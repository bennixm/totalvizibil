import type { SeedCtx } from '../section-catalog';
import { SECTION_CATALOG } from '../section-catalog';
import { generateSite } from './pipeline';
import { analyzeBusiness, ARCHETYPE_PROFILE_DEFAULTS } from './business-analysis';
import { deriveDesignDNA, dnaToTheme, dnaToTypography } from './design-dna';
import {
  deterministicIA,
  planIA,
  reshuffleIA,
  roleToType,
  ROLE_VOCAB,
} from './information-architecture';
import { assignRhythm, buildRecipe, pickVariant } from './layout-recipe';
import { fingerprintDoc, fingerprintDistance, fingerprintRecipe } from './design-fingerprint';
import { repairGeneratedSite } from './repair';
import type {
  BusinessProfile,
  GeneratorAi,
  IARole,
  IASpec,
  ImageSearchResolver,
  SectionRole,
  SuggestedPage,
  VisualReview,
} from './types';

const NO_AI: GeneratorAi = {
  configured: false,
  analyzeBusiness: async () => null,
  planArchitecture: async () => null,
  writePageCopy: async () => null,
  enrichImageIntents: async () => null,
  reviewSite: async () => [],
  fixSections: async () => null,
  visualReview: async () => null,
  refineBrief: async () => null,
  clarifyBrief: async () => null,
};

const ctxFor = (name: string, type: string, services: string[]): SeedCtx => ({
  businessName: name,
  businessType: type,
  city: 'Cluj',
  services,
  locale: 'ro',
  phone: '',
  email: '',
});

const CASES = [
  {
    label: 'construction',
    brief: 'firmă de construcții case la cheie și renovări',
    type: 'construcții',
    services: ['case la cheie', 'renovări'],
  },
  {
    label: 'restaurant',
    brief: 'restaurant bistro cu bucătărie locală',
    type: 'restaurant',
    services: ['prânz', 'cină'],
  },
  {
    label: 'lawyer',
    brief: 'cabinet de avocatură drept comercial și litigii',
    type: 'cabinet avocatură',
    services: ['litigii', 'consultanță'],
  },
  {
    label: 'salon',
    brief: 'salon de coafură și cosmetică',
    type: 'salon coafură',
    services: ['coafor', 'manichiură'],
  },
  {
    label: 'dentist',
    brief: 'clinică stomatologică cu implantologie',
    type: 'clinică stomatologică',
    services: ['implantologie', 'ortodonție'],
  },
  {
    label: 'photographer',
    brief: 'fotograf de nuntă și portret stil documentar',
    type: 'fotograf',
    services: ['nuntă', 'portret'],
  },
  {
    label: 'cleaning',
    brief: 'firmă de curățenie pentru birouri',
    type: 'curățenie',
    services: ['birouri', 'rezidențial'],
  },
  {
    label: 'consultant',
    brief: 'consultanță în management și optimizare procese',
    type: 'consultanță',
    services: ['strategie', 'procese'],
  },
];

describe('generator — business analysis + design DNA', () => {
  it('has a complete deterministic default for every archetype', () => {
    for (const [, d] of Object.entries(ARCHETYPE_PROFILE_DEFAULTS)) {
      expect(d.directions.length).toBeGreaterThanOrEqual(2);
      expect(d.profile.trustDrivers.length).toBeGreaterThan(0);
      expect(d.profile.contentPriorities.length).toBeGreaterThan(0);
    }
  });

  it('analyzeBusiness resolves without AI and picks a fitting direction', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 1,
    });
    expect(profile.archetype).toBe('local-trade');
    expect(profile.imageIntensity).toBe('high');
    expect(direction.family).toBeTruthy();
  });

  it('DNA actually projects onto the theme + typography', async () => {
    const a = await analyzeBusiness(NO_AI, {
      brief: 'cabinet avocatură',
      business: { name: 'x', services: [] },
      locale: 'ro',
      seed: 3,
    });
    const dnaA = deriveDesignDNA(a.profile, a.direction, 3);
    const b = await analyzeBusiness(NO_AI, {
      brief: 'restaurant bistro',
      business: { name: 'y', services: [] },
      locale: 'ro',
      seed: 3,
    });
    const dnaB = deriveDesignDNA(b.profile, b.direction, 3);

    const themeA = { ...dnaToTheme(dnaA), ...dnaToTypography(dnaA) };
    const themeB = { ...dnaToTheme(dnaB), ...dnaToTypography(dnaB) };
    // a lawyer and a restaurant should not land on the same look
    expect(JSON.stringify(themeA)).not.toBe(JSON.stringify(themeB));
    expect(themeA.headingFont).toBeDefined();
    expect(themeA.headingScale).toBeDefined();
  });

  it('same seed ⇒ identical DNA; different seed ⇒ different DNA', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 5,
    });
    expect(deriveDesignDNA(profile, direction, 9)).toEqual(deriveDesignDNA(profile, direction, 9));
    const d1 = deriveDesignDNA(profile, direction, 1);
    const d2 = deriveDesignDNA(profile, direction, 2);
    expect(JSON.stringify(d1)).not.toBe(JSON.stringify(d2));
  });
});

