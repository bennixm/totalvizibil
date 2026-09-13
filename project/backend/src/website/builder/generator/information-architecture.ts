/**
 * Stage 4: decide WHICH sections this business needs and in what order — as
 * abstract ROLES, not catalog types. A lawyer, a photographer and a restaurant
 * get genuinely different role lists; the seed drops an optional role, swaps a
 * reorderable pair and picks one- vs multi-page, so same-archetype sites differ
 * structurally (not just in copy).
 *
 * `roleToType` then maps each role onto a concrete `SectionType`, biased by the
 * Design DNA (role `work` → `gallery` for a portfolio, `caseStudy` for an
 * agency, `beforeAfter` for a local trade).
 */
import type { SectionType } from '../../website.types';
import type { Archetype } from '../site-archetypes';
import type {
  BusinessProfile,
  CompositionMode,
  CreativeDirection,
  DesignDNA,
  GeneratorAi,
  GeneratorBusiness,
  IARole,
  IASpec,
  SectionRole,
} from './types';
import type { StudioLocale } from '../section-catalog';
import { hashInt } from '../stock-images';

export const ROLE_VOCAB: SectionRole[] = [
  'hero',
  'trustBar',
  'services',
  'work',
  'process',
  'about',
  'story',
  'team',
  'credentials',
  'stats',
  'testimonials',
  'faq',
  'pricing',
  'gallery',
  'hours',
  'comparisonTable',
  'featuredProject',
  'specialties',
  'serviceArea',
  'primaryCTA',
  'secondaryCTA',
  'contact',
];

/**
 * Roles that make a natural secondary page when the IA asked for multi-page —
 * the shared source of truth for `layout-recipe.ts`'s `buildRecipe` (which
 * actually peels a group into its own page) AND `planIA`'s retry heuristic
 * (which judges whether a role list can realistically reach a client-forced
 * page count BEFORE building anything, by checking group depth, not just a
 * raw role total). Each group carries a couple of extra members beyond its
 * "obvious" core so it stays viable even when one is dropped upstream (e.g.
 * `pricing` is stripped for most archetypes by `dropMisfitRoles`) — otherwise
 * a group can quietly fall under the depth threshold and its roles get stuck
 * on home instead of becoming their own page. Every role belongs to EXACTLY
 * one group — no role is shared between two groups — so which page a role
 * lands on stays predictable regardless of seed-rotated processing order.
 */
export const SPLIT_OFF: Record<string, SectionRole[]> = {
  work: ['work', 'gallery', 'process', 'testimonials'],
  services: ['services', 'pricing', 'faq', 'trustBar', 'hours'],
  about: ['about', 'story', 'team', 'credentials', 'stats'],
  proof: ['comparisonTable', 'featuredProject', 'specialties', 'serviceArea'],
};

/** Same depth floor `buildRecipe` uses before peeling a group off. */
const MIN_GROUP_DEPTH = 3;

const VALID_EMPHASIS = new Set<CompositionMode>([
  'full',
  'split',
  'asymmetric',
  'centered',
  'editorial',
  'grid',
  'image-led',
  'compact',
]);

type RoleWeight = { role: SectionRole; required: boolean; weight: number };

