import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/env';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsApiClient } from './google-ads-api-client.service';

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
 * All Google Ads auth/HTTP goes through the shared `GoogleAdsApiClient` (see
 * its own doc comment for the service-account JWT details) — this service
 * only owns the GAQL query, the cost/CPC aggregation, and the
 * currency→credits conversion, all unchanged from before that extraction.
 *
 * Same sync tick also auto-books the day's REAL Google Ads cost as a
 * `PlatformExpense` (category `google_ads`, source `google_ads_api`) — see
 * `recordDailyCost()`. Reuses the exact same query response (`costMicros`)
 * already fetched for the CPC average, so this is zero extra API calls.
 * Replaces the old all-manual `google_ads` expense category for everything
 * going forward; existing manual rows are untouched and the category still
 * accepts manual entries (e.g. to backfill a day this job missed).
 */
@Injectable()
export class GoogleAdsCpcSyncService implements OnModuleInit {
  private readonly logger = new Logger(GoogleAdsCpcSyncService.name);
  /** Env fallback only — the live value is resolved on every tick via
   *  `resolveCampaignId()`, DB setting first (admin-settable), so a change
   *  takes effect without a restart. `GoogleAdsApiClient`'s own credential
   *  loading happens in ITS `onModuleInit` (not its constructor) now, so
   *  `.configured` can't be trusted yet at THIS constructor's time — every
   *  check against it lives in `sync()` instead, which already re-checks it
   *  on every tick regardless. */
  private readonly envCampaignId: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly client: GoogleAdsApiClient,
    private readonly settings: PlatformSettingsService,
    private readonly prisma: PrismaService,
  ) {
    this.envCampaignId = config.get('googleAdsCampaignId', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    const campaignId = await this.resolveCampaignId();
    if (!campaignId) {
      this.logger.warn(
        'No Google Ads campaign id configured — averaging cost/clicks across the WHOLE ' +
          'Google Ads account. Set one (admin panel or GOOGLE_ADS_CAMPAIGN_ID) once the ' +
          'platform-promotion campaign exists, or any unrelated campaign on the same ' +
          'account will skew the price.',
      );
    }
    void this.sync();
    setInterval(() => void this.sync(), SYNC_INTERVAL_MS);
  }

  private async resolveCampaignId(): Promise<string> {
    const dbValue = await this.settings.googleAdsCampaignId();
    return dbValue || this.envCampaignId;
  }

  private async sync(): Promise<void> {
    if (!this.client.configured) return;
    try {
      const campaignId = await this.resolveCampaignId();
      const query = [
        'SELECT customer.currency_code, metrics.cost_micros, metrics.clicks',
        'FROM campaign',
        'WHERE segments.date DURING TODAY',
        campaignId ? `AND campaign.id = ${campaignId}` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const results = await this.client.search(query);

      let costMicros = 0;
      let clicks = 0;
      let currencyCode: string | undefined;
      for (const row of results) {
        costMicros += Number(row.metrics?.costMicros ?? 0);
        clicks += Number(row.metrics?.clicks ?? 0);
        currencyCode ??= row.customer?.currencyCode;
      }

      // Booked regardless of clicks — a campaign can accrue cost (e.g.
      // impression-based line items) without a click, and this is the
      // platform's bookkeeping of record for that spend, not just an input
      // to the CPC average below.
      await this.recordDailyCost(costMicros, currencyCode);

      if (clicks <= 0) {
        this.logger.debug('No Google Ads clicks yet today — keeping the previous cached average.');
        return;
      }

      const avgCostAccountCurrency = costMicros / clicks / 1_000_000;
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
   * Upserts today's running total Google Ads cost as a `PlatformExpense` —
   * `externalRef` (`google_ads_daily:<customerId>:<date>`) is the row's
   * idempotency key, so every 10-minute tick this cycle just replaces the
   * same day's figure with Google's latest running total instead of
   * double-booking. The row effectively "finalizes" once the UTC day rolls
   * over and this job starts querying the next day instead.
   */
  private async recordDailyCost(
    costMicros: number,
    currencyCode: string | undefined,
  ): Promise<void> {
    if (costMicros <= 0 || !currencyCode) return;
    // `toCredits()` doubles as a EUR converter here — 1 credit ≡ 1 EUR.
    const costEur = await this.toCredits(costMicros / 1_000_000, currencyCode);
    if (costEur == null) return; // already logged inside toCredits()

    const dateKey = new Date().toISOString().slice(0, 10);
    const externalRef = `google_ads_daily:${this.client.customerId}:${dateKey}`;
    const amountMinor = Math.round(costEur * 100);

    await this.prisma.platformExpense.upsert({
      where: { externalRef },
      update: { amountMinor },
      create: {
        category: 'google_ads',
        incurredOn: new Date(dateKey),
        amountMinor,
        currency: 'EUR',
        source: 'google_ads_api',
        externalRef,
      },
    });
  }

  /**
   * Credits are pegged 1 credit ≈ 1 EUR everywhere else in the platform
   * (see wallet/money.ts). Converts whatever the Google Ads account's own
   * currency is — read fresh from `customer.currencyCode` above, never
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
