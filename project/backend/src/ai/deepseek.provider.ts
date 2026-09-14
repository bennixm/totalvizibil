/**
 * Real DeepSeek client — OpenAI-compatible Chat Completions API
 * (https://api-docs.deepseek.com). Never streams (V2 has no streaming infra).
 * Does the full request/response translation to/from the agent loop's
 * Anthropic-shaped `AgentCallParams`/`AgentCallResult` at its own edges, so
 * nothing outside this file needs to know DeepSeek's wire format.
 *
 * NOTE: this has never been exercised against the real API in this codebase
 * — there is no DEEPSEEK_API_KEY configured in this environment. It is
 * written against DeepSeek's public documentation and unit-tested against a
 * mocked HTTP response, but its real-world behavior is unverified. See the
 * PRO V2 cost-optimization report.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config/env';
import type { AgentCallParams, AgentCallResult, AiProvider } from './provider.types';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEFAULT_TIMEOUT_MS = 45_000;

interface OaiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
interface OaiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
}

function toOpenAiTools(tools: Anthropic.Tool[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function toolResultText(content: Anthropic.ToolResultBlockParam['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .filter(Boolean)
    .join('\n');
}

/** Anthropic bundles multiple tool results into ONE user-role message with
 *  several content blocks; OpenAI's format wants one `role: 'tool'` message
 *  PER result instead. */
function toOpenAiMessages(system: string, messages: Anthropic.MessageParam[]): OaiMessage[] {
  const out: OaiMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) continue;

    if (m.role === 'assistant') {
      const textParts: string[] = [];
      const toolCalls: OaiToolCall[] = [];
      for (const block of m.content) {
        if (block.type === 'text') textParts.push(block.text);
        else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          });
        }
      }
      out.push({
        role: 'assistant',
        content: textParts.length ? textParts.join('\n') : null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // role === 'user' with block content in this loop is always tool_results.
    for (const block of m.content) {
      if (block.type !== 'tool_result') continue;
      out.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: toolResultText(block.content) || (block.is_error ? 'Error' : 'OK'),
      });
    }
  }
  return out;
}

function fromOpenAiResponse(body: {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OaiToolCall[] };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
  };
}): AgentCallResult {
  const choice = body.choices?.[0];
  const message = choice?.message ?? {};
  const content: AgentCallResult['content'] = [];
  if (typeof message.content === 'string' && message.content.trim()) {
    content.push({ type: 'text', text: message.content });
  }
  for (const tc of message.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tc.function?.arguments || '{}') as Record<string, unknown>;
    } catch {
      input = {};
    }
    content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name ?? '', input });
  }
  return {
    content,
    stop_reason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    usage: {
      input_tokens: body.usage?.prompt_tokens ?? 0,
      output_tokens: body.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: body.usage?.prompt_cache_hit_tokens ?? 0,
    },
  };
}

@Injectable()
export class DeepSeekProvider implements AiProvider {
  readonly name = 'deepseek' as const;
  private readonly logger = new Logger(DeepSeekProvider.name);
  private readonly apiKey: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.apiKey = config.get('deepseekApiKey', { infer: true });
  }

  get configured(): boolean {
    return !!this.apiKey;
  }

  async agentMessage(params: AgentCallParams): Promise<AgentCallResult | null> {
    if (!this.apiKey) return null;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          messages: toOpenAiMessages(params.system, params.messages),
          tools: toOpenAiTools(params.tools),
          max_tokens: params.maxTokens,
          stream: false,
        }),
        signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(
          `DeepSeek call failed: HTTP ${res.status} ${await res.text().catch(() => '')}`,
        );
        return null;
      }
      const body = (await res.json()) as Parameters<typeof fromOpenAiResponse>[0];
      return fromOpenAiResponse(body);
    } catch (err) {
      this.logger.warn(`DeepSeek call failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