/** Ordered role preferences per archetype (weight = keep-probability / priority). */
const ARCHETYPE_IA: Record<Archetype, RoleWeight[]> = {
  'local-trade': [
    { role: 'hero', required: true, weight: 100 },
    { role: 'trustBar', required: false, weight: 80 },
    { role: 'services', required: true, weight: 95 },
    { role: 'work', required: false, weight: 85 },
    { role: 'process', required: false, weight: 70 },
    { role: 'testimonials', required: false, weight: 65 },
    { role: 'faq', required: false, weight: 45 },
    { role: 'comparisonTable', required: false, weight: 40 },
    { role: 'featuredProject', required: false, weight: 45 },
    { role: 'specialties', required: false, weight: 40 },
    { role: 'serviceArea', required: false, weight: 50 },
    { role: 'primaryCTA', required: true, weight: 90 },
    { role: 'contact', required: true, weight: 100 },
  ],
  agency: [
    { role: 'hero', required: true, weight: 100 },
    { role: 'trustBar', required: false, weight: 78 },
    { role: 'story', required: false, weight: 60 },
    { role: 'work', required: true, weight: 92 },
    { role: 'services', required: true, weight: 88 },
    { role: 'process', required: false, weight: 72 },
    { role: 'testimonials', required: false, weight: 62 },
    { role: 'comparisonTable', required: false, weight: 42 },
    { role: 'featuredProject', required: false, weight: 55 },
    { role: 'specialties', required: false, weight: 42 },
    { role: 'primaryCTA', required: true, weight: 88 },
    { role: 'contact', required: true, weight: 100 },
  ],
  portfolio: [
    { role: 'hero', required: true, weight: 100 },
    { role: 'gallery', required: true, weight: 98 },
    { role: 'work', required: false, weight: 70 },
    { role: 'about', required: false, weight: 75 },
    { role: 'services', required: false, weight: 55 },
    { role: 'testimonials', required: false, weight: 48 },
    { role: 'featuredProject', required: false, weight: 52 },
    { role: 'primaryCTA', required: true, weight: 80 },
    { role: 'contact', required: true, weight: 100 },
  ],
  saas: [
    { role: 'hero', required: true, weight: 100 },
    { role: 'trustBar', required: false, weight: 82 },
    { role: 'services', required: true, weight: 90 },
    { role: 'process', required: false, weight: 68 },
    { role: 'stats', required: false, weight: 62 },
    { role: 'pricing', required: false, weight: 78 },
    { role: 'testimonials', required: false, weight: 58 },
    { role: 'faq', required: false, weight: 50 },
    { role: 'comparisonTable', required: false, weight: 55 },
    { role: 'specialties', required: false, weight: 45 },
    { role: 'primaryCTA', required: true, weight: 92 },
    { role: 'contact', required: true, weight: 90 },
  ],
  hospitality: [
    { role: 'hero', required: true, weight: 100 },
    { role: 'story', required: false, weight: 70 },
    { role: 'services', required: true, weight: 88 },
    { role: 'gallery', required: true, weight: 95 },
    { role: 'testimonials', required: false, weight: 60 },
    { role: 'hours', required: false, weight: 72 },
    { role: 'serviceArea', required: false, weight: 35 },
    { role: 'primaryCTA', required: true, weight: 85 },
    { role: 'contact', required: true, weight: 100 },
  ],
  clinic: [
    { role: 'hero', required: true, weight: 100 },
    { role: 'services', required: true, weight: 92 },
    { role: 'credentials', required: false, weight: 80 },
    { role: 'team', required: false, weight: 78 },
    { role: 'process', required: false, weight: 66 },
    { role: 'testimonials', required: false, weight: 60 },
    { role: 'faq', required: false, weight: 58 },
    { role: 'hours', required: false, weight: 55 },
    { role: 'comparisonTable', required: false, weight: 45 },
    { role: 'specialties', required: false, weight: 48 },
    { role: 'serviceArea', required: false, weight: 40 },
    { role: 'primaryCTA', required: true, weight: 88 },
    { role: 'contact', required: true, weight: 100 },
  ],
  shop: [
    { role: 'hero', required: true, weight: 100 },
    { role: 'trustBar', required: false, weight: 70 },
    { role: 'gallery', required: true, weight: 90 },
    { role: 'services', required: false, weight: 60 },
    { role: 'stats', required: false, weight: 50 },
    { role: 'testimonials', required: false, weight: 62 },
    { role: 'serviceArea', required: false, weight: 30 },
    { role: 'primaryCTA', required: true, weight: 88 },
    { role: 'contact', required: true, weight: 85 },
  ],
  events: [
    { role: 'hero', required: true, weight: 100 },
    { role: 'story', required: false, weight: 68 },
    { role: 'services', required: true, weight: 85 },
    { role: 'gallery', required: true, weight: 95 },
    { role: 'process', required: false, weight: 64 },
    { role: 'pricing', required: false, weight: 70 },
    { role: 'testimonials', required: false, weight: 58 },
    { role: 'featuredProject', required: false, weight: 40 },
    { role: 'primaryCTA', required: true, weight: 85 },
    { role: 'contact', required: true, weight: 100 },
  ],
  generic: [
    { role: 'hero', required: true, weight: 100 },
    { role: 'about', required: false, weight: 78 },
    { role: 'services', required: true, weight: 90 },
    { role: 'trustBar', required: false, weight: 60 },
    { role: 'testimonials', required: false, weight: 62 },
    { role: 'faq', required: false, weight: 48 },
    { role: 'specialties', required: false, weight: 38 },
    { role: 'serviceArea', required: false, weight: 35 },
    { role: 'primaryCTA', required: true, weight: 85 },
    { role: 'contact', required: true, weight: 100 },
  ],
};