describe('generator — information architecture', () => {
  it('different archetypes get visibly different role lists', async () => {
    const lists: Record<string, string> = {};
    for (const c of CASES) {
      const { profile, direction } = await analyzeBusiness(NO_AI, {
        brief: c.brief,
        business: { name: 'x', type: c.type, services: c.services },
        locale: 'ro',
        seed: 42,
      });
      lists[c.label] = deterministicIA(profile, direction, 42)
        .roles.map((r) => r.role)
        .join('>');
    }
    expect(new Set(Object.values(lists)).size).toBeGreaterThanOrEqual(6);
    // every list starts hero, ends contact, and has the spine
    for (const seq of Object.values(lists)) {
      expect(seq.startsWith('hero>')).toBe(true);
      expect(seq.endsWith('>contact')).toBe(true);
      expect(seq).toContain('services');
    }
  });

  it('IA is seed-reproducible and seed-varied', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[2].brief,
      business: { name: 'x', type: CASES[2].type, services: CASES[2].services },
      locale: 'ro',
      seed: 0,
    });
    const at = (s: number): string =>
      deterministicIA(profile, direction, s)
        .roles.map((r) => r.role)
        .join('>');
    expect(at(11)).toBe(at(11));
    const seqs = new Set([at(1), at(2), at(3), at(4), at(5), at(6)]);
    expect(seqs.size).toBeGreaterThanOrEqual(2);
  });

  it('roleToType only yields catalog-valid section types', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[1].brief,
      business: { name: 'x', type: CASES[1].type, services: CASES[1].services },
      locale: 'ro',
      seed: 7,
    });
    const dna = deriveDesignDNA(profile, direction, 7);
    for (const role of ROLE_VOCAB) {
      for (let s = 0; s < 8; s++) {
        const type = roleToType(role, dna, profile, s);
        expect(SECTION_CATALOG[type]).toBeDefined();
      }
    }
  });

  it('reshuffleIA restructures without wrecking the spine', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 3,
    });
    const base = deterministicIA(profile, direction, 3);
    const baseSeq = base.roles.map((r) => r.role).join('>');
    let differing = 0;
    for (let s = 1; s <= 6; s++) {
      const rs = reshuffleIA(base, s);
      const seq = rs.roles.map((r) => r.role).join('>');
      // still opens hero, closes contact, keeps required roles
      expect(rs.roles[0].role).toBe('hero');
      expect(rs.roles[rs.roles.length - 1].role).toBe('contact');
      for (const req of base.roles.filter((r) => r.required)) {
        expect(rs.roles.some((r) => r.role === req.role)).toBe(true);
      }
      if (seq !== baseSeq) differing++;
      // reproducible
      expect(
        reshuffleIA(base, s)
          .roles.map((r) => r.role)
          .join('>'),
      ).toBe(seq);
    }
    // most seeds produce a genuinely different sequence
    expect(differing).toBeGreaterThanOrEqual(4);
  });

  it('drops an AI-picked "pricing" role for a project-quote business (fake monthly plans)', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief, // construction — local-trade
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 1,
    });
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      planArchitecture: async () => ({
        roles: [
          { role: 'hero', required: true, priority: 0 },
          { role: 'services', required: true, priority: 1 },
          { role: 'pricing', required: false, priority: 2 },
          { role: 'contact', required: true, priority: 3 },
        ],
        omitted: [],
        pageCount: 1,
      }),
    };
    const ia = await planIA(ai, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      profile,
      direction,
      locale: 'ro',
      seed: 1,
    });
    expect(ia.roles.some((r) => r.role === 'pricing')).toBe(false);
    expect(ia.omitted).toContain('pricing');
  });

  it('keeps "pricing" for a SaaS business (subscription plans genuinely fit)', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: 'aplicație SaaS de facturare pentru freelanceri, cu planuri lunare',
      business: { name: 'x', type: 'saas', services: [] },
      locale: 'ro',
      seed: 1,
    });
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      planArchitecture: async () => ({
        roles: [
          { role: 'hero', required: true, priority: 0 },
          { role: 'pricing', required: false, priority: 1 },
          { role: 'contact', required: true, priority: 2 },
        ],
        omitted: [],
        pageCount: 1,
      }),
    };
    const ia = await planIA(ai, {
      brief: 'aplicație SaaS de facturare pentru freelanceri, cu planuri lunare',
      business: { name: 'x', type: 'saas', services: [] },
      profile,
      direction,
      locale: 'ro',
      seed: 1,
    });
    expect(ia.roles.some((r) => r.role === 'pricing')).toBe(true);
  });

  it('keeps a valid AI-suggested "emphasis" hint; drops an invalid one', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 1,
    });
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      planArchitecture: async () =>
        ({
          roles: [
            { role: 'hero', required: true, priority: 0 },
            { role: 'services', required: true, priority: 1, emphasis: 'image-led' },
            // an arbitrary string here simulates what the raw AI JSON boundary can send —
            // `IARole['emphasis']` doesn't allow it, but `coerceAiRoles` must reject it anyway
            { role: 'work', required: false, priority: 2, emphasis: 'not-a-real-mode' },
            { role: 'contact', required: true, priority: 3 },
          ],
          omitted: [],
          pageCount: 1,
        }) as unknown as Awaited<ReturnType<GeneratorAi['planArchitecture']>>,
    };
    const ia = await planIA(ai, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      profile,
      direction,
      locale: 'ro',
      seed: 1,
    });
    expect(ia.roles.find((r) => r.role === 'services')?.emphasis).toBe('image-led');
    expect(ia.roles.find((r) => r.role === 'work')?.emphasis).toBeUndefined();
  });

  it('accepts the "comparisonTable" role and maps it to the comparison catalog type', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 1,
    });
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      planArchitecture: async () => ({
        roles: [
          { role: 'hero', required: true, priority: 0 },
          { role: 'services', required: true, priority: 1 },
          { role: 'comparisonTable', required: false, priority: 2 },
          { role: 'contact', required: true, priority: 3 },
        ],
        omitted: [],
        pageCount: 1,
      }),
    };
    const ia = await planIA(ai, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      profile,
      direction,
      locale: 'ro',
      seed: 1,
    });
    expect(ia.roles.some((r) => r.role === 'comparisonTable')).toBe(true);
    expect(roleToType('comparisonTable', deriveDesignDNA(profile, direction, 1), profile, 1)).toBe(
      'comparison',
    );
  });

  it('retries once when Stage 0 recommended real depth but the model came back thin', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 1,
    });
    let calls = 0;
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      planArchitecture: async () => {
        calls++;
        return calls === 1
          ? {
              roles: [
                { role: 'hero', required: true, priority: 0 },
                { role: 'contact', required: true, priority: 1 },
              ],
              omitted: [],
              pageCount: 1,
            }
          : {
              roles: [
                { role: 'hero', required: true, priority: 0 },
                { role: 'services', required: true, priority: 1 },
                { role: 'work', required: false, priority: 2 },
                { role: 'about', required: false, priority: 3 },
                { role: 'faq', required: false, priority: 4 },
                { role: 'testimonials', required: false, priority: 5 },
                { role: 'primaryCTA', required: true, priority: 6 },
                { role: 'contact', required: true, priority: 7 },
              ],
              omitted: [],
              pageCount: 2,
            };
      },
    };
    const ia = await planIA(ai, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      profile,
      direction,
      locale: 'ro',
      seed: 1,
      pageHint: 'Acasă (overview); Servicii (depth); Despre (trust); Contact (booking)',
    });
    expect(calls).toBe(2);
    expect(ia.roles.length).toBe(8);
  });

  it('does NOT retry when Stage 0 only recommended a simple 1-2 page split', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 1,
    });
    let calls = 0;
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      planArchitecture: async () => {
        calls++;
        return {
          roles: [
            { role: 'hero', required: true, priority: 0 },
            { role: 'contact', required: true, priority: 1 },
          ],
          omitted: [],
          pageCount: 1,
        };
      },
    };
    await planIA(ai, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      profile,
      direction,
      locale: 'ro',
      seed: 1,
      pageHint: 'Acasă (overview)',
    });
    expect(calls).toBe(1);
  });

  it('retries for a long/detailed brief even when the page hint only suggests 2 pages', async () => {
    // Mirrors a real gap: a brief over `SKIP_AI_OVER_CHARS` skips Stage 0's AI
    // call, whose deterministic fallback only ever suggests 2 pages — so the
    // pageHint-segment check alone would never trip for exactly the rich,
    // detailed briefs where a thin result is least justified.
    const longBrief = 'x'.repeat(450);
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: longBrief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 1,
    });
    let calls = 0;
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      planArchitecture: async () => {
        calls++;
        return {
          roles: [
            { role: 'hero', required: true, priority: 0 },
            { role: 'contact', required: true, priority: 1 },
          ],
          omitted: [],
          pageCount: 1,
        };
      },
    };
    await planIA(ai, {
      brief: longBrief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      profile,
      direction,
      locale: 'ro',
      seed: 1,
      pageHint: 'Servicii (depth); Contact (booking)',
    });
    expect(calls).toBe(2);
  });

  it("forces the final pageCount to the client's explicit clarify choice, overriding the model", async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 1,
    });
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      planArchitecture: async () => ({
        roles: [
          { role: 'hero', required: true, priority: 0 },
          { role: 'services', required: true, priority: 1 },
          { role: 'contact', required: true, priority: 2 },
        ],
        omitted: [],
        pageCount: 2, // the model's own judgement — must be overridden
      }),
    };
    const ia = await planIA(ai, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      profile,
      direction,
      locale: 'ro',
      seed: 1,
      forcedPageCount: 5,
    });
    expect(ia.pageCount).toBe(5);
    expect(ia.pageStrategy).toBe('multi-page');
  });

  it('retries once when roles are lopsided across groups despite a high total count', async () => {
    // A high role COUNT that's all clustered in one split-off group can't
    // actually reach a forced pageCount — buildRecipe needs ≥3 matched roles
    // PER group, not just a big total.
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 1,
    });
    let calls = 0;
    const lopsided: IARole[] = [
      { role: 'hero', required: true, priority: 0 },
      { role: 'primaryCTA', required: true, priority: 1 },
      { role: 'secondaryCTA', required: true, priority: 2 },
      { role: 'about', required: false, priority: 3 },
      { role: 'story', required: false, priority: 4 },
      { role: 'team', required: false, priority: 5 },
      { role: 'credentials', required: false, priority: 6 },
      { role: 'stats', required: false, priority: 7 },
      { role: 'services', required: true, priority: 8 },
      { role: 'faq', required: false, priority: 9 },
      { role: 'trustBar', required: false, priority: 10 },
      { role: 'hours', required: false, priority: 11 },
      { role: 'contact', required: true, priority: 12 },
    ];
    const balanced: IARole[] = [
      { role: 'hero', required: true, priority: 0 },
      { role: 'primaryCTA', required: true, priority: 1 },
      { role: 'secondaryCTA', required: true, priority: 2 },
      { role: 'about', required: false, priority: 3 },
      { role: 'story', required: false, priority: 4 },
      { role: 'team', required: false, priority: 5 },
      { role: 'services', required: true, priority: 6 },
      { role: 'faq', required: false, priority: 7 },
      { role: 'trustBar', required: false, priority: 8 },
      { role: 'work', required: false, priority: 9 },
      { role: 'gallery', required: false, priority: 10 },
      { role: 'process', required: false, priority: 11 },
      { role: 'featuredProject', required: false, priority: 12 },
      { role: 'specialties', required: false, priority: 13 },
      { role: 'serviceArea', required: false, priority: 14 },
      { role: 'contact', required: true, priority: 15 },
    ];
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      planArchitecture: async () => {
        calls++;
        return { roles: calls === 1 ? lopsided : balanced, omitted: [], pageCount: 5 };
      },
    };
    const ia = await planIA(ai, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      profile,
      direction,
      locale: 'ro',
      seed: 1,
      forcedPageCount: 5,
    });
    expect(calls).toBe(2);
    expect(ia.roles.map((r) => r.role)).toEqual(balanced.map((r) => r.role));
  });

  it('does not retry when the role list already spreads across enough groups', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed: 1,
    });
    let calls = 0;
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      planArchitecture: async () => {
        calls++;
        return {
          roles: [
            { role: 'hero', required: true, priority: 0 },
            { role: 'primaryCTA', required: true, priority: 1 },
            { role: 'about', required: false, priority: 2 },
            { role: 'story', required: false, priority: 3 },
            { role: 'team', required: false, priority: 4 },
            { role: 'services', required: true, priority: 5 },
            { role: 'faq', required: false, priority: 6 },
            { role: 'trustBar', required: false, priority: 7 },
            { role: 'work', required: false, priority: 8 },
            { role: 'gallery', required: false, priority: 9 },
            { role: 'process', required: false, priority: 10 },
            { role: 'contact', required: true, priority: 11 },
          ],
          omitted: [],
          pageCount: 4,
        };
      },
    };
    await planIA(ai, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      profile,
      direction,
      locale: 'ro',
      seed: 1,
      forcedPageCount: 4,
    });
    expect(calls).toBe(1);
  });
});

