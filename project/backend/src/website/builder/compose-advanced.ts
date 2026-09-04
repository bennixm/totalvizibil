/**
 * Deterministic composer for the ADVANCED (multi-page) website builder.
 *
 * The builder works on a `BuilderDoc` — the editable spec (pages → ordered
 * sections referencing catalog types/variants + their content). Every mutation
 * runs `composeAdvancedDoc` to (re)produce the rendered `WebsiteContent` +
 * `WebsiteTheme` that the public renderer and the feed already consume. Nothing
 * here calls an LLM.
 */
import { randomUUID } from 'node:crypto';
import { slugify } from '../../common/slug';
import {
  GeneratedWebsite,
  Section,
  SectionType,
  WebsitePage,
  WebsiteTheme,
} from '../website.types';
import {
  SECTION_CATALOG,
  SeedCtx,
  coerceContent,
  seedSectionContent,
  snapAnimation,
  snapVariant,
} from './section-catalog';

export const MAX_PAGES = 6;
export const ADVANCED_GENERATOR = 'advanced-builder-v2';

const DEFAULT_THEME: WebsiteTheme = {
  palette: 'indigo',
  fontPair: 'grotesk-inter',
  radius: 'rounded',
  density: 'comfortable',
};

export const PALETTES: WebsiteTheme['palette'][] = [
  'indigo',
  'violet',
  'blue',
  'cyan',
  'teal',
  'emerald',
  'lime',
  'amber',
  'orange',
  'rose',
  'fuchsia',
  'slate',
];
const FONTS: WebsiteTheme['fontPair'][] = ['grotesk-inter', 'serif-sans', 'mono-sans'];
export const RADII: WebsiteTheme['radius'][] = ['none', 'subtle', 'rounded', 'large', 'pill'];
export const THEME_FONTS: NonNullable<WebsiteTheme['headingFont']>[] = [
  'grotesk',
  'inter',
  'fraunces',
  'jetbrains',
];
export const BACKGROUNDS: NonNullable<WebsiteTheme['background']>[] = ['light', 'tinted', 'dark'];
export const BUTTON_STYLES: NonNullable<WebsiteTheme['buttonStyle']>[] = [
  'solid',
  'outline',
  'soft',
  'pill',
];
export const SHADOWS: NonNullable<WebsiteTheme['shadow']>[] = ['none', 'soft', 'bold'];
export const MOTIONS: NonNullable<WebsiteTheme['motion']>[] = ['off', 'subtle', 'lively'];
export const PRESET_IDS = ['studio', 'bold', 'editorial', 'soft', 'tech', 'warm', 'mono'];
const DENSITIES: WebsiteTheme['density'][] = ['compact', 'comfortable', 'spacious'];

/** Old 3-value radius scale → new 5-value scale. */
const RADIUS_MIGRATE: Record<string, WebsiteTheme['radius']> = {
  sharp: 'none',
  soft: 'rounded',
  round: 'large',
};

export interface DocSection {
  id: string;
  type: SectionType;
  variant: string;
  visible: boolean;
  /** Entrance animation preset id; absent = inherit the theme's motion default. */
  animation?: string;
  content: Record<string, unknown>;
}

export interface PageSpec {
  id: string;
  title: string;
  slug: string;
  isHome: boolean;
  nav: boolean;
  sections: DocSection[];
}

export interface BuilderDoc {
  v: 2;
  mode: 'manual' | 'ai';
  theme: WebsiteTheme;
  pages: PageSpec[];
  ai?: { brief?: string; planCount: number; sectionCount: number; notes?: string[] };
  /** Snapshots kept before an AI plan replace, newest last. Bounded. */
  history?: PageSpec[][];
}

const cap = (v: string): string => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

const L = (loc: SeedCtx['locale'], t: { ro: string; en: string; de: string }): string =>
  t[loc] ?? t.ro;

