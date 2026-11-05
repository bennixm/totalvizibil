import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAdsApi, fromMicros, type Customer } from 'google-ads-api';
import { AppConfig } from '../config/env';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

const SYNC_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Keeps `PlatformSettingsService`'s Google Ads average-CPC cache warm — the
 * dynamic `costPromovare` that `AnalyticsService.marginConfig()` charges
 * Google-Ads-attributed feed clicks instead of the old flat admin setting
 * (see the admin-panel removal in `UpdateSettingsDto`).
 *
 * Same resilience shape as `NotificationsSweepService`: `OnModuleInit` +
 * `setInterval`, every cycle wrapped so a failure never crashes the app —
 * it just leaves the previous cached value in place, and the staleness
 * check at the read side (`GOOGLE_ADS_CPC_STALE_AFTER_MS`) falls back to
 * the admin-configured Max CPC ceiling once that value gets too old.
 *
 * Needs ALL of GOOGLE_ADS_DEVELOPER_TOKEN / _CLIENT_ID / _CLIENT_SECRET /
 * _REFRESH_TOKEN / _CUSTOMER_ID (env.ts) to do anything — missing any one of
 * them, the job logs once at boot and stays idle forever (no retry storm,
 * no crash).
 */
@Injectable()
export class GoogleAdsCpcSyncService implements OnModuleInit {
  private readonly logger = new Logger(GoogleAdsCpcSyncService.name);
  private readonly customer: Customer | null;
  private readonly campaignId: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly settings: PlatformSettingsService,
  ) {
    const developerToken = config.get('googleAdsDeveloperToken', { infer: true });
    const clientId = config.get('googleAdsClientId', { infer: true });
    const clientSecret = config.get('googleAdsClientSecret', { infer: true });
    const refreshToken = config.get('googleAdsRefreshToken', { infer: true });
    const customerId = config.get('googleAdsCustomerId', { infer: true });
    const loginCustomerId = config.get('googleAdsLoginCustomerId', { infer: true });
    this.campaignId = config.get('googleAdsCampaignId', { infer: true });

    if (!developerToken || !clientId || !clientSecret || !refreshToken || !customerId) {
      this.customer = null;
      this.logger.log(
        'Google Ads credentials not fully configured — CPC sync job stays idle. ' +
          'Google-attributed feed clicks fall back to the admin-set Max CPC ceiling ' +
          '(platform setting googleAdsMaxCpcCredits) until this is set up.',
      );
      return;
    }

    const client = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    });
    this.customer = client.Customer({
      customer_id: customerId,
      login_customer_id: loginCustomerId || undefined,
      refresh_token: refreshToken,
    });
    if (!this.campaignId) {
      this.logger.warn(
        'GOOGLE_ADS_CAMPAIGN_ID not set — averaging cost/clicks across the WHOLE ' +
          'Google Ads account. Set it once the platform-promotion campaign exists, ' +
          'or any unrelated campaign on the same account will skew the price.',
      );
    }
  }

  onModuleInit(): void {
    if (!this.customer) return;
    void this.sync();
    setInterval(() => void this.sync(), SYNC_INTERVAL_MS);
  }

  private async sync(): Promise<void> {
    if (!this.customer) return;
    try {
      const rows = await this.customer.report({
        entity: 'campaign',
        // The customer (account) resource joins in for free alongside
        // campaign — no separate lookup needed to know what currency
        // `cost_micros` below is actually denominated in, and it's read
        // fresh every cycle so a currency change on the account (rare, but
        // possible) is picked up automatically instead of needing a
        // deploy to fix a silently wrong conversion.
        attributes: ['customer.currency_code'],
        metrics: ['metrics.cost_micros', 'metrics.clicks'],
        constraints: this.campaignId ? { 'campaign.id': this.campaignId } : undefined,
        date_constant: 'TODAY',
      });

      let costMicros = 0;
      let clicks = 0;
      let currencyCode: string | undefined;
      for (const row of rows) {
        costMicros += Number(row.metrics?.cost_micros ?? 0);
        clicks += Number(row.metrics?.clicks ?? 0);
        currencyCode ??= row.customer?.currency_code ?? undefined;
      }

      if (clicks <= 0) {
        this.logger.debug('No Google Ads clicks yet today — keeping the previous cached average.');
        return;
      }

      const avgCostAccountCurrency = fromMicros(costMicros) / clicks;
      const avgCostCredits = await this.toCredits(avgCostAccountCurrency, currencyCode);
      if (avgCostCredits == null) return; // already logged inside toCredits()

      await this.settings.setGoogleAdsAvgCpc(avgCostCredits);
      this.logger.log(
        `Google Ads avg CPC synced: ${avgCostAccountCurrency.toFixed(4)} ${currencyCode} ` +
          `→ ${avgCostCredits.toFixed(4)} credits (${clicks} clicks today).`,
      );
    } catch (err) {
      this.logger.error(
        'Google Ads CPC sync failed — keeping the previous cached value.',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /**
   * Credits are pegged 1 credit ≈ 1 EUR everywhere else in the platform
   * (see wallet/money.ts). Converts whatever the Google Ads account's own
   * currency is — read fresh from `customer.currency_code` above, never
   * assumed — into that same peg. RON goes through the platform's own
   * live EUR→RON rate (the same one the wallet/invoicing already use, not
   * a second, possibly-drifted source of truth). Any other currency has no
   * conversion path here yet: rather than silently charge off a wrong
   * number, this skips the write entirely and keeps the previous cached
   * value (or the admin Max CPC fallback if there never was one).
   */
  private async toCredits(
    amount: number,
    currencyCode: string | undefined,
  ): Promise<number | null> {
    switch (currencyCode) {
      case 'EUR':
        return amount;
      case 'RON': {
        const eurRonRate = await this.settings.eurRonRate();
        return amount / eurRonRate;
      }
      default:
        this.logger.error(
          `Google Ads account currency is '${currencyCode ?? 'unknown'}', which this sync job ` +
            "doesn't know how to convert to credits (only EUR and RON are wired up) — skipping " +
            'this cycle rather than caching a wrong number. Add a conversion case in ' +
            'GoogleAdsCpcSyncService.toCredits() for this currency.',
        );
        return null;
    }
  }
}
