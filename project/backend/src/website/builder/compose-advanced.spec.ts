import { SeedCtx, textFieldKeys } from './section-catalog';
import {
  ADVANCED_GENERATOR,
  MAX_PAGES,
  coerceOverrides,
  coerceStyle,
  composeAdvancedDoc,
  docFromLegacy,
  keywordPlanDoc,
  normalizeDoc,
  normalizeTheme,
  starterAdvancedDoc,
} from './compose-advanced';

const ctx: SeedCtx = {
  businessName: 'Acme SRL',
  businessType: 'construcții',
  city: 'Cluj-Napoca',
  services: ['Amenajări', 'Reparații'],
  locale: 'ro',
};

describe('advanced composer', () => {
  // Every Advanced doc carries the 3 mandatory legal pages, always kept last.
  const POLICY_SLUGS = ['confidentialitate', 'termeni', 'cookies'];
  const real = (d: { pages: { system?: string }[] }): { slug: string }[] =>
    d.pages.filter((p) => !p.system) as { slug: string }[];
  const legalSlugs = (d: { pages: { system?: string; slug: string }[] }): string[] =>
    d.pages.filter((p) => p.system).map((p) => p.slug);

  it('starterAdvancedDoc builds a 3-page site + legal pages', () => {
    const doc = starterAdvancedDoc(ctx);
    expect(doc.v).toBe(2);
    expect(real(doc).map((p) => p.slug)).toEqual(['home', 'about', 'contact']);
    expect(legalSlugs(doc)).toEqual(POLICY_SLUGS);
    expect(doc.pages.filter((p) => p.isHome)).toHaveLength(1);
    expect(doc.pages[0].sections.map((s) => s.type)).toEqual([
      'hero',
      'services',
      'testimonials',
      'cta',
    ]);
  });

  it('composeAdvancedDoc renders content + theme from the starter doc', () => {
    const g = composeAdvancedDoc(starterAdvancedDoc(ctx), ctx);
    expect(g.generator).toBe(ADVANCED_GENERATOR);
    expect(g.content.pages.filter((p) => !p.system)).toHaveLength(3);
    expect(g.content.pages.filter((p) => p.system).map((p) => p.slug)).toEqual(POLICY_SLUGS);
    expect(g.content.pages[0].sections[0].type).toBe('hero');
    expect(g.content.seo.title).toContain('Acme SRL');
    expect(g.content.pages.filter((p) => p.isHome)).toHaveLength(1);
  });

  it('normalizeDoc clamps real pages to MAX_PAGES and enforces one home', () => {
    const many = {
      v: 2,
      mode: 'manual',
      pages: Array.from({ length: 10 }, (_, i) => ({
        title: `P${i}`,
        slug: `p${i}`,
        isHome: true,
        sections: [],
      })),
    };
    const doc = normalizeDoc(many, ctx);
    expect(real(doc).length).toBeLessThanOrEqual(MAX_PAGES);
    expect(legalSlugs(doc)).toEqual(POLICY_SLUGS);
    expect(doc.pages.filter((p) => p.isHome)).toHaveLength(1);
    expect(doc.pages[0].isHome).toBe(true);
  });

  it('docFromLegacy reverse-maps a bare content tree (+ legal pages)', () => {
    const legacyContent = {
      pages: [
        {
          slug: 'home',
          title: 'Home',
          isHome: true,
          sections: [
            { id: 'h1', type: 'hero', visible: true, headline: 'Hello', subheadline: 'Sub' },
            { id: 'c1', type: 'contact', visible: true, phone: '123' },
          ],
        },
      ],
    };
    const doc = docFromLegacy(null, legacyContent, null, ctx);
    expect(real(doc)).toHaveLength(1);
    expect(legalSlugs(doc)).toEqual(POLICY_SLUGS);
    expect(doc.pages[0].sections.map((s) => s.type)).toEqual(['hero', 'contact']);
    expect(doc.pages[0].sections[0].content.headline).toBe('Hello');
  });

  it('docFromLegacy falls back to the starter when there is nothing to load', () => {
    const doc = docFromLegacy(null, null, null, ctx);
    expect(real(doc)).toHaveLength(3);
    expect(legalSlugs(doc)).toEqual(POLICY_SLUGS);
  });

  it('docFromLegacy passes a v2 doc through (normalised)', () => {
    const v2 = starterAdvancedDoc(ctx);
    const doc = docFromLegacy(v2, null, null, ctx);
    expect(real(doc).map((p) => p.slug)).toEqual(['home', 'about', 'contact']);
    expect(legalSlugs(doc)).toEqual(POLICY_SLUGS);
  });

  it('keywordPlanDoc builds a complete archetype site from a brief', () => {
    const plain = keywordPlanDoc('un site simplu de prezentare', ctx);
    expect(real(plain).length).toBeGreaterThanOrEqual(2);
    expect(real(plain).length).toBeLessThanOrEqual(MAX_PAGES);
    expect(legalSlugs(plain)).toEqual(POLICY_SLUGS);
    expect(plain.pages.filter((p) => p.isHome)).toHaveLength(1);
    expect(plain.pages[0].sections[0].type).toBe('hero');
    // no section is left empty
    const g0 = composeAdvancedDoc(plain, ctx);
    const allSections = g0.content.pages.flatMap((p) => p.sections);
    expect(allSections.length).toBeGreaterThan(3);
    expect(allSections.every((s) => !!s.type)).toBe(true);

    const withPricing = keywordPlanDoc('avem 3 pachete de preț lunar', ctx);
    expect(withPricing.pages.some((p) => p.slug === 'pricing')).toBe(true);
    expect(real(withPricing).length).toBeLessThanOrEqual(MAX_PAGES);
    const g = composeAdvancedDoc(withPricing, ctx);
    expect(g.content.pages.flatMap((p) => p.sections).every((s) => !!s.type)).toBe(true);
  });

  it('every Advanced doc has a contact page and 3 legal pages', () => {
    const doc = keywordPlanDoc('salon de coafură, fără pagină de contact', ctx);
    const hasContact = doc.pages.some((p) => p.sections.some((s) => s.type === 'contact'));
    expect(hasContact).toBe(true);
    expect(legalSlugs(doc)).toEqual(POLICY_SLUGS);
    // legal pages sit last, are out of nav, and carry generated body copy
    const legal = doc.pages.filter((p) => p.system);
    expect(doc.pages.slice(-3)).toEqual(legal);
    for (const p of legal) {
      expect(p.nav).toBe(false);
      expect(String(p.sections[0].content.body ?? '').length).toBeGreaterThan(80);
    }
  });

  it('normalizeTheme accepts the expanded fields and migrates old radius', () => {
    const t = normalizeTheme({
      palette: 'cyan',
      radius: 'soft', // legacy → 'rounded'
      background: 'dark',
      headingFont: 'fraunces',
      bodyFont: 'inter',
      buttonStyle: 'pill',
      shadow: 'bold',
      preset: 'tech',
      accent: '#0891b2',
    });
    expect(t.palette).toBe('cyan');
    expect(t.radius).toBe('rounded');
    expect(t.background).toBe('dark');
    expect(t.headingFont).toBe('fraunces');
    expect(t.buttonStyle).toBe('pill');
    expect(t.shadow).toBe('bold');
    expect(t.preset).toBe('tech');
    expect(t.accent).toBe('#0891b2');
  });

  it('normalizeTheme drops unknown values', () => {
    const t = normalizeTheme({ palette: 'chartreuse', background: 'rainbow', preset: 'nope' });
    expect(t.palette).toBe('indigo');
    expect(t.background).toBeUndefined();
    expect(t.preset).toBeUndefined();
  });

  it('keywordPlanDoc picks a style preset from the brief', () => {
    const shop = keywordPlanDoc('magazin online cu produse si preturi', ctx);
    expect(shop.theme.preset).toBe('bold');
    const tech = keywordPlanDoc('o aplicatie saas pentru echipe', ctx);
    expect(tech.theme.preset).toBe('tech');
    expect(tech.theme.background).toBe('dark');
  });

  it('normalizeDoc carries a bounded undo history', () => {
    const base = starterAdvancedDoc(ctx);
    const withHist = normalizeDoc(
      { ...base, history: [base.pages, base.pages, base.pages, base.pages] },
      ctx,
    );
    expect(withHist.history).toHaveLength(3);
  });

  it('coerceStyle keeps only valid hex colours', () => {
    expect(
      coerceStyle({ bg: '#FFF', text: '#0b0c11', heading: 'red', accent: '#12345678' }),
    ).toEqual({ bg: '#fff', text: '#0b0c11', accent: '#12345678' });
    expect(coerceStyle({ bg: '' })).toBeUndefined();
    expect(coerceStyle('nope')).toBeUndefined();
    expect(coerceStyle({ bg: 'javascript:alert(1)' })).toBeUndefined();
  });

  it('normalizeDoc preserves a section colour override', () => {
    const base = starterAdvancedDoc(ctx);
    base.pages[0].sections[0].style = { bg: '#101820', heading: '#ffffff', bogus: 'x' } as never;
    const out = normalizeDoc(base, ctx);
    expect(out.pages[0].sections[0].style).toEqual({ bg: '#101820', heading: '#ffffff' });
    const g = composeAdvancedDoc(out, ctx);
    expect((g.content.pages[0].sections[0] as { style?: unknown }).style).toEqual({
      bg: '#101820',
      heading: '#ffffff',
    });
  });

  it('textFieldKeys returns a section type’s prose fields', () => {
    expect(textFieldKeys('hero')).toEqual(expect.arrayContaining(['headline', 'subheadline']));
    expect(textFieldKeys('services')).toContain('title');
    // no image / enum / items keys
    expect(textFieldKeys('hero')).not.toContain('backgroundImage');
  });

  it('coerceOverrides keeps valid element keys + clamps the style', () => {
    const ov = coerceOverrides('hero', {
      headline: { color: '#FF0000', size: 'lg', weight: 'bold', align: 'center', junk: 1 },
      subheadline: { color: 'red' }, // bad hex -> dropped -> element empty -> removed
      backgroundImage: { color: '#000' }, // not a prose field -> dropped
      bogusField: { color: '#000' },
    });
    expect(ov).toEqual({
      headline: { color: '#ff0000', size: 'lg', weight: 'bold', align: 'center' },
    });
    expect(coerceOverrides('hero', { headline: { size: 'huge' } })).toBeUndefined();
  });

  it('normalizeDoc + composeAdvancedDoc carry a per-element override through', () => {
    const base = starterAdvancedDoc(ctx);
    base.pages[0].sections[0].overrides = {
      headline: { color: '#112233', size: 'xl' },
      nope: { color: '#000' },
    } as never;
    const out = normalizeDoc(base, ctx);
    expect(out.pages[0].sections[0].overrides).toEqual({
      headline: { color: '#112233', size: 'xl' },
    });
    const g = composeAdvancedDoc(out, ctx);
    expect((g.content.pages[0].sections[0] as { overrides?: unknown }).overrides).toEqual({
      headline: { color: '#112233', size: 'xl' },
    });
  });

  it('the 12 new section types survive a normalize round-trip', () => {
    const types = [
      'bigStatement',
      'highlightsRow',
      'ratingBand',
      'video',
      'showcase',
      'beforeAfter',
      'tabs',
      'hours',
      'caseStudy',
      'splitCta',
      'newsletter',
      'quoteBig',
    ];
    const doc = normalizeDoc(
      {
        v: 2,
        mode: 'manual',
        pages: [
          {
            title: 'Home',
            slug: 'home',
            isHome: true,
            sections: types.slice(0, 6).map((type) => ({ type, variant: '' })),
          },
          {
            title: 'More',
            slug: 'more',
            isHome: false,
            sections: types.slice(6).map((type) => ({ type, variant: '' })),
          },
        ],
      },
      ctx,
    );
    const g = composeAdvancedDoc(doc, ctx);
    const seen: string[] = g.content.pages.flatMap((p) => p.sections.map((s) => s.type));
    expect(types.every((t) => seen.includes(t))).toBe(true);
    expect(g.content.pages.flatMap((p) => p.sections).every((s) => !!s.type && !!s.variant)).toBe(
      true,
    );
  });

  it('normalizeDoc clamps a page to MAX_SECTIONS', () => {
    const doc = normalizeDoc(
      {
        v: 2,
        mode: 'manual',
        pages: [
          {
            title: 'Home',
            slug: 'home',
            isHome: true,
            sections: Array.from({ length: 18 }, () => ({ type: 'about', variant: '' })),
          },
        ],
      },
      ctx,
    );
    expect(doc.pages[0].sections.length).toBe(10);
  });

  it('a legal page is always exactly one non-empty richText (self-heals)', () => {
    const base = starterAdvancedDoc(ctx);
    const legal = base.pages.filter((p) => p.system);
    // (a) emptied legal page → boilerplate restored
    legal[0].sections = [];
    // (b) legal page with an injected non-text section → stripped, text kept
    legal[1].sections = [
      { id: 'x', type: 'gallery', variant: 'grid', visible: true, content: {} },
      legal[1].sections[0],
    ];
    const out = normalizeDoc(base, ctx);
    for (const p of out.pages.filter((x) => x.system)) {
      expect(p.sections).toHaveLength(1);
      expect(p.sections[0].type).toBe('richText');
      expect(String(p.sections[0].content.body ?? '').length).toBeGreaterThan(80);
    }
  });
});
