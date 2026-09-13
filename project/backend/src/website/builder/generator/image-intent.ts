/**
 * Stage 7 — turn the composed doc's image slots into typed `ImageIntent`s.
 *
 * Deterministic: it walks the doc, finds the fields that carry a photo (the same
 * set `fillDocImages` fills), and describes each one with a SUBJECT + SCENE
 * drawn from the business profile's `visualOpportunities`, an orientation from
 * the section type/variant, and the DNA's photography style. One optional
 * batched AI call (`enrichImageIntents`) then sharpens the subjects — into
 * `refinedSubject` / `refinedScene`, so the SEARCH query stays deterministic and
 * the Pexels cache keeps hitting across re-generations.
 *
 * `profile.imageIntensity` caps how many slots get a real photo — but WHOLE
 * multi-item sections at a time, so a gallery is never "2 Pexels + 1 pool".
 */
import type { BuilderDoc, DocSection } from '../compose-advanced';
import type { StudioLocale } from '../section-catalog';
import type {
  BusinessProfile,
  DesignDNA,
  GeneratorAi,
  GeneratorBusiness,
  ImageIntent,
} from './types';

const INTENSITY_CAP: Record<BusinessProfile['imageIntensity'], number> = {
  minimal: 3,
  medium: 6,
  high: 9,
  'gallery-led': 14,
};

const DEFAULT_AVOID = ['logo', 'illustration', 'text overlay', 'watermark', 'collage'];

interface RawSlot {
  section: DocSection;
  field: string;
  itemIndex?: number;
  role: string;
  orientation: ImageIntent['orientation'];
  priority: number; // lower = more important, kept when the cap bites
  /** Which page this slot lives on — the topical anchor for AI enrichment on a
   *  multi-pillar site (a "Design Interior" page shouldn't get an office photo
   *  just because it shares a global `visualOpportunities` rotation). */
  pageTitle: string;
}

type BareSlot = Omit<RawSlot, 'pageTitle'>;

function bareSlotsForSection(s: DocSection): BareSlot[] {
  const c = (s.content ?? {}) as Record<string, unknown>;
  const items = Array.isArray(c.items) ? (c.items as Record<string, unknown>[]) : [];
  switch (s.type) {
    case 'hero':
      // A "minimal" hero is deliberately text-only (also the lean page-header
      // on secondary pages) — never search a photo for it.
      return s.variant === 'minimal'
        ? []
        : [
            {
              section: s,
              field: 'backgroundImage',
              role: 'hero',
              orientation: 'landscape',
              priority: 0,
            },
          ];
    case 'showcase':
      return [
        {
          section: s,
          field: 'backgroundImage',
          role: 'showcase environment',
          orientation: 'landscape',
          priority: 2,
        },
      ];
    case 'caseStudy':
      return [
        {
          section: s,
          field: 'imageUrl',
          role: 'completed project',
          orientation: 'landscape',
          priority: 2,
        },
      ];
    case 'about':
      return ['imageRight', 'imageLeft', 'twoCol'].includes(s.variant)
        ? [
            {
              section: s,
              field: 'imageUrl',
              role: 'workspace, people at work',
              orientation: 'portrait',
              priority: 3,
            },
          ]
        : [];
    case 'gallery':
      return items.map((_, i) => ({
        section: s,
        field: 'imageUrl',
        itemIndex: i,
        role: 'portfolio piece, single clean subject',
        orientation: 'landscape' as const,
        priority: 1,
      }));
    case 'featureSplit':
    case 'bento':
    case 'tabs':
      return items.map((_, i) => ({
        section: s,
        field: 'imageUrl',
        itemIndex: i,
        role: 'service in action, real detail',
        orientation: 'landscape' as const,
        priority: 4,
      }));
    default:
      return [];
  }
}

function slotsForSection(s: DocSection, pageTitle: string): RawSlot[] {
  return bareSlotsForSection(s).map((slot) => ({ ...slot, pageTitle }));
}

function pickSubject(opps: string[], seed: number, i: number): string {
  if (!opps.length) return '';
  return opps[(Math.abs(seed) + i) % opps.length];
}

/**
 * Slot GROUPS: a single-image section is its own group; every multi-item section
 * (gallery / tabs / bento / featureSplit) is ONE group so the cap keeps or drops
 * it whole. Groups are ordered by priority; the hero group is always kept.
 */
