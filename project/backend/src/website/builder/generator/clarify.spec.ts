import {
  AI_CLARIFY_MAX_TURNS,
  clarifyTurn,
  formatClarifyContext,
  resolveClarifiedPages,
  type ClarifyState,
} from './clarify';
import type { ClarifyQuestion, GeneratorAi } from './types';

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

const business = { name: 'BuildCo', type: 'construcții', services: ['case la cheie'] };

const DESIGN_QUESTION: ClarifyQuestion = {
  id: 'design',
  kind: 'choice',
  prompt: 'Ce stil vizual preferi?',
  options: [
    { id: 'modern', label: 'Modern & minimalist' },
    { id: 'warm', label: 'Cald & primitor' },
    { id: 'ai', label: 'Las AI să aleagă' },
  ],
};

describe('clarifyTurn', () => {
  it('returns done:true without any AI call when the AI is not configured', async () => {
    const res = await clarifyTurn(NO_AI, {
      brief: 'firmă de construcții',
      business,
      locale: 'ro',
      answers: [],
      turnsSoFar: 0,
    });
    expect(res).toEqual({ done: true, questions: [] });
  });

  it('skips clarification for an already-detailed brief, even with AI configured', async () => {
    let called = false;
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      clarifyBrief: async () => {
        called = true;
        return { done: false, questions: [DESIGN_QUESTION] };
      },
    };
    const longBrief = 'x'.repeat(400);
    const res = await clarifyTurn(ai, {
      brief: longBrief,
      business,
      locale: 'ro',
      answers: [],
      turnsSoFar: 0,
    });
    expect(called).toBe(false);
    expect(res).toEqual({ done: true, questions: [] });
  });

  it('surfaces valid questions from the AI, capped and de-duplicated', async () => {
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      clarifyBrief: async () => ({
        done: false,
        questions: [
          DESIGN_QUESTION,
          DESIGN_QUESTION, // duplicate id — must be dropped
          { id: 'city', kind: 'text', prompt: 'În ce oraș activați?' },
          { id: 'bad-choice', kind: 'choice', prompt: 'Alege', options: [{ id: 'a', label: 'A' }] }, // <2 options — dropped
          { id: 'q4', kind: 'text', prompt: 'a' },
          { id: 'q5', kind: 'text', prompt: 'b' },
          { id: 'q6', kind: 'text', prompt: 'c' }, // beyond the 4-question cap — dropped
        ],
      }),
    };
    const res = await clarifyTurn(ai, {
      brief: 'salon scurt',
      business,
      locale: 'ro',
      answers: [],
      turnsSoFar: 0,
    });
    expect(res.done).toBe(false);
    expect(res.questions.map((q) => q.id)).toEqual(['design', 'city', 'q4', 'q5']);
  });

  it('treats a null/failed AI call as "no clarification needed"', async () => {
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      clarifyBrief: async () => {
        throw new Error('boom');
      },
    };
    const res = await clarifyTurn(ai, {
      brief: 'salon scurt',
      business,
      locale: 'ro',
      answers: [],
      turnsSoFar: 0,
    });
    expect(res).toEqual({ done: true, questions: [] });
  });

  it('never starts another turn once the turn cap is reached', async () => {
    let called = false;
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      clarifyBrief: async () => {
        called = true;
        return { done: false, questions: [DESIGN_QUESTION] };
      },
    };
    const res = await clarifyTurn(ai, {
      brief: 'salon scurt',
      business,
      locale: 'ro',
      answers: [],
      turnsSoFar: AI_CLARIFY_MAX_TURNS,
    });
    expect(called).toBe(false);
    expect(res).toEqual({ done: true, questions: [] });
  });

  it('passes accumulated answers through to the AI call on a later turn', async () => {
    let seenAnswers: unknown;
    const ai: GeneratorAi = {
      ...NO_AI,
      configured: true,
      clarifyBrief: async (i) => {
        seenAnswers = i.answers;
        return { done: true };
      },
    };
    await clarifyTurn(ai, {
      brief: 'salon scurt',
      business,
      locale: 'ro',
      answers: [{ questionId: 'design', value: 'modern' }],
      turnsSoFar: 1,
    });
    expect(seenAnswers).toEqual([{ questionId: 'design', value: 'modern' }]);
  });
});

