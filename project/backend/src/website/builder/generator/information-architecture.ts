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
  'primaryCTA',
  'secondaryCTA',
  'contact',
];

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
): IASpec {
  if (!raw || !Array.isArray(raw.roles) || raw.roles.length < 3) return fallback;
  const seen = new Set<SectionRole>();
  const roles: IARole[] = [];
  for (const r of raw.roles) {
    const role = r?.role as SectionRole;
    if (!ROLE_VOCAB.includes(role) || seen.has(role)) continue;
    seen.add(role);
    roles.push({
      role,
      required: !!r.required,
      priority: Number.isFinite(r.priority) ? Number(r.priority) : roles.length,
      rationale: typeof r.rationale === 'string' ? r.rationale.slice(0, 120) : undefined,
    });
  }
  if (!roles.some((r) => r.role === 'hero'))
    roles.unshift({ role: 'hero', required: true, priority: -1 });
  if (!roles.some((r) => r.role === 'contact'))
    roles.push({ role: 'contact', required: true, priority: 999 });
  return {
    roles: roles.sort((a, b) => a.priority - b.priority),
    omitted: (raw.omitted ?? []).filter((r): r is SectionRole => ROLE_VOCAB.includes(r)),
    pageStrategy: raw.pageCount > 1 ? 'multi-page' : 'one-page',
    pageCount: Math.max(1, Math.min(4, raw.pageCount || fallback.pageCount)),
  };
}

export interface PlanIAInput {
  brief: string;
  business: GeneratorBusiness;
  profile: BusinessProfile;
  direction: CreativeDirection;
  locale: StudioLocale;
  seed: number;
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

export async function planIA(ai: GeneratorAi, input: PlanIAInput): Promise<IASpec> {
  const fallback = deterministicIA(input.profile, input.direction, input.seed);
  if (!ai.configured) return fallback;
  const raw = await ai
    .planArchitecture({
      brief: input.brief,
      business: input.business,
      profile: input.profile,
      direction: input.direction,
      locale: input.locale,
      seed: input.seed,
      roleVocab: ROLE_VOCAB,
    })
    .catch(() => null);
  return coerceAiRoles(raw, fallback);
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