export function normalizeTheme(raw: unknown): WebsiteTheme {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T>(v: unknown, opts: T[], dflt: T): T => (opts.includes(v as T) ? (v as T) : dflt);
  const opt = <T>(v: unknown, opts: T[]): T | undefined =>
    opts.includes(v as T) ? (v as T) : undefined;
  const accent =
    typeof t.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.accent) ? t.accent : undefined;
  const rawRadius =
    typeof t.radius === 'string' ? (RADIUS_MIGRATE[t.radius] ?? t.radius) : t.radius;
  const preset =
    typeof t.preset === 'string' && PRESET_IDS.includes(t.preset) ? t.preset : undefined;

  return {
    palette: pick(t.palette, PALETTES, DEFAULT_THEME.palette),
    fontPair: pick(t.fontPair, FONTS, DEFAULT_THEME.fontPair),
    radius: pick(rawRadius, RADII, DEFAULT_THEME.radius),
    density: pick(t.density, DENSITIES, DEFAULT_THEME.density),
    ...(accent ? { accent } : {}),
    ...(preset ? { preset } : {}),
    ...(opt(t.background, BACKGROUNDS) ? { background: opt(t.background, BACKGROUNDS) } : {}),
    ...(opt(t.headingFont, THEME_FONTS) ? { headingFont: opt(t.headingFont, THEME_FONTS) } : {}),
    ...(opt(t.bodyFont, THEME_FONTS) ? { bodyFont: opt(t.bodyFont, THEME_FONTS) } : {}),
    ...(opt(t.buttonStyle, BUTTON_STYLES)
      ? { buttonStyle: opt(t.buttonStyle, BUTTON_STYLES) }
      : {}),
    ...(opt(t.shadow, SHADOWS) ? { shadow: opt(t.shadow, SHADOWS) } : {}),
    ...(opt(t.motion, MOTIONS) ? { motion: opt(t.motion, MOTIONS) } : {}),
  };
}

function docSection(type: SectionType, variant: string, ctx: SeedCtx): DocSection {
  return {
    id: randomUUID(),
    type,
    variant: snapVariant(type, variant),
    visible: true,
    content: seedSectionContent(type, ctx),
  };
}

/** A real 3-page starting site so "unlock" never lands on a blank canvas. */
export function starterAdvancedDoc(ctx: SeedCtx): BuilderDoc {
  const P = (title: Record<SeedCtx['locale'], string>): Record<SeedCtx['locale'], string> => title;
  const home = P({ ro: 'Acasă', en: 'Home', de: 'Start' })[ctx.locale];
  const about = P({ ro: 'Despre', en: 'About', de: 'Über uns' })[ctx.locale];
  const contact = P({ ro: 'Contact', en: 'Contact', de: 'Kontakt' })[ctx.locale];
  return normalizeDoc(
    {
      v: 2,
      mode: 'manual',
      theme: { ...DEFAULT_THEME },
      pages: [
        {
          id: randomUUID(),
          title: home,
          slug: 'home',
          isHome: true,
          nav: true,
          sections: [
            docSection('hero', 'split', ctx),
            docSection('services', 'cards', ctx),
            docSection('testimonials', 'cards', ctx),
            docSection('cta', 'gradient', ctx),
          ],
        },
        {
          id: randomUUID(),
          title: about,
          slug: 'about',
          isHome: false,
          nav: true,
          sections: [
            docSection('about', 'imageRight', ctx),
            docSection('team', 'cards', ctx),
            docSection('stats', 'band', ctx),
          ],
        },
        {
          id: randomUUID(),
          title: contact,
          slug: 'contact',
          isHome: false,
          nav: true,
          sections: [docSection('contact', 'split', ctx), docSection('faq', 'accordion', ctx)],
        },
      ],
    },
    ctx,
  );
}

/**
 * Deterministic "AI plan" fallback — used when DeepSeek is unavailable. Starts
 * from the 3-page starter and adds brief-keyword-driven sections/pages so a
 * prompt still yields something tailored.
 */
