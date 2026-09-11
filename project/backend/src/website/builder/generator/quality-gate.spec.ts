import type { SeedCtx } from '../section-catalog';
import type { AuditCheck } from '../site-audit';
import { ARCHETYPE_PROFILE_DEFAULTS } from './business-analysis';
import { deriveDesignDNA } from './design-dna';
import { applyTargetedFixes, gatePasses, runQualityGate } from './quality-gate';
import type { BuilderDoc } from '../compose-advanced';
import type {
  BusinessProfile,
  GeneratorAi,
  ImageSearchResolver,
  QaScores,
  VisualReview,
} from './types';

const ctx: SeedCtx = {
  businessName: 'Acme',
  businessType: 'construcții',
  city: 'Cluj',
  services: ['case'],
  locale: 'ro',
};
const profile: BusinessProfile = {
  ...ARCHETYPE_PROFILE_DEFAULTS['local-trade'].profile,
  archetype: 'local-trade',
};
const dna = deriveDesignDNA(profile, ARCHETYPE_PROFILE_DEFAULTS['local-trade'].directions[0], 3);

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

function doc(): BuilderDoc {
  return {
    v: 2,
    mode: 'ai',
    theme: { headingScale: 'display', density: 'compact' } as BuilderDoc['theme'],
    pages: [
      {
        id: 'home',
        title: 'Acasă',
        slug: 'acasa',
        isHome: true,
        nav: true,
        sections: [
          {
            id: 'hero1',
            type: 'hero',
            variant: 'split',
            visible: true,
            content: { headline: 'Hi' },
          },
          {
            id: 'srv1',
            type: 'services',
            variant: 'cards',
            visible: true,
            content: { title: 'Servicii', items: [{ title: 'A', text: 'x' }] },
          },
        ],
      },
    ],
  } as BuilderDoc;
}

const checks = (passed: number, total: number): AuditCheck[] =>
  Array.from({ length: total }, (_, i) => ({ id: `c${i}`, ok: i < passed }));

const review = (over: Partial<VisualReview> = {}): VisualReview => ({
  score: 48,
  criticalIssues: ['typography feels off, headings too large'],
  warnings: ['sections look cramped, needs spacing'],
  strengths: [],
  recommendedFixes: [{ target: 'section:srv1.variant', instruction: 'try another layout' }],
  ...over,
});

describe('runQualityGate', () => {
  it('scores each axis 0..1', () => {
    const { scores } = runQualityGate({
      doc: doc(),
      structuralChecks: checks(8, 10),
      findings: [{ ref: 'x', severity: 'warn', message: 'm' }],
      visual: review({ score: 70 }),
      diversityDistance: 1,
      imageSlots: { filled: 1, total: 2 },
    });
    expect(scores.structural).toBeCloseTo(0.8);
    expect(scores.visual).toBeCloseTo(0.7);
    expect(scores.image).toBeCloseTo(0.5);
    for (const v of Object.values(scores)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('keeps only fixes that point at a real section id, capped at 4', () => {
    const { fixes } = runQualityGate({
      doc: doc(),
      structuralChecks: checks(10, 10),
      findings: [],
      visual: review({
        recommendedFixes: [
          { target: 'section:srv1.copy', instruction: 'a' },
          { target: 'section:ghost.image', instruction: 'b' }, // invalid id
          { target: 'typography', instruction: 'c' },
          { target: 'hero.image', instruction: 'd' },
          { target: 'spacing', instruction: 'e' },
          { target: 'section:srv1.variant', instruction: 'f' },
        ],
      }),
      diversityDistance: 1,
      imageSlots: { filled: 2, total: 2 },
    });
    expect(fixes.length).toBeLessThanOrEqual(4);
    expect(fixes.some((f) => f.target === 'section:ghost.image')).toBe(false);
  });

  it('derives a hero image fix when the image score is low', () => {
    const { fixes } = runQualityGate({
      doc: doc(),
      structuralChecks: checks(10, 10),
      findings: [],
      visual: null,
      diversityDistance: 1,
      imageSlots: { filled: 0, total: 3 },
    });
    expect(fixes.some((f) => f.target === 'section:hero1.image')).toBe(true);
  });

  it('gatePasses only when every axis clears its bar', () => {
    const good: QaScores = { structural: 0.9, content: 0.8, visual: 0.8, image: 0.7, diversity: 1 };
    const bad: QaScores = { ...good, visual: 0.4 };
    expect(gatePasses(good)).toBe(true);
    expect(gatePasses(bad)).toBe(false);
  });
});

describe('applyTargetedFixes', () => {
  it('nudges typography + spacing without touching structure', async () => {
    const d = doc();
    const before = d.pages[0].sections.map((s) => s.type + s.variant).join();
    const { applied } = await applyTargetedFixes({
      doc: d,
      fixes: [
        { target: 'typography', instruction: 't' },
        { target: 'spacing', instruction: 's' },
      ],
      ctx,
      ai: NO_AI,
      dna,
      profile,
      business: { name: 'Acme', services: [] },
      brief: 'b',
      seed: 1,
    });
    expect(d.theme.headingScale).toBe('normal');
    expect(d.theme.density).toBe('comfortable');
    expect(d.pages[0].sections.map((s) => s.type + s.variant).join()).toBe(before);
    expect(applied.length).toBe(2);
  });

  it('re-picks a section variant to a different valid one', async () => {
    const d = doc();
    await applyTargetedFixes({
      doc: d,
      fixes: [{ target: 'section:srv1.variant', instruction: 'x' }],
      ctx,
      ai: NO_AI,
      dna,
      profile,
      business: { name: 'Acme', services: [] },
      brief: 'b',
      seed: 5,
    });
    expect(d.pages[0].sections[1].variant).not.toBe('cards');
  });

  it('rewrites flagged copy via one fixSections call', async () => {
    const d = doc();
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      fixSections: async () => ({ 0: { headline: 'Fundații turnate corect în Cluj' } }),
    };
    const { applied } = await applyTargetedFixes({
      doc: d,
      fixes: [{ target: 'section:hero1.copy', instruction: 'sharper' }],
      ctx,
      ai,
      dna,
      profile,
      business: { name: 'Acme', services: [] },
      brief: 'b',
      seed: 1,
    });
    expect((d.pages[0].sections[0].content as Record<string, unknown>).headline).toContain(
      'Fundații',
    );
    expect(applied.join()).toContain('copy');
  });

  it('re-searches a flagged image slot through the resolver', async () => {
    const d = doc();
    const images: ImageSearchResolver = {
      configured: true,
      resolve: async ({ intents }) => {
        const m = new Map();
        if (intents[0]) {
          m.set(`${intents[0].sectionId}|${intents[0].field}|${intents[0].itemIndex ?? '-'}`, {
            url: 'https://images.pexels.com/photos/7/l.jpg',
            provider: 'pexels',
            photoId: '7',
            alt: 'hero',
          });
        }
        return m;
      },
    };
    const { applied } = await applyTargetedFixes({
      doc: d,
      fixes: [{ target: 'hero.image', instruction: 'stronger' }],
      ctx,
      ai: NO_AI,
      dna,
      profile,
      business: { name: 'Acme', services: [] },
      brief: 'b',
      seed: 2,
      images,
    });
    expect((d.pages[0].sections[0].content as Record<string, unknown>).backgroundImage).toBe(
      'https://images.pexels.com/photos/7/l.jpg',
    );
    expect(applied.join()).toContain('image');
  });
});
