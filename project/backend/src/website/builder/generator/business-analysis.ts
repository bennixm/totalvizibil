/**
 * Stage 1–2: understand the business, then choose a creative direction.
 *
 * One merged AI call produces a `BusinessProfile` + a `CreativeDirection`. When
 * no AI is configured (or the call fails) a deterministic per-archetype default
 * is used, with the `seed` rotating among 2–3 canned directions so keyless
 * generation still varies. The AI result is merged OVER the default, so a
 * partial / sloppy model response never leaves a hole.
 */
import type { Archetype } from '../site-archetypes';
import { classifyArchetype } from '../site-archetypes';
import { SECTION_CATALOG, type StudioLocale } from '../section-catalog';
import { BACKGROUNDS, PALETTES, RADII, THEME_FONTS } from '../compose-advanced';
import type {
  BusinessProfile,
  CreativeDirection,
  DnaHints,
  GeneratorAi,
  GeneratorBusiness,
  ImageIntensity,
  PurchaseIntent,
} from './types';
import { hashInt } from '../stock-images';

interface ArchetypeDefault {
  profile: Omit<BusinessProfile, 'archetype'>;
  /** 2–3 fitting directions; the seed picks one. */
  directions: CreativeDirection[];
}

const D = (family: string, rationale: string, referencePoints: string[]): CreativeDirection => ({
  family,
  rationale,
  referencePoints,
});

/**
 * Per-archetype baselines. Every field is a sensible default a designer would
 * reach for; the AI call refines them per brief. `imageIntensity` and the
 * direction list are the biggest structural levers.
 */
