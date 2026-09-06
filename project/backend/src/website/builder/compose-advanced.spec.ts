import { SeedCtx } from './section-catalog';
import {
  ADVANCED_GENERATOR,
  MAX_PAGES,
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
});