describe('generator — layout recipe + rhythm engine', () => {
  const profile: BusinessProfile = {
    ...ARCHETYPE_PROFILE_DEFAULTS['local-trade'].profile,
    archetype: 'local-trade',
  };

  it('assignRhythm never repeats the previous composition mode', () => {
    const dna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      3,
    );
    const roles = [
      'hero',
      'services',
      'work',
      'process',
      'testimonials',
      'faq',
      'primaryCTA',
      'contact',
    ] as const;
    for (let seed = 0; seed < 25; seed++) {
      const modes = assignRhythm([...roles], dna, seed);
      for (let i = 1; i < modes.length; i++) expect(modes[i]).not.toBe(modes[i - 1]);
    }
  });

  it('assignRhythm honors a valid emphasis hint when it does not collide with the previous mode', () => {
    const dna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      3,
    );
    const roles = ['hero', 'services', 'work', 'contact'] as const;
    const modes = assignRhythm([...roles], dna, 3, { work: 'image-led' });
    expect(modes[2]).toBe('image-led');
    // the "never repeat the previous mode" guarantee still holds even with a hint
    for (let i = 1; i < modes.length; i++) expect(modes[i]).not.toBe(modes[i - 1]);
  });

  it('pickVariant spreads across a type’s variants over seeds', () => {
    const dna = deriveDesignDNA(profile, ARCHETYPE_PROFILE_DEFAULTS.agency.directions[0], 1);
    const seen = new Set<string>();
    for (let s = 0; s < 20; s++) seen.add(pickVariant('services', dna, 'grid', s, new Set()));
    expect(seen.size).toBeGreaterThanOrEqual(2);
    // returned variant is always catalog-valid
    for (const v of seen) expect(SECTION_CATALOG.services.variants.map((x) => x.id)).toContain(v);
  });

  it('buildRecipe produces a hero-first, contact-last page with image slots', async () => {
    const { profile: p, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[5].brief,
      business: { name: 'x', type: CASES[5].type, services: CASES[5].services },
      locale: 'ro',
      seed: 4,
    });
    const dna = deriveDesignDNA(p, direction, 4);
    const ia = deterministicIA(p, direction, 4);
    const recipe = buildRecipe({
      ia,
      dna,
      profile: p,
      ctx: ctxFor('Studio', CASES[5].type, CASES[5].services),
      seed: 4,
    });
    const home = recipe.pages[0];
    expect(home.sections[0].type).toBe('hero');
    const flat = recipe.pages.flatMap((pg) => pg.sections);
    expect(flat.some((s) => s.type === 'contact')).toBe(true);
    expect(flat.some((s) => s.imageSlot.needed)).toBe(true);
  });

  it('buildRecipe tags the theme with the style preset matching the business archetype', () => {
    const roles: SectionRole[] = ['hero', 'services', 'contact'];
    const ia: IASpec = {
      roles: roles.map((role, i) => ({ role, required: true, priority: i })),
      omitted: [],
      pageStrategy: 'one-page',
      pageCount: 1,
    };
    const forArchetype = (archetype: BusinessProfile['archetype']): string | undefined => {
      const p = { ...profile, archetype };
      const dna = deriveDesignDNA(p, ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0], 2);
      return buildRecipe({
        ia,
        dna,
        profile: p,
        ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
        seed: 2,
      }).theme.preset;
    };
    // an AI-generated site now lands on the SAME preset-scoped CSS treatments
    // (`.site--preset-*` in WebsiteRenderer.vue) a manually-applied ThemeBar
    // preset gets — the two paths were previously disjoint.
    expect(forArchetype('saas')).toBe('tech');
    expect(forArchetype('portfolio')).toBe('editorial');
    expect(forArchetype('shop')).toBe('bold');
    expect(forArchetype('hospitality')).toBe('warm');
    expect(forArchetype('clinic')).toBe('soft');
    expect(forArchetype('agency')).toBe('studio');
  });

  it('buildRecipe applies one coherent DNA-derived style to every button/input/gap target', () => {
    const baseDna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      2,
    );
    const dna = {
      ...baseDna,
      decorativeStyle: 'expressive' as const,
      cardStyle: 'bordered' as const,
      spacing: 'spacious' as const,
      typography: { ...baseDna.typography, headingFont: 'jetbrains' as const },
      colorStrategy: { ...baseDna.colorStrategy, accentHex: '#00ff88' },
    };
    // 'stats' is a fixed 1:1 role→type mapping (unlike 'services', which is a
    // seeded pick over several concrete types) — guarantees an `itemsGap`
    // target is actually present regardless of seed.
    const roles: SectionRole[] = ['hero', 'stats', 'contact'];
    const ia: IASpec = {
      roles: roles.map((role, i) => ({ role, required: true, priority: i })),
      omitted: [],
      pageStrategy: 'one-page',
      pageCount: 1,
    };
    const recipe = buildRecipe({
      ia,
      dna,
      profile,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 2,
    });
    const flat = recipe.pages.flatMap((p) => p.sections);
    const hero = flat.find((s) => s.type === 'hero')!;
    const stats = flat.find((s) => s.type === 'stats')!;
    const contact = flat.find((s) => s.type === 'contact')!;
    // buttons: same radius/font/border everywhere — one coherent choice, not
    // a random flourish per section
    expect(hero.overrides?.primaryButton).toEqual({
      radius: 'subtle', // BUTTON_RADIUS_BY_CARD.bordered
      font: 'jetbrains',
      borderWidth: 'thin',
      borderColor: '#00ff88',
    });
    expect(hero.overrides?.secondaryButton).toEqual(hero.overrides?.primaryButton);
    expect(contact.overrides?.submitButton).toEqual(hero.overrides?.primaryButton);
    // spacing: 'spacious' DNA -> 'relaxed' gap, applied to every gap target
    expect(stats.overrides?.itemsGap).toEqual({ gap: 'relaxed' });
    expect(contact.overrides?.formGap).toEqual({ gap: 'relaxed' });
    // the contact section's prose "formLead" target is untouched by this pass
    expect(contact.overrides?.formLead).toBeUndefined();
  });

  it('a plain/minimal art direction (decorativeStyle "none") skips the style-variety flourish', () => {
    const baseDna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      2,
    );
    const dna = { ...baseDna, decorativeStyle: 'none' as const };
    const roles: SectionRole[] = ['hero', 'services', 'contact'];
    const ia: IASpec = {
      roles: roles.map((role, i) => ({ role, required: true, priority: i })),
      omitted: [],
      pageStrategy: 'one-page',
      pageCount: 1,
    };
    const recipe = buildRecipe({
      ia,
      dna,
      profile,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 2,
    });
    for (const s of recipe.pages.flatMap((p) => p.sections)) expect(s.overrides).toBeUndefined();
  });

  it('a rich IA (pageCount 4) actually reaches 4 pages — one per split-off group', () => {
    const dna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      2,
    );
    const roles: SectionRole[] = [
      'hero',
      'secondaryCTA',
      'services',
      'pricing',
      'faq',
      'work',
      'gallery',
      'process',
      'about',
      'story',
      'team',
      'primaryCTA',
      'contact',
    ];
    const ia: IASpec = {
      roles: roles.map((role, i) => ({ role, required: true, priority: i })),
      omitted: [],
      pageStrategy: 'multi-page',
      pageCount: 4,
    };
    const recipe = buildRecipe({
      ia,
      dna,
      profile,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 2,
    });
    expect(recipe.pages.length).toBe(4);
    expect(recipe.pages[0].sections[0].type).toBe('hero');
    const flat = recipe.pages.flatMap((p) => p.sections);
    expect(flat.some((s) => s.type === 'contact')).toBe(true);
    // contact is on the LAST page, not stranded on home
    expect(recipe.pages[recipe.pages.length - 1].sections.some((s) => s.role === 'contact')).toBe(
      true,
    );
    // every secondary page opens with its own lean, image-free header AND
    // closes with its own call-to-action (primaryCTA/secondaryCTA are
    // anchor-only roles, never part of a split-off group's own content)
    for (const p of recipe.pages.slice(1)) {
      expect(p.sections[0]).toMatchObject({ type: 'hero', variant: 'minimal' });
      expect(p.sections[0].imageSlot.needed).toBe(false);
      expect(p.sections.some((s) => s.role === 'secondaryCTA')).toBe(true);
    }
    // no IA role appears on two pages — 'hero' (home's real hero + one lean
    // header per secondary page) and 'secondaryCTA' (home's own instance +
    // one closing CTA per secondary page) are the deliberate exceptions
    const roleCounts = new Map<string, number>();
    for (const s of flat) roleCounts.set(s.role, (roleCounts.get(s.role) ?? 0) + 1);
    for (const [role, n] of roleCounts) {
      if (role === 'hero' || role === 'secondaryCTA') expect(n).toBe(recipe.pages.length);
      else expect(n).toBe(1);
    }
  });

  it('a client-chosen page structure (clarification) renames the built pages to match it', () => {
    const dna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      2,
    );
    const roles: SectionRole[] = [
      'hero',
      'secondaryCTA',
      'services',
      'pricing',
      'faq',
      'work',
      'gallery',
      'process',
      'about',
      'story',
      'team',
      'primaryCTA',
      'contact',
    ];
    const ia: IASpec = {
      roles: roles.map((role, i) => ({ role, required: true, priority: i })),
      omitted: [],
      pageStrategy: 'multi-page',
      pageCount: 4,
    };
    // Exactly the shape the clarify flow produces: a home entry first, the
    // client's own page names/purposes, "Portofoliu" deliberately worded to
    // require keyword-matching onto the `work` group (not `services`, which
    // would peel off first in this seed's default rotation).
    const chosen: SuggestedPage[] = [
      { title: 'Acasă', purpose: 'prezentare generală' },
      { title: 'Portofoliu', purpose: 'proiectele noastre recente' },
      { title: 'Servicii', purpose: 'ce oferim, în detaliu' },
      { title: 'Despre noi', purpose: 'echipa și povestea firmei' },
      { title: 'Contact', purpose: 'date de contact' },
    ];
    const recipe = buildRecipe({
      ia,
      dna,
      profile,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 2,
      suggestedPages: chosen,
    });
    const titles = recipe.pages.map((p) => p.title);
    expect(titles).toContain('Acasă'); // home renamed from the default too
    expect(titles).toContain('Portofoliu');
    expect(titles).toContain('Servicii');
    expect(titles).toContain('Despre noi');
    // "Portofoliu" must land on the page built from the `work` group content
    // (gallery/process/work sections), proving keyword matching — not just
    // positional renaming — picked the right group for it.
    const portfolioPage = recipe.pages.find((p) => p.title === 'Portofoliu')!;
    expect(portfolioPage.sections.some((s) => s.role === 'work' || s.role === 'process')).toBe(
      true,
    );
    expect(portfolioPage.sections.some((s) => s.role === 'services')).toBe(false);
  });

  it('an unmatched clarify page name still gets a page (falls back to the group it landed on)', () => {
    const dna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      2,
    );
    const roles: SectionRole[] = [
      'hero',
      'secondaryCTA',
      'services',
      'pricing',
      'faq',
      'about',
      'story',
      'team',
      'primaryCTA',
      'contact',
    ];
    const ia: IASpec = {
      roles: roles.map((role, i) => ({ role, required: true, priority: i })),
      omitted: [],
      pageStrategy: 'multi-page',
      pageCount: 3,
    };
    const chosen: SuggestedPage[] = [
      { title: 'Home', purpose: 'overview' },
      { title: 'Something Unrelated', purpose: 'a made-up page name' },
      { title: 'Contact', purpose: 'contact info' },
    ];
    const recipe = buildRecipe({
      ia,
      dna,
      profile,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 2,
      suggestedPages: chosen,
    });
    expect(recipe.pages.length).toBe(3);
    expect(recipe.pages[0].title).toBe('Home');
    // the unmatched name still gets assigned to *a* real group, not dropped
    expect(recipe.pages.some((p) => p.title === 'Something Unrelated')).toBe(true);
  });

  it('the fallback per-archetype page guess (no clarify) never renames pages in English', () => {
    const dna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      2,
    );
    const roles: SectionRole[] = [
      'hero',
      'secondaryCTA',
      'services',
      'pricing',
      'faq',
      'about',
      'story',
      'team',
      'primaryCTA',
      'contact',
    ];
    const ia: IASpec = {
      roles: roles.map((role, i) => ({ role, required: true, priority: i })),
      omitted: [],
      pageStrategy: 'multi-page',
      pageCount: 2,
    };
    // No `suggestedPages` at all (the pipeline only forwards `clarifiedPages`,
    // never Stage 0's own English-only archetype guess) — titles must stay
    // the normal localised defaults.
    const recipe = buildRecipe({
      ia,
      dna,
      profile,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 2,
    });
    expect(recipe.pages.map((p) => p.title)).not.toContain('Services');
    expect(recipe.pages[0].title).toBe('Acasă');
  });

  it('an even richer IA (pageCount 5) reaches 5 pages via the 4th ("proof") split-off group', () => {
    const dna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      2,
    );
    const roles: SectionRole[] = [
      'hero',
      'secondaryCTA',
      'primaryCTA',
      'contact',
      'work',
      'gallery',
      'process',
      'services',
      'faq',
      'trustBar',
      'about',
      'story',
      'team',
      'comparisonTable',
      'featuredProject',
      'specialties',
    ];
    const ia: IASpec = {
      roles: roles.map((role, i) => ({ role, required: true, priority: i })),
      omitted: [],
      pageStrategy: 'multi-page',
      pageCount: 5,
    };
    const recipe = buildRecipe({
      ia,
      dna,
      profile,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 2,
    });
    expect(recipe.pages.length).toBe(5);
    const proofPage = recipe.pages.find((p) => p.slug === 'proof');
    expect(proofPage).toBeDefined();
    const proofRoles = proofPage!.sections.map((s) => s.role);
    expect(proofRoles).toEqual(
      expect.arrayContaining(['comparisonTable', 'featuredProject', 'specialties']),
    );
  });

  it('a thin IA (pageCount 2, one usable group) still falls back to exactly 1 extra page', () => {
    const dna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      2,
    );
    const roles: SectionRole[] = ['hero', 'services', 'primaryCTA', 'contact'];
    const ia: IASpec = {
      roles: roles.map((role, i) => ({ role, required: true, priority: i })),
      omitted: [],
      pageStrategy: 'multi-page',
      pageCount: 2,
    };
    const recipe = buildRecipe({
      ia,
      dna,
      profile,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 2,
    });
    // only 'services' alone (1 section) doesn't clear the ≥3 threshold for any
    // group ⇒ nothing to split off ⇒ a single page, not an empty second one
    expect(recipe.pages.length).toBe(1);
  });

  it('the services page still splits off without pricing — faq/trustBar/hours cover the gap', () => {
    const dna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      2,
    );
    // 'pricing' deliberately absent (dropMisfitRoles strips it for most
    // archetypes) — the group must still clear the ≥3 threshold on its own.
    const roles: SectionRole[] = [
      'hero',
      'secondaryCTA',
      'primaryCTA',
      'contact',
      'services',
      'faq',
      'trustBar',
      'hours',
    ];
    const ia: IASpec = {
      roles: roles.map((role, i) => ({ role, required: true, priority: i })),
      omitted: [],
      pageStrategy: 'multi-page',
      pageCount: 2,
    };
    const recipe = buildRecipe({
      ia,
      dna,
      profile,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 2,
    });
    expect(recipe.pages.length).toBe(2);
    const secondary = recipe.pages[1];
    const secondaryRoles = secondary.sections.map((s) => s.role);
    // 'contact' relocates to the last built page, on top of the split-off group
    expect(secondaryRoles).toEqual(
      expect.arrayContaining(['services', 'faq', 'trustBar', 'hours', 'contact']),
    );
    expect(recipe.pages[0].sections.some((s) => s.role === 'contact')).toBe(false);
  });

  it('never peels a group if it would leave home thinner than the floor', () => {
    const dna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      2,
    );
    // Only 3 non-anchor roles total, all in one group, and just 2 anchors
    // besides hero/contact — peeling the group would leave home with only
    // 2 sections (hero, contact), under the floor of 4.
    const roles: SectionRole[] = ['hero', 'contact', 'services', 'faq', 'trustBar'];
    const ia: IASpec = {
      roles: roles.map((role, i) => ({ role, required: true, priority: i })),
      omitted: [],
      pageStrategy: 'multi-page',
      pageCount: 2,
    };
    const recipe = buildRecipe({
      ia,
      dna,
      profile,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 2,
    });
    expect(recipe.pages.length).toBe(1);
  });

  it('page count varies with role richness instead of converging on a fixed number', () => {
    const dna = deriveDesignDNA(
      profile,
      ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0],
      2,
    );
    const thin: SectionRole[] = ['hero', 'primaryCTA', 'contact', 'services'];
    const rich: SectionRole[] = [
      'hero',
      'secondaryCTA',
      'primaryCTA',
      'contact',
      'services',
      'faq',
      'trustBar',
      'work',
      'gallery',
      'process',
      'about',
      'story',
      'team',
    ];
    const build = (roles: SectionRole[]) =>
      buildRecipe({
        ia: {
          roles: roles.map((role, i) => ({ role, required: true, priority: i })),
          omitted: [],
          pageStrategy: 'multi-page',
          pageCount: 4,
        },
        dna,
        profile,
        ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
        seed: 2,
      });
    const thinRecipe = build(thin);
    const richRecipe = build(rich);
    expect(thinRecipe.pages.length).toBe(1);
    expect(richRecipe.pages.length).toBeGreaterThan(thinRecipe.pages.length);
    expect(richRecipe.pages.length).toBeGreaterThanOrEqual(3);
  });
});

