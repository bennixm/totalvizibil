import { Global, Module } from '@nestjs/common';
import { StripeService } from './stripe.service';

/** Global like PlatformSettingsModule/AiModule — any feature can inject
 *  `StripeService` without wiring an explicit import. */
@Global()
@Module({
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