export function keywordPlanDoc(brief: string, ctx: SeedCtx): BuilderDoc {
  const doc = starterAdvancedDoc(ctx);
  const b = brief.toLowerCase();
  const has = (...re: string[]): boolean => re.some((r) => new RegExp(r, 'i').test(b));

  const home = doc.pages[0];
  const about = doc.pages[1];

  if (has('pre[țt]', 'pricing', 'plan', 'abonament', 'subscription', 'tarif', 'pachet', 'preise')) {
    doc.pages.splice(2, 0, {
      id: randomUUID(),
      title: L(ctx.locale, { ro: 'Prețuri', en: 'Pricing', de: 'Preise' }),
      slug: 'pricing',
      isHome: false,
      nav: true,
      sections: [docSection('pricing', 'tiers', ctx), docSection('faq', 'accordion', ctx)],
    });
  }
  if (
    has('portofoli', 'portfolio', 'galer', 'gallery', 'lucr[ăa]ri', 'proiect', 'referin', 'work')
  ) {
    (doc.pages[2] ?? about).sections.push(docSection('gallery', 'grid', ctx));
    home.sections.splice(2, 0, docSection('logos', 'strip', ctx));
  }
  if (has('proces', 'process', 'pa[șs]i', 'steps', 'cum lucr', 'workflow', 'ablauf')) {
    home.sections.splice(2, 0, docSection('process', 'vertical', ctx));
  }
  if (has('avantaj', 'benefic', 'why', 'de ce', 'feature', 'warum')) {
    home.sections.splice(2, 0, docSection('features', 'grid', ctx));
  }
  if (has('echip[ăa]', 'team', 'fondator', 'colegi', 'oameni')) {
    about.sections.splice(1, 0, docSection('featureSplit', 'alternating', ctx));
  }

  // Pick a style bundle from the brief's vocabulary.
  const preset = has('agen[țt]ie', 'agency', 'studio', 'consult')
    ? 'studio'
    : has('magazin', 'shop', 'store', 'ecommerce', 'produs', 'vânz', 'pre[țt]', 'pricing')
      ? 'bold'
      : has('restaurant', 'cafenea', 'cafe', 'bistro', 'bar', 'catering', 'food', 'patiser')
        ? 'warm'
        : has('tech', 'saas', 'software', 'aplica[țt]ie', 'app', 'startup', 'platform', 'it ')
          ? 'tech'
          : has('fotograf', 'photo', 'portofoli', 'portfolio', 'arhitect', 'design', 'art')
            ? 'editorial'
            : undefined;
  if (preset) {
    const themePatch: Partial<WebsiteTheme> =
      preset === 'studio'
        ? { preset, palette: 'indigo', background: 'tinted', radius: 'rounded', shadow: 'soft' }
        : preset === 'bold'
          ? {
              preset,
              palette: 'orange',
              radius: 'none',
              buttonStyle: 'pill',
              shadow: 'bold',
              motion: 'lively',
            }
          : preset === 'warm'
            ? { preset, palette: 'amber', background: 'tinted', headingFont: 'fraunces' }
            : preset === 'tech'
              ? { preset, palette: 'cyan', background: 'dark', radius: 'subtle', motion: 'lively' }
              : {
                  preset,
                  palette: 'slate',
                  headingFont: 'fraunces',
                  shadow: 'none',
                  radius: 'subtle',
                };
    doc.theme = normalizeTheme({ ...doc.theme, ...themePatch });
  }

  return normalizeDoc(doc, ctx);
}

function normalizeSection(raw: unknown): DocSection | null {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof s.type !== 'string' || !(s.type in SECTION_CATALOG)) return null;
  const type = s.type as SectionType;
  const content =
    s.content && typeof s.content === 'object'
      ? (s.content as Record<string, unknown>)
      : // legacy: content fields sat flat on the section
        (() => {
          const { id, type: _t, visible, variant, content: _c, ...rest } = s;
          void id;
          void _t;
          void visible;
          void variant;
          void _c;
          return rest;
        })();
  const animation = snapAnimation(s.animation);
  return {
    id: typeof s.id === 'string' && s.id ? s.id : randomUUID(),
    type,
    variant: snapVariant(type, s.variant),
    visible: s.visible !== false,
    ...(animation ? { animation } : {}),
    content: coerceContent(type, content),
  };
}