describe('generator — design fingerprint', () => {
  it('a text-only difference produces the SAME fingerprint', async () => {
    const a = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('Alpha SRL', CASES[0].type, CASES[0].services),
      seed: 100,
      runContentReview: false,
    });
    const b = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('Totally Different Name SA', CASES[0].type, CASES[0].services),
      seed: 100,
      runContentReview: false,
    });
    expect(fingerprintDoc(a.doc, a.recipe).hash).toBe(fingerprintDoc(b.doc, b.recipe).hash);
  });

  it('distance is 0 for identical, > 0 for restructured', async () => {
    const a = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('X', CASES[0].type, CASES[0].services),
      seed: 1,
      runContentReview: false,
    });
    const b = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('X', CASES[0].type, CASES[0].services),
      seed: 2,
      runContentReview: false,
    });
    expect(fingerprintDistance(a.fingerprint, a.fingerprint)).toBe(0);
    expect(fingerprintDistance(a.fingerprint, b.fingerprint)).toBeGreaterThan(0.1);
  });
});

describe('generator — end-to-end diversity (deterministic path)', () => {
  it('8 business types → 8 distinct structural fingerprints', async () => {
    const fps: string[] = [];
    for (const c of CASES) {
      const r = await generateSite(NO_AI, {
        brief: c.brief,
        ctx: ctxFor(`${c.label} SRL`, c.type, c.services),
        seed: 2024,
        runContentReview: false,
      });
      fps.push(r.fingerprint.hash);
      // sanity: a real multi-section site with a hero + contact
      const secs = r.doc.pages.filter((p) => !p.system).flatMap((p) => p.sections);
      expect(secs[0].type).toBe('hero');
      expect(secs.some((s) => s.type === 'contact')).toBe(true);
      expect(secs.length).toBeGreaterThanOrEqual(4);
    }
    expect(new Set(fps).size).toBe(CASES.length);
  });

  it('5 seeded variants of one business → 5 distinct fingerprints, structurally apart', async () => {
    const fps = [];
    for (let seed = 1; seed <= 5; seed++) {
      const r = await generateSite(NO_AI, {
        brief: CASES[0].brief,
        ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
        seed,
        runContentReview: false,
      });
      fps.push(r.fingerprint);
    }
    expect(new Set(fps.map((f) => f.hash)).size).toBe(5);
    let minD = 1;
    for (let i = 0; i < fps.length; i++)
      for (let j = i + 1; j < fps.length; j++)
        minD = Math.min(minD, fingerprintDistance(fps[i], fps[j]));
    expect(minD).toBeGreaterThan(0.15); // not just a recolor
  });

  it('same seed ⇒ byte-identical structure (reproducible)', async () => {
    const mk = () =>
      generateSite(NO_AI, {
        brief: CASES[3].brief,
        ctx: ctxFor('Salon', CASES[3].type, CASES[3].services),
        seed: 77,
        runContentReview: false,
      });
    const a = await mk();
    const b = await mk();
    expect(a.fingerprint.hash).toBe(b.fingerprint.hash);
    expect(a.fingerprint.variants).toBe(b.fingerprint.variants);
  });
});

