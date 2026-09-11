/**
 * Stage 3: turn (profile + creative direction + seed) into a concrete
 * `DesignDNA` that DRIVES the rest of the pipeline — theme tokens, typographic
 * character, per-section variant bias, and the section-rhythm target.
 *
 * Deterministic. The direction `family` (free text from Stage 2) is fuzzily
 * matched to a base DNA; the profile nudges a few knobs; the seed rotates the
 * palette, a typography axis and the rhythm so two same-family businesses still
 * diverge. `dnaToTheme` / `dnaToTypography` project it onto `WebsiteTheme`.
 */
import type { WebsiteTheme } from '../../website.types';
import { PALETTES } from '../compose-advanced';
import type {
  BusinessProfile,
  CompositionMode,
  CompositionStyle,
  CreativeDirection,
  DesignDNA,
  DnaHints,
  DnaTypography,
} from './types';

type BaseDna = Omit<DesignDNA, 'colorStrategy'> & {
  palettes: WebsiteTheme['palette'][];
  background: NonNullable<WebsiteTheme['background']>;
};

/** Composition-mode vocabularies keyed by composition style — the rhythm engine
 *  draws from these, alternating so no two neighbours match. */
const RHYTHM_POOL: Record<CompositionStyle, CompositionMode[]> = {
  centered: ['centered', 'grid', 'split', 'full', 'compact'],
  asymmetric: ['asymmetric', 'split', 'image-led', 'editorial', 'full', 'grid'],
  editorial: ['editorial', 'asymmetric', 'full', 'split', 'centered'],
  grid: ['grid', 'compact', 'split', 'full', 'centered'],
};

function rhythm(style: CompositionStyle, seed: number, len = 7): CompositionMode[] {
  const pool = RHYTHM_POOL[style];
  const out: CompositionMode[] = [];
  let i = Math.abs(seed) % pool.length;
  while (out.length < len) {
    const next = pool[i % pool.length];
    // never repeat the previous mode
    if (next !== out[out.length - 1]) out.push(next);
    i += 1 + (Math.abs(seed >> out.length) % (pool.length - 1));
  }
  return out;
}

const TYPO = (o: Partial<DnaTypography>): DnaTypography => ({
  headingFont: 'grotesk',
  headingScale: 'normal',
  headingWeight: 'bold',
  headingAlign: 'left',
  bodyScale: 'normal',
  lineHeight: 'normal',
  letterSpacing: 'normal',
  textWidth: 'normal',
  ...o,
});

/**
 * Base DNA per direction family. Keys are the canonical families; `matchFamily`
 * maps free text onto them.
 */
