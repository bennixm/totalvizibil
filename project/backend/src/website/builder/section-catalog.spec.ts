import {
  SECTION_CATALOG,
  SECTION_TYPES,
  SeedCtx,
  catalogForClient,
  coerceContent,
  coerceSection,
  seedSection,
  snapVariant,
} from './section-catalog';

const ctx: SeedCtx = {
  businessName: 'Acme SRL',
  businessType: 'instalații sanitare',
  city: 'Cluj-Napoca',
  services: ['Montaj', 'Reparații'],
  phone: '0740 111 222',
  email: 'contact@acme.ro',
  locale: 'ro',
};

describe('section catalog', () => {
  it('seeds every catalog type into a coerce-valid section', () => {
    for (const type of SECTION_TYPES) {
      const seeded = seedSection(type, undefined, ctx);
      expect(seeded.type).toBe(type);
      expect(seeded.visible).toBe(true);
      expect(SECTION_CATALOG[type].variants.map((v) => v.id)).toContain(seeded.variant);

      const round = coerceSection(seeded);
      expect(round).not.toBeNull();
      expect(round!.type).toBe(type);

      // every declared field key exists on the seeded content
      for (const f of SECTION_CATALOG[type].fields) {
        expect(seeded).toHaveProperty(f.key);
      }
    }
  });

  it('snapVariant falls back to the first variant for unknown input', () => {
    expect(snapVariant('hero', 'nope')).toBe(SECTION_CATALOG.hero.variants[0].id);
    expect(snapVariant('hero', 'centered')).toBe('centered');
  });

  it('coerceContent clamps strings, drops unknown keys and caps item rows', () => {
    const out = coerceContent('services', {
      title: 'x'.repeat(500),
      bogus: 'should vanish',
      items: Array.from({ length: 40 }, (_, i) => ({ name: `S${i}`, description: 'd', extra: 1 })),
    });
    expect((out.title as string).length).toBe(120);
    expect(out).not.toHaveProperty('bogus');
    expect((out.items as unknown[]).length).toBe(12);
    expect(Object.keys((out.items as Record<string, unknown>[])[0])).toEqual([
      'name',
      'description',
    ]);
  });

  it('coerceSection rejects an unknown type', () => {
    expect(coerceSection({ type: 'banana' })).toBeNull();
    expect(coerceSection({ type: 'hero', headline: 'Hi' })!.type).toBe('hero');
  });

  it('catalogForClient is function-free and covers every type', () => {
    const client = catalogForClient();
    expect(client.map((c) => c.type).sort()).toEqual([...SECTION_TYPES].sort());
    expect(JSON.stringify(client)).not.toContain('function');
  });
});