/** Pairs whose order may be swapped by the seed without hurting the page. */
const SWAPPABLE: [SectionRole, SectionRole][] = [
  ['work', 'services'],
  ['process', 'testimonials'],
  ['about', 'story'],
  ['stats', 'trustBar'],
  ['credentials', 'team'],
  ['gallery', 'services'],
];

function applyProfile(list: RoleWeight[], profile: BusinessProfile): RoleWeight[] {
  const bump = (role: SectionRole, by: number, required = false): void => {
    const hit = list.find((r) => r.role === role);
    if (hit) {
      hit.weight = Math.min(100, hit.weight + by);
      if (required) hit.required = true;
    } else {
      list.push({ role, required, weight: 50 + by });
    }
  };
  if (profile.imageIntensity === 'gallery-led') bump('gallery', 25, true);
  if (profile.imageIntensity === 'minimal') {
    const g = list.find((r) => r.role === 'gallery');
    if (g && !g.required) g.weight -= 30;
  }
  if (profile.purchaseIntent === 'high-trust') {
    bump('credentials', 18);
    bump('testimonials', 12);
    bump('team', 10);
  }
  if (profile.purchaseIntent === 'impulse') {
    bump('primaryCTA', 12);
    const faq = list.find((r) => r.role === 'faq');
    if (faq) faq.weight -= 20;
  }
  if (profile.maturity === 'new') {
    const st = list.find((r) => r.role === 'stats');
    if (st && !st.required) st.weight -= 25; // a new business has no numbers to boast
    bump('story', 10);
  }
  if (profile.maturity === 'premium') bump('story', 12);
  return list;
}

function coerceAiRoles(
  raw: { roles: IARole[]; omitted: SectionRole[]; pageCount: number } | null,
  fallback: IASpec,
  forcedPageCount?: number,
): IASpec {
  const withForcedCount = (ia: IASpec): IASpec =>
    forcedPageCount
      ? {
          ...ia,
          pageCount: Math.max(1, Math.min(5, forcedPageCount)),
          pageStrategy: forcedPageCount > 1 ? 'multi-page' : 'one-page',
        }
      : ia;
  if (!raw || !Array.isArray(raw.roles) || raw.roles.length < 3) return withForcedCount(fallback);
  const seen = new Set<SectionRole>();
  const roles: IARole[] = [];
  for (const r of raw.roles) {
    const role = r?.role as SectionRole;
    if (!ROLE_VOCAB.includes(role) || seen.has(role)) continue;
    seen.add(role);
    const emphasis = VALID_EMPHASIS.has(r.emphasis as CompositionMode)
      ? (r.emphasis as CompositionMode)
      : undefined;
    roles.push({
      role,
      required: !!r.required,
      priority: Number.isFinite(r.priority) ? Number(r.priority) : roles.length,
      rationale: typeof r.rationale === 'string' ? r.rationale.slice(0, 120) : undefined,
      ...(emphasis ? { emphasis } : {}),
    });
  }
  if (!roles.some((r) => r.role === 'hero'))
    roles.unshift({ role: 'hero', required: true, priority: -1 });
  if (!roles.some((r) => r.role === 'contact'))
    roles.push({ role: 'contact', required: true, priority: 999 });
  return withForcedCount({
    roles: roles.sort((a, b) => a.priority - b.priority),
    omitted: (raw.omitted ?? []).filter((r): r is SectionRole => ROLE_VOCAB.includes(r)),
    pageStrategy: raw.pageCount > 1 ? 'multi-page' : 'one-page',
    pageCount: Math.max(1, Math.min(5, raw.pageCount || fallback.pageCount)),
  });
}

