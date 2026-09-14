import { Injectable } from '@nestjs/common';
import { AiService } from './ai.service';
import type { AgentCallParams, AgentCallResult, AiProvider } from './provider.types';

/** Thin adapter over the EXISTING `AiService` — no second Claude client. */
@Injectable()
export class ClaudeProvider implements AiProvider {
  readonly name = 'claude' as const;

  constructor(private readonly ai: AiService) {}

  get configured(): boolean {
    return this.ai.configured;
  }

  async agentMessage(params: AgentCallParams): Promise<AgentCallResult | null> {
    const res = await this.ai.agentMessage(params);
    if (!res) return null;
    return {
      content: res.content.flatMap((b): AgentCallResult['content'] => {
        if (b.type === 'text') return [{ type: 'text', text: b.text }];
        if (b.type === 'tool_use') {
          return [{ type: 'tool_use', id: b.id, name: b.name, input: b.input }];
        }
        return [];
      }),
      stop_reason: res.stop_reason,
      usage: {
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        cache_read_input_tokens: res.usage.cache_read_input_tokens,
      },
    };
  }
}
