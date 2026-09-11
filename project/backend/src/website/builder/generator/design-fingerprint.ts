/**
 * A structural fingerprint of a generated site. Two sites that differ ONLY in
 * copy / colour / photos hash to the SAME fingerprint — that similarity is
 * exactly the failure this guards against. Real diversity means different
 * section sequences, variants, composition rhythm, typographic character and
 * CTA pattern.
 */
import type { BuilderDoc } from '../compose-advanced';
import type { LayoutRecipe } from './types';

export interface Fingerprint {
  /** `hero>services>work>...` (non-system pages, in order). */
  sequence: string;
  /** `hero:split|services:cards|...`. */
  variants: string;
  heroVariant: string;
  /** Composition modes when built from a recipe, else derived from variants. */
  rhythm: string;
  /** `<headingFont>/<headingScale>/<headingAlign>`. */
  typography: string;
  /** count of image-bearing sections bucketed: none|light|medium|heavy. */
  imageDensity: string;
  /** which CTA section types appear. */
  ctaPattern: string;
  /** `<background>/<palette>` — the ONE cosmetic axis kept (weak signal). */
  colorStrategy: string;
  /** stable digest of the structural axes only (excludes colorStrategy). */
  hash: string;
}

const CTA_TYPES = new Set(['cta', 'splitCta', 'banner', 'newsletter']);
const IMG_TYPES = new Set([
  'hero',
  'gallery',
  'showcase',
  'about',
  'caseStudy',
  'beforeAfter',
  'featureSplit',
  'bento',
  'tabs',
]);

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function densityBucket(n: number): string {
  if (n === 0) return 'none';
  if (n <= 2) return 'light';
  if (n <= 5) return 'medium';
  return 'heavy';
}

export function fingerprintDoc(doc: BuilderDoc, recipe?: LayoutRecipe): Fingerprint {
  const pages = doc.pages.filter((p) => !p.system);
  const secs = pages.flatMap((p) => p.sections.filter((s) => s.visible !== false));

  const sequence = secs.map((s) => s.type).join('>');
  const variants = secs.map((s) => `${s.type}:${s.variant}`).join('|');
  const heroVariant = secs.find((s) => s.type === 'hero')?.variant ?? '-';
  const rhythm = recipe
    ? recipe.pages.flatMap((p) => p.sections.map((s) => s.composition)).join('-')
    : secs.map((s) => s.variant).join('-');

  const t = doc.theme;
  const typography = `${t.headingFont ?? 'grotesk'}/${t.headingScale ?? 'normal'}/${
    t.headingAlign ?? 'center'
  }/${t.textWidth ?? 'normal'}`;

  const imgCount = secs.filter((s) => IMG_TYPES.has(s.type)).length;
  const imageDensity = densityBucket(imgCount);
  const ctaPattern = [...new Set(secs.filter((s) => CTA_TYPES.has(s.type)).map((s) => s.type))]
    .sort()
    .join('+');
  const colorStrategy = `${t.background ?? 'light'}/${t.palette}`;

  const hash = djb2(
    [sequence, variants, heroVariant, rhythm, typography, imageDensity, ctaPattern].join('#'),
  );

  return {
    sequence,
    variants,
    heroVariant,
    rhythm,
    typography,
    imageDensity,
    ctaPattern,
    colorStrategy,
    hash,
  };
}

/**
 * Same fingerprint, computed straight off a `LayoutRecipe` — before the (slow)
 * copy pass. Lets the pipeline detect "this structure is a repeat of a recent
 * generation" and re-roll the seed for free.
 */
export function fingerprintRecipe(recipe: LayoutRecipe): Fingerprint {
  const secs = recipe.pages.flatMap((p) => p.sections);
  const sequence = secs.map((s) => s.type).join('>');
  const variants = secs.map((s) => `${s.type}:${s.variant}`).join('|');
  const heroVariant = secs.find((s) => s.type === 'hero')?.variant ?? '-';
  const rhythm = secs.map((s) => s.composition).join('-');
  const t = recipe.theme;
  const typography = `${t.headingFont ?? 'grotesk'}/${t.headingScale ?? 'normal'}/${
    t.headingAlign ?? 'center'
  }/${t.textWidth ?? 'normal'}`;
  const imgCount = secs.filter((s) => IMG_TYPES.has(s.type)).length;
  const imageDensity = densityBucket(imgCount);
  const ctaPattern = [...new Set(secs.filter((s) => CTA_TYPES.has(s.type)).map((s) => s.type))]
    .sort()
    .join('+');
  const colorStrategy = `${t.background ?? 'light'}/${t.palette}`;
  const hash = djb2(
    [sequence, variants, heroVariant, rhythm, typography, imageDensity, ctaPattern].join('#'),
  );
  return {
    sequence,
    variants,
    heroVariant,
    rhythm,
    typography,
    imageDensity,
    ctaPattern,
    colorStrategy,
    hash,
  };
}

/** 0 = identical structure, 1 = maximally different. Ignores colour/copy. */
export function fingerprintDistance(a: Fingerprint, b: Fingerprint): number {
  const axes: (keyof Fingerprint)[] = [
    'sequence',
    'variants',
    'heroVariant',
    'rhythm',
    'typography',
    'imageDensity',
    'ctaPattern',
  ];
  const weights: Record<string, number> = {
    sequence: 0.28,
    variants: 0.24,
    heroVariant: 0.08,
    rhythm: 0.18,
    typography: 0.12,
    imageDensity: 0.05,
    ctaPattern: 0.05,
  };
  let d = 0;
  for (const ax of axes) {
    const av = String(a[ax]);
    const bv = String(b[ax]);
    if (av === bv) continue;
    // token-level Jaccard for the multi-token axes, binary for the rest
    if (av.includes('>') || av.includes('|') || av.includes('-')) {
      const sep = av.includes('|') ? '|' : av.includes('>') ? '>' : '-';
      const sa = new Set(av.split(sep));
      const sb = new Set(bv.split(sep));
      const inter = [...sa].filter((x) => sb.has(x)).length;
      const uni = new Set([...sa, ...sb]).size || 1;
      d += weights[ax] * (1 - inter / uni);
    } else {
      d += weights[ax];
    }
  }
  return Math.min(1, d);
}

/** True when `fp` is structurally too close to any of `recent`. */
export function tooSimilar(fp: Fingerprint, recent: Fingerprint[], threshold = 0.22): boolean {
  return recent.some((r) => fingerprintDistance(fp, r) < threshold);
}
