import type { SeedCtx } from '../section-catalog';
import { SECTION_CATALOG } from '../section-catalog';
import { generateSite } from './pipeline';
import { analyzeBusiness, ARCHETYPE_PROFILE_DEFAULTS } from './business-analysis';
import { deriveDesignDNA, dnaToTheme, dnaToTypography } from './design-dna';
import { deterministicIA, reshuffleIA, roleToType, ROLE_VOCAB } from './information-architecture';
import { assignRhythm, buildRecipe, pickVariant } from './layout-recipe';
import { fingerprintDoc, fingerprintDistance, fingerprintRecipe } from './design-fingerprint';
import { repairGeneratedSite } from './repair';
import type { BusinessProfile, GeneratorAi, ImageSearchResolver, VisualReview } from './types';

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
