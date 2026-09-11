import { ARCHETYPE_PROFILE_DEFAULTS } from './business-analysis';
import { deriveDesignDNA } from './design-dna';
import { deriveImageIntents } from './image-intent';
import { intentKey, applyResolvedImages } from './image-provider/image-apply';
import type { BuilderDoc } from '../compose-advanced';
import type { BusinessProfile, GeneratorAi, ImageIntent, ResolvedImage } from './types';

const NO_AI: GeneratorAi = {
  configured: false,
  analyzeBusiness: async () => null,
  planArchitecture: async () => null,
  writePageCopy: async () => null,
  enrichImageIntents: async () => null,
  reviewSite: async () => [],
  fixSections: async () => null,
  visualReview: async () => null,
};

function docWith(sections: { type: string; variant?: string; items?: number }[]): BuilderDoc {
  return {
    v: 2,
    mode: 'ai',
    theme: {} as BuilderDoc['theme'],
    pages: [
      {
        id: 'home',
        title: 'Acasă',
        slug: 'acasa',
        isHome: true,
        nav: true,
        sections: sections.map((s, i) => ({
          id: `sec-${i}`,
          type: s.type,
          variant: s.variant ?? 'default',
          visible: true,
          content: s.items
            ? { items: Array.from({ length: s.items }, () => ({ imageUrl: '', alt: '' })) }
            : {},
        })),
      },
      {
        id: 'legal',
        title: 'Legal',
        slug: 'legal',
        isHome: false,
        nav: false,
        system: true,
        sections: [{ id: 'l1', type: 'richText', variant: 'default', visible: true, content: {} }],
      },
    ],
  } as BuilderDoc;
}

const profFor = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  ...ARCHETYPE_PROFILE_DEFAULTS.portfolio.profile,
  archetype: 'portfolio',
  ...over,
});

