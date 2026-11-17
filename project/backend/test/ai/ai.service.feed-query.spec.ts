import { AiService } from 'src/ai/ai.service';

/** `AiService.interpretFeedQuery` — the homepage "ask" box's AI read. Same
 *  fake-transport approach as `ai.service.easy-intro.spec.ts`. */
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
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  (svc as any).anthropic = { messages: { create } };
  return create;
}

const INPUT = {
  text: 'unde gasesc un instalator in Cluj?',
  locale: 'ro' as const,
  catalog:
    'instalatii | Instalații | Installations\n  instalatii-sanitare | Instalații sanitare | Plumbing',
  counties: ['Cluj', 'București'],
};

describe('AiService.interpretFeedQuery', () => {
  it('returns null when Claude is not configured', async () => {
    const svc = new AiService(fakeConfig(''));
    await expect(svc.interpretFeedQuery(INPUT)).resolves.toBeNull();
  });

  it('returns null for an empty or oversized request without calling Claude', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    const create = withFakeTransport(svc, '{}');
    await expect(svc.interpretFeedQuery({ ...INPUT, text: ' ' })).resolves.toBeNull();
    await expect(svc.interpretFeedQuery({ ...INPUT, text: 'x'.repeat(301) })).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('puts the catalog in a prompt-cached system block and only the request in the user turn', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    const create = withFakeTransport(svc, '{"group":null,"niches":[],"counties":[],"cities":[]}');
    await svc.interpretFeedQuery(INPUT);

    const params = create.mock.calls[0][0];
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(params.system[0].text).toContain('instalatii-sanitare');
    expect(params.system[0].text).toContain('COUNTIES: Cluj, București');
    expect(params.messages[0].content).toContain(INPUT.text);
    expect(params.messages[0].content).not.toContain('instalatii-sanitare');
  });

  it('runs on the cheap feed model (Haiku by default), not the builder models', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    const create = withFakeTransport(svc, '{"group":null}');
    await svc.interpretFeedQuery(INPUT);
    expect(create.mock.calls[0][0].model).toBe('claude-haiku-5-5');
  });

  it('shape-checks the reply: caps lists, drops non-strings, keeps raw picks for the caller to whitelist', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    withFakeTransport(
      svc,
      JSON.stringify({
        group: 'instalatii',
        niches: ['instalatii-sanitare', 42, 'a', 'b', 'c'],
        counties: ['Cluj'],
        cities: ['Cluj-Napoca'],
      }),
    );

    const out = await svc.interpretFeedQuery(INPUT);

    expect(out).toEqual({
      group: 'instalatii',
      niches: ['instalatii-sanitare', 'a', 'b'],
      counties: ['Cluj'],
      cities: ['Cluj-Napoca'],
    });
  });

  it('treats a missing/blank group as null', async () => {
    const svc = new AiService(fakeConfig('test-key'));
    withFakeTransport(svc, '{"group":"  ","niches":"nope"}');

    await expect(svc.interpretFeedQuery(INPUT)).resolves.toEqual({
      group: null,
      niches: [],
      counties: [],
      cities: [],
    });
  });
});
