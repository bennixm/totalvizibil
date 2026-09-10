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

  it('an archetype ships ≥ 3 blueprints and they differ structurally', () => {
    const sig = (sk: (typeof ARCHETYPE_SKELETONS)[Archetype][number]): string =>
      sk.pages.map((p) => p.sections.map((s) => `${s.type}:${s.variant}`).join(',')).join('|');
    for (const a of ARCHETYPES) {
      const list = ARCHETYPE_SKELETONS[a];
      expect(list.length).toBeGreaterThanOrEqual(3);
      const sigs = list.map(sig);
      expect(new Set(sigs).size).toBe(sigs.length); // every pair differs
    }
  });

  it('pickSkeleton is deterministic for a seed and spans every blueprint', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const a = pickSkeleton('saas', seed);
      const b = pickSkeleton('saas', seed);
      expect(a).toEqual(b); // fresh object, same content
      seen.add(a.pages.map((p) => p.sections.map((s) => s.type).join(',')).join('|'));
    }
    expect(seen.size).toBe(ARCHETYPE_SKELETONS.saas.length);
  });

  it('pickSkeleton merges a seed-rotated palette without overriding the blueprint', () => {
    const n = ARCHETYPE_SKELETONS['local-trade'].length;
    // seeds 0 and n both land on blueprint #0 (no pinned palette) — rotation varies it
    const p0 = pickSkeleton('local-trade', 0).theme?.palette;
    const pN = pickSkeleton('local-trade', n).theme?.palette;
    expect(p0).toBeTruthy();
    expect(p0).not.toBe(pN);
    // blueprint #1 of local-trade pins palette 'orange' — the merge must keep it
    const pinned = ARCHETYPE_SKELETONS['local-trade'].findIndex(
      (sk) => sk.theme?.palette === 'orange',
    );
    expect(pinned).toBeGreaterThanOrEqual(0);
    for (let seed = pinned; seed < 300; seed += n) {
      expect(pickSkeleton('local-trade', seed).theme?.palette).toBe('orange');
    }
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