export const ARCHETYPE_PROFILE_DEFAULTS: Record<Archetype, ArchetypeDefault> = {
  'local-trade': {
    profile: {
      businessType: 'local trades / contractor',
      audience: 'homeowners and property managers planning a concrete project',
      purchaseIntent: 'considered',
      trustDrivers: ['finished projects', 'years in business', 'reviews', 'guarantees'],
      primaryConversion: 'request a quote',
      secondaryConversion: 'call the office',
      maturity: 'established',
      positioning: 'reliable, does it right, shows up on time',
      emotionalTone: 'grounded, confident, plain-spoken',
      visualOpportunities: [
        'finished builds and renovations',
        'the crew at work',
        'materials and detail shots',
        'before/after',
      ],
      contentPriorities: [
        'what we do',
        'proof of past work',
        'how the process works',
        'get a quote',
      ],
      imageIntensity: 'high',
    },
    directions: [
      D(
        'architectural',
        'Let the finished builds carry the page — big photography, restrained type.',
        ['a builder monograph', 'architecture studio site'],
      ),
      D('warm-local', 'Approachable and neighbourly — warm palette, human photos, short copy.', [
        'a well-run family firm',
        'local hardware brand',
      ]),
      D(
        'utilitarian-modern',
        'Efficient and no-nonsense — tight grid, strong labels, quick to a quote.',
        ['a trades marketplace', 'a modern services brand'],
      ),
    ],
  },
  agency: {
    profile: {
      businessType: 'creative / marketing agency',
      audience: 'founders and marketing leads choosing a partner',
      purchaseIntent: 'high-trust',
      trustDrivers: ['named results', 'client logos', 'a clear method', 'point of view'],
      primaryConversion: 'start a project',
      secondaryConversion: 'see case studies',
      maturity: 'established',
      positioning: 'sharp thinking, senior hands, measurable outcomes',
      emotionalTone: 'assured, articulate, a little bold',
      visualOpportunities: [
        'work in context',
        'the team mid-thought',
        'process artefacts',
        'brand systems',
      ],
      contentPriorities: ['point of view', 'selected work', 'how we work', 'start a project'],
      imageIntensity: 'medium',
    },
    directions: [
      D(
        'editorial',
        'Magazine logic — serif headlines, generous whitespace, a strong opening statement.',
        ['a design annual', 'a studio journal'],
      ),
      D('bold-commercial', 'High contrast, big type, motion — confidence you can feel.', [
        'a hype-cycle product launch',
        'a sports-brand campaign site',
      ]),
      D('sophisticated', 'Quiet luxury — muted palette, precise spacing, few words.', [
        'a boutique consultancy',
        'an architecture practice',
      ]),
    ],
  },
  portfolio: {
    profile: {
      businessType: 'creative professional (photographer / designer / studio)',
      audience: 'clients commissioning creative work',
      purchaseIntent: 'considered',
      trustDrivers: ['the work itself', 'range', 'a recognisable eye', 'past clients'],
      primaryConversion: 'enquire about a commission',
      secondaryConversion: 'view full portfolio',
      maturity: 'established',
      positioning: 'a distinct visual signature',
      emotionalTone: 'confident, spare, image-first',
      visualOpportunities: [
        'the portfolio itself',
        'behind the scenes',
        'a signature piece',
        'the workspace',
      ],
      contentPriorities: ['the work', 'a signature piece', 'services / how to book', 'enquire'],
      imageIntensity: 'gallery-led',
    },
    directions: [
      D('minimalist', 'The work and nothing else — hairline type, black on white, huge images.', [
        'a photographer monograph',
        'a gallery site',
      ]),
      D('editorial', 'Framed like a printed feature — serif, captions, asymmetric spreads.', [
        'a design publication',
        'an art-book layout',
      ]),
      D('bold-commercial', 'Loud and kinetic — overlap, marquee, full-bleed carousels.', [
        'a fashion lookbook',
        'a motion-studio reel site',
      ]),
    ],
  },
  saas: {
    profile: {
      businessType: 'software product',
      audience: 'operators evaluating a tool for their team',
      purchaseIntent: 'considered',
      trustDrivers: [
        'a clear value prop',
        'proof it works',
        'transparent pricing',
        'customer logos',
      ],
      primaryConversion: 'start a trial / book a demo',
      secondaryConversion: 'see pricing',
      maturity: 'new',
      positioning: 'does one job noticeably better',
      emotionalTone: 'crisp, precise, quietly ambitious',
      visualOpportunities: [
        'product UI',
        'the workflow',
        'outcome dashboards',
        'the team building it',
      ],
      contentPriorities: ['the value in one screen', 'how it works', 'pricing', 'get started'],
      imageIntensity: 'medium',
    },
    directions: [
      D('technical', 'Dark surface, mono accents, product-led — feels engineered.', [
        'a developer-tool landing page',
        'an infra dashboard',
      ]),
      D('modern-corporate', 'Bright, tidy, gradient-lit — enterprise-friendly.', [
        'a B2B SaaS homepage',
        'a fintech product site',
      ]),
      D('premium-service', 'Fewer, larger claims — high-touch, considered.', [
        'a category-leader rebrand',
        'a high-ACV product site',
      ]),
    ],
  },
  hospitality: {
    profile: {
      businessType: 'restaurant / café / hospitality venue',
      audience: 'locals and visitors deciding where to eat or stay',
      purchaseIntent: 'impulse',
      trustDrivers: ['the room', 'the food', 'reviews', 'the people'],
      primaryConversion: 'book a table / reserve',
      secondaryConversion: 'see the menu',
      maturity: 'established',
      positioning: 'a place with a feeling, not just a meal',
      emotionalTone: 'warm, sensory, inviting',
      visualOpportunities: [
        'plated dishes',
        'the room and light',
        'the kitchen',
        'guests mid-meal',
      ],
      contentPriorities: [
        'atmosphere',
        'signature dishes / menu',
        'find & book',
        'what people say',
      ],
      imageIntensity: 'gallery-led',
    },
    directions: [
      D('warm-local', 'Candlelit palette, serif display, big appetising photography.', [
        'a neighbourhood bistro',
        'a farm-to-table room',
      ]),
      D('editorial', 'Treated like a food magazine — pull quotes, captions, full-bleed spreads.', [
        'a restaurant review feature',
        'a chef monograph',
      ]),
      D('boutique', 'Restrained and design-forward — for a place that is also a brand.', [
        'a specialty-coffee brand',
        'a natural-wine bar',
      ]),
    ],
  },
  clinic: {
    profile: {
      businessType: 'clinic / medical or wellness practice',
      audience: 'patients choosing a practitioner they can trust',
      purchaseIntent: 'high-trust',
      trustDrivers: ['credentials', 'the practitioners', 'a clear care path', 'patient outcomes'],
      primaryConversion: 'book an appointment',
      secondaryConversion: 'call the practice',
      maturity: 'established',
      positioning: 'calm, competent, unhurried',
      emotionalTone: 'reassuring, clear, professional',
      visualOpportunities: ['the practice space', 'the team', 'equipment', 'calm detail shots'],
      contentPriorities: [
        'services & credentials',
        'reassurance / the care path',
        'the team',
        'book',
      ],
      imageIntensity: 'medium',
    },
    directions: [
      D('clinical-calm', 'Soft palette, lots of air, gentle type — nothing alarming.', [
        'a modern dental practice',
        'a physiotherapy clinic',
      ]),
      D('premium-service', 'Concierge feel — muted tones, precise spacing, few words.', [
        'a private health practice',
        'an aesthetics clinic',
      ]),
      D(
        'modern-corporate',
        'Trustworthy and institutional — structured, blue-leaning, credentialed.',
        ['a specialist medical group', 'a diagnostics provider'],
      ),
    ],
  },
  shop: {
    profile: {
      businessType: 'retail / product brand',
      audience: 'shoppers browsing a range',
      purchaseIntent: 'impulse',
      trustDrivers: ['the products', 'reviews', 'returns / guarantees', 'the brand story'],
      primaryConversion: 'shop the range',
      secondaryConversion: 'read reviews',
      maturity: 'established',
      positioning: 'a range worth browsing, a brand worth trusting',
      emotionalTone: 'energetic, tactile, current',
      visualOpportunities: [
        'product shots',
        'products in use',
        'the making of',
        'lifestyle context',
      ],
      contentPriorities: ['hero product / offer', 'the range', 'why buy here', 'social proof'],
      imageIntensity: 'high',
    },
    directions: [
      D('bold-commercial', 'Big offer banners, punchy grid, saturated accent.', [
        'a DTC brand homepage',
        'a seasonal sale page',
      ]),
      D('boutique', 'Curated and calm — one product per row, lots of white.', [
        'a design-object shop',
        'a small-batch label',
      ]),
      D('organic', 'Earthy palette, hand-set type, natural textures.', [
        'a skincare brand',
        'a homeware maker',
      ]),
    ],
  },
  events: {
    profile: {
      businessType: 'events / experiences provider',
      audience: 'people planning a wedding, party or corporate event',
      purchaseIntent: 'high-trust',
      trustDrivers: ['past events', 'packages', 'reviews', 'the team'],
      primaryConversion: 'check a date / enquire',
      secondaryConversion: 'see packages',
      maturity: 'established',
      positioning: 'the day handled, beautifully',
      emotionalTone: 'aspirational, celebratory, warm',
      visualOpportunities: ['real events', 'décor and detail', 'crowds mid-celebration', 'venues'],
      contentPriorities: ['the experience', 'packages', 'a gallery', 'check a date'],
      imageIntensity: 'gallery-led',
    },
    directions: [
      D('editorial', 'Serif display, big romantic imagery, generous spacing.', [
        'a wedding-planner portfolio',
        'a lifestyle magazine',
      ]),
      D('energetic', 'Motion, overlap, colour — the buzz of the night.', [
        'a festival site',
        'an event-production reel',
      ]),
      D('sophisticated', 'For corporate and luxury events — restrained, precise, dark.', [
        'a high-end event agency',
        'a private-members club',
      ]),
    ],
  },
  generic: {
    profile: {
      businessType: 'small business',
      audience: 'prospective customers comparing local options',
      purchaseIntent: 'considered',
      trustDrivers: ['what we do', 'proof', 'the people', 'reviews'],
      primaryConversion: 'get in touch',
      secondaryConversion: 'learn more',
      maturity: 'established',
      positioning: 'clear, credible, easy to work with',
      emotionalTone: 'straightforward, friendly, professional',
      visualOpportunities: ['the work', 'the team', 'the workspace', 'customers served'],
      contentPriorities: ['who we are', 'what we offer', 'the difference', 'get in touch'],
      imageIntensity: 'medium',
    },
    directions: [
      D('modern-corporate', 'Clean, structured, confident — a safe, sharp default.', [
        'a professional-services site',
        'a modern SME homepage',
      ]),
      D('warm-local', 'Human and approachable — warm palette, real photos.', [
        'a family business',
        'a community brand',
      ]),
      D('minimalist', 'Say less, space it well — for a brand with a point of view.', [
        'a boutique consultancy',
        'a design-led studio',
      ]),
    ],
  },
};

