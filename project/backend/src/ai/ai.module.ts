import { Global, Module } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';

/**
 * AI integrations. Global so any feature can inject the client without wiring
 * an import. `DeepseekService` is the (historically named) AI client — it now
 * talks to Claude with a DeepSeek fallback; call sites are the two website
 * builders.
 */
@Global()
@Module({
  providers: [DeepseekService],
  exports: [DeepseekService],
})
export class AiModule {}
