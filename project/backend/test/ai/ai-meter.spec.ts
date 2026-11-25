import { AiService } from 'src/ai/ai.service';

describe('AiService.meter', () => {
  it('reports the usage of calls made inside it, unusable answers included', async () => {
    const svc = new AiService({ get: () => '' } as any) as any;
    svc.anthropic = {
      messages: {
        create: jest.fn(async () => ({
          model: 'claude-sonnet-5',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'not json' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        })),
      },
    };
    const seen: unknown[] = [];
    const call = () => svc.anthropicJsonWithUsage('s', 'u', { maxTokens: 10 });
    await svc.meter(
      (model: string, u: { input_tokens: number }) => seen.push([model, u.input_tokens]),
      call,
    );
    await call(); // outside
    expect(seen).toEqual([['claude-sonnet-5', 10]]);
  });
});