const FAMILY_DNA: Record<string, BaseDna> = {
  editorial: {
    visualStyle: 'editorial',
    compositionStyle: 'editorial',
    typography: TYPO({
      headingFont: 'fraunces',
      headingScale: 'display',
      headingWeight: 'semibold',
      headingAlign: 'left',
      lineHeight: 'relaxed',
      textWidth: 'narrow',
    }),
    spacing: 'spacious',
    radius: 'subtle',
    imageTreatment: 'inset',
    heroStyle: 'minimal',
    navStyle: 'text',
    cardStyle: 'editorial',
    buttonStyle: 'outline',
    contentDensity: 'spacious',
    sectionRhythm: [],
    decorativeStyle: 'subtle',
    photographyStyle: 'natural light, documentary, unposed, film-like grain',
    palettes: ['slate', 'amber', 'rose'],
    background: 'light',
  },
  minimalist: {
    visualStyle: 'minimalist',
    compositionStyle: 'centered',
    typography: TYPO({
      headingFont: 'grotesk',
      headingScale: 'tight',
      headingWeight: 'medium',
      headingAlign: 'left',
      letterSpacing: 'tight',
      bodyScale: 'small',
      textWidth: 'narrow',
    }),
    spacing: 'spacious',
    radius: 'none',
    imageTreatment: 'full-bleed',
    heroStyle: 'minimal',
    navStyle: 'text',
    cardStyle: 'flat',
    buttonStyle: 'outline',
    contentDensity: 'spacious',
    sectionRhythm: [],
    decorativeStyle: 'none',
    photographyStyle: 'high-key, lots of negative space, single subject, muted colour',
    palettes: ['slate', 'blue'],
    background: 'light',
  },
  architectural: {
    visualStyle: 'architectural',
    compositionStyle: 'asymmetric',
    typography: TYPO({
      headingFont: 'grotesk',
      headingScale: 'display',
      headingWeight: 'semibold',
      headingAlign: 'left',
      letterSpacing: 'tight',
      lineHeight: 'tight',
      textWidth: 'narrow',
    }),
    spacing: 'spacious',
    radius: 'none',
    imageTreatment: 'full-bleed',
    heroStyle: 'imageBg',
    navStyle: 'text',
    cardStyle: 'flat',
    buttonStyle: 'outline',
    contentDensity: 'spacious',
    sectionRhythm: [],
    decorativeStyle: 'subtle',
    photographyStyle: 'wide angle, strong lines, golden-hour exterior, big skies',
    palettes: ['slate', 'amber', 'emerald'],
    background: 'light',
  },
  'warm-local': {
    visualStyle: 'warm-local',
    compositionStyle: 'centered',
    typography: TYPO({
      headingFont: 'fraunces',
      headingScale: 'normal',
      headingWeight: 'semibold',
      headingAlign: 'center',
      lineHeight: 'relaxed',
    }),
    spacing: 'standard',
    radius: 'large',
    imageTreatment: 'framed',
    heroStyle: 'split',
    navStyle: 'text',
    cardStyle: 'raised',
    buttonStyle: 'soft',
    contentDensity: 'comfortable',
    sectionRhythm: [],
    decorativeStyle: 'subtle',
    photographyStyle: 'warm tones, people, hands at work, cosy interiors',
    palettes: ['amber', 'orange', 'rose', 'emerald'],
    background: 'tinted',
  },
  'modern-corporate': {
    visualStyle: 'modern-corporate',
    compositionStyle: 'grid',
    typography: TYPO({
      headingFont: 'inter',
      headingScale: 'normal',
      headingWeight: 'bold',
      headingAlign: 'left',
    }),
    spacing: 'standard',
    radius: 'rounded',
    imageTreatment: 'inset',
    heroStyle: 'split',
    navStyle: 'pill',
    cardStyle: 'bordered',
    buttonStyle: 'solid',
    contentDensity: 'comfortable',
    sectionRhythm: [],
    decorativeStyle: 'subtle',
    photographyStyle: 'bright, clean, real workplaces, candid not stock',
    palettes: ['blue', 'indigo', 'cyan', 'teal'],
    background: 'light',
  },
  'bold-commercial': {
    visualStyle: 'bold-commercial',
    compositionStyle: 'asymmetric',
    typography: TYPO({
      headingFont: 'grotesk',
      headingScale: 'display',
      headingWeight: 'bold',
      headingAlign: 'left',
      letterSpacing: 'tight',
    }),
    spacing: 'standard',
    radius: 'none',
    imageTreatment: 'full-bleed',
    heroStyle: 'imageBg',
    navStyle: 'pill',
    cardStyle: 'raised',
    buttonStyle: 'pill',
    contentDensity: 'comfortable',
    sectionRhythm: [],
    decorativeStyle: 'expressive',
    photographyStyle: 'high saturation, dynamic angles, energy, product hero shots',
    palettes: ['rose', 'orange', 'fuchsia', 'violet'],
    background: 'light',
  },
  technical: {
    visualStyle: 'technical',
    compositionStyle: 'grid',
    typography: TYPO({
      headingFont: 'jetbrains',
      headingScale: 'normal',
      headingWeight: 'semibold',
      headingAlign: 'left',
      letterSpacing: 'tight',
      bodyScale: 'small',
    }),
    spacing: 'compact',
    radius: 'subtle',
    imageTreatment: 'inset',
    heroStyle: 'gradient',
    navStyle: 'text',
    cardStyle: 'bordered',
    buttonStyle: 'solid',
    contentDensity: 'compact',
    sectionRhythm: [],
    decorativeStyle: 'subtle',
    photographyStyle: 'product UI, dark interfaces, close-up detail, engineered feel',
    palettes: ['cyan', 'blue', 'indigo'],
    background: 'dark',
  },
  boutique: {
    visualStyle: 'boutique',
    compositionStyle: 'centered',
    typography: TYPO({
      headingFont: 'fraunces',
      headingScale: 'normal',
      headingWeight: 'regular',
      headingAlign: 'center',
      letterSpacing: 'wide',
      lineHeight: 'relaxed',
      textWidth: 'narrow',
    }),
    spacing: 'spacious',
    radius: 'subtle',
    imageTreatment: 'framed',
    heroStyle: 'centered',
    navStyle: 'text',
    cardStyle: 'flat',
    buttonStyle: 'outline',
    contentDensity: 'spacious',
    sectionRhythm: [],
    decorativeStyle: 'subtle',
    photographyStyle: 'styled, calm, one object per frame, soft daylight',
    palettes: ['slate', 'emerald', 'rose'],
    background: 'tinted',
  },
  'premium-service': {
    visualStyle: 'premium-service',
    compositionStyle: 'asymmetric',
    typography: TYPO({
      headingFont: 'fraunces',
      headingScale: 'display',
      headingWeight: 'regular',
      headingAlign: 'left',
      letterSpacing: 'tight',
      lineHeight: 'relaxed',
      textWidth: 'narrow',
    }),
    spacing: 'spacious',
    radius: 'none',
    imageTreatment: 'full-bleed',
    heroStyle: 'overlap',
    navStyle: 'text',
    cardStyle: 'editorial',
    buttonStyle: 'outline',
    contentDensity: 'spacious',
    sectionRhythm: [],
    decorativeStyle: 'none',
    photographyStyle: 'muted, cinematic, shallow depth of field, restrained',
    palettes: ['slate', 'indigo'],
    background: 'dark',
  },
  'clinical-calm': {
    visualStyle: 'clinical-calm',
    compositionStyle: 'centered',
    typography: TYPO({
      headingFont: 'inter',
      headingScale: 'normal',
      headingWeight: 'medium',
      headingAlign: 'center',
      lineHeight: 'relaxed',
    }),
    spacing: 'spacious',
    radius: 'large',
    imageTreatment: 'framed',
    heroStyle: 'split',
    navStyle: 'text',
    cardStyle: 'raised',
    buttonStyle: 'soft',
    contentDensity: 'comfortable',
    sectionRhythm: [],
    decorativeStyle: 'none',
    photographyStyle: 'soft daylight, calm spaces, gentle tones, unhurried',
    palettes: ['teal', 'blue', 'cyan'],
    background: 'light',
  },
  energetic: {
    visualStyle: 'energetic',
    compositionStyle: 'asymmetric',
    typography: TYPO({
      headingFont: 'grotesk',
      headingScale: 'display',
      headingWeight: 'bold',
      headingAlign: 'left',
    }),
    spacing: 'standard',
    radius: 'large',
    imageTreatment: 'full-bleed',
    heroStyle: 'overlap',
    navStyle: 'pill',
    cardStyle: 'raised',
    buttonStyle: 'pill',
    contentDensity: 'comfortable',
    sectionRhythm: [],
    decorativeStyle: 'expressive',
    photographyStyle: 'motion blur, crowds, colour, night lighting, candid joy',
    palettes: ['fuchsia', 'violet', 'orange'],
    background: 'light',
  },
  organic: {
    visualStyle: 'organic',
    compositionStyle: 'editorial',
    typography: TYPO({
      headingFont: 'fraunces',
      headingScale: 'normal',
      headingWeight: 'regular',
      headingAlign: 'left',
      lineHeight: 'relaxed',
      textWidth: 'narrow',
    }),
    spacing: 'spacious',
    radius: 'large',
    imageTreatment: 'framed',
    heroStyle: 'split',
    navStyle: 'text',
    cardStyle: 'flat',
    buttonStyle: 'soft',
    contentDensity: 'comfortable',
    sectionRhythm: [],
    decorativeStyle: 'subtle',
    photographyStyle: 'earthy palette, natural textures, daylight, handmade detail',
    palettes: ['emerald', 'lime', 'amber'],
    background: 'tinted',
  },
  sophisticated: {
    visualStyle: 'sophisticated',
    compositionStyle: 'asymmetric',
    typography: TYPO({
      headingFont: 'fraunces',
      headingScale: 'normal',
      headingWeight: 'regular',
      headingAlign: 'left',
      letterSpacing: 'wide',
      lineHeight: 'relaxed',
      textWidth: 'narrow',
    }),
    spacing: 'spacious',
    radius: 'none',
    imageTreatment: 'full-bleed',
    heroStyle: 'minimal',
    navStyle: 'text',
    cardStyle: 'editorial',
    buttonStyle: 'outline',
    contentDensity: 'spacious',
    sectionRhythm: [],
    decorativeStyle: 'none',
    photographyStyle: 'monochrome-leaning, architectural, restrained, high craft',
    palettes: ['slate', 'indigo'],
    background: 'dark',
  },
  'utilitarian-modern': {
    visualStyle: 'utilitarian-modern',
    compositionStyle: 'grid',
    typography: TYPO({
      headingFont: 'inter',
      headingScale: 'normal',
      headingWeight: 'bold',
      headingAlign: 'left',
      letterSpacing: 'tight',
    }),
    spacing: 'compact',
    radius: 'subtle',
    imageTreatment: 'inset',
    heroStyle: 'split',
    navStyle: 'pill',
    cardStyle: 'bordered',
    buttonStyle: 'solid',
    contentDensity: 'compact',
    sectionRhythm: [],
    decorativeStyle: 'none',
    photographyStyle: 'plain, well-lit, functional, real jobs and tools',
    palettes: ['blue', 'slate', 'teal'],
    background: 'light',
  },
  heritage: {
    visualStyle: 'heritage',
    compositionStyle: 'centered',
    typography: TYPO({
      headingFont: 'fraunces',
      headingScale: 'normal',
      headingWeight: 'semibold',
      headingAlign: 'center',
      letterSpacing: 'normal',
      lineHeight: 'relaxed',
    }),
    spacing: 'standard',
    radius: 'subtle',
    imageTreatment: 'framed',
    heroStyle: 'centered',
    navStyle: 'text',
    cardStyle: 'bordered',
    buttonStyle: 'outline',
    contentDensity: 'comfortable',
    sectionRhythm: [],
    decorativeStyle: 'subtle',
    photographyStyle: 'classic, warm archival tones, craftsmanship, worn textures',
    palettes: ['amber', 'slate', 'emerald'],
    background: 'tinted',
  },
  playful: {
    visualStyle: 'playful',
    compositionStyle: 'grid',
    typography: TYPO({
      headingFont: 'grotesk',
      headingScale: 'display',
      headingWeight: 'bold',
      headingAlign: 'left',
    }),
    spacing: 'standard',
    radius: 'pill',
    imageTreatment: 'framed',
    heroStyle: 'gradient',
    navStyle: 'pill',
    cardStyle: 'raised',
    buttonStyle: 'pill',
    contentDensity: 'comfortable',
    sectionRhythm: [],
    decorativeStyle: 'expressive',
    photographyStyle: 'bright, candid, colourful, people smiling naturally',
    palettes: ['orange', 'lime', 'cyan', 'fuchsia'],
    background: 'light',
  },
  industrial: {
    visualStyle: 'industrial',
    compositionStyle: 'grid',
    typography: TYPO({
      headingFont: 'grotesk',
      headingScale: 'display',
      headingWeight: 'bold',
      headingAlign: 'left',
      letterSpacing: 'tight',
    }),
    spacing: 'compact',
    radius: 'none',
    imageTreatment: 'full-bleed',
    heroStyle: 'imageBg',
    navStyle: 'text',
    cardStyle: 'bordered',
    buttonStyle: 'solid',
    contentDensity: 'compact',
    sectionRhythm: [],
    decorativeStyle: 'subtle',
    photographyStyle: 'raw materials, machinery, workshop, high-contrast steel and concrete',
    palettes: ['slate', 'amber', 'blue'],
    background: 'dark',
  },
  wellness: {
    visualStyle: 'wellness',
    compositionStyle: 'centered',
    typography: TYPO({
      headingFont: 'fraunces',
      headingScale: 'normal',
      headingWeight: 'regular',
      headingAlign: 'center',
      lineHeight: 'relaxed',
      textWidth: 'narrow',
    }),
    spacing: 'spacious',
    radius: 'large',
    imageTreatment: 'framed',
    heroStyle: 'split',
    navStyle: 'text',
    cardStyle: 'flat',
    buttonStyle: 'soft',
    contentDensity: 'spacious',
    sectionRhythm: [],
    decorativeStyle: 'subtle',
    photographyStyle: 'soft natural light, greenery, skin and texture, unhurried calm',
    palettes: ['emerald', 'teal', 'lime', 'rose'],
    background: 'tinted',
  },
  'luxe-dark': {
    visualStyle: 'luxe-dark',
    compositionStyle: 'asymmetric',
    typography: TYPO({
      headingFont: 'fraunces',
      headingScale: 'display',
      headingWeight: 'regular',
      headingAlign: 'left',
      letterSpacing: 'wide',
      lineHeight: 'relaxed',
      textWidth: 'narrow',
    }),
    spacing: 'spacious',
    radius: 'none',
    imageTreatment: 'full-bleed',
    heroStyle: 'overlap',
    navStyle: 'text',
    cardStyle: 'editorial',
    buttonStyle: 'outline',
    contentDensity: 'spacious',
    sectionRhythm: [],
    decorativeStyle: 'none',
    photographyStyle: 'moody low-key lighting, gold and black, cinematic, high craft',
    palettes: ['slate', 'amber', 'indigo'],
    background: 'dark',
  },
  zine: {
    visualStyle: 'zine',
    compositionStyle: 'editorial',
    typography: TYPO({
      headingFont: 'jetbrains',
      headingScale: 'display',
      headingWeight: 'bold',
      headingAlign: 'left',
      letterSpacing: 'tight',
      lineHeight: 'tight',
    }),
    spacing: 'standard',
    radius: 'none',
    imageTreatment: 'inset',
    heroStyle: 'overlap',
    navStyle: 'text',
    cardStyle: 'flat',
    buttonStyle: 'solid',
    contentDensity: 'comfortable',
    sectionRhythm: [],
    decorativeStyle: 'expressive',
    photographyStyle: 'grainy, high-contrast, collage energy, street-shot spontaneity',
    palettes: ['rose', 'lime', 'slate', 'cyan'],
    background: 'light',
  },
};