function groupSlots(raw: RawSlot[]): RawSlot[][] {
  const byKey = new Map<string, RawSlot[]>();
  for (const slot of raw) {
    const key =
      slot.itemIndex == null
        ? `${slot.section.id}:${slot.field}:one`
        : `${slot.section.id}:${slot.field}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(slot);
    else byKey.set(key, [slot]);
  }
  return [...byKey.values()].sort(
    (a, b) => Math.min(...a.map((s) => s.priority)) - Math.min(...b.map((s) => s.priority)),
  );
}

function capBySection(raw: RawSlot[], cap: number): RawSlot[] {
  const groups = groupSlots(raw);
  const kept: RawSlot[] = [];
  let total = 0;
  for (const group of groups) {
    const isHero = group.some((s) => s.role === 'hero');
    if (isHero || total + group.length <= cap) {
      kept.push(...group);
      total += group.length;
    }
    // otherwise skip this group (don't break — a smaller later group may fit)
  }
  return kept;
}

export interface DeriveImageIntentsInput {
  doc: BuilderDoc;
  profile: BusinessProfile;
  dna: DesignDNA;
  business: GeneratorBusiness;
  locale: StudioLocale;
  seed: number;
}

/** Build the intents. Runs `ai.enrichImageIntents` when a key is present. */
export async function deriveImageIntents(
  ai: GeneratorAi,
  input: DeriveImageIntentsInput,
): Promise<ImageIntent[]> {
  const { doc, profile, dna, business, locale, seed } = input;

  const raw: RawSlot[] = [];
  for (const p of doc.pages) {
    if (p.system) continue;
    for (const s of p.sections) raw.push(...slotsForSection(s, p.title));
  }
  if (!raw.length) return [];

  const kept = capBySection(raw, Math.max(1, INTENSITY_CAP[profile.imageIntensity] ?? 6));

  const sceneBase = [profile.businessType, business.city].filter(Boolean).join(', ');
  const avoidBase = [...DEFAULT_AVOID];
  if (/candid|documentary|real|unposed/i.test(dna.photographyStyle)) {
    avoidBase.push('posed studio portrait');
  }

  const intents: ImageIntent[] = kept.map((slot, i) => ({
    sectionId: slot.section.id,
    field: slot.field,
    ...(slot.itemIndex != null ? { itemIndex: slot.itemIndex } : {}),
    role: slot.role,
    subject: pickSubject(profile.visualOpportunities, seed, i) || profile.businessType,
    scene: sceneBase,
    mood: profile.emotionalTone,
    composition: slot.role === 'hero' ? dna.heroStyle : dna.compositionStyle,
    style: dna.photographyStyle,
    orientation: slot.orientation,
    avoid: avoidBase,
  }));

  // --- optional AI enrichment (one batched call) ---
  // Refined phrasing lands in `refinedSubject` / `refinedScene` (ranking + alt
  // text) and `avoid` — never `subject`/`scene`, so the query is reproducible.
  // `pageTitle` is the anti-cross-pillar-bleed signal: on a multi-pillar site
  // (e.g. "Design Interior" + "Proiecte Comerciale" pages), the naive rotation
  // over the business-wide `visualOpportunities` list has no idea which pillar
  // a given slot belongs to — the model does, given the page it's actually on.
  if (ai.configured) {
    const bySlotKey = new Map<string, ImageIntent>();
    const slots = intents.map((it, i) => {
      const key = `${it.sectionId}:${it.field}:${it.itemIndex ?? 0}`;
      bySlotKey.set(key, it);
      return {
        key,
        role: it.role,
        sectionType:
          doc.pages.flatMap((p) => p.sections).find((s) => s.id === it.sectionId)?.type ?? '',
        hint: `${it.subject} — ${it.scene}`,
        pageTitle: kept[i].pageTitle,
      };
    });
    const enriched = await ai
      .enrichImageIntents({ business, profile, dna, locale, slots })
      .catch(() => null);
    if (enriched) {
      for (const [key, e] of Object.entries(enriched)) {
        const it = bySlotKey.get(key);
        if (!it) continue;
        if (e.subject) it.refinedSubject = e.subject;
        if (e.scene) it.refinedScene = e.scene;
        if (e.avoid?.length) it.avoid = [...new Set([...it.avoid, ...e.avoid])].slice(0, 8);
      }
    }
  }

  return intents;
}