export interface PlanIAInput {
  brief: string;
  business: GeneratorBusiness;
  profile: BusinessProfile;
  direction: CreativeDirection;
  locale: StudioLocale;
  seed: number;
  /** Stage 0's recommended page split, serialized — a strong signal, not a command. */
  pageHint?: string;
  /** The client EXPLICITLY chose this page count during pre-generation
   *  clarification — a requirement, not a suggestion. `coerceAiRoles` clamps
   *  the final `pageCount` to it regardless of what the model returns. */
  forcedPageCount?: number;
}

/** Deterministic IA — the floor the AI result is merged over. */
export function deterministicIA(
  profile: BusinessProfile,
  direction: CreativeDirection,
  seed: number,
): IASpec {
  void direction;
  const h = Math.abs(seed);
  const list = applyProfile(
    (ARCHETYPE_IA[profile.archetype] ?? ARCHETYPE_IA.generic).map((r) => ({ ...r })),
    profile,
  );

  // Keep a role if required, or if a seeded roll beats its weight threshold.
  const kept = list.filter((r, i) => {
    if (r.required) return true;
    const roll = (h >> i) % 100;
    return roll < r.weight;
  });

  // Guarantee a spine.
  const has = (role: SectionRole): boolean => kept.some((r) => r.role === role);
  for (const must of ['hero', 'services', 'primaryCTA', 'contact'] as SectionRole[]) {
    if (!has(must)) {
      const src = list.find((r) => r.role === must);
      if (src) kept.push({ ...src, required: true });
    }
  }

  // Seeded swap of one eligible adjacent pair.
  const order = kept.map((r) => r.role);
  for (const [a, b] of SWAPPABLE) {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia >= 0 && ib >= 0 && (h % 7) - 3 > 0) {
      [order[ia], order[ib]] = [order[ib], order[ia]];
      break;
    }
  }
  // Re-sort kept to the (possibly swapped) order, hero first / contact last.
  const roles: IARole[] = order
    .map((role, i) => {
      const src = kept.find((r) => r.role === role)!;
      return { role, required: src.required, priority: i };
    })
    .sort((x, y) => {
      if (x.role === 'hero') return -1;
      if (y.role === 'hero') return 1;
      if (x.role === 'contact') return 1;
      if (y.role === 'contact') return -1;
      return x.priority - y.priority;
    });

  const omitted = list.map((r) => r.role).filter((r) => !roles.some((k) => k.role === r));

  // One-page unless the brief is long / detailed and the archetype supports depth.
  const detailed = /\bpages?\b|\bmenu\b|\bpricing\b|\bteam\b|\bcareers?\b/i.test('') === false;
  void detailed;
  const wantsMulti =
    roles.length >= 8 &&
    h % 3 === 0 &&
    ['agency', 'saas', 'clinic', 'events'].includes(profile.archetype);

  return {
    roles,
    omitted,
    pageStrategy: wantsMulti ? 'multi-page' : 'one-page',
    pageCount: wantsMulti ? 2 : 1,
  };
}

/** Roles that must survive any restructuring — the page makes no sense without them. */
const IA_SPINE = new Set<SectionRole>(['hero', 'services', 'primaryCTA', 'contact']);

