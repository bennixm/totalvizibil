import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ClaudeProvider } from './claude.provider';
import { DeepSeekProvider } from './deepseek.provider';

/**
 * AI integrations. Global so any feature can inject `AiService` without wiring an
 * import. `AiService` talks to Claude (Anthropic Messages API) only; call sites
 * are the two website builders. `ClaudeProvider`/`DeepSeekProvider` are the
 * normalized `AiProvider` adapters PRO V2's model router picks between —
 * `ClaudeProvider` wraps `AiService` (no second Claude client); `DeepSeekProvider`
 * is a real, separate, optional provider (see its own file for details).
 */
@Global()
@Module({
  providers: [AiService, ClaudeProvider, DeepSeekProvider],
  exports: [AiService, ClaudeProvider, DeepSeekProvider],
})
export class AiModule {}
