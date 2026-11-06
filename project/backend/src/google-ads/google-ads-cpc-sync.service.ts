import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWT } from 'google-auth-library';
import { AppConfig } from '../config/env';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
// Matches the Google Ads API version this project's dev tooling has been
// verified against. Bump in lockstep if GAQL/report shapes ever change.
const GOOGLE_ADS_API_VERSION = 'v25';

interface GoogleAdsSearchRow {
  customer?: { currencyCode?: string };
  metrics?: { costMicros?: string; clicks?: string };
}
interface GoogleAdsSearchResponse {
  results?: GoogleAdsSearchRow[];
  error?: { message?: string };
}

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
 * Auth: a GCP service account added directly as a Standard user on the
 * Google Ads account (no Workspace/domain-wide delegation, no human
 * consent screen, nothing to regenerate). `google-auth-library`'s `JWT`
 * client mints short-lived access tokens straight from the service
 * account's key — this bypasses the `google-ads-api` npm package entirely
 * for this job, because that package hard-wires the older OAuth
 * user-consent refresh-token flow (`UserRefreshClient`) with no injection
 * point for a service-account credential (confirmed by reading its
 * compiled `service.js`), so the query goes to the REST endpoint directly
 * instead of through that library's gRPC client.
 */
@Injectable()
export class GoogleAdsCpcSyncService implements OnModuleInit {
  private readonly logger = new Logger(GoogleAdsCpcSyncService.name);
  private readonly jwtClient: JWT | null;
  private readonly customerId: string;
  private readonly loginCustomerId: string;
  private readonly campaignId: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly settings: PlatformSettingsService,
  ) {
    const keyBase64 = config.get('googleAdsServiceAccountKeyBase64', { infer: true });
    this.customerId = config.get('googleAdsCustomerId', { infer: true });
    this.loginCustomerId = config.get('googleAdsLoginCustomerId', { infer: true });
    this.campaignId = config.get('googleAdsCampaignId', { infer: true });

    if (!keyBase64 || !this.customerId) {
      this.jwtClient = null;
      this.logger.log(
        'Google Ads service-account key / customer id not configured — CPC sync job stays idle. ' +
          'Google-attributed feed clicks fall back to the admin-set Max CPC ceiling ' +
          '(platform setting googleAdsMaxCpcCredits) until this is set up.',
      );
      return;
    }

    let key: { client_email?: string; private_key?: string };
    try {
      key = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf8')) as typeof key;
    } catch (err) {
      this.jwtClient = null;
      this.logger.error(
        'GOOGLE_ADS_SERVICE_ACCOUNT_KEY_BASE64 is not valid base64-encoded JSON — CPC sync job stays idle.',
        err instanceof Error ? err.stack : err,
      );
      return;
    }
    if (!key.client_email || !key.private_key) {
      this.jwtClient = null;
      this.logger.error(
        "Service account key JSON is missing 'client_email'/'private_key' — CPC sync job stays idle.",
      );
      return;
    }

    this.jwtClient = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: [GOOGLE_ADS_SCOPE],
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
    if (!this.jwtClient) return;
    void this.sync();
    setInterval(() => void this.sync(), SYNC_INTERVAL_MS);
  }

  private async sync(): Promise<void> {
    if (!this.jwtClient) return;
    try {
      const { token } = await this.jwtClient.getAccessToken();
      if (!token) throw new Error('google-auth-library returned no access token');

      const query = [
        'SELECT customer.currency_code, metrics.cost_micros, metrics.clicks',
        'FROM campaign',
        'WHERE segments.date DURING TODAY',
        this.campaignId ? `AND campaign.id = ${this.campaignId}` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Deliberately NOT sending `developer-token` at all. Google's own
        // guidance since the 2026-09-09 retirement is to omit it entirely
        // going forward — confirmed live: sending it as an empty string
        // (rather than leaving it off) gets rejected as
        // DEVELOPER_TOKEN_PARAMETER_MISSING, i.e. the API still treats an
        // empty value as "present but invalid", only a fully absent header
        // is accepted.
      };
      if (this.loginCustomerId) headers['login-customer-id'] = this.loginCustomerId;

      const res = await fetch(
        `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${this.customerId}/googleAds:search`,
        { method: 'POST', headers, body: JSON.stringify({ query }) },
      );
      const data = (await res.json()) as GoogleAdsSearchResponse;
      if (!res.ok) {
        throw new Error(
          `Google Ads API ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`,
        );
      }

      let costMicros = 0;
      let clicks = 0;
      let currencyCode: string | undefined;
      for (const row of data.results ?? []) {
        costMicros += Number(row.metrics?.costMicros ?? 0);
        clicks += Number(row.metrics?.clicks ?? 0);
        currencyCode ??= row.customer?.currencyCode;
      }

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
