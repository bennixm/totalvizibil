import { DeepSeekProvider } from './deepseek.provider';
import type { AgentCallParams } from './provider.types';

/**
 * There is no DEEPSEEK_API_KEY in this environment, so none of this can be
 * checked against the real API — these tests verify the request/response
 * TRANSLATION is correct against a mocked `fetch`, per DeepSeek's publicly
 * documented OpenAI-compatible format. Real-world behavior is unverified.
 */
function fakeConfig(apiKey: string) {
  return { get: () => apiKey } as never;
}

describe('DeepSeekProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is not configured without an API key, and never calls fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new DeepSeekProvider(fakeConfig(''));
    expect(provider.configured).toBe(false);
    const result = await provider.agentMessage({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      model: 'deepseek-chat',
      maxTokens: 100,
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('translates Anthropic-shaped tools/messages into OpenAI format in the request body', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    } as Response);

    const provider = new DeepSeekProvider(fakeConfig('sk-test'));
    const params: AgentCallParams = {
      system: 'You are PRO.',
      messages: [{ role: 'user', content: 'Add a hero section' }],
      tools: [
        {
          name: 'write_file',
          description: 'Write a file',
          input_schema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
      model: 'deepseek-chat',
      maxTokens: 4096,
    };
    await provider.agentMessage(params);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('deepseek-chat');
    expect(body.stream).toBe(false);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are PRO.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Add a hero section' });
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    });
  });

  it('converts a tool_use response into normalized tool_use content with parsed input', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: '{"path":"src/App.vue","content":"<template></template>"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 20, prompt_cache_hit_tokens: 5 },
      }),
    } as Response);

    const provider = new DeepSeekProvider(fakeConfig('sk-test'));
    const result = await provider.agentMessage({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      model: 'deepseek-chat',
      maxTokens: 100,
    });

    expect(result).not.toBeNull();
    expect(result?.stop_reason).toBe('tool_use');
    expect(result?.content).toEqual([
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'write_file',
        input: { path: 'src/App.vue', content: '<template></template>' },
      },
    ]);
    expect(result?.usage).toEqual({
      input_tokens: 50,
      output_tokens: 20,
      cache_read_input_tokens: 5,
    });
  });

  it('bundles multiple Anthropic tool_result blocks into separate OpenAI "tool" messages', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: {},
      }),
    } as Response);

    const provider = new DeepSeekProvider(fakeConfig('sk-test'));
    await provider.agentMessage({
      system: 'sys',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a.vue' } },
            { type: 'tool_use', id: 'c2', name: 'read_file', input: { path: 'b.vue' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'c1', content: 'content of a', is_error: false },
            { type: 'tool_result', tool_use_id: 'c2', content: 'content of b', is_error: false },
          ],
        },
      ],
      tools: [],
      model: 'deepseek-chat',
      maxTokens: 100,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    // system + assistant(with 2 tool_calls) + 2 separate tool messages
    expect(body.messages).toHaveLength(4);
    expect(body.messages[1].tool_calls).toHaveLength(2);
    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'content of a' });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c2', content: 'content of b' });
  });

  it('returns null (not throw) on a non-OK HTTP response, so the router can escalate', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid api key',
    } as Response);
    const provider = new DeepSeekProvider(fakeConfig('sk-bad'));
    const result = await provider.agentMessage({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      model: 'deepseek-chat',
      maxTokens: 100,
    });
    expect(result).toBeNull();
  });

  it('returns null (not throw) on a network failure', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const provider = new DeepSeekProvider(fakeConfig('sk-test'));
    const result = await provider.agentMessage({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      model: 'deepseek-chat',
      maxTokens: 100,
    });
    expect(result).toBeNull();
  });
});
