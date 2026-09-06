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

  it('custom section: coerces width/background/align + a typed block stack', () => {
    const seeded = seedSection('custom', undefined, ctx) as unknown as Record<string, unknown>;
    expect(seeded.type).toBe('custom');
    expect(['standard', 'wide', 'full', 'narrow']).toContain(seeded.width);
    expect(Array.isArray(seeded.blocks)).toBe(true);

    const out = coerceContent('custom', {
      width: 'nonsense',
      background: 'accent',
      align: 'center',
      blocks: [
        { kind: 'heading', text: 'y'.repeat(400), size: 'huge' },
        { kind: 'text', text: 'a paragraph' },
        { kind: 'image', url: 'https://evil.example.com/x.png', caption: 'cap' },
        { kind: 'button', label: 'Go', target: 'javascript:alert(1)', variant: 'weird' },
        { kind: 'spacer', size: 'md' },
        { kind: 'divider' },
        { kind: 'not-a-kind', text: 'falls back to text' },
      ],
    });
    expect(out.width).toBe('standard'); // bad enum → default
    expect(out.background).toBe('accent');
    expect(out.align).toBe('center');

    const blocks = out.blocks as Record<string, unknown>[];
    expect(blocks).toHaveLength(7);
    expect((blocks[0].text as string).length).toBe(160); // heading clamp
    expect(blocks[0].size).toBe('lg'); // bad size → default
    expect(blocks[2].url).toBe(''); // disallowed image host dropped
    expect(blocks[3].variant).toBe('solid'); // bad variant → default
    expect(blocks[3].target).toBe('javascript:alert(1)'); // kept as data (renderer never interpolates it)
    expect(blocks[6].kind).toBe('text'); // unknown kind → text
  });

  it('catalogForClient is function-free and covers every type', () => {
    const client = catalogForClient();
    expect(client.map((c) => c.type).sort()).toEqual([...SECTION_TYPES].sort());
    expect(JSON.stringify(client)).not.toContain('function');
  });
});
