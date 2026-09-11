import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';

/**
 * AI integrations. Global so any feature can inject `AiService` without wiring an
 * import. `AiService` talks to Claude (Anthropic Messages API) only; call sites
 * are the two website builders.
 */
@Global()
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