/**
 * A deterministic structural variation of an IA — for the anti-collision re-roll.
 * Keeps the AI's ROLE JUDGEMENT (what this business needs) but changes the
 * STRUCTURE enough that a plain "regenerate" lands on a genuinely different
 * layout, not a 1-section tweak: drop one NON-SPINE middle section (fewer
 * sections ⇒ different type set), swap a natural adjacent pair, flip the page
 * split. Every surviving role stays in its sensible position — no blind shuffle
 * that puts the CTA before the services.
 */
export function reshuffleIA(ia: IASpec, seed: number): IASpec {
  const h = Math.abs(seed) || 1;
  const roles = ia.roles.map((r) => ({ ...r }));

  // 1 · drop ONE non-spine middle role. Overrides the model's `required` flag —
  //     on a re-roll the caller explicitly wants something different.
  if (roles.length >= 6) {
    const droppable = roles
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => i > 0 && i < roles.length - 1 && !IA_SPINE.has(r.role));
    if (droppable.length) roles.splice(droppable[h % droppable.length].i, 1);
  }

  // 2 · swap one eligible SWAPPABLE adjacent-ish pair (seed picks which).
  const order = roles.map((r) => r.role);
  for (let k = 0; k < SWAPPABLE.length; k++) {
    const [a, b] = SWAPPABLE[(h + k) % SWAPPABLE.length];
    const ai2 = order.indexOf(a);
    const bi2 = order.indexOf(b);
    if (ai2 >= 0 && bi2 >= 0) {
      [roles[ai2], roles[bi2]] = [roles[bi2], roles[ai2]];
      break;
    }
  }

  roles.forEach((r, i) => (r.priority = i));

  // 3 · flip the page strategy when the role count still supports it.
  const pageStrategy: IASpec['pageStrategy'] =
    ia.pageStrategy === 'multi-page'
      ? 'one-page'
      : roles.length >= 7 && h % 2 === 0
        ? 'multi-page'
        : 'one-page';

  return {
    roles,
    omitted: ia.omitted,
    pageStrategy,
    pageCount: pageStrategy === 'multi-page' ? Math.max(2, ia.pageCount || 2) : 1,
  };
}

/**
 * Roles whose CATALOG TYPE only makes sense for a narrow set of archetypes —
 * `pricing` renders as subscription-style plans (name/price/"€X per month"/
 * features), which is a genuine fit for a SaaS or a ticketed event but reads as
 * a fabricated monthly-subscription price on a project-quote business
 * (construction, an agency, an architecture studio, a law firm...). The
 * deterministic `ARCHETYPE_IA` tables already only offer `pricing` where it
 * fits; the AI path has no such guardrail on its own, so it's enforced here —
 * a widened role budget must not smuggle in a role that doesn't belong.
 */
const PRICING_FIT_ARCHETYPES = new Set<Archetype>(['saas', 'events']);

function dropMisfitRoles(ia: IASpec, archetype: Archetype): IASpec {
  if (PRICING_FIT_ARCHETYPES.has(archetype) || !ia.roles.some((r) => r.role === 'pricing')) {
    return ia;
  }
  return {
    ...ia,
    roles: ia.roles.filter((r) => r.role !== 'pricing'),
    omitted: ia.omitted.includes('pricing') ? ia.omitted : [...ia.omitted, 'pricing'],
  };
}

