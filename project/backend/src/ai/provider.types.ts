/**
 * Normalized provider abstraction for PRO V2's model router. Both providers
 * speak the SAME shape as `AiService.agentMessage` already uses (Anthropic's
 * tool-use format) — that's the agent loop's existing "lingua franca", not a
 * new invented format, so the loop itself barely changes to support a second
 * provider. `DeepSeekProvider` does the translation work at its own edges
 * (its own request/response shapes in, Anthropic-shaped result out); the
 * loop and `ClaudeProvider` never see DeepSeek's wire format.
 */
import type Anthropic from '@anthropic-ai/sdk';

export type ProviderName = 'claude' | 'deepseek';

export interface AgentCallParams {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  model: string;
  maxTokens: number;
  timeoutMs?: number;
}

/** The `...Param` variants (not the response `TextBlock`/`ToolUseBlock`
 *  types) — they require only `{type, text}` / `{type, id, name, input}`,
 *  which is exactly what both providers can always produce, AND is what the
 *  loop needs anyway to push this content straight back into the next
 *  request's `messages` unchanged. */
export interface AgentCallResult {
  content: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam>;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
  };
}

export interface AiProvider {
  readonly name: ProviderName;
  readonly configured: boolean;
  agentMessage(params: AgentCallParams): Promise<AgentCallResult | null>;
}
