import { Controller, Get, Logger } from '@nestjs/common';
import { GoogleAdsApiClient } from '../google-ads/google-ads-api-client.service';
import { PlatformSettingsService } from './platform-settings.service';

/** In-process only, no TTL eviction — but ONLY once actually configured:
 *  the conversion action, once it exists, never changes, so re-reading its
 *  tag snippet from Google on every single public page view (this is
 *  embedded site-wide) would be pure waste. Deliberately never caches the
 *  "not configured yet" state — that's one cheap settings read, and
 *  permanently caching it would wedge every page at `configured: false`
 *  for the rest of this process's life the moment the content pass creates
 *  the conversion action after this endpoint was first hit. */
let cachedConversionTag: { conversionId: string; conversionLabel: string } | undefined;

/** Public, read-only pricing the create flow needs before sign-in. */
@Controller('platform')
export class PlatformController {
  private readonly logger = new Logger(PlatformController.name);

  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly googleAds: GoogleAdsApiClient,
  ) {}

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
      creditsDiscountEnabled,
      creditsDiscountPct,
    ] = await Promise.all([
      this.settings.advancedBuilderPriceCredits(),
      this.settings.advancedBuilderUnlockBonusCredits(),
      this.settings.additionalBusinessPriceCredits(),
      this.settings.eurRonRate(),
      this.settings.affiliateEnabled(),
      this.settings.affiliateRewardCredits(),
      this.settings.affiliateMinDepositCredits(),
      this.settings.creditsDiscountEnabled(),
      this.settings.creditsDiscountPct(),
    ]);
    return {
      advancedBuilderPriceCredits,
      advancedBuilderUnlockBonusCredits,
      additionalBusinessPriceCredits,
      eurRonRate,
      affiliateEnabled,
      affiliateRewardCredits,
      affiliateMinDepositCredits,
      creditsDiscountEnabled,
      creditsDiscountPct,
    };
  }

  /**
   * Google Ads conversion tracking (research doc, Direction 3): the id/
   * label the frontend's gtag snippet needs to fire a conversion the
   * moment a visitor clicks through from the feed to a company — the same
   * moment that click is already billed. Returns `{configured: false}`
   * (never an error) until the one account-wide conversion action exists —
   * created lazily by the content pass, see
   * `GoogleAdsAgentContentService.ensureConversionAction()`.
   */
  @Get('google-ads-conversion-tag')
  async googleAdsConversionTag() {
    if (cachedConversionTag) return { configured: true, ...cachedConversionTag };
    try {
      const resourceName = await this.settings.googleAdsConversionActionResourceName();
      if (!resourceName || !this.googleAds.configured) return { configured: false };
      const rows = await this.googleAds.search(
        'SELECT conversion_action.tag_snippets FROM conversion_action ' +
          `WHERE conversion_action.resource_name = '${resourceName}'`,
      );
      const snippet = rows[0]?.conversionAction?.tagSnippets?.[0]?.eventSnippet ?? '';
      const match = snippet.match(/send_to:\s*['"]([\w-]+\/[\w-]+)['"]/);
      if (!match) return { configured: false };
      const [conversionId, conversionLabel] = match[1].split('/');
      cachedConversionTag = { conversionId, conversionLabel };
      return { configured: true, ...cachedConversionTag };
    } catch (err) {
      this.logger.warn(
        'Google Ads conversion tag lookup failed — reporting unconfigured for now.',
        err instanceof Error ? err.stack : String(err),
      );
      return { configured: false };
    }
  }
}