const FAMILY_ALIASES: [RegExp, keyof typeof FAMILY_DNA][] = [
  [/edito|magazine|journal|feature/, 'editorial'],
  [/\bzine\b|cut-?and-?paste|collage|punk|riso/, 'zine'],
  [/minimal|spare|bare|stark/, 'minimalist'],
  [/architect|structur|brutal/, 'architectural'],
  [/industr|workshop|foundry|steel|concrete|machine|fabrication/, 'industrial'],
  [/heritage|classic|traditional|old-?school|timeless|vintage|artisanal legacy/, 'heritage'],
  [/warm|local|neighbou?r|family|community|homely|cosy|cozy/, 'warm-local'],
  [/corporate|enterprise|b2b|institution/, 'modern-corporate'],
  [/bold|loud|commercial|punchy|hype|vibrant|dtc/, 'bold-commercial'],
  [/playful|fun|friendly|cheerful|bright|whimsical|approachable/, 'playful'],
  [/tech|technical|developer|engineer|product-led|saas/, 'technical'],
  [/boutique|curat|craft|artisan|refined/, 'boutique'],
  [/luxe-?dark|dark luxury|opulent|glamour|black-?tie|couture/, 'luxe-dark'],
  [/premium|luxury|luxe|high-?end|concierge|bespoke/, 'premium-service'],
  [/wellness|spa|holistic|mindful|self-?care|nourish|restorative/, 'wellness'],
  [/clinic|calm|medical|reassur|gentle|health/, 'clinical-calm'],
  [/energ|festival|party|dynamic|kinetic|celebrat/, 'energetic'],
  [/organic|earthy|natural|handmade|\beco\b|sustainab/, 'organic'],
  [/sophisticat|elegan|understated|quiet/, 'sophisticated'],
  [/utilitar|efficient|no-?nonsense|practical|functional/, 'utilitarian-modern'],
  [/professional|straightforward|standard/, 'modern-corporate'],
];

