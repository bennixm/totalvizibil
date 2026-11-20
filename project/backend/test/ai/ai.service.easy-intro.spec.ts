import { AiService } from 'src/ai/ai.service';

/**
 * `AiService.parseIntro` — Site Simplu's immediate, cheap read of the
 * visitor's very first message, so the preview never shows the raw sentence
 * as the business name (see `website-draft.service.ts`'s `applyParsedIntro`).
 * Same fake-transport approach as `ai.service.google-ads.spec.ts`: the real
 * Anthropic SDK is never called.
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
    usage: { input_tokens: 100, output_tokens: 100 },
  });
  (svc as any).anthropic = { messages: { create } };
  return create;
}

describe('AiService.parseIntro', () => {
  it('returns null when Claude is not configured', async () => {
    const svc = new AiService(fakeConfig(''));
    const result = await svc.parseIntro({ rawIntro: 'AquaFix, instalatii din Cluj', locale: 'ro' });
    expect(result).toBeNull();
  });

  it('returns null for an empty or oversized intro, without calling Claude', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    const create = withFakeTransport(svc, '{}');
    await expect(svc.parseIntro({ rawIntro: '', locale: 'ro' })).resolves.toBeNull();
    await expect(svc.parseIntro({ rawIntro: 'x'.repeat(501), locale: 'ro' })).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('parses a valid reply and clamps/validates every field', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    withFakeTransport(
      svc,
      JSON.stringify({
        companyName: 'AquaFix SRL',
        businessType: 'instalații sanitare',
        city: 'Cluj-Napoca',
        landingTitle: 'Instalatori de încredere în Cluj',
        tone: 'professional',
      }),
    );

    const result = await svc.parseIntro({
      rawIntro: 'sunt aquafix, facem instalatii sanitare in cluj',
      locale: 'ro',
    });

    expect(result).toEqual({
      isIntro: true,
      companyName: 'AquaFix SRL',
      businessType: 'instalații sanitare',
      city: 'Cluj-Napoca',
      landingTitle: 'Instalatori de încredere în Cluj',
      tone: 'professional',
    });
  });

  it('reports a message that is not an intro at all', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    withFakeTransport(svc, JSON.stringify({ isIntro: false }));
    const result = await svc.parseIntro({ rawIntro: 'salut, ce faci?', locale: 'ro' });
    expect(result).toEqual({ isIntro: false });
  });

  it('drops an unrecognised tone value instead of passing it through', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    withFakeTransport(
      svc,
      JSON.stringify({ companyName: 'AquaFix', tone: 'enthusiastic-but-not-a-real-bucket' }),
    );

    const result = await svc.parseIntro({ rawIntro: 'AquaFix, instalatii', locale: 'ro' });

    expect(result?.companyName).toBe('AquaFix');
    expect(result?.tone).toBeUndefined();
  });

  it('returns null when every field comes back empty', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    withFakeTransport(svc, JSON.stringify({}));

    const result = await svc.parseIntro({ rawIntro: 'AquaFix, instalatii', locale: 'ro' });

    expect(result).toBeNull();
  });
});
