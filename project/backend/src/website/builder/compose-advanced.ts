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
import { SkeletonSpec, classifyArchetype, pickSkeleton } from './site-archetypes';
import { fillDocImages, hashInt } from './stock-images';
import { POLICY_KINDS, POLICY_SLUG, PolicyKind, policyPageText } from './policy-pages';

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
  /** Reserved legal page (privacy/terms/cookies) — editable, not deletable. */
  system?: 'privacy' | 'terms' | 'cookies';
  sections: DocSection[];
}

export interface NavConfig {
  logo: 'show' | 'hide';
  sticky: boolean;
  linkStyle: 'text' | 'pill';
  showPages: boolean;
  cta: { label: string; target: string } | null;
}
export interface FooterConfig {
  tagline: string;
  showLegal: boolean;
  showContact: boolean;
  socials: { label: string; url: string }[];
}

export interface BuilderDoc {
  v: 2;
  mode: 'manual' | 'ai';
  theme: WebsiteTheme;
  pages: PageSpec[];
  nav?: NavConfig;
  footer?: FooterConfig;
  ai?: { brief?: string; planCount: number; sectionCount: number; notes?: string[] };
  /** Snapshots kept before an AI plan replace, newest last. Bounded. */
  history?: PageSpec[][];
}

const DEFAULT_NAV: NavConfig = {
  logo: 'show',
  sticky: true,
  linkStyle: 'text',
  showPages: true,
  cta: null,
};
const DEFAULT_FOOTER: FooterConfig = {
  tagline: '',
  showLegal: true,
  showContact: true,
  socials: [],
};

export function normalizeNav(raw: unknown): NavConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ctaRaw = r.cta as Record<string, unknown> | null | undefined;
  const cta =
    ctaRaw && typeof ctaRaw === 'object' && typeof ctaRaw.label === 'string' && ctaRaw.label.trim()
      ? {
          label: String(ctaRaw.label).trim().slice(0, 40),
          target:
            String(ctaRaw.target ?? 'contact')
              .trim()
              .slice(0, 60) || 'contact',
        }
      : null;
  return {
    logo: r.logo === 'hide' ? 'hide' : 'show',
    sticky: r.sticky !== false,
    linkStyle: r.linkStyle === 'pill' ? 'pill' : 'text',
    showPages: r.showPages !== false,
    cta,
  };
}
export function normalizeFooter(raw: unknown): FooterConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const socials = Array.isArray(r.socials)
    ? (r.socials as Record<string, unknown>[])
        .map((x) => ({
          label: String(x?.label ?? '')
            .trim()
            .slice(0, 24),
          url: String(x?.url ?? '')
            .trim()
            .slice(0, 200),
        }))
        .filter((x) => x.label && /^https?:\/\//i.test(x.url))
        .slice(0, 6)
    : [];
  return {
    tagline: String(r.tagline ?? '')
      .trim()
      .slice(0, 200),
    showLegal: r.showLegal !== false,
    showContact: r.showContact !== false,
    socials,
  };
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
  const logoUrl =
    typeof t.logoUrl === 'string' && t.logoUrl.trim().length > 0 && t.logoUrl.length <= 500
      ? t.logoUrl.trim()
      : undefined;

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
    ...(logoUrl ? { logoUrl } : {}),
  };
}

function docSection(
  type: SectionType,
  variant: string,
  ctx: SeedCtx,
  animation?: string,
): DocSection {
  return {
    id: randomUUID(),
    type,
    variant: snapVariant(type, variant),
    visible: true,
    ...(snapAnimation(animation) ? { animation: snapAnimation(animation) } : {}),
    content: seedSectionContent(type, ctx),
  };
}

/** Build the `richText` section for one legal page from the boilerplate. */
function policyPage(kind: PolicyKind, ctx: SeedCtx): PageSpec {
  const { title, body } = policyPageText(kind, {
    businessName: ctx.businessName,
    city: ctx.city,
    email: ctx.email,
    locale: ctx.locale,
  });
  return {
    id: randomUUID(),
    title,
    slug: POLICY_SLUG[kind],
    isHome: false,
    nav: false,
    system: kind,
    sections: [
      {
        id: randomUUID(),
        type: 'richText',
        variant: 'narrow',
        visible: true,
        content: coerceContent('richText', { title, body }),
      },
    ],
  };
}

/** Every Advanced site must carry privacy / terms / cookies pages. Appends the
 *  missing ones (keeps any the owner already edited). */
export function ensurePolicyPages(doc: BuilderDoc, ctx: SeedCtx): void {
  for (const kind of POLICY_KINDS) {
    if (!doc.pages.some((p) => p.system === kind)) doc.pages.push(policyPage(kind, ctx));
  }
}