function matchFamily(family: string, profile: BusinessProfile): keyof typeof FAMILY_DNA {
  const f = (family ?? '').toLowerCase();
  for (const [re, key] of FAMILY_ALIASES) if (re.test(f)) return key;
  if (FAMILY_DNA[f as keyof typeof FAMILY_DNA]) return f as keyof typeof FAMILY_DNA;
  // last resort: pick from the maturity/intent
  if (profile.maturity === 'premium') return 'premium-service';
  if (profile.purchaseIntent === 'high-trust') return 'modern-corporate';
  if (profile.imageIntensity === 'gallery-led') return 'editorial';
  return 'modern-corporate';
}

const HEADING_SCALE_AXIS: DnaTypography['headingScale'][] = ['tight', 'normal', 'display'];

const densityFor = (s: DesignDNA['spacing']): WebsiteTheme['density'] =>
  s === 'spacious' ? 'spacious' : s === 'compact' ? 'compact' : 'comfortable';

/**
 * (profile + direction + seed) → `DesignDNA`. Deterministic. When the AI supplied
 * validated `hints` in Stage 1, they are merged OVER the family-table base so the
 * look is bespoke to THIS brand rather than the family default.
 */
export function deriveDesignDNA(
  profile: BusinessProfile,
  direction: CreativeDirection,
  seed: number,
  hints: DnaHints = {},
): DesignDNA {
  const key = matchFamily(direction.family, profile);
  const base = FAMILY_DNA[key];
  const h = Math.abs(seed);

  // Seed rotates the palette within the family's fitting set + one typography axis.
  const palette =
    hints.palette ?? base.palettes[h % base.palettes.length] ?? PALETTES[h % PALETTES.length];
  const scaleShift = (h >> 3) % 3;
  const headingScale =
    hints.headingScale ??
    HEADING_SCALE_AXIS[
      (HEADING_SCALE_AXIS.indexOf(base.typography.headingScale) + scaleShift) %
        HEADING_SCALE_AXIS.length
    ];
  // A premium / established business earns a touch more air; a new one is denser.
  const spacing: DesignDNA['spacing'] =
    hints.spacing ??
    (profile.maturity === 'premium'
      ? 'spacious'
      : profile.maturity === 'new'
        ? base.spacing === 'spacious'
          ? 'standard'
          : 'compact'
        : base.spacing);

  return {
    visualStyle: base.visualStyle,
    compositionStyle: base.compositionStyle,
    typography: {
      ...base.typography,
      headingScale,
      ...(hints.headingFont ? { headingFont: hints.headingFont } : {}),
      ...(hints.headingAlign ? { headingAlign: hints.headingAlign } : {}),
    },
    spacing,
    radius: hints.radius ?? base.radius,
    imageTreatment: profile.imageIntensity === 'minimal' ? 'inset' : base.imageTreatment,
    heroStyle: hints.heroStyle ?? base.heroStyle,
    navStyle: base.navStyle,
    cardStyle: hints.cardStyle ?? base.cardStyle,
    buttonStyle: base.buttonStyle,
    contentDensity: densityFor(spacing),
    sectionRhythm: rhythm(base.compositionStyle, seed),
    decorativeStyle: hints.decorativeStyle ?? base.decorativeStyle,
    photographyStyle: hints.photographyStyle ?? base.photographyStyle,
    colorStrategy: {
      background: hints.background ?? base.background,
      palette,
      ...(hints.accentHex ? { accentHex: hints.accentHex } : {}),
    },
  };
}