describe('deriveImageIntents', () => {
  it('produces a hero intent + gallery item intents, skips team/legal', async () => {
    const doc = docWith([
      { type: 'hero', variant: 'imageBg' },
      { type: 'gallery', variant: 'masonry', items: 3 },
      { type: 'team', variant: 'cards', items: 2 },
      { type: 'contact', variant: 'split' },
    ]);
    const profile = profFor({ imageIntensity: 'gallery-led' });
    const dna = deriveDesignDNA(profile, ARCHETYPE_PROFILE_DEFAULTS.portfolio.directions[0], 4);
    const intents = await deriveImageIntents(NO_AI, {
      doc,
      profile,
      dna,
      business: { name: 'Studio X', services: [] },
      locale: 'ro',
      seed: 4,
    });
    const roles = intents.map((i) => i.role);
    expect(intents.some((i) => i.role === 'hero')).toBe(true);
    expect(intents.filter((i) => i.field === 'imageUrl' && i.itemIndex != null).length).toBe(3);
    expect(roles.join(' ')).not.toContain('team');
    // hero always present, and it's the top-priority slot
    expect(intents[0].role).toBe('hero');
  });

  it('caps the number of intents by imageIntensity (hero survives)', async () => {
    const doc = docWith([
      { type: 'hero', variant: 'imageBg' },
      { type: 'gallery', variant: 'grid', items: 8 },
      { type: 'featureSplit', variant: 'rows', items: 4 },
    ]);
    const minimal = profFor({ imageIntensity: 'minimal' });
    const dnaM = deriveDesignDNA(minimal, ARCHETYPE_PROFILE_DEFAULTS.portfolio.directions[0], 1);
    const few = await deriveImageIntents(NO_AI, {
      doc,
      profile: minimal,
      dna: dnaM,
      business: { name: 'x', services: [] },
      locale: 'ro',
      seed: 1,
    });
    expect(few.length).toBeLessThanOrEqual(3);
    expect(few[0].role).toBe('hero');
  });

  it('never fills a multi-item section only partially', async () => {
    const doc = docWith([
      { type: 'hero', variant: 'imageBg' },
      { type: 'gallery', variant: 'grid', items: 4 },
      { type: 'bento', variant: 'grid', items: 4 },
    ]);
    const profile = profFor({ imageIntensity: 'medium' }); // cap 6
    const dna = deriveDesignDNA(profile, ARCHETYPE_PROFILE_DEFAULTS.portfolio.directions[0], 1);
    const intents = await deriveImageIntents(NO_AI, {
      doc,
      profile,
      dna,
      business: { name: 'x', services: [] },
      locale: 'ro',
      seed: 1,
    });
    // for every section that got ANY item intent, it got ALL of its items
    const bySection = new Map<string, number>();
    for (const it of intents) {
      if (it.itemIndex != null) bySection.set(it.sectionId, (bySection.get(it.sectionId) ?? 0) + 1);
    }
    for (const [sectionId, n] of bySection) {
      const total = doc.pages[0].sections.find((s) => s.id === sectionId)!.content as {
        items: unknown[];
      };
      expect(n).toBe(total.items.length);
    }
  });

  it('every intent names a real subject (never blank / generic-only)', async () => {
    const doc = docWith([
      { type: 'hero', variant: 'split' },
      { type: 'about', variant: 'imageRight' },
    ]);
    const profile = profFor();
    const dna = deriveDesignDNA(profile, ARCHETYPE_PROFILE_DEFAULTS.portfolio.directions[0], 2);
    const intents = await deriveImageIntents(NO_AI, {
      doc,
      profile,
      dna,
      business: { name: 'x', city: 'Cluj', services: [] },
      locale: 'ro',
      seed: 2,
    });
    for (const it of intents) {
      expect(it.subject.trim().length).toBeGreaterThan(0);
      expect(it.orientation).toMatch(/landscape|portrait|square/);
    }
  });

  it('AI enrichment lands in refinedSubject/refinedScene, NOT subject/scene (stable query)', async () => {
    const AI: GeneratorAi = {
      ...NO_AI,
      configured: true,
      enrichImageIntents: async ({ slots }) =>
        Object.fromEntries(
          slots.map((s) => [
            s.key,
            { subject: `AI-worded ${Math.random()}`, scene: 'AI scene', avoid: ['empty room'] },
          ]),
        ),
    };
    const doc = docWith([{ type: 'hero', variant: 'split' }]);
    const profile = profFor();
    const dna = deriveDesignDNA(profile, ARCHETYPE_PROFILE_DEFAULTS.portfolio.directions[0], 2);
    const mk = () =>
      deriveImageIntents(AI, {
        doc,
        profile,
        dna,
        business: { name: 'x', city: 'Cluj', services: [] },
        locale: 'ro',
        seed: 2,
      });
    const a = await mk();
    const b = await mk();
    // subject/scene are deterministic across calls even though the AI reworded
    expect(a[0].subject).toBe(b[0].subject);
    expect(a[0].scene).toBe(b[0].scene);
    // the AI phrasing was captured separately + the avoid list merged
    expect(a[0].refinedSubject).toMatch(/^AI-worded /);
    expect(a[0].avoid).toContain('empty room');
  });
});

describe('applyResolvedImages', () => {
  const resolved = (over: Partial<ResolvedImage> = {}): ResolvedImage => ({
    url: 'https://images.pexels.com/photos/1/l.jpg',
    provider: 'pexels',
    photoId: '1',
    alt: 'a real bakery',
    ...over,
  });

  it('writes onto the right field / item and leaves unmatched slots alone', () => {
    const doc = docWith([
      { type: 'hero', variant: 'imageBg' },
      { type: 'gallery', variant: 'masonry', items: 2 },
    ]);
    const heroId = doc.pages[0].sections[0].id;
    const galId = doc.pages[0].sections[1].id;
    const intents: ImageIntent[] = [
      {
        sectionId: heroId,
        field: 'backgroundImage',
        role: 'hero',
        subject: 's',
        scene: '',
        mood: '',
        composition: '',
        style: '',
        orientation: 'landscape',
        avoid: [],
      },
      {
        sectionId: galId,
        field: 'imageUrl',
        itemIndex: 1,
        role: 'gallery',
        subject: 's',
        scene: '',
        mood: '',
        composition: '',
        style: '',
        orientation: 'landscape',
        avoid: [],
      },
    ];
    const map = new Map<string, ResolvedImage>([
      [intentKey(intents[0]), resolved({ url: 'https://images.pexels.com/photos/9/l.jpg' })],
      // no entry for the gallery item → left blank
    ]);
    const res = applyResolvedImages(doc, intents, map);
    expect(res.applied).toBe(1);
    expect(res.anyPexels).toBe(true);
    expect((doc.pages[0].sections[0].content as any).backgroundImage).toBe(
      'https://images.pexels.com/photos/9/l.jpg',
    );
    expect((doc.pages[0].sections[1].content as any).items[1].imageUrl).toBe('');
  });
});
