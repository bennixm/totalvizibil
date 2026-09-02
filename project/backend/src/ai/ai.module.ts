import { Global, Module } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';

/**
 * AI integrations. Global so any feature can inject the client without wiring
 * an import; there is only one call site today (the Simple-site builder).
 */
@Global()
@Module({
  providers: [DeepseekService],
  exports: [DeepseekService],
})
export class AiModule {}
