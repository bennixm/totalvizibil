import { refineBrief, serializePageHint } from './brief-refine';
import type { EnrichedBrief, GeneratorAi } from './types';

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

const BRIEF = 'salon de infrumusetare in Cluj, facem manichiura, coafor si cosmetica faciala';

describe('refineBrief — deterministic fallback (no AI)', () => {
  it('passes the brief through byte-identical — never fabricates text', async () => {
    const out = await refineBrief(NO_AI, {
      brief: BRIEF,
      business: { name: 'Salon X', services: ['manichiură', 'coafor'] },
      locale: 'ro',
    });
    expect(out.brief).toBe(BRIEF);
    expect(out.emphasize).toEqual([]);
    expect(out.clarifications).toEqual([]);
  });

  it('suggests a real, non-empty page split from the classified archetype', async () => {
    const out = await refineBrief(NO_AI, {
      brief: BRIEF,
      business: { name: 'Salon X', services: [] },
      locale: 'ro',
    });
    expect(out.suggestedPages.length).toBeGreaterThan(0);
    for (const p of out.suggestedPages) {
      expect(p.title.trim().length).toBeGreaterThan(0);
      expect(p.purpose.trim().length).toBeGreaterThan(0);
    }
  });

  it('different archetypes get different page hints', async () => {
    const salon = await refineBrief(NO_AI, {
      brief: 'salon de infrumusetare',
      business: { name: 'x', type: 'salon coafură', services: [] },
      locale: 'ro',
    });
    const lawyer = await refineBrief(NO_AI, {
      brief: 'cabinet de avocatură',
      business: { name: 'y', type: 'cabinet avocatură', services: [] },
      locale: 'ro',
    });
    expect(salon.suggestedPages.map((p) => p.title)).not.toEqual(
      lawyer.suggestedPages.map((p) => p.title),
    );
  });
});

describe('refineBrief — with AI', () => {
  it('uses the AI brief/pages/emphasis when present', async () => {
    const enriched: Partial<EnrichedBrief> = {
      brief: 'Un brief mult mai detaliat.',
      suggestedPages: [{ title: 'Servicii', purpose: 'detaliu' }],
      emphasize: ['trei servicii, un salon'],
      clarifications: ['nu s-au inventat ani de experiență'],
    };
    const ai: GeneratorAi = { ...NO_AI, configured: true, refineBrief: async () => enriched };
    const out = await refineBrief(ai, {
      brief: BRIEF,
      business: { name: 'Salon X', services: [] },
      locale: 'ro',
    });
    expect(out.brief).toBe('Un brief mult mai detaliat.');
    expect(out.suggestedPages).toEqual([{ title: 'Servicii', purpose: 'detaliu' }]);
    expect(out.emphasize).toEqual(['trei servicii, un salon']);
    expect(out.clarifications).toEqual(['nu s-au inventat ani de experiență']);
  });

  it('falls back field-by-field when the AI response is partial', async () => {
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      refineBrief: async () => ({ emphasize: ['x'] }), // no brief, no pages
    };
    const out = await refineBrief(ai, {
      brief: BRIEF,
      business: { name: 'Salon X', services: [] },
      locale: 'ro',
    });
    expect(out.brief).toBe(BRIEF); // fell back
    expect(out.suggestedPages.length).toBeGreaterThan(0); // fell back
    expect(out.emphasize).toEqual(['x']); // used
  });

  it('falls back entirely when the AI call fails', async () => {
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      refineBrief: async () => {
        throw new Error('timeout');
      },
    };
    const out = await refineBrief(ai, {
      brief: BRIEF,
      business: { name: 'Salon X', services: [] },
      locale: 'ro',
    });
    expect(out.brief).toBe(BRIEF);
  });

  it('skips the AI call entirely for an already-detailed brief (cost control)', async () => {
    const longBrief = 'A'.repeat(400); // over the 350-char threshold
    let called = false;
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      refineBrief: async () => {
        called = true;
        return { brief: 'should never be used' };
      },
    };
    const out = await refineBrief(ai, {
      brief: longBrief,
      business: { name: 'Salon X', services: [] },
      locale: 'ro',
    });
    expect(called).toBe(false);
    expect(out.brief).toBe(longBrief);
  });

  it('still calls the AI for a short brief, right at the threshold', async () => {
    const shortBrief = 'A'.repeat(300); // under the 350-char threshold
    let called = false;
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      refineBrief: async () => {
        called = true;
        return { brief: 'enriched version' };
      },
    };
    const out = await refineBrief(ai, {
      brief: shortBrief,
      business: { name: 'Salon X', services: [] },
      locale: 'ro',
    });
    expect(called).toBe(true);
    expect(out.brief).toBe('enriched version');
  });
});

describe('serializePageHint', () => {
  it('formats a compact "Title (purpose); Title (purpose)" line', () => {
    expect(
      serializePageHint([
        { title: 'Servicii', purpose: 'detaliu pe categorii' },
        { title: 'Contact', purpose: 'date de contact' },
      ]),
    ).toBe('Servicii (detaliu pe categorii); Contact (date de contact)');
  });

  it('is empty for an empty list', () => {
    expect(serializePageHint([])).toBe('');
  });
});
