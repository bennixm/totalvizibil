/**
 * Stage 5: (IASpec + DesignDNA + seed) → a concrete `LayoutRecipe`. Fully
 * deterministic.
 *
 * For each IA role: a catalog `type`, a `variant`, a `compositionMode`, and an
 * `imageSlot`. The **section-rhythm engine** assigns modes so no two adjacent
 * sections share one — killing "centered heading → cards → centered heading →
 * cards". The **variant picker** is a seeded, DNA-biased weighted choice over
 * the type's catalog variants — never "always variants[0]".
 */
import type { SectionType, WebsiteTheme } from '../../website.types';
import { SECTION_CATALOG, snapVariant, styleTargetKeys, textFieldKeys } from '../section-catalog';
import { normalizeTheme, PRESET_IDS, type ElementStyle } from '../compose-advanced';
import type { Archetype } from '../site-archetypes';
import { hashInt } from '../stock-images';
import { dnaToTheme, dnaToTypography } from './design-dna';
import { roleToType, SPLIT_OFF } from './information-architecture';
import type {
  BusinessProfile,
  CompositionMode,
  DesignDNA,
  IASpec,
  ImageSlotSpec,
  LayoutRecipe,
  RecipePage,
  RecipeSection,
  SectionRole,
  SuggestedPage,
} from './types';
import type { SeedCtx } from '../section-catalog';

// --- composition-mode → variant affinity ------------------------------

const MODE_VARIANT_HINT: Record<CompositionMode, RegExp> = {
  full: /^(imageBg|gradient|wide|band|flat|full|plain)$/i,
  split: /^(split|imageRight|imageLeft|twoCol|columns|side|alternating|line)$/i,
  asymmetric: /^(overlap|imageRight|imageLeft|alternating|left|masonry|mixed|stat)$/i,
  centered: /^(centered|center|single|plain|narrow|accordion|tiers)$/i,
  editorial: /^(minimal|editorial|quote|ticker|rows|list|narrow|alternating)$/i,
  grid: /^(grid|cards|iconGrid|even|columns|masonry|tiers)$/i,
  'image-led': /^(imageBg|masonry|carousel|wide|overlap|gallery|showcase)$/i,
  compact: /^(inline|compact|strip|plain|list|flat|line)$/i,
};

const CARD_STYLE_HINT: Record<DesignDNA['cardStyle'], RegExp> = {
  flat: /^(list|rows|plain|minimal|inline|line)$/i,
  bordered: /^(cards|grid|table|columns|accordion)$/i,
  raised: /^(cards|tiers|boxed|grid)$/i,
  editorial: /^(quote|single|ticker|minimal|rows|alternating|masonry|editorial)$/i,
};