export async function planIA(ai: GeneratorAi, input: PlanIAInput): Promise<IASpec> {
  const fallback = deterministicIA(input.profile, input.direction, input.seed);
  if (!ai.configured) return fallback;
  const call = () =>
    ai
      .planArchitecture({
        brief: input.brief,
        business: input.business,
        profile: input.profile,
        direction: input.direction,
        locale: input.locale,
        seed: input.seed,
        roleVocab: ROLE_VOCAB,
        ...(input.pageHint ? { pageHint: input.pageHint } : {}),
        ...(input.forcedPageCount ? { forcedPageCount: input.forcedPageCount } : {}),
      })
      .catch(() => null);
  let raw = await call();
  // A client-forced page count is the STRONGEST possible depth signal — an
  // explicit interactive choice, not a guess — so it always earns the retry
  // check, judged against the role count that count actually needs. Absent
  // that: either Stage 0 recommended real depth (≥3 distinct pages) OR the
  // brief itself is long/detailed (this also covers the case where Stage 0's
  // OWN AI call was skipped for being already-detailed — see
  // `SKIP_AI_OVER_CHARS` in brief-refine.ts — whose deterministic fallback
  // only ever suggests 2 pages, so it would never trip the pageHint check on
  // its own even for a rich brief). Either way, the model coming back thin is
  // sampling variance (the same call can land differently run to run), not a
  // considered "this business is simple" judgement — worth ONE bounded retry.
  const suggestedDepth =
    !!input.forcedPageCount ||
    (input.pageHint?.split(';').length ?? 0) >= 3 ||
    input.brief.length > 400;
  // A raw role COUNT can clear the target while still being lopsided — e.g.
  // 18 roles that are all "about"/"services" and only 2 in "proof" — which
  // still can't actually reach the forced page count, since `buildRecipe`
  // only peels a group off with ≥`MIN_GROUP_DEPTH` matched roles. So for a
  // forced count, check the SAME grouping `buildRecipe` will use, not a total.
  const groupsDeepEnough = (roles: SectionRole[]): number =>
    Object.values(SPLIT_OFF).filter(
      (group) => roles.filter((r) => group.includes(r)).length >= MIN_GROUP_DEPTH,
    ).length;
  const tooThin = (r: NonNullable<typeof raw>): boolean =>
    input.forcedPageCount
      ? r.pageCount < input.forcedPageCount ||
        groupsDeepEnough(r.roles.map((role) => role.role)) < input.forcedPageCount - 1
      : r.roles.length < 8 || r.pageCount < 2;
  if (suggestedDepth && raw && tooThin(raw)) {
    raw = (await call()) ?? raw;
  }
  return dropMisfitRoles(
    coerceAiRoles(raw, fallback, input.forcedPageCount),
    input.profile.archetype,
  );
}

// --- role → catalog type -----------------------------------------------

/** Map an abstract role to a concrete `SectionType`, biased by the DNA. */
export function roleToType(
  role: SectionRole,
  dna: DesignDNA,
  profile: BusinessProfile,
  seed: number,
): SectionType {
  const pick = <T extends string>(opts: T[], salt = 0): T =>
    opts[Math.abs(seed + salt + hashInt(role)) % opts.length];

  switch (role) {
    case 'hero':
      return 'hero';
    case 'trustBar':
      return pick(['logos', 'stats', 'marquee', 'highlightsRow']);
    case 'services':
      return pick(['services', 'features', 'featureSplit', 'tabs']);
    case 'work':
      return profile.archetype === 'agency'
        ? pick(['caseStudy', 'showcase', 'bento'])
        : profile.archetype === 'local-trade'
          ? pick(['beforeAfter', 'gallery', 'showcase'])
          : pick(['gallery', 'showcase', 'caseStudy']);
    case 'process':
      return pick(['process', 'timeline']);
    case 'about':
      return 'about';
    case 'story':
      return pick(['bigStatement', 'about', 'quoteBig']);
    case 'team':
      return 'team';
    case 'credentials':
      return pick(['features', 'highlightsRow', 'stats', 'logos']);
    case 'stats':
      return 'stats';
    case 'testimonials':
      return pick(['testimonials', 'ratingBand', 'quoteBig']);
    case 'faq':
      return 'faq';
    case 'pricing':
      return 'pricing';
    case 'gallery':
      return 'gallery';
    case 'hours':
      return 'hours';
    case 'comparisonTable':
      return 'comparison';
    case 'featuredProject':
      return 'caseStudy';
    case 'specialties':
      return pick(['featureSplit', 'tabs', 'features']);
    case 'serviceArea':
      return pick(['features', 'highlightsRow']);
    case 'primaryCTA':
      return pick(['cta', 'splitCta', 'banner']);
    case 'secondaryCTA':
      return pick(['newsletter', 'banner', 'cta']);
    case 'contact':
      return 'contact';
    default:
      return 'about';
  }
}
