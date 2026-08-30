import { Controller, Get } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';

/** Public, read-only pricing the create flow needs before sign-in. */
@Controller('platform')
export class PlatformController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get('pricing')
  async pricing() {
    const [advancedBuilderPriceCredits, additionalBusinessPriceCredits, eurRonRate] =
      await Promise.all([
        this.settings.advancedBuilderPriceCredits(),
        this.settings.additionalBusinessPriceCredits(),
        this.settings.eurRonRate(),
      ]);
    return { advancedBuilderPriceCredits, additionalBusinessPriceCredits, eurRonRate };
  }
}
