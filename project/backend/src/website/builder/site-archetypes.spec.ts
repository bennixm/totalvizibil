import { SECTION_CATALOG, SeedCtx } from './section-catalog';
import {
  ARCHETYPE_SKELETONS,
  Archetype,
  classifyArchetype,
  pickSkeleton,
  skeletonExampleJson,
} from './site-archetypes';

const ARCHETYPES: Archetype[] = [
  'local-trade',
  'agency',
  'portfolio',
  'saas',
  'hospitality',
  'clinic',
  'shop',
  'events',
  'generic',
];

describe('site archetypes', () => {
  it('classifyArchetype maps clear briefs to the right archetype', () => {
    expect(classifyArchetype('firmă de acoperișuri și instalații')).toBe('local-trade');
    expect(classifyArchetype('restaurant italian cu meniu de sezon')).toBe('hospitality');
    expect(classifyArchetype('aplicație SaaS pentru echipe de vânzări')).toBe('saas');
    expect(classifyArchetype('studio de fotografie de nuntă', '', ['portofoliu'])).toBe(
      'portfolio',
    );
    expect(classifyArchetype('cabinet stomatologic')).toBe('clinic');
    expect(classifyArchetype('magazin online de haine')).toBe('shop');
    expect(classifyArchetype('organizăm evenimente și nunți')).toBe('events');
    expect(classifyArchetype('agenție de marketing digital')).toBe('agency');
    expect(classifyArchetype('ceva foarte general fără cuvinte cheie')).toBe('generic');
  });

  it('every skeleton section is catalog-valid and each has a hero + contact', () => {
    for (const a of ARCHETYPES) {
      for (const sk of ARCHETYPE_SKELETONS[a]) {
        expect(sk.pages.length).toBeGreaterThanOrEqual(2);
        expect(sk.pages.length).toBeLessThanOrEqual(6);
        const types = sk.pages.flatMap((p) => p.sections.map((s) => s.type));
        expect(types).toContain('hero');
        expect(types).toContain('contact');
        for (const p of sk.pages) {
          expect(p.sections.length).toBeGreaterThanOrEqual(1);
          expect(p.sections.length).toBeLessThanOrEqual(7);
          for (const s of p.sections) {
            const spec = SECTION_CATALOG[s.type];
            expect(spec).toBeDefined();
            expect(spec.variants.map((v) => v.id)).toContain(s.variant);
          }
        }
      }
    }
  });

  it('the two blueprints of an archetype differ structurally', () => {
    for (const a of ARCHETYPES) {
      const [x, y] = ARCHETYPE_SKELETONS[a];
      const sig = (sk: (typeof ARCHETYPE_SKELETONS)[Archetype][number]): string =>
        sk.pages.map((p) => p.sections.map((s) => `${s.type}:${s.variant}`).join(',')).join('|');
      expect(sig(x)).not.toBe(sig(y));
    }
  });

  it('pickSkeleton is stable for a seed and spans both blueprints', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const a = pickSkeleton('saas', seed);
      const b = pickSkeleton('saas', seed);
      expect(a).toBe(b);
      seen.add(JSON.stringify(a.pages.map((p) => p.title.en)));
    }
    expect(seen.size).toBe(2);
  });

  it('skeletonExampleJson is compact valid JSON', () => {
    const j = skeletonExampleJson(ARCHETYPE_SKELETONS.agency[0]);
    expect(j).not.toContain('\n');
    const parsed = JSON.parse(j) as { pages: unknown[] };
    expect(Array.isArray(parsed.pages)).toBe(true);
  });
});

export const _ctx: SeedCtx = {
  businessName: 'x',
  businessType: '',
  city: '',
  services: [],
  locale: 'ro',
};
