import { SeedCtx } from './section-catalog';
import { keywordPlanDoc } from './compose-advanced';
import type { BuilderDoc } from './compose-advanced';
import { siteDigest, structuralAudit } from './site-audit';

const ctx: SeedCtx = {
  businessName: 'Acme SRL',
  businessType: 'acoperișuri',
  city: 'Cluj-Napoca',
  services: ['Reparații', 'Montaj'],
  locale: 'ro',
};

const failed = (doc: BuilderDoc, brief = ''): string[] =>
  structuralAudit(doc, brief)
    .filter((c) => !c.ok)
    .map((c) => c.id);

describe('site audit', () => {
  it('a clean keyword-plan doc passes the structural checks', () => {
    const doc = keywordPlanDoc('firmă de acoperișuri și izolații în Cluj', ctx);
    const bad = failed(doc, 'firmă de acoperișuri și izolații în Cluj');
    // brief_reflected can legitimately fail (deterministic copy is generic) — the
    // structural checks must not.
    expect(bad).not.toContain('home_hero');
    expect(bad).not.toContain('has_contact');
    expect(bad).not.toContain('page_depth');
    expect(bad).not.toContain('no_stacked_dups');
  });

  it('flags a missing hero, a stacked duplicate and placeholder text', () => {
    const doc: BuilderDoc = {
      v: 2,
      mode: 'ai',
      theme: { palette: 'indigo', radius: 'rounded' } as BuilderDoc['theme'],
      pages: [
        {
          id: 'p1',
          title: 'Home',
          slug: 'home',
          isHome: true,
          nav: true,
          sections: [
            {
              id: 's1',
              type: 'services',
              variant: 'cards',
              visible: true,
              content: { title: 'Servicii' },
            },
            {
              id: 's2',
              type: 'services',
              variant: 'list',
              visible: true,
              content: { title: 'Lorem ipsum dolor' },
            },
          ],
        },
      ],
    };
    const bad = failed(doc);
    expect(bad).toContain('home_hero');
    expect(bad).toContain('has_contact');
    expect(bad).toContain('no_stacked_dups');
    expect(bad).toContain('no_placeholder_text');
  });

  it('siteDigest is a compact one-line-per-section summary', () => {
    const doc = keywordPlanDoc('firmă de acoperișuri', ctx);
    const d = siteDigest(doc);
    expect(d.length).toBeLessThanOrEqual(4000);
    expect(d).toMatch(/^## /m);
    expect(d).toMatch(/^- \w+\/\w+:/m);
  });
});