describe('generator — AI design hints (DNA)', () => {
  it('validated hints override the family base; junk hints are ignored', async () => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[2].brief,
      business: { name: 'x', type: CASES[2].type, services: CASES[2].services },
      locale: 'ro',
      seed: 5,
    });
    const base = deriveDesignDNA(profile, direction, 5);
    const hinted = deriveDesignDNA(profile, direction, 5, {
      headingScale: 'display',
      spacing: 'spacious',
      accentHex: '#123456',
      radius: 'none',
      cardStyle: 'editorial',
    });
    expect(hinted.typography.headingScale).toBe('display');
    expect(hinted.spacing).toBe('spacious');
    expect(hinted.colorStrategy.accentHex).toBe('#123456');
    expect(hinted.radius).toBe('none');
    expect(hinted.cardStyle).toBe('editorial');
    // and hints genuinely changed the DNA vs. the family base
    expect(JSON.stringify(hinted)).not.toBe(JSON.stringify(base));
    // an empty hint set is a no-op — identical to the un-hinted derivation
    expect(deriveDesignDNA(profile, direction, 5, {})).toEqual(base);
  });

  it('rejects an AI-picked accent too close to white/black; keeps a usable one', async () => {
    const aiFor = (accentHex: string): GeneratorAi => ({
      ...NO_AI,
      configured: true,
      analyzeBusiness: async () => ({ profile: {}, direction: {}, dnaHints: { accentHex } }),
    });
    const nearWhite = await analyzeBusiness(aiFor('#fbfbfb'), {
      brief: CASES[0].brief,
      business: { name: 'x', services: [] },
      locale: 'ro',
      seed: 1,
    });
    expect(nearWhite.dnaHints.accentHex).toBeUndefined();

    const nearBlack = await analyzeBusiness(aiFor('#050505'), {
      brief: CASES[0].brief,
      business: { name: 'x', services: [] },
      locale: 'ro',
      seed: 1,
    });
    expect(nearBlack.dnaHints.accentHex).toBeUndefined();

    const usable = await analyzeBusiness(aiFor('#2f5bd6'), {
      brief: CASES[0].brief,
      business: { name: 'x', services: [] },
      locale: 'ro',
      seed: 1,
    });
    expect(usable.dnaHints.accentHex).toBe('#2f5bd6');
  });
});