const INTENSITIES: ImageIntensity[] = ['minimal', 'medium', 'high', 'gallery-led'];
const INTENTS: PurchaseIntent[] = ['impulse', 'considered', 'high-trust'];

function coerceProfile(
  raw: Partial<BusinessProfile> | undefined,
  base: Omit<BusinessProfile, 'archetype'>,
  archetype: Archetype,
): BusinessProfile {
  const r = raw ?? {};
  const str = (v: unknown, fb: string): string =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : fb;
  const list = (v: unknown, fb: string[]): string[] =>
    Array.isArray(v) && v.length
      ? v
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim().slice(0, 120))
          .slice(0, 8)
      : fb;
  return {
    archetype,
    businessType: str(r.businessType, base.businessType),
    audience: str(r.audience, base.audience),
    purchaseIntent: INTENTS.includes(r.purchaseIntent as PurchaseIntent)
      ? (r.purchaseIntent as PurchaseIntent)
      : base.purchaseIntent,
    trustDrivers: list(r.trustDrivers, base.trustDrivers),
    primaryConversion: str(r.primaryConversion, base.primaryConversion),
    secondaryConversion: str(r.secondaryConversion, base.secondaryConversion),
    maturity: (['new', 'established', 'premium'] as const).includes(
      r.maturity as BusinessProfile['maturity'],
    )
      ? (r.maturity as BusinessProfile['maturity'])
      : base.maturity,
    positioning: str(r.positioning, base.positioning),
    emotionalTone: str(r.emotionalTone, base.emotionalTone),
    visualOpportunities: list(r.visualOpportunities, base.visualOpportunities),
    contentPriorities: list(r.contentPriorities, base.contentPriorities),
    imageIntensity: INTENSITIES.includes(r.imageIntensity as ImageIntensity)
      ? (r.imageIntensity as ImageIntensity)
      : base.imageIntensity,
  };
}

