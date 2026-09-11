/**
 * Phase 3 — aggregate the QA layers into scores + a short, SURGICAL fix list,
 * then apply those fixes without ever rebuilding the site.
 *
 *   structural + content + visual + image + diversity  →  QaScores
 *   visual.recommendedFixes (+ a few derived)           →  TargetedFix[]  (≤4)
 *   applyTargetedFixes: re-search ONE image / re-pick ONE variant / nudge the
 *   theme / rewrite ONE section's copy — nothing more.
 *
 * The pipeline loops gate → apply at most twice. Results stay server-side
 * (`GenerateResult.report`); the studio never sees "problems to fix".
 */
import { SECTION_CATALOG, seedSectionContent, snapVariant, type SeedCtx } from '../section-catalog';
import type { BuilderDoc, DocSection } from '../compose-advanced';
import type { AuditCheck, SiteFinding } from '../site-audit';
import { deriveImageIntents } from './image-intent';
import { applyResolvedImages } from './image-provider/image-apply';
import type {
  BusinessProfile,
  DesignDNA,
  GeneratorAi,
  GeneratorBusiness,
  ImageSearchResolver,
  QaScores,
  TargetedFix,
  VisualReview,
} from './types';

// --- scoring ---------------------------------------------------------

export interface QualityGateInput {
  doc: BuilderDoc;
  structuralChecks: AuditCheck[];
  findings: SiteFinding[];
  visual: VisualReview | null;
  /** 0..1 — min structural fingerprint distance to the company's recent sites. */
  diversityDistance: number;
  imageSlots: { filled: number; total: number };
}

export interface QualityGateResult {
  scores: QaScores;
  fixes: TargetedFix[];
}

const SECTION_FIX_RE = /^section:([^.]+)\.(image|variant|copy)$/;

function validFix(fix: TargetedFix, ids: Set<string>): boolean {
  if (fix.target === 'hero.image' || fix.target === 'typography' || fix.target === 'spacing') {
    return true;
  }
  const m = SECTION_FIX_RE.exec(fix.target);
  return !!m && ids.has(m[1]);
}