describe('generator — recipe fingerprint + anti-collision re-roll', () => {
  const mkRecipe = async (seed: number) => {
    const { profile, direction } = await analyzeBusiness(NO_AI, {
      brief: CASES[0].brief,
      business: { name: 'x', type: CASES[0].type, services: CASES[0].services },
      locale: 'ro',
      seed,
    });
    const dna = deriveDesignDNA(profile, direction, seed);
    const ia = deterministicIA(profile, direction, seed);
    return buildRecipe({
      ia,
      dna,
      profile,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed,
    });
  };

  it('fingerprintRecipe is reproducible and seed-sensitive', async () => {
    expect(fingerprintRecipe(await mkRecipe(3)).hash).toBe(
      fingerprintRecipe(await mkRecipe(3)).hash,
    );
    expect(fingerprintRecipe(await mkRecipe(1)).hash).not.toBe(
      fingerprintRecipe(await mkRecipe(2)).hash,
    );
  });

  it('a plain re-generate (auto seed) re-rolls when the structure repeats a recent one', async () => {
    // no explicit seed → generateSite derives a stable one from ctx + brief
    const first = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      runContentReview: false,
    });
    const collided = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      recentFingerprints: [first.fingerprint.hash],
      runContentReview: false,
    });
    // that fingerprint is marked "recent" ⇒ a different structure — and now the
    // IA is restructured too, so the SECTION SEQUENCE really moves.
    expect(collided.fingerprint.hash).not.toBe(first.fingerprint.hash);
    expect(collided.fingerprint.sequence).not.toBe(first.fingerprint.sequence);
    expect(fingerprintDistance(first.fingerprint, collided.fingerprint)).toBeGreaterThan(0.15);
  });

  it('an EXPLICIT seed is honoured as-is — no re-roll even on a fingerprint match', async () => {
    const a = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 4242,
      runContentReview: false,
    });
    const b = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 4242,
      recentFingerprints: [a.fingerprint.hash], // would re-roll an auto seed
      runContentReview: false,
    });
    expect(b.fingerprint.hash).toBe(a.fingerprint.hash);
  });
});