function coerceDirection(
  raw: Partial<CreativeDirection> | undefined,
  fallback: CreativeDirection,
): CreativeDirection {
  const r = raw ?? {};
  const family =
    typeof r.family === 'string' && r.family.trim()
      ? r.family.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40)
      : fallback.family;
  return {
    family,
    rationale:
      typeof r.rationale === 'string' && r.rationale.trim()
        ? r.rationale.trim().slice(0, 240)
        : fallback.rationale,
    referencePoints:
      Array.isArray(r.referencePoints) && r.referencePoints.length
        ? r.referencePoints
            .filter((x): x is string => typeof x === 'string')
            .map((x) => x.trim().slice(0, 80))
            .slice(0, 4)
        : fallback.referencePoints,
  };
}

const HERO_VARIANTS = new Set((SECTION_CATALOG.hero?.variants ?? []).map((v) => v.id));
const CARD_STYLES = new Set(['flat', 'bordered', 'raised', 'editorial']);
const DECOR_STYLES = new Set(['none', 'subtle', 'expressive']);
const H_SCALES = new Set(['tight', 'normal', 'display']);
const H_ALIGNS = new Set(['left', 'center']);
const SPACINGS = new Set(['compact', 'standard', 'spacious']);

/** Keep only the AI DNA hints that name a real, valid value. */
function coerceDnaHints(raw: Partial<DnaHints> | undefined): DnaHints {
  const r = raw ?? {};
  const out: DnaHints = {};
  const inSet = <T>(v: unknown, set: Set<string>): T | undefined =>
    typeof v === 'string' && set.has(v) ? (v as T) : undefined;
  const inArr = <T>(v: unknown, arr: readonly string[]): T | undefined =>
    typeof v === 'string' && (arr as readonly string[]).includes(v) ? (v as T) : undefined;

  const hf = inArr<DnaHints['headingFont']>(r.headingFont, THEME_FONTS);
  if (hf) out.headingFont = hf;
  const hs = inSet<DnaHints['headingScale']>(r.headingScale, H_SCALES);
  if (hs) out.headingScale = hs;
  const ha = inSet<DnaHints['headingAlign']>(r.headingAlign, H_ALIGNS);
  if (ha) out.headingAlign = ha;
  const sp = inSet<DnaHints['spacing']>(r.spacing, SPACINGS);
  if (sp) out.spacing = sp;
  const rad = inArr<DnaHints['radius']>(r.radius, RADII);
  if (rad) out.radius = rad;
  if (typeof r.heroStyle === 'string' && HERO_VARIANTS.has(r.heroStyle))
    out.heroStyle = r.heroStyle;
  const cs = inSet<DnaHints['cardStyle']>(r.cardStyle, CARD_STYLES);
  if (cs) out.cardStyle = cs;
  const ds = inSet<DnaHints['decorativeStyle']>(r.decorativeStyle, DECOR_STYLES);
  if (ds) out.decorativeStyle = ds;
  const bg = inArr<DnaHints['background']>(r.background, BACKGROUNDS);
  if (bg) out.background = bg;
  const pal = inArr<DnaHints['palette']>(r.palette, PALETTES);
  if (pal) out.palette = pal;
  if (typeof r.accentHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.accentHex.trim())) {
    out.accentHex = r.accentHex.trim().toLowerCase();
  }
  if (typeof r.photographyStyle === 'string' && r.photographyStyle.trim()) {
    out.photographyStyle = r.photographyStyle.trim().slice(0, 140);
  }
  return out;
}