export function runQualityGate(input: QualityGateInput): QualityGateResult {
  const { doc, structuralChecks, findings, visual, diversityDistance, imageSlots } = input;

  const total = structuralChecks.length || 1;
  const passed = structuralChecks.filter((c) => c.ok).length;
  const structural = passed / total;

  const blocks = findings.filter((f) => f.severity === 'block').length;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  const content = Math.max(0, 1 - (blocks * 0.34 + warns * 0.12));

  const visualScore = visual ? Math.max(0, Math.min(1, visual.score / 100)) : 0.75;
  const image = imageSlots.total ? imageSlots.filled / imageSlots.total : 1;
  const diversity = Math.max(0, Math.min(1, diversityDistance));

  const scores: QaScores = {
    structural: round(structural),
    content: round(content),
    visual: round(visualScore),
    image: round(image),
    diversity: round(diversity),
  };

  // --- collect fixes ---
  const ids = new Set(doc.pages.flatMap((p) => p.sections).map((s) => s.id));
  const heroId = doc.pages.flatMap((p) => p.sections).find((s) => s.type === 'hero')?.id;
  const seen = new Set<string>();
  const fixes: TargetedFix[] = [];
  const push = (f: TargetedFix): void => {
    if (seen.has(f.target) || !validFix(f, ids)) return;
    seen.add(f.target);
    fixes.push(f);
  };

  for (const f of visual?.recommendedFixes ?? []) push(f);

  if (image < 0.6 && heroId) {
    push({
      target: `section:${heroId}.image`,
      instruction: 'weak / missing hero image — search a stronger one',
    });
  }
  if (visualScore < 0.55 && visual) {
    const txt = [...visual.criticalIssues, ...visual.warnings].join(' ').toLowerCase();
    if (/typograph|font|heading|type scale/.test(txt)) {
      push({ target: 'typography', instruction: 'tighten the type scale / heading treatment' });
    }
    if (/spacing|cramped|crowded|dense|whitespace|padding/.test(txt)) {
      push({ target: 'spacing', instruction: 'give sections more breathing room' });
    }
  }

  return { scores, fixes: fixes.slice(0, 4) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Below this, a sub-score is worth a repair round (if a matching fix exists). */
export const GATE_THRESHOLD = 0.72;

export function gatePasses(scores: QaScores): boolean {
  return (
    scores.structural >= 0.85 &&
    scores.content >= GATE_THRESHOLD &&
    scores.visual >= GATE_THRESHOLD &&
    scores.image >= 0.5
  );
}

// --- applying fixes -------------------------------------------------

export interface ApplyFixesInput {
  doc: BuilderDoc;
  fixes: TargetedFix[];
  ctx: SeedCtx;
  ai: GeneratorAi;
  dna: DesignDNA;
  profile: BusinessProfile;
  business: GeneratorBusiness;
  brief: string;
  seed: number;
  images?: ImageSearchResolver;
}

export interface ApplyFixesResult {
  doc: BuilderDoc;
  /** Human-readable list of what changed (logs only). */
  applied: string[];
}

const H_SCALE_DOWN: Record<string, string> = { display: 'normal', normal: 'tight', tight: 'tight' };
const DENSITY_UP: Record<string, string> = {
  compact: 'comfortable',
  comfortable: 'spacious',
  spacious: 'spacious',
};

export async function applyTargetedFixes(input: ApplyFixesInput): Promise<ApplyFixesResult> {
  const { doc, fixes, ctx, ai, dna, profile, business, brief, seed, images } = input;
  const applied: string[] = [];
  const allSections = doc.pages.flatMap((p) => p.sections);
  const heroId = allSections.find((s) => s.type === 'hero')?.id;
  const bySectionId = new Map(allSections.map((s) => [s.id, s]));

  const copyTargets: DocSection[] = [];
  const imageTargets: DocSection[] = [];

  for (const fix of fixes) {
    if (fix.target === 'typography') {
      const cur = String(doc.theme.headingScale ?? 'normal');
      const next = H_SCALE_DOWN[cur] ?? 'normal';
      if (next !== cur) {
        doc.theme.headingScale = next as typeof doc.theme.headingScale;
        applied.push(`typography: heading scale ${cur} → ${next}`);
      }
      continue;
    }
    if (fix.target === 'spacing') {
      const cur = String(doc.theme.density ?? 'comfortable');
      const next = DENSITY_UP[cur] ?? 'comfortable';
      if (next !== cur) {
        doc.theme.density = next as typeof doc.theme.density;
        applied.push(`spacing: density ${cur} → ${next}`);
      }
      continue;
    }
    if (fix.target === 'hero.image') {
      const s = heroId ? bySectionId.get(heroId) : undefined;
      if (s) imageTargets.push(s);
      continue;
    }
    const m = SECTION_FIX_RE.exec(fix.target);
    if (!m) continue;
    const s = bySectionId.get(m[1]);
    if (!s) continue;
    if (m[2] === 'variant') {
      const opts = (SECTION_CATALOG[s.type]?.variants ?? [])
        .map((v) => v.id)
        .filter((v) => v !== s.variant);
      if (opts.length) {
        s.variant = snapVariant(s.type, opts[Math.abs(seed) % opts.length]);
        applied.push(`variant: ${s.type} → ${s.variant}`);
      }
    } else if (m[2] === 'image') {
      imageTargets.push(s);
    } else if (m[2] === 'copy') {
      copyTargets.push(s);
    }
  }

  // --- re-search images for the flagged sections (one resolve call) ---
  if (imageTargets.length && images?.configured) {
    const miniDoc: BuilderDoc = {
      ...doc,
      pages: [{ id: 'p', title: 'p', slug: 'p', isHome: true, nav: true, sections: imageTargets }],
    };
    const intents = await deriveImageIntents(ai, {
      doc: miniDoc,
      profile,
      dna,
      business,
      locale: ctx.locale,
      seed: seed + 101,
    });
    if (intents.length) {
      const resolved = await images
        .resolve({ intents, seed: seed + 101, dna, profile })
        .catch(() => new Map());
      const { applied: n } = applyResolvedImages(doc, intents, resolved);
      if (n) applied.push(`image: re-searched ${n} slot(s)`);
    }
  }

  // --- rewrite the flagged sections' copy (one batched call) ---
  if (copyTargets.length && ai.configured) {
    const fixesOut = await ai
      .fixSections({
        brief,
        business,
        locale: ctx.locale,
        sections: copyTargets.map((s) => ({
          ref: s.type,
          type: s.type,
          variant: s.variant,
          fieldKeys: (SECTION_CATALOG[s.type]?.fields ?? []).map((f) => f.key),
          content: s.content ?? {},
          issues: ['the visual review flagged this section — make the copy sharper and specific'],
        })),
      })
      .catch(() => null);
    if (fixesOut) {
      let n = 0;
      for (const [i, content] of Object.entries(fixesOut)) {
        const s = copyTargets[Number(i)];
        if (!s) continue;
        s.content = { ...(s.content ?? {}), ...content };
        n++;
      }
      if (n) applied.push(`copy: rewrote ${n} section(s)`);
    }
  }

  // seed-fill anything a rewrite emptied
  for (const s of copyTargets) {
    const c = s.content ?? {};
    const empty = Object.values(c).every(
      (v) => (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length),
    );
    if (empty) s.content = seedSectionContent(s.type, ctx);
  }

  return { doc, applied };
}
