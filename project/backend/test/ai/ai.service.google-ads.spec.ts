import { AiService, estimateClaudeCostMinor } from 'src/ai/ai.service';

/**
 * The Google Ads agent (docs/ai/GOOGLE-ADS-AGENT-PLAN.md) methods on
 * `AiService` do real parsing/validation of whatever Claude returns (length
 * caps, minimum counts, slug/number sanitization) before any of it reaches
 * a Google Ads mutate call or an admin approval queue — this is what these
 * tests pin down. The real Anthropic SDK is never called: `anthropic` is
 * swapped for a fake transport after construction, same idea as every other
 * fake in this repo, just reaching past a `readonly` TS field (which is not
 * enforced at runtime) instead of a constructor arg.
 */
function fakeConfig(apiKey: string) {
  return {
    get: (key: string) => {
      if (key === 'anthropicApiKey') return apiKey;
      if (key === 'anthropicModel') return 'claude-opus-5';
      if (key === 'anthropicModelFast') return 'claude-sonnet-5';
      return '';
    },
  } as never;
}

function withFakeTransport(svc: AiService, responseText: string) {
  const create = jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: responseText }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 500, output_tokens: 500 },
  });
  (svc as any).anthropic = { messages: { create } };
  return create;
}

describe('AiService.googleAdsKeywordPlan', () => {
  it('returns null when Claude is not configured', async () => {
    const svc = new AiService(fakeConfig(''));
    const result = await svc.googleAdsKeywordPlan({
      categoryName: 'Electricieni',
      landingUrl: 'https://totalvizibil.ro/constructii/electricieni',
      businessNames: [],
    });
    expect(result).toBeNull();
  });

  it('parses a valid plan and enforces length caps', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    withFakeTransport(
      svc,
      JSON.stringify({
        keywords: ['electrician bucuresti', 'reparatii electrice', 'instalatii electrice'],
        headlines: ['Electricieni verificați', 'Programează rapid', 'Firme locale', 'a'.repeat(31)],
        descriptions: ['Găsește un electrician de încredere lângă tine.', 'Comparații rapide.'],
      }),
    );

    const result = await svc.googleAdsKeywordPlan({
      categoryName: 'Electricieni',
      parentCategoryName: 'Construcții',
      landingUrl: 'https://totalvizibil.ro/constructii/electricieni',
      businessNames: ['Firma A', 'Firma B'],
    });

    expect(result).not.toBeNull();
    expect(result!.keywords).toHaveLength(3);
    // The 31-char headline must be dropped, the 3 valid ones kept.
    expect(result!.headlines).toHaveLength(3);
    expect(result!.headlines.every((h) => h.length <= 30)).toBe(true);
    expect(result!.descriptions).toHaveLength(2);
    expect(result!.costEstimateMinor).toBe(1); // 500 in + 500 out tokens, Sonnet-tier rates
  });

  it('returns null when under the Responsive Search Ad minimums', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    withFakeTransport(
      svc,
      JSON.stringify({
        keywords: ['electrician bucuresti', 'reparatii electrice', 'instalatii electrice'],
        headlines: ['Doar un titlu', 'Al doilea'], // only 2 — RSA needs >= 3
        descriptions: ['O singură descriere.'], // only 1 — needs >= 2
      }),
    );

    const result = await svc.googleAdsKeywordPlan({
      categoryName: 'Electricieni',
      landingUrl: 'https://totalvizibil.ro/constructii/electricieni',
      businessNames: [],
    });
    expect(result).toBeNull();
  });

  it('returns null when Claude returns unparseable output', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    withFakeTransport(svc, 'not json at all');
    const result = await svc.googleAdsKeywordPlan({
      categoryName: 'Electricieni',
      landingUrl: 'https://totalvizibil.ro/constructii/electricieni',
      businessNames: [],
    });
    expect(result).toBeNull();
  });
});

describe('AiService.googleAdsBudgetIntelligence', () => {
  const SIGNAL = {
    categorySlug: 'electricieni',
    categoryName: 'Electricieni',
    activeCompanyCount: 5,
    currentDailyBudgetCredits: 5,
    currentMaxCpcCredits: 1,
  };

  it('returns null when Claude is not configured', async () => {
    const svc = new AiService(fakeConfig(''));
    const result = await svc.googleAdsBudgetIntelligence({
      signals: [SIGNAL],
      feedCpcFloorCredits: 1,
      maxDailyBudgetCapCredits: 50,
      maxCpcCapCredits: 5,
    });
    expect(result).toBeNull();
  });

  it('returns null when there are no signals (nothing to batch)', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    const result = await svc.googleAdsBudgetIntelligence({
      signals: [],
      feedCpcFloorCredits: 1,
      maxDailyBudgetCapCredits: 50,
      maxCpcCapCredits: 5,
    });
    expect(result).toBeNull();
  });

  it('keeps only proposals for known slugs with valid positive numbers', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    withFakeTransport(
      svc,
      JSON.stringify({
        proposals: [
          {
            categorySlug: 'electricieni',
            proposedDailyBudgetCredits: 8,
            proposedMaxCpcCredits: 1.5,
            reasoning: 'Cerere în creștere.',
          },
          { categorySlug: 'nu-exista', proposedDailyBudgetCredits: 100, proposedMaxCpcCredits: 10 },
          {
            categorySlug: 'electricieni',
            proposedDailyBudgetCredits: -5,
            proposedMaxCpcCredits: 1,
          },
        ],
      }),
    );

    const result = await svc.googleAdsBudgetIntelligence({
      signals: [SIGNAL],
      feedCpcFloorCredits: 1,
      maxDailyBudgetCapCredits: 50,
      maxCpcCapCredits: 5,
    });

    expect(result).toEqual({
      proposals: [
        {
          categorySlug: 'electricieni',
          proposedDailyBudgetCredits: 8,
          proposedMaxCpcCredits: 1.5,
          reasoning: 'Cerere în creștere.',
        },
      ],
      costEstimateMinor: 1,
      inputTokens: 500,
      outputTokens: 500,
      model: 'claude-sonnet-5',
    });
  });
});

describe('estimateClaudeCostMinor', () => {
  it('prices input/output tokens at the Sonnet-tier rate ($2/$10 per MTok)', () => {
    // 1,000,000 input + 1,000,000 output => $2 + $10 = $12 => 1200 minor units.
    expect(estimateClaudeCostMinor({ input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(
      1200,
    );
  });

  it('rounds to the nearest minor unit', () => {
    expect(estimateClaudeCostMinor({ input_tokens: 0, output_tokens: 0 })).toBe(0);
    expect(estimateClaudeCostMinor({ input_tokens: 500, output_tokens: 500 })).toBe(1);
  });
});
