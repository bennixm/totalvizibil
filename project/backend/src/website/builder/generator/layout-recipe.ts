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
import { SECTION_CATALOG, snapVariant, textFieldKeys } from '../section-catalog';
import { normalizeTheme } from '../compose-advanced';
import { hashInt } from '../stock-images';
import { dnaToTheme, dnaToTypography } from './design-dna';
import { roleToType } from './information-architecture';
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
 */
export function assignRhythm(
  roles: SectionRole[],
  dna: DesignDNA,
  seed: number,
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
    let mode = target[ti % target.length];
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
    role !== 'work';
  const needed =
    !NO_IMAGE_TYPES.has(type) &&
    !noneByIntensity &&
    (role === 'hero' ||
      role === 'gallery' ||
      role === 'work' ||
      role === 'about' ||
      role === 'story' ||
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
}

const PAGE_TITLE: Record<string, Record<SeedCtx['locale'], string>> = {
  home: { ro: 'Acasă', en: 'Home', de: 'Start' },
  work: { ro: 'Lucrări', en: 'Work', de: 'Arbeiten' },
  services: { ro: 'Servicii', en: 'Services', de: 'Leistungen' },
  about: { ro: 'Despre', en: 'About', de: 'Über uns' },
  contact: { ro: 'Contact', en: 'Contact', de: 'Kontakt' },
};

/** Roles that make a natural second page when the IA asked for multi-page. */
const SPLIT_OFF: Record<string, SectionRole[]> = {
  work: ['work', 'gallery', 'process'],
  services: ['services', 'pricing', 'faq'],
  about: ['about', 'story', 'team', 'credentials', 'stats'],
};

export function buildRecipe(input: BuildRecipeInput): LayoutRecipe {
  const { ia, dna, profile, ctx, seed } = input;
  const usedVariants = new Set<string>();

  const roleList = ia.roles.map((r) => r.role);
  const modes = assignRhythm(roleList, dna, seed);

  const allSections: RecipeSection[] = ia.roles.map((r, i) => {
    const type = roleToType(r.role, dna, profile, seed);
    const mode = modes[i];
    const variant = pickVariant(type, dna, mode, seed + i, usedVariants);
    usedVariants.add(`${type}:${variant}`);
    const imageSlot = imageSlotFor(r.role, type, mode, dna, profile, i);
    const animation = animationFor(mode, dna, i, seed);
    return {
      role: r.role,
      type,
      variant,
      composition: mode,
      ...(animation ? { animation } : {}),
      imageSlot,
    };
  });

  // Ensure home opens with a hero and ends (on the last page) with contact.
  if (allSections[0]?.type !== 'hero') {
    allSections.unshift({
      role: 'hero',
      type: 'hero',
      variant: dna.heroStyle,
      composition: 'full',
      imageSlot: imageSlotFor('hero', 'hero', 'full', dna, profile, 0),
    });
  }

  const pages: RecipePage[] = [];
  if (ia.pageStrategy === 'multi-page' && ia.pageCount >= 2) {
    // pick ONE split-off group present in the section list
    const groups = Object.entries(SPLIT_OFF);
    const gIdx = Math.abs(seed) % groups.length;
    const [pageKey, roles] = groups[(gIdx + groups.length) % groups.length];
    const moved = allSections.filter(
      (s) => roles.includes(s.role) && s.role !== 'hero' && s.role !== 'contact',
    );
    if (moved.length >= 2) {
      const home = allSections.filter((s) => !moved.includes(s) || s.role === 'contact');
      pages.push(page('home', home, ctx, dna));
      pages.push(page(pageKey, moved, ctx, dna));
      // contact lives on the last page
      const last = pages[pages.length - 1];
      if (!last.sections.some((s) => s.role === 'contact')) {
        const contact = home.find((s) => s.role === 'contact');
        if (contact) {
          pages[0].sections = pages[0].sections.filter((s) => s.role !== 'contact');
          last.sections.push(contact);
        }
      }
    }
  }
  if (!pages.length) pages.push(page('home', allSections, ctx, dna));

  // theme = DNA projection (normalizeTheme fills any gap with its own defaults)
  const theme: WebsiteTheme = normalizeTheme({
    ...dnaToTheme(dna),
    ...dnaToTypography(dna),
  });

  return { pages, theme };
}

function page(key: string, sections: RecipeSection[], ctx: SeedCtx, dna: DesignDNA): RecipePage {
  void dna;
  const title = PAGE_TITLE[key]?.[ctx.locale] ?? PAGE_TITLE.home[ctx.locale];
  return {
    title,
    slug: key === 'home' ? 'home' : key,
    purpose: key === 'home' ? 'the whole business in one scroll' : `${key} in depth`,
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