describe('generator — Stage 0 brief refinement', () => {
  it('the ENRICHED brief (not the raw one) reaches analyzeBusiness / planArchitecture / writePageCopy', async () => {
    const seenBriefs: string[] = [];
    const enrichedText = 'ENRICHED: three distinct service lines, warm local tone.';
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      refineBrief: async () => ({
        brief: enrichedText,
        suggestedPages: [
          { title: 'Services', purpose: 'detail' },
          { title: 'Contact', purpose: 'contact' },
        ],
        emphasize: ['three services, one salon'],
        clarifications: ['assumed local audience'],
      }),
      analyzeBusiness: async (i) => {
        seenBriefs.push(i.brief);
        return null;
      },
      planArchitecture: async (i) => {
        seenBriefs.push(i.brief);
        return null;
      },
      writePageCopy: async (i) => {
        seenBriefs.push(i.brief);
        return null;
      },
    };
    const r = await generateSite(ai, {
      brief: 'RAW: salon in Cluj',
      ctx: ctxFor('Salon', 'salon', []),
      runContentReview: false,
    });
    expect(seenBriefs.length).toBeGreaterThan(0);
    expect(seenBriefs.every((b) => b === enrichedText)).toBe(true);
    expect(seenBriefs).not.toContain('RAW: salon in Cluj');
    expect(r.enrichedBrief.brief).toBe(enrichedText);
    expect(r.enrichedBrief.emphasize).toContain('three services, one salon');
  });

  it('suggestedPages is forwarded to planArchitecture as a compact pageHint', async () => {
    let seenHint: string | undefined;
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      refineBrief: async () => ({ suggestedPages: [{ title: 'Menu', purpose: 'full menu' }] }),
      planArchitecture: async (i) => {
        seenHint = i.pageHint;
        return null;
      },
    };
    await generateSite(ai, {
      brief: 'a restaurant with a big menu',
      ctx: ctxFor('R', 'restaurant', []),
      runContentReview: false,
    });
    expect(seenHint).toBe('Menu (full menu)');
  });

  it('emphasize is forwarded to writePageCopy — not silently dropped after Stage 0', async () => {
    let seenEmphasize: string[] | undefined;
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      refineBrief: async () => ({ emphasize: ['trei linii de servicii distincte'] }),
      writePageCopy: async (i) => {
        seenEmphasize = i.emphasize;
        return null;
      },
    };
    await generateSite(ai, {
      brief: CASES[0].brief,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      runContentReview: false,
    });
    expect(seenEmphasize).toEqual(['trei linii de servicii distincte']);
  });

  it('the auto-derived seed depends on the RAW brief, not on what refineBrief returns', async () => {
    const ctx = ctxFor('BuildCo', CASES[0].type, CASES[0].services);
    let seedA = -1;
    let seedB = -1;
    const aiA: GeneratorAi = {
      ...NO_AI,
      configured: true,
      refineBrief: async () => ({ brief: 'variant A of the enrichment' }),
      planArchitecture: async (i) => {
        seedA = i.seed;
        return null;
      },
    };
    const aiB: GeneratorAi = {
      ...NO_AI,
      configured: true,
      refineBrief: async () => ({ brief: 'a totally different, much longer variant B' }),
      planArchitecture: async (i) => {
        seedB = i.seed;
        return null;
      },
    };
    await generateSite(aiA, { brief: CASES[0].brief, ctx, runContentReview: false });
    await generateSite(aiB, { brief: CASES[0].brief, ctx, runContentReview: false });
    expect(seedA).toBe(seedB);
  });

  it('the deterministic (no-AI) path never fabricates — the brief passes through unchanged', async () => {
    const r = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      runContentReview: false,
    });
    expect(r.enrichedBrief.brief).toBe(CASES[0].brief);
    expect(r.enrichedBrief.emphasize).toEqual([]);
    expect(r.enrichedBrief.clarifications).toEqual([]);
  });
});