/** Clamp + repair an arbitrary doc-shaped value into a valid `BuilderDoc`. */
export function normalizeDoc(raw: unknown, ctx: SeedCtx): BuilderDoc {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pagesIn = Array.isArray(d.pages) ? d.pages : [];
  const usedSlugs = new Set<string>();

  let pages: PageSpec[] = pagesIn.slice(0, MAX_PAGES).map((p, i) => {
    const pp = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const title = (typeof pp.title === 'string' && pp.title.trim()) || `Page ${i + 1}`;
    let slug = slugify(typeof pp.slug === 'string' && pp.slug ? pp.slug : title) || `page-${i + 1}`;
    while (usedSlugs.has(slug)) slug = `${slug}-${usedSlugs.size + 1}`;
    usedSlugs.add(slug);
    const sections = (Array.isArray(pp.sections) ? pp.sections : [])
      .map(normalizeSection)
      .filter((s): s is DocSection => s != null);
    return {
      id: (typeof pp.id === 'string' && pp.id) || randomUUID(),
      title: title.slice(0, 60),
      slug,
      isHome: pp.isHome === true,
      nav: pp.nav !== false,
      sections,
    };
  });

  if (!pages.length) pages = starterAdvancedDoc(ctx).pages;

  // Exactly one home page.
  const homeIdx = pages.findIndex((p) => p.isHome);
  pages.forEach((p, i) => (p.isHome = i === (homeIdx >= 0 ? homeIdx : 0)));

  const ai =
    d.ai && typeof d.ai === 'object'
      ? {
          brief:
            typeof (d.ai as Record<string, unknown>).brief === 'string'
              ? String((d.ai as Record<string, unknown>).brief).slice(0, 4000)
              : undefined,
          planCount: Number((d.ai as Record<string, unknown>).planCount) || 0,
          sectionCount: Number((d.ai as Record<string, unknown>).sectionCount) || 0,
          notes: Array.isArray((d.ai as Record<string, unknown>).notes)
            ? ((d.ai as Record<string, unknown>).notes as unknown[])
                .filter((x): x is string => typeof x === 'string')
                .slice(0, 5)
            : undefined,
        }
      : undefined;

  // Undo snapshots taken before an AI plan replace — bounded to the last 3.
  // Carried forward verbatim; a restore re-runs `normalizeDoc` over it.
  const history = Array.isArray(d.history)
    ? (d.history as unknown[]).filter((h): h is unknown[] => Array.isArray(h)).slice(-3)
    : [];

  return {
    v: 2,
    mode: d.mode === 'ai' ? 'ai' : 'manual',
    theme: normalizeTheme(d.theme),
    pages,
    ...(ai ? { ai } : {}),
    ...(history.length ? { history: history as PageSpec[][] } : {}),
  };
}

/** Compose the rendered website (content + theme) from a builder doc. */
export function composeAdvancedDoc(doc: BuilderDoc, ctx: SeedCtx): GeneratedWebsite {
  const pages: WebsitePage[] = doc.pages.map((p) => {
    const sections = p.sections
      .filter((s) => s.visible !== false)
      .map((s) => {
        const animation = snapAnimation(s.animation);
        return {
          id: s.id,
          type: s.type,
          visible: true,
          variant: snapVariant(s.type, s.variant),
          ...(animation ? { animation } : {}),
          ...coerceContent(s.type, s.content ?? {}),
        } as Section;
      });
    return {
      slug: p.slug,
      title: p.title || cap(p.slug),
      isHome: p.isHome,
      nav: p.nav !== false,
      sections,
    };
  });

  if (pages.length && !pages.some((p) => p.isHome)) pages[0].isHome = true;

  const home = pages.find((p) => p.isHome) ?? pages[0];
  const hero = home?.sections.find((x) => x.type === 'hero') as
    { subheadline?: string } | undefined;
  const name = ctx.businessName || home?.title || 'Website';
  const title = `${name}${ctx.businessType ? ` — ${ctx.businessType}` : ''}${
    ctx.city ? `, ${ctx.city}` : ''
  }`.slice(0, 70);
  const description = (
    hero?.subheadline ||
    `${name}${ctx.businessType ? `, ${ctx.businessType}` : ''}${ctx.city ? ` — ${ctx.city}` : ''}.`
  ).slice(0, 160);

  return {
    generator: ADVANCED_GENERATOR,
    theme: normalizeTheme(doc.theme),
    content: { pages, seo: { title, description, schemaType: 'LocalBusiness' } },
  };
}

/**
 * Load an editable doc from a stored `Website` — a `v:2` builderSpec straight
 * through (normalised), an old `{step,answers}` builderSpec or a bare `content`
 * reverse-mapped, else a fresh starter site.
 */
export function docFromLegacy(
  builderSpec: unknown,
  content: unknown,
  theme: unknown,
  ctx: SeedCtx,
): BuilderDoc {
  const bs = (builderSpec && typeof builderSpec === 'object' ? builderSpec : null) as Record<
    string,
    unknown
  > | null;

  if (bs && bs.v === 2 && Array.isArray(bs.pages)) return normalizeDoc(bs, ctx);

  const c = (content && typeof content === 'object' ? content : null) as {
    pages?: unknown[];
  } | null;
  if (c && Array.isArray(c.pages) && c.pages.length) {
    return normalizeDoc({ v: 2, mode: 'manual', theme, pages: c.pages }, ctx);
  }

  return starterAdvancedDoc(ctx);
}