export interface AnalyzeInput {
  brief: string;
  business: GeneratorBusiness;
  locale: StudioLocale;
  seed: number;
}

/**
 * Returns a fully-populated `BusinessProfile` + `CreativeDirection` + validated
 * `DnaHints`. Always resolves — the deterministic per-archetype default is the
 * floor; `dnaHints` is `{}` without AI.
 */
export async function analyzeBusiness(
  ai: GeneratorAi,
  input: AnalyzeInput,
): Promise<{ profile: BusinessProfile; direction: CreativeDirection; dnaHints: DnaHints }> {
  const archetype = classifyArchetype(
    input.brief,
    input.business.type ?? '',
    input.business.services,
  );
  const dflt = ARCHETYPE_PROFILE_DEFAULTS[archetype] ?? ARCHETYPE_PROFILE_DEFAULTS.generic;
  // Seed picks the baseline direction so a keyless / AI-failed generation still
  // varies run to run for the same business.
  const dirIdx = Math.abs(input.seed + hashInt(input.brief)) % dflt.directions.length;
  const baseDir = dflt.directions[dirIdx];

  let raw: {
    profile: Partial<BusinessProfile>;
    direction: Partial<CreativeDirection>;
    dnaHints?: Partial<DnaHints>;
  } | null = null;
  if (ai.configured) {
    raw = await ai.analyzeBusiness(input).catch(() => null);
  }

  return {
    profile: coerceProfile(raw?.profile, dflt.profile, archetype),
    direction: coerceDirection(raw?.direction, baseDir),
    dnaHints: coerceDnaHints(raw?.dnaHints),
  };
}