describe('generator — post-generation auto-repair', () => {
  it('generateSite runs verify→fix and exposes `repaired`, not user-facing findings', async () => {
    const r = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 3,
    });
    expect(Array.isArray(r.repaired)).toBe(true);
    // every non-system page still opens sensibly and has a hero + contact overall
    const secs = r.doc.pages.filter((p) => !p.system).flatMap((p) => p.sections);
    expect(secs[0].type).toBe('hero');
    expect(secs.some((s) => s.type === 'contact')).toBe(true);
  });

  it('repairGeneratedSite fixes a missing hero + stacked duplicates deterministically', async () => {
    const gen = await generateSite(NO_AI, {
      brief: CASES[2].brief,
      ctx: ctxFor('Lawfirm', CASES[2].type, CASES[2].services),
      seed: 9,
      runContentReview: false,
    });
    // break the doc: drop the hero, stack two identical sections
    const home = gen.doc.pages.find((p) => !p.system)!;
    home.sections = home.sections.filter((s) => s.type !== 'hero');
    const dupType = home.sections[1].type;
    home.sections.splice(2, 0, { ...home.sections[1], id: 'dup-1' });
    expect(home.sections[1].type).toBe(dupType);
    expect(home.sections[2].type).toBe(dupType);

    const res = await repairGeneratedSite({
      ai: NO_AI,
      doc: gen.doc,
      brief: CASES[2].brief,
      ctx: ctxFor('Lawfirm', CASES[2].type, CASES[2].services),
      business: { name: 'Lawfirm', type: CASES[2].type, services: CASES[2].services },
      initialFindings: [],
    });
    const fixedHome = res.doc.pages.find((p) => !p.system)!;
    expect(fixedHome.sections[0].type).toBe('hero');
    // no two adjacent sections share a type any more
    for (let i = 1; i < fixedHome.sections.length; i++) {
      expect(fixedHome.sections[i].type).not.toBe(fixedHome.sections[i - 1].type);
    }
    expect(res.repaired.length).toBeGreaterThan(0);
  });
});

describe('generator — Phase 2 image search', () => {
  /** A resolver that hands back a fake pexels photo for every intent. */
  const fakeImages: ImageSearchResolver = {
    configured: true,
    resolve: async ({ intents }) => {
      const m = new Map();
      intents.forEach((it, i) => {
        m.set(`${it.sectionId}|${it.field}|${it.itemIndex ?? '-'}`, {
          url: `https://images.pexels.com/photos/${100 + i}/l.jpg`,
          provider: 'pexels' as const,
          photoId: String(100 + i),
          alt: `photo ${i}`,
        });
      });
      return m;
    },
  };

  it('real search results overwrite the pool hero image', async () => {
    const r = await generateSite(NO_AI, {
      brief: CASES[5].brief,
      ctx: ctxFor('Studio', CASES[5].type, CASES[5].services),
      seed: 8,
      runContentReview: false,
      images: fakeImages,
    });
    const hero = r.doc.pages.flatMap((p) => p.sections).find((s) => s.type === 'hero')!;
    expect(String((hero.content as Record<string, unknown>).backgroundImage)).toMatch(
      /^https:\/\/images\.pexels\.com\//,
    );
  });

  it('an unconfigured resolver is ignored — pool photos stay', async () => {
    const off: ImageSearchResolver = { configured: false, resolve: async () => new Map() };
    const r = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 2,
      runContentReview: false,
      images: off,
    });
    const hero = r.doc.pages.flatMap((p) => p.sections).find((s) => s.type === 'hero')!;
    // still a real image, just from the curated pool (unsplash), never blank
    expect(
      String((hero.content as Record<string, unknown>).backgroundImage).length,
    ).toBeGreaterThan(0);
  });
});

describe('generator — Phase 3 visual QA gate', () => {
  it('is a pure no-op when no visualQa config is passed', async () => {
    const r = await generateSite(NO_AI, {
      brief: CASES[0].brief,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 4,
      runContentReview: false,
    });
    expect(r.report.scores).toBeUndefined();
    expect(r.report.visual).toBeUndefined();
  });

  it('runs the gate + records scores when a screenshot + verdict are available', async () => {
    const AI_VISION: GeneratorAi = {
      ...NO_AI,
      configured: true,
      visualReview: async (): Promise<VisualReview> => ({
        score: 82,
        criticalIssues: [],
        warnings: [],
        strengths: ['clean layout'],
        recommendedFixes: [],
      }),
    };
    const r = await generateSite(AI_VISION, {
      brief: CASES[0].brief,
      ctx: ctxFor('BuildCo', CASES[0].type, CASES[0].services),
      seed: 4,
      runContentReview: false,
      visualQa: { enabled: true, screenshotUrl: 'http://shooter', siteUrl: 'http://site' },
      shoot: async () => ({ base64: 'AAAA', mediaType: 'image/png' }),
    });
    expect(r.report.visual?.score).toBe(82);
    expect(r.report.scores).toBeDefined();
  });
});