/** Seeded, DNA-biased pick over a section type's catalog variants. */
export function pickVariant(
  type: SectionType,
  dna: DesignDNA,
  mode: CompositionMode,
  seed: number,
  used: Set<string>,
): string {
  const spec = SECTION_CATALOG[type];
  const variants = spec?.variants?.map((v) => v.id) ?? [];
  if (!variants.length) return snapVariant(type, '');
  if (variants.length === 1) return variants[0];

  const modeRe = MODE_VARIANT_HINT[mode];
  const cardRe = CARD_STYLE_HINT[dna.cardStyle];
  const composRe =
    dna.compositionStyle === 'grid'
      ? /^(grid|cards|iconGrid|even|columns)$/i
      : dna.compositionStyle === 'editorial'
        ? /^(editorial|minimal|rows|quote|alternating|masonry)$/i
        : dna.compositionStyle === 'asymmetric'
          ? /^(overlap|imageLeft|imageRight|alternating|masonry|mixed|left)$/i
          : /^(centered|center|single|plain|narrow)$/i;

  const scored = variants.map((id, i) => {
    let score = 4 + ((Math.abs(seed + i + hashInt(type + id)) % 5) - 2); // seeded jitter
    if (modeRe.test(id)) score += 6;
    if (cardRe.test(id)) score += 3;
    if (composRe.test(id)) score += 3;
    if (type === 'hero' && id === dna.heroStyle) score += 8;
    if (used.has(`${type}:${id}`)) score -= 5; // spread variants across the site
    return { id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

// --- section-rhythm engine ------------------------------------------

/**
 * Assign a composition mode to each section, following the DNA rhythm target
 * but NEVER repeating the previous section's mode. Hero + contact are pinned.
 * `emphasis` (AI's per-role visual-weight hint, from Stage 4's `planArchitecture`)
 * overrides the rotation for that one role when present and valid — still
 * subject to the same "never repeat the previous mode" rule, so a hint can't
 * break the rhythm engine's core guarantee, only bias it.
 */
export function assignRhythm(
  roles: SectionRole[],
  dna: DesignDNA,
  seed: number,
  emphasis?: Partial<Record<SectionRole, CompositionMode>>,
): CompositionMode[] {
  const target = dna.sectionRhythm.length
    ? dna.sectionRhythm
    : (['split', 'grid', 'centered', 'full', 'editorial'] as CompositionMode[]);
  const alt: CompositionMode[] = [
    'split',
    'grid',
    'centered',
    'full',
    'editorial',
    'asymmetric',
    'compact',
  ];
  const out: CompositionMode[] = [];
  let ti = Math.abs(seed) % target.length;

  roles.forEach((role, idx) => {
    if (role === 'hero') {
      out.push('full');
      return;
    }
    if (role === 'contact') {
      out.push(out[out.length - 1] === 'split' ? 'centered' : 'split');
      return;
    }
    let mode = emphasis?.[role] ?? target[ti % target.length];
    ti++;
    if (mode === out[out.length - 1]) {
      // walk the alt list for the first mode that differs from the neighbour
      mode =
        alt.find((m, k) => m !== out[out.length - 1] && Math.abs(seed + idx + k) % 3 === 0) ??
        alt.find((m) => m !== out[out.length - 1]) ??
        'grid';
    }
    out.push(mode);
  });
  return out;
}

// --- style variety (item 6: the new per-target overrides should make each
// generated site more visually distinct, not just sit unused) -------------

/** Buttons/inputs get their OWN radius axis (tied to `cardStyle`, not the
 *  theme's own `radius`) — a deliberate second variable so a button's
 *  silhouette can differ from a card's, not just mirror it. */
const BUTTON_RADIUS_BY_CARD: Record<DesignDNA['cardStyle'], NonNullable<WebsiteTheme['radius']>> = {
  flat: 'none',
  bordered: 'subtle',
  raised: 'large',
  editorial: 'pill',
};

/** Which named style preset (see `compose-advanced.ts` `PRESET_IDS`) a
 *  generated site's archetype reads as — lets an AI-generated site pick up
 *  the SAME preset-scoped structural/visual CSS treatments (see
 *  `WebsiteRenderer.vue`'s `.site--preset-*` rules) that a manually-applied
 *  ThemeBar preset gets, instead of the two paths being visually disjoint.
 *  Mirrors (doesn't duplicate the exact keyword logic of) the brief-keyword
 *  preset guess already used by the deterministic `keywordPlanDoc` fallback
 *  (`compose-advanced.ts`) — this one is exhaustive over every archetype
 *  since it has the already-classified archetype to work from, not raw text. */
const ARCHETYPE_PRESET: Record<Archetype, (typeof PRESET_IDS)[number]> = {
  'local-trade': 'studio',
  agency: 'studio',
  portfolio: 'editorial',
  saas: 'tech',
  hospitality: 'warm',
  clinic: 'soft',
  shop: 'bold',
  events: 'bold',
  generic: 'studio',
};

/** One site-wide "box" override (buttons/inputs) and one "gap" override
 *  (spacing between repeated cards/rows/form fields), both DNA-derived and
 *  deterministic — reused across every section that exposes the matching
 *  target, so the whole site reads as one coherent, deliberately-styled
 *  choice rather than a random per-section flourish. */
function deriveStyleVariety(dna: DesignDNA): { box?: ElementStyle; gap?: ElementStyle } {
  // A deliberately plain/minimal art direction skips the flourish entirely —
  // "less decoration" is itself a valid, distinct look, not a gap to fill.
  if (dna.decorativeStyle === 'none') return {};
  const gap: ElementStyle['gap'] =
    dna.spacing === 'compact' ? 'tight' : dna.spacing === 'spacious' ? 'relaxed' : 'normal';
  const box: ElementStyle = {
    radius: BUTTON_RADIUS_BY_CARD[dna.cardStyle],
    font: dna.typography.headingFont,
  };
  // Only add a border when we also have a real brand colour for it — a bare
  // `borderWidth` with no matching `borderColor` falls back to the browser's
  // default (usually black), which looks like a bug, not a style choice.
  if (dna.cardStyle === 'bordered' && dna.colorStrategy.accentHex) {
    box.borderWidth = 'thin';
    box.borderColor = dna.colorStrategy.accentHex;
  }
  return { box, gap: { gap } };
}

/** The non-prose style targets a section type exposes, split by kind — a
 *  "box" target (button/input) reads the box override, a "gap" target
 *  (`itemsGap`/`formGap`) reads the gap override. `formLead` is prose (styled
 *  via the normal per-element text override, not this pass) so it's excluded
 *  from both. */
function extraStyleTargets(type: SectionType): { box: string[]; gap: string[] } {
  const prose = new Set(textFieldKeys(type));
  const extra = styleTargetKeys(type).filter((k) => !prose.has(k));
  return {
    box: extra.filter((k) => !/Gap$/i.test(k) && k !== 'formLead'),
    gap: extra.filter((k) => /Gap$/i.test(k)),
  };
}

// --- image slots -------------------------------------------------

const NO_IMAGE_TYPES = new Set<SectionType>([
  'faq',
  'contact',
  'pricing',
  'stats',
  'newsletter',
  'marquee',
  'logos',
  'hours',
  'comparison',
  'team',
  'quoteBig',
]);

function imageSlotFor(
  role: SectionRole,
  type: SectionType,
  mode: CompositionMode,
  dna: DesignDNA,
  profile: BusinessProfile,
  idx: number,
): ImageSlotSpec {
  const noneByIntensity =
    profile.imageIntensity === 'minimal' &&
    role !== 'hero' &&
    role !== 'gallery' &&
    role !== 'work' &&
    role !== 'featuredProject';
  const needed =
    !NO_IMAGE_TYPES.has(type) &&
    !noneByIntensity &&
    (role === 'hero' ||
      role === 'gallery' ||
      role === 'work' ||
      role === 'about' ||
      role === 'story' ||
      role === 'featuredProject' ||
      ['image-led', 'split', 'asymmetric', 'full'].includes(mode) ||
      // spread a few supporting images through medium/high-intensity sites
      ((profile.imageIntensity === 'high' || profile.imageIntensity === 'gallery-led') &&
        idx % 2 === 0));

  const orientation: ImageSlotSpec['orientation'] =
    role === 'hero'
      ? mode === 'split' || mode === 'asymmetric'
        ? 'landscape'
        : 'landscape'
      : role === 'team'
        ? 'portrait'
        : mode === 'split' || mode === 'editorial'
          ? 'portrait'
          : 'landscape';

  const focal =
    role === 'hero'
      ? dna.heroStyle === 'imageBg'
        ? 'wide, strong central subject, room for an overlay'
        : 'wide, subject to one side, negative space opposite'
      : role === 'gallery' || role === 'work'
        ? 'clean single subject, portfolio-grade'
        : 'supporting, contextual, not the focus';

  return { needed, orientation, role: `${role}`, focal };
}

// --- recipe assembly --------------------------------------------

export interface BuildRecipeInput {
  ia: IASpec;
  dna: DesignDNA;
  profile: BusinessProfile;
  ctx: SeedCtx;
  seed: number;
  /** The page structure the client actually picked/confirmed (clarification,
   *  or Stage 0's own softer guess) — when present, the produced pages are
   *  renamed to these exact titles/purposes (matched to the best-fitting
   *  `SPLIT_OFF` group by keyword, not just position) so what the client
   *  chose during setup is what the generated site's page list shows. */
  suggestedPages?: SuggestedPage[];
}

/** Keyword hints used to match a client-chosen page name to the `SPLIT_OFF`
 *  group whose content it's actually asking for (e.g. "Portofoliu" → `work`),
 *  rather than assigning chosen names to groups in an arbitrary seed order. */
const GROUP_KEYWORDS: Record<string, RegExp> = {
  work: /lucr[aă]ri|portofoliu|proiecte|galerie|work|portfolio|projects|gallery|showcase/i,
  services: /servicii|pre[țt]uri|pachete|services|pricing|packages|plans|men[iu]u|menu/i,
  about: /despre|echip[aă]|poveste|about|team|story|company|firma|firmă/i,
  proof: /recenzii|testimoniale|compara[țt]ie|reviews|comparison|why ?us|de ?ce ?noi/i,
};

const PAGE_TITLE: Record<string, Record<SeedCtx['locale'], string>> = {
  home: { ro: 'Acasă', en: 'Home', de: 'Start' },
  work: { ro: 'Lucrări', en: 'Work', de: 'Arbeiten' },
  services: { ro: 'Servicii', en: 'Services', de: 'Leistungen' },
  about: { ro: 'Despre', en: 'About', de: 'Über uns' },
  proof: { ro: 'De ce noi', en: 'Why us', de: 'Warum wir' },
  contact: { ro: 'Contact', en: 'Contact', de: 'Kontakt' },
};

// `SPLIT_OFF` (which roles form which secondary page) now lives in
// `information-architecture.ts` — `planIA`'s retry heuristic needs the same
// table to judge whether a role list can actually reach a client-forced page
// count, so it's the shared source of truth rather than duplicated here.

const HOME_TITLE_RE = /^(acas[aă]|home|start)$/i;
const CONTACT_TITLE_RE = /^contact(are)?$/i;

export function buildRecipe(input: BuildRecipeInput): LayoutRecipe {
  const { ia, dna, profile, ctx, seed } = input;
  const usedVariants = new Set<string>();

  // The pages the client actually chose (clarification) or Stage 0 guessed —
  // minus its "home" entry (renamed onto the home page below) and any bare
  // "Contact" entry (contact is already an anchor role, never a SPLIT_OFF
  // group of its own, so matching it to one would just waste a page slot).
  // NOTE: only a REAL clarify-driven page list includes a home/"Acasă" entry
  // (the clarify prompt asks for one explicitly) — Stage 0's own deterministic
  // per-archetype guess (`ARCHETYPE_PAGE_HINTS`) never does, it only lists 1-2
  // secondary pages. So home is renamed ONLY on an explicit match, never by
  // assuming the first entry is home — that would misname the home page from
  // the archetype fallback (e.g. "Services") on every plain generation.
  const allSuggested = (input.suggestedPages ?? []).filter((sp) => sp.title?.trim());
  const homeSuggested = allSuggested.find((sp) => HOME_TITLE_RE.test(sp.title.trim()));
  const namedPages = allSuggested.filter(
    (sp) => sp !== homeSuggested && !CONTACT_TITLE_RE.test(sp.title.trim()),
  );

  const roleList = ia.roles.map((r) => r.role);
  const emphasis = Object.fromEntries(
    ia.roles.filter((r) => r.emphasis).map((r) => [r.role, r.emphasis]),
  ) as Partial<Record<SectionRole, CompositionMode>>;
  const modes = assignRhythm(roleList, dna, seed, emphasis);

  // One coherent, DNA-derived style choice for the whole site's buttons/
  // inputs and item spacing — see `deriveStyleVariety`. Applied uniformly
  // below so every section that exposes a matching target picks it up.
  const variety = deriveStyleVariety(dna);
  function withVariety(rs: RecipeSection): RecipeSection {
    const targets = extraStyleTargets(rs.type);
    if (!targets.box.length && !targets.gap.length) return rs;
    const overrides: Record<string, ElementStyle> = { ...(rs.overrides ?? {}) };
    if (variety.box) for (const k of targets.box) overrides[k] = variety.box;
    if (variety.gap) for (const k of targets.gap) overrides[k] = variety.gap;
    return Object.keys(overrides).length ? { ...rs, overrides } : rs;
  }

  const allSections: RecipeSection[] = ia.roles.map((r, i) => {
    const type = roleToType(r.role, dna, profile, seed);
    const mode = modes[i];
    const variant = pickVariant(type, dna, mode, seed + i, usedVariants);
    usedVariants.add(`${type}:${variant}`);
    const imageSlot = imageSlotFor(r.role, type, mode, dna, profile, i);
    const animation = animationFor(mode, dna, i, seed);
    return withVariety({
      role: r.role,
      type,
      variant,
      composition: mode,
      ...(animation ? { animation } : {}),
      imageSlot,
    });
  });

  // Ensure home opens with a hero and ends (on the last page) with contact.
  if (allSections[0]?.type !== 'hero') {
    allSections.unshift(
      withVariety({
        role: 'hero',
        type: 'hero',
        variant: dna.heroStyle,
        composition: 'full',
        imageSlot: imageSlotFor('hero', 'hero', 'full', dna, profile, 0),
      }),
    );
  }

  const pages: RecipePage[] = [];
  if (ia.pageStrategy === 'multi-page' && ia.pageCount >= 2) {
    // Peel off up to (pageCount - 1) DISTINCT split-off groups — each becomes
    // its own page, in a seed-rotated order — instead of always exactly one.
    // A thin group (fewer than 3 matching sections — a page needs real depth,
    // not just 1-2 sections) is skipped, never blocks the others, so a rich
    // brief can genuinely reach 3-4 pages.
    const groups = Object.entries(SPLIT_OFF);
    let order = groups.map((_, i) => groups[(Math.abs(seed) + i) % groups.length]);
    // A client-named page structure REORDERS the groups to match it (e.g. a
    // page called "Portofoliu" pulls the `work` group ahead of the seed's
    // default rotation), instead of the group that happens to peel off first
    // getting an unrelated chosen name slapped onto it.
    const groupTitle = new Map<string, SuggestedPage>();
    if (namedPages.length) {
      const pool = new Map(groups);
      const preferred: (typeof groups)[number][] = [];
      for (const sp of namedPages) {
        let bestKey: string | undefined;
        let bestScore = -1;
        for (const [key, groupRoles] of pool) {
          const re = GROUP_KEYWORDS[key];
          const keywordHit = !!re && (re.test(sp.title) || re.test(sp.purpose));
          // A chosen name with no keyword match still prefers a group that
          // actually has content in THIS business's IA over an empty one —
          // otherwise an unrecognized name can land on a group that produces
          // no page at all, wasting the client's chosen name for nothing.
          const hasContent = groupRoles.some(
            (r) => roleList.includes(r) && r !== 'hero' && r !== 'contact',
          );
          const score = (keywordHit ? 2 : 0) + (hasContent ? 1 : 0);
          if (score > bestScore) {
            bestScore = score;
            bestKey = key;
          }
        }
        if (bestKey) {
          preferred.push([bestKey, pool.get(bestKey)!]);
          groupTitle.set(bestKey, sp);
          pool.delete(bestKey);
        }
      }
      // Leftover groups (no chosen page matched them) stay available as
      // filler if `pageCount` allows more pages than were explicitly named.
      for (const entry of groups) if (pool.has(entry[0])) preferred.push(entry);
      order = preferred;
    }
    const wantExtra = Math.min(ia.pageCount - 1, groups.length);
    const remaining = new Set(allSections);
    const extraPages: RecipePage[] = [];
    for (const [pageKey, roles] of order) {
      if (extraPages.length >= wantExtra) break;
      const matched = [...remaining].filter(
        (s) => roles.includes(s.role) && s.role !== 'hero' && s.role !== 'contact',
      );
      // Symmetric floor: a group only peels off if it leaves BOTH the new
      // page and home (whatever stays in `remaining`) with real depth —
      // otherwise home ends up hoarding everything that isn't an anchor
      // role while a thin secondary page looks unfinished.
      const homeAfter = remaining.size - matched.length;
      if (matched.length < 3 || homeAfter < 4) continue;
      for (const s of matched) remaining.delete(s);
      // Every secondary page opens with its own lean header — a "minimal"
      // hero. That variant is deliberately treated as image-free downstream
      // (`fillDocImages` / `deriveImageIntents` both skip it), so this never
      // reads as headless AND never costs an extra Pexels search. It also
      // CLOSES with its own call-to-action — `primaryCTA`/`secondaryCTA` are
      // anchor-only roles (never in a SPLIT_OFF group), so without this a
      // secondary page would just stop after its content, never asking for
      // anything. Deterministic, reuses `pickVariant` — no extra AI call.
      extraPages.push(
        page(
          pageKey,
          [
            withVariety(pageHeaderSection()),
            ...matched,
            withVariety(pageClosingCta(dna, seed + hashInt(pageKey), usedVariants)),
          ],
          ctx,
          dna,
          groupTitle.get(pageKey),
        ),
      );
    }
    if (extraPages.length) {
      pages.push(page('home', [...remaining], ctx, dna, homeSuggested));
      pages.push(...extraPages);
      // contact lives on the LAST page actually built, not an assumed one
      const last = pages[pages.length - 1];
      if (!last.sections.some((s) => s.role === 'contact')) {
        const home = pages[0];
        const contactIdx = home.sections.findIndex((s) => s.role === 'contact');
        if (contactIdx >= 0) {
          const [contact] = home.sections.splice(contactIdx, 1);
          last.sections.push(contact);
        }
      }
    }
  }
  if (!pages.length) pages.push(page('home', allSections, ctx, dna, homeSuggested));

  // theme = DNA projection (normalizeTheme fills any gap with its own defaults)
  const theme: WebsiteTheme = normalizeTheme({
    ...dnaToTheme(dna),
    ...dnaToTypography(dna),
    preset: ARCHETYPE_PRESET[profile.archetype],
  });

  return { pages, theme };
}

/**
 * A lean, text-only page-intro for a secondary page — a "minimal" hero.
 * `imageSlot.needed: false` here is a hint only; the real cost-avoidance is
 * that `fillDocImages` / `deriveImageIntents` both special-case a "minimal"
 * hero as image-free by design (it's the one hero style meant to run without
 * a photo), so adding this never triggers another Pexels search.
 */
function pageHeaderSection(): RecipeSection {
  return {
    role: 'hero',
    type: 'hero',
    variant: 'minimal',
    composition: 'compact',
    imageSlot: { needed: false, orientation: 'landscape', role: 'page header', focal: '' },
  };
}

/**
 * A secondary page's closing call-to-action. `primaryCTA`/`secondaryCTA` are
 * anchor roles (never part of a SPLIT_OFF group, so `matched` never contains
 * one) — without this, a page built purely from a split-off group's content
 * would just stop, never asking the reader to do anything.
 */
function pageClosingCta(dna: DesignDNA, seed: number, used: Set<string>): RecipeSection {
  const type: SectionType = 'cta';
  const variant = pickVariant(type, dna, 'centered', seed, used);
  used.add(`${type}:${variant}`);
  return {
    role: 'secondaryCTA',
    type,
    variant,
    composition: 'centered',
    imageSlot: { needed: false, orientation: 'landscape', role: 'closing cta', focal: '' },
  };
}

function page(
  key: string,
  sections: RecipeSection[],
  ctx: SeedCtx,
  dna: DesignDNA,
  suggested?: SuggestedPage,
): RecipePage {
  void dna;
  const title =
    suggested?.title.trim() || PAGE_TITLE[key]?.[ctx.locale] || PAGE_TITLE.home[ctx.locale];
  const purpose =
    suggested?.purpose.trim() ||
    (key === 'home' ? 'the whole business in one scroll' : `${key} in depth`);
  return {
    title,
    slug: key === 'home' ? 'home' : key,
    purpose,
    nav: key !== 'home',
    sections,
  };
}

function animationFor(
  mode: CompositionMode,
  dna: DesignDNA,
  idx: number,
  seed: number,
): string | undefined {
  if (dna.decorativeStyle === 'none') return idx === 0 ? 'fade' : undefined;
  const pool =
    dna.decorativeStyle === 'expressive'
      ? ['fade', 'rise', 'slideLeft', 'slideRight', 'zoom', 'blur']
      : ['fade', 'rise', 'slideLeft'];
  if (idx === 0) return 'fade';
  return pool[Math.abs(seed + idx + mode.length) % pool.length];
}

/** Field keys the copy pass must fill for a recipe section. */
export function recipeFieldKeys(type: SectionType): string[] {
  return SECTION_CATALOG[type]?.fields.map((f) => f.key) ?? textFieldKeys(type);
}