const PAGES_QUESTION: ClarifyQuestion = {
  id: 'pages',
  kind: 'choice',
  prompt: 'Ce structură de pagini vrei?',
  options: [
    {
      id: 'full',
      label: 'Structură completă (Acasă, Despre, Servicii, Galerie, Contact)',
      pages: [
        { title: 'Acasă', purpose: 'overview' },
        { title: 'Despre', purpose: 'story' },
        { title: 'Servicii', purpose: 'offer' },
        { title: 'Galerie', purpose: 'proof' },
        { title: 'Contact', purpose: 'contact' },
      ],
    },
    { id: 'ai_decide', label: 'Las AI să decidă' },
  ],
};

describe('formatClarifyContext', () => {
  it('drops any answer that resolved to the "ai_decide" option (no info, and pollutes the brief)', () => {
    const state: ClarifyState = {
      brief: 'x',
      done: true,
      turnsSoFar: 1,
      answers: [
        { questionId: 'pages', value: PAGES_QUESTION.options![0].label },
        { questionId: 'design', value: DESIGN_QUESTION.options![2].label }, // DESIGN_QUESTION's "ai" id, not "ai_decide" — kept
      ],
      askedQuestions: [PAGES_QUESTION, DESIGN_QUESTION],
    };
    const ctx = formatClarifyContext(state);
    expect(ctx).toContain('Structură completă');
    // DESIGN_QUESTION's "let AI decide" option uses a non-"ai_decide" id in this
    // fixture on purpose — only the exact "ai_decide" id is filtered.
    expect(ctx).toContain('Las AI să aleagă');
  });

  it('actually filters out an "ai_decide"-resolved answer', () => {
    const state: ClarifyState = {
      brief: 'x',
      done: true,
      turnsSoFar: 1,
      answers: [{ questionId: 'pages', value: 'Las AI să decidă' }],
      askedQuestions: [PAGES_QUESTION],
    };
    expect(formatClarifyContext(state)).toBe('');
  });

  it('returns empty until the round is actually done', () => {
    const state: ClarifyState = {
      brief: 'x',
      done: false,
      turnsSoFar: 1,
      answers: [{ questionId: 'pages', value: 'Las AI să decidă' }],
      askedQuestions: [PAGES_QUESTION],
    };
    expect(formatClarifyContext(state)).toBe('');
  });
});

describe('resolveClarifiedPages', () => {
  it('returns the structured pages from the chosen option', () => {
    const state: ClarifyState = {
      brief: 'x',
      done: true,
      turnsSoFar: 1,
      answers: [{ questionId: 'pages', value: PAGES_QUESTION.options![0].label }],
      askedQuestions: [PAGES_QUESTION],
    };
    expect(resolveClarifiedPages(state)).toEqual(PAGES_QUESTION.options![0].pages);
  });

  it('returns undefined when the client let the AI decide', () => {
    const state: ClarifyState = {
      brief: 'x',
      done: true,
      turnsSoFar: 1,
      answers: [{ questionId: 'pages', value: 'Las AI să decidă' }],
      askedQuestions: [PAGES_QUESTION],
    };
    expect(resolveClarifiedPages(state)).toBeUndefined();
  });

  it('returns undefined when no question carried a page structure at all', () => {
    const state: ClarifyState = {
      brief: 'x',
      done: true,
      turnsSoFar: 1,
      answers: [{ questionId: 'design', value: DESIGN_QUESTION.options![0].label }],
      askedQuestions: [DESIGN_QUESTION],
    };
    expect(resolveClarifiedPages(state)).toBeUndefined();
  });
});
