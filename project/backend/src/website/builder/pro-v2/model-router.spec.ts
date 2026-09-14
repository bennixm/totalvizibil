import {
  classifyTask,
  initialTier,
  nextTier,
  tierForRepairAttempt,
  ModelRouter,
} from './model-router';
import type { AiProvider } from '../../../ai/provider.types';

describe('classifyTask', () => {
  it('always classifies a repair report as "repair", regardless of content', () => {
    expect(classifyTask({ isFirstMessage: false, isRepair: true, userContent: 'anything' })).toBe(
      'repair',
    );
  });

  it('always classifies the first message as "initial_generation"', () => {
    expect(
      classifyTask({ isFirstMessage: true, isRepair: false, userContent: 'rename the button' }),
    ).toBe('initial_generation');
  });

  it('classifies a short, clearly simple edit as "simple_edit"', () => {
    expect(
      classifyTask({
        isFirstMessage: false,
        isRepair: false,
        userContent: 'Rename the CTA button to "Start now"',
      }),
    ).toBe('simple_edit');
  });

  it('falls through to "multi_file" for anything not clearly simple', () => {
    expect(
      classifyTask({
        isFirstMessage: false,
        isRepair: false,
        userContent: 'Add a full pricing section with 3 plans and a comparison table',
      }),
    ).toBe('multi_file');
  });

  it('does not misclassify a long message as simple even if it contains a simple-edit keyword', () => {
    const longMessage = `Rename the button, but also ${'add a whole new section '.repeat(10)}`;
    expect(classifyTask({ isFirstMessage: false, isRepair: false, userContent: longMessage })).toBe(
      'multi_file',
    );
  });
});

describe('tier ladders', () => {
  it('pins initial generation and review to claude, never DeepSeek', () => {
    expect(initialTier('initial_generation')).toBe('claude');
    expect(initialTier('review')).toBe('claude');
  });

  it('starts simple edits, multi-file work and repairs on the cheapest tier', () => {
    expect(initialTier('simple_edit')).toBe('deepseek-flash');
    expect(initialTier('multi_file')).toBe('deepseek-flash');
    expect(initialTier('repair')).toBe('deepseek-flash');
  });

  it('escalates flash -> pro -> claude, and claude has no further tier', () => {
    expect(nextTier('deepseek-flash')).toBe('deepseek-pro');
    expect(nextTier('deepseek-pro')).toBe('claude');
    expect(nextTier('claude')).toBe('claude');
  });

  it('maps repair attempt number to the matching tier', () => {
    expect(tierForRepairAttempt(1)).toBe('deepseek-flash');
    expect(tierForRepairAttempt(2)).toBe('deepseek-pro');
    expect(tierForRepairAttempt(3)).toBe('claude');
    expect(tierForRepairAttempt(99)).toBe('claude'); // never escalates past claude
  });
});

describe('ModelRouter', () => {
  function fakeProvider(name: 'claude' | 'deepseek', configured: boolean): AiProvider {
    return { name, configured, agentMessage: jest.fn(async () => null) };
  }
  function fakeConfig() {
    const values: Record<string, unknown> = {
      anthropicModel: 'claude-sonnet-5',
      deepseekModelFlash: 'deepseek-chat',
      deepseekModelPro: 'deepseek-reasoner',
    };
    return { get: (key: string) => values[key] } as never;
  }

  it('resolves a DeepSeek tier to DeepSeek when it is configured', () => {
    const router = new ModelRouter(
      fakeProvider('claude', true) as never,
      fakeProvider('deepseek', true) as never,
      fakeConfig(),
    );
    const route = router.resolve('deepseek-flash');
    expect(route.provider.name).toBe('deepseek');
    expect(route.model).toBe('deepseek-chat');
    expect(route.fellBackToClaudeUnconfigured).toBe(false);
  });

  it('gracefully falls back to Claude when DeepSeek is not configured, flagging the fallback', () => {
    const router = new ModelRouter(
      fakeProvider('claude', true) as never,
      fakeProvider('deepseek', false) as never,
      fakeConfig(),
    );
    const route = router.resolve('deepseek-pro');
    expect(route.provider.name).toBe('claude');
    expect(route.tier).toBe('claude');
    expect(route.fellBackToClaudeUnconfigured).toBe(true);
  });

  it('resolveInitial / resolveNext / resolveForRepairAttempt compose the pure functions correctly', () => {
    const router = new ModelRouter(
      fakeProvider('claude', true) as never,
      fakeProvider('deepseek', true) as never,
      fakeConfig(),
    );
    expect(router.resolveInitial('initial_generation').tier).toBe('claude');
    expect(router.resolveInitial('simple_edit').tier).toBe('deepseek-flash');
    expect(router.resolveNext('deepseek-flash').tier).toBe('deepseek-pro');
    expect(router.resolveForRepairAttempt(3).tier).toBe('claude');
  });
});
