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
 *
 * Which campaigns feed this average: every campaign the Google Ads AGENT has
 * ever created (`GoogleAdsSubcategoryCampaign.googleCampaignId`, regardless
 * of its current local `status` — a campaign paused mid-day can still have
 * accrued real cost earlier that same day) PLUS the admin-configured single
 * `googleAdsCampaignId` (DB-settable, env fallback), if any, for a manually-
 * run campaign outside the agent (e.g. a platform-brand campaign) that ALSO
 * drives feed traffic. Found live in production (2026-11-12): before this,
 * the job only ever looked at that one manual id, which pointed at an
 * unrelated, permanently-PAUSED "Web Pixel" campaign — so the average could
 * never update no matter how much real traffic the agent's own campaigns
 * got. Falls back to the whole account only when NEITHER source has
 * anything yet (a fresh install, before the agent has created its first
 * campaign).
 */
@Injectable()
export class GoogleAdsCpcSyncService implements OnModuleInit {
  private readonly logger = new Logger(GoogleAdsCpcSyncService.name);
  /** Env fallback only — the live value is resolved on every tick via
   *  `resolveManualCampaignId()`, DB setting first (admin-settable), so a
   *  change takes effect without a restart. `GoogleAdsApiClient`'s own
   *  credential loading happens in ITS `onModuleInit` (not its constructor)
   *  now, so `.configured` can't be trusted yet at THIS constructor's time —
   *  every check against it lives in `sync()` instead, which already
   *  re-checks it on every tick regardless. */
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
    const campaignIds = await this.relevantCampaignIds();
    if (!campaignIds.length) {
      this.logger.warn(
        'No Google Ads campaign ids to track yet (no agent-created campaigns, no manual ' +
          'campaign id configured) — averaging cost/clicks across the WHOLE Google Ads ' +
          'account instead, which any unrelated campaign on the same account would skew.',
      );
    }
    void this.sync();
    setInterval(() => void this.sync(), SYNC_INTERVAL_MS);
  }

  private async resolveManualCampaignId(): Promise<string> {
    const dbValue = await this.settings.googleAdsCampaignId();
    return dbValue || this.envCampaignId;
  }

  /** Every campaign id this job should pull today's cost/clicks for — see
   *  the class doc comment for why both sources matter. */
  private async relevantCampaignIds(): Promise<string[]> {
    const [agentCampaigns, manualCampaignId] = await Promise.all([
      this.prisma.googleAdsSubcategoryCampaign.findMany({
        where: { googleCampaignId: { not: null } },
        select: { googleCampaignId: true },
      }),
      this.resolveManualCampaignId(),
    ]);
    const ids = new Set(agentCampaigns.map((c) => c.googleCampaignId as string));
    if (manualCampaignId) ids.add(manualCampaignId);
    return [...ids];
  }

  private async sync(): Promise<void> {
    if (!this.client.configured) return;
    try {
      const campaignIds = await this.relevantCampaignIds();
      const query = [
        'SELECT customer.currency_code, metrics.cost_micros, metrics.clicks',
        'FROM campaign',
        'WHERE segments.date DURING TODAY',
        campaignIds.length ? `AND campaign.id IN (${campaignIds.join(',')})` : '',
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
