import { Controller, Get } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';

/** Public, read-only pricing the create flow needs before sign-in. */
@Controller('platform')
export class PlatformController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get('pricing')
  async pricing() {
    const [
      advancedBuilderPriceCredits,
      advancedBuilderUnlockBonusCredits,
      additionalBusinessPriceCredits,
      eurRonRate,
      affiliateEnabled,
      affiliateRewardCredits,
      affiliateMinDepositCredits,
    ] = await Promise.all([
      this.settings.advancedBuilderPriceCredits(),
      this.settings.advancedBuilderUnlockBonusCredits(),
      this.settings.additionalBusinessPriceCredits(),
      this.settings.eurRonRate(),
      this.settings.affiliateEnabled(),
      this.settings.affiliateRewardCredits(),
      this.settings.affiliateMinDepositCredits(),
    ]);
    return {
      advancedBuilderPriceCredits,
      advancedBuilderUnlockBonusCredits,
      additionalBusinessPriceCredits,
      eurRonRate,
      affiliateEnabled,
      affiliateRewardCredits,
      affiliateMinDepositCredits,
    };
  }
}