/** Guarantee a way to get in touch — a page with a `contact` section. */
export function ensureContactPage(doc: BuilderDoc, ctx: SeedCtx): void {
  if (doc.pages.some((p) => p.sections.some((s) => s.type === 'contact'))) return;
  const insertAt = doc.pages.findIndex((p) => p.system);
  const page: PageSpec = {
    id: randomUUID(),
    title: L(ctx.locale, { ro: 'Contact', en: 'Contact', de: 'Kontakt' }),
    slug: 'contact',
    isHome: false,
    nav: true,
    sections: [docSection('contact', 'split', ctx), docSection('faq', 'accordion', ctx)],
  };
  if (insertAt >= 0) doc.pages.splice(insertAt, 0, page);
  else doc.pages.push(page);
}

/** Build a full `BuilderDoc` from an archetype blueprint (deterministic seeds). */
export function skeletonToDoc(sk: SkeletonSpec, ctx: SeedCtx): BuilderDoc {
  const known = new Set(Object.keys(SECTION_CATALOG));
  const pages = sk.pages.map((p, i) => ({
    id: randomUUID(),
    title: p.title[ctx.locale] ?? p.title.ro,
    slug: slugify(p.title.en) || `page-${i + 1}`,
    isHome: i === 0,
    nav: p.nav !== false,
    sections: p.sections
      .filter((x) => known.has(x.type))
      .map((x) => docSection(x.type, x.variant, ctx, x.animation)),
  }));
  return normalizeDoc(
    { v: 2, mode: 'ai', theme: normalizeTheme({ ...DEFAULT_THEME, ...(sk.theme ?? {}) }), pages },
    ctx,
  );
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
  const b = brief.toLowerCase();
  const has = (...re: string[]): boolean => re.some((r) => new RegExp(r, 'i').test(b));

  // Structure comes from an archetype blueprint (deterministic pick), not the
  // one-size starter — so two briefs rarely land on the same shape.
  const archetype = classifyArchetype(brief, ctx.businessType, ctx.services);
  const doc = skeletonToDoc(pickSkeleton(archetype, hashInt(`${brief}|${ctx.businessName}`)), ctx);
  const hasType = (t: SectionType): boolean =>
    doc.pages.some((p) => p.sections.some((sec) => sec.type === t));
  const hasPage = (slug: string): boolean => doc.pages.some((p) => p.slug === slug);
  // Legal pages are appended by normalizeDoc — don't count them against the cap.
  const realCount = (): number => doc.pages.filter((p) => !p.system).length;
  const firstSystemIdx = (): number => {
    const i = doc.pages.findIndex((p) => p.system);
    return i >= 0 ? i : doc.pages.length;
  };
  const home = doc.pages[0];
  const secondary = doc.pages.find((p, i) => i > 0 && !p.system) ?? home;

  // Graft on what the brief explicitly asks for and the blueprint lacks.
  if (
    has('pre[țt]', 'pricing', 'plan', 'abonament', 'subscription', 'tarif', 'pachet', 'preise') &&
    !hasPage('pricing') &&
    realCount() < MAX_PAGES
  ) {
    doc.pages.splice(Math.max(1, firstSystemIdx() - 1), 0, {
      id: randomUUID(),
      title: L(ctx.locale, { ro: 'Prețuri', en: 'Pricing', de: 'Preise' }),
      slug: 'pricing',
      isHome: false,
      nav: true,
      sections: [docSection('pricing', 'tiers', ctx), docSection('faq', 'accordion', ctx)],
    });
  }
  if (
    has('portofoli', 'portfolio', 'galer', 'gallery', 'lucr[ăa]ri', 'proiect', 'referin', 'work') &&
    !hasType('gallery')
  ) {
    secondary.sections.push(docSection('gallery', 'grid', ctx));
  }
  if (
    has('proces', 'process', 'pa[șs]i', 'steps', 'cum lucr', 'workflow', 'ablauf') &&
    !hasType('process') &&
    !hasType('timeline')
  ) {
    home.sections.splice(
      Math.min(2, home.sections.length),
      0,
      docSection('process', 'vertical', ctx),
    );
  }
  if (has('echip[ăa]', 'team', 'fondator', 'colegi', 'oameni') && !hasType('team')) {
    secondary.sections.push(docSection('team', 'cards', ctx));
  }

  // Brief vocabulary can still refine the blueprint's default palette bundle.
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

  fillDocImages(doc, ctx, brief);
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

/** True when a coerced content object carries no user-visible value at all. */
function isEmptyContent(type: SectionType, content: Record<string, unknown>): boolean {
  const c = coerceContent(type, content ?? {});
  for (const v of Object.values(c)) {
    if (typeof v === 'string' && v.trim()) return false;
    if (Array.isArray(v)) {
      for (const row of v) {
        if (typeof row === 'string' && row.trim()) return false;
        if (row && typeof row === 'object') {
          for (const rv of Object.values(row as Record<string, unknown>)) {
            if (typeof rv === 'string' && rv.trim()) return false;
          }
        }
      }
    }
  }
  return true;
}

/**
 * Repair an AI plan whose per-page copy call failed or was truncated: any
 * section that came back empty is refilled with the catalog's deterministic
 * seed so a partly-failed generation still ships a complete site. Returns how
 * many sections were touched.
 */
export function seedFillEmptySections(doc: BuilderDoc, ctx: SeedCtx): number {
  let filled = 0;
  for (const page of doc.pages) {
    for (const sct of page.sections) {
      if (isEmptyContent(sct.type, sct.content)) {
        sct.content = seedSectionContent(sct.type, ctx);
        filled++;
      }
    }
  }
  return filled;
}

/** Clamp + repair an arbitrary doc-shaped value into a valid `BuilderDoc`. */
export function normalizeDoc(raw: unknown, ctx: SeedCtx): BuilderDoc {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pagesIn = Array.isArray(d.pages) ? d.pages : [];
  const usedSlugs = new Set<string>();

  const POLICY_KIND_SET = new Set(['privacy', 'terms', 'cookies']);
  const mapped: PageSpec[] = pagesIn.map((p, i) => {
    const pp = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const title = (typeof pp.title === 'string' && pp.title.trim()) || `Page ${i + 1}`;
    let slug = slugify(typeof pp.slug === 'string' && pp.slug ? pp.slug : title) || `page-${i + 1}`;
    while (usedSlugs.has(slug)) slug = `${slug}-${usedSlugs.size + 1}`;
    usedSlugs.add(slug);
    const sections = (Array.isArray(pp.sections) ? pp.sections : [])
      .map(normalizeSection)
      .filter((s): s is DocSection => s != null);
    const system = POLICY_KIND_SET.has(String(pp.system))
      ? (String(pp.system) as PageSpec['system'])
      : undefined;
    return {
      id: (typeof pp.id === 'string' && pp.id) || randomUUID(),
      title: title.slice(0, 60),
      slug,
      isHome: pp.isHome === true,
      nav: system ? false : pp.nav !== false,
      ...(system ? { system } : {}),
      sections,
    };
  });

  // Clamp only real pages; legal pages are extra and always kept.
  const systemPages = mapped.filter((p) => p.system);
  let pages: PageSpec[] = mapped.filter((p) => !p.system).slice(0, MAX_PAGES);

  if (!pages.length && !systemPages.length) return starterAdvancedDoc(ctx);
  if (!pages.length) pages = starterAdvancedDoc(ctx).pages.filter((p) => !p.system);

  // Exactly one home page (never a legal page).
  const homeIdx = pages.findIndex((p) => p.isHome);
  pages.forEach((p, i) => (p.isHome = i === (homeIdx >= 0 ? homeIdx : 0)));

  const built: BuilderDoc = {
    v: 2,
    mode: 'manual',
    theme: DEFAULT_THEME,
    pages: [...pages, ...systemPages],
  };
  ensureContactPage(built, ctx);
  ensurePolicyPages(built, ctx);
  // Re-clamp real pages: ensureContactPage may have pushed one past the cap.
  // The contact page is guaranteed a slot so it never gets clamped away.
  let realPages = built.pages.filter((p) => !p.system);
  if (realPages.length > MAX_PAGES) {
    const contactPg = realPages.find((p) => p.sections.some((s) => s.type === 'contact'));
    realPages = realPages.slice(0, MAX_PAGES);
    if (contactPg && !realPages.includes(contactPg)) {
      realPages = [...realPages.slice(0, MAX_PAGES - 1), contactPg];
    }
  }
  // Legal pages always sit last.
  pages = [
    ...realPages,
    ...POLICY_KINDS.map((k) => built.pages.find((p) => p.system === k)).filter(
      (p): p is PageSpec => !!p,
    ),
  ];

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
    ...(d.nav !== undefined ? { nav: normalizeNav(d.nav) } : {}),
    ...(d.footer !== undefined ? { footer: normalizeFooter(d.footer) } : {}),
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
      nav: p.system ? false : p.nav !== false,
      ...(p.system ? { system: p.system } : {}),
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
    content: {
      pages,
      seo: { title, description, schemaType: 'LocalBusiness' },
      nav: normalizeNav(doc.nav ?? DEFAULT_NAV),
      footer: normalizeFooter(doc.footer ?? DEFAULT_FOOTER),
    },
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