// --- projections onto WebsiteTheme -------------------------------------

const SPACING_TO_DENSITY: Record<DesignDNA['spacing'], WebsiteTheme['density']> = {
  compact: 'compact',
  standard: 'comfortable',
  spacious: 'spacious',
};

/** DNA → the existing `WebsiteTheme` structural knobs. */
export function dnaToTheme(dna: DesignDNA): Partial<WebsiteTheme> {
  return {
    palette: dna.colorStrategy.palette,
    ...(dna.colorStrategy.accentHex ? { accent: dna.colorStrategy.accentHex } : {}),
    background: dna.colorStrategy.background,
    radius: dna.radius,
    density: SPACING_TO_DENSITY[dna.spacing],
    buttonStyle: dna.buttonStyle,
    headingFont: dna.typography.headingFont,
    bodyFont: dna.typography.headingFont === 'jetbrains' ? 'inter' : 'inter',
    shadow: dna.cardStyle === 'raised' ? 'bold' : dna.cardStyle === 'flat' ? 'none' : 'soft',
    motion:
      dna.decorativeStyle === 'expressive'
        ? 'lively'
        : dna.decorativeStyle === 'none'
          ? 'subtle'
          : 'subtle',
  };
}

/** DNA → the new typographic-character `WebsiteTheme` fields. */
export function dnaToTypography(dna: DesignDNA): Partial<WebsiteTheme> {
  const t = dna.typography;
  return {
    headingScale: t.headingScale,
    headingWeight: t.headingWeight,
    headingAlign: t.headingAlign,
    bodyScale: t.bodyScale,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    textWidth: t.textWidth,
  };
}
