import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWT } from 'google-auth-library';
import { AppConfig } from '../config/env';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
// Matches the Google Ads API version this project's dev tooling has been
// verified against. Bump in lockstep if GAQL/mutate shapes ever change.
const GOOGLE_ADS_API_VERSION = 'v25';
/** How often this client re-reads its credentials from `PlatformSettingsService`
 *  (which has its own 30s cache) and rebuilds the JWT client if they changed —
 *  the mechanism that lets an admin paste a new service-account key from
 *  `/admin/google-ads-agent` and have it take effect without a restart. */
const CREDENTIAL_REFRESH_INTERVAL_MS = 60_000;

export interface GoogleAdsSearchRow {
  customer?: { currencyCode?: string };
  metrics?: { costMicros?: string; clicks?: string };
  geoTargetConstant?: {
    resourceName?: string;
    countryCode?: string;
    targetType?: string;
    name?: string;
  };
  campaignCriterion?: {
    resourceName?: string;
    location?: { geoTargetConstant?: string };
  };
  languageConstant?: { resourceName?: string; code?: string };
  [key: string]: unknown;
}

/** Google's standard API error envelope — `details[].errors` is where the
 *  Ads-specific field-level violation actually lives; the top-level
 *  `message` alone (e.g. "Request contains an invalid argument.") is
 *  useless for diagnosing a bad mutate payload. */
interface GoogleAdsApiError {
  message?: string;
  details?: unknown[];
}

interface GoogleAdsSearchResponse {
  results?: GoogleAdsSearchRow[];
  error?: GoogleAdsApiError;
}

/**
 * One entry of a `googleAds:mutate` request — exactly one operation key is
 * set per entry, matching the Google Ads API's oneof-shaped
 * `MutateOperation`. Only the operation types this platform actually sends
 * are typed here; extend as later phases need more (e.g. `adGroupAdOperation`
 * for ad copy). `create`/`update` payloads are intentionally untyped
 * (`Record<string, unknown>`) — this client has no opinion on what a
 * campaign/budget/keyword looks like, only on how to transport it.
 */
export interface GoogleAdsMutateOperation {
  campaignBudgetOperation?: GoogleAdsOperationBody;
  campaignOperation?: GoogleAdsOperationBody;
  campaignCriterionOperation?: GoogleAdsOperationBody;
  adGroupOperation?: GoogleAdsOperationBody;
  adGroupCriterionOperation?: GoogleAdsOperationBody;
  adGroupAdOperation?: GoogleAdsOperationBody;
}

interface GoogleAdsOperationBody {
  create?: Record<string, unknown>;
  /** Must carry `resourceName` inside `update`, and the changed field paths
   *  (comma-separated, e.g. `"status"` or `"campaign_budget.amount_micros"`)
   *  in `updateMask` — the Google Ads API rejects an update without one. */
  update?: Record<string, unknown>;
  updateMask?: string;
  /** The resource name to delete — mutually exclusive with `create`/
   *  `update` (Google Ads' own oneof). Used for criteria (e.g. dropping a
   *  stale geo-targeting county) a campaign no longer needs; a *campaign*
   *  itself can't be removed this way through `status` (Google rejects
   *  `status: 'REMOVED'` on an update — this `remove` field is the only
   *  path), confirmed live. */
  remove?: string;
}

export interface GoogleAdsMutateResult {
  campaignBudgetResult?: { resourceName?: string };
  campaignResult?: { resourceName?: string };
  campaignCriterionResult?: { resourceName?: string };
  adGroupResult?: { resourceName?: string };
  adGroupCriterionResult?: { resourceName?: string };
  adGroupAdResult?: { resourceName?: string };
}

interface GoogleAdsMutateResponse {
  mutateOperationResponses?: GoogleAdsMutateResult[];
  error?: GoogleAdsApiError;
}

/** The generic top-level `error.message` (e.g. "Request contains an invalid
 *  argument.") never says WHICH field — `error.details[].errors[]` carries
 *  the actual field path/reason. Logged in full (server-side only) and
 *  summarized into the thrown error so a real API rejection is diagnosable
 *  from this service's own logs, not just "it failed". */
function formatApiError(
  status: number,
  error: GoogleAdsApiError | undefined,
  logger: Logger,
): Error {
  const message = error?.message ?? 'unknown error';
  if (error?.details?.length) {
    logger.error(`Google Ads API ${status} full error details: ${JSON.stringify(error.details)}`);
  }
  return new Error(`Google Ads API ${status}: ${message}`);
}

/**
 * Thin, dumb REST transport for the Google Ads API — auth + `search` +
 * `mutate`, nothing else. Shared by `GoogleAdsCpcSyncService` (read-only
 * today) and the Google Ads agent built on top of it (read + mutate — see
 * docs/ai/GOOGLE-ADS-AGENT-PLAN.md). Deliberately has no knowledge of what a
 * campaign/budget/keyword MEANS for this platform; callers build the
 * operation payloads, this class only knows how to authenticate and make
 * the HTTP call.
 *
 * Auth: a GCP service account added directly as a Standard user on the
 * Google Ads account (no Workspace/domain-wide delegation, no human consent
 * screen, nothing to regenerate). `google-auth-library`'s `JWT` client mints
 * short-lived access tokens straight from the service account's key — this
 * bypasses the `google-ads-api` npm package entirely, because that package
 * hard-wires the older OAuth user-consent refresh-token flow
 * (`UserRefreshClient`) with no injection point for a service-account
 * credential (confirmed by reading its compiled `service.js`), so every call
 * goes to the REST endpoint directly instead of through that library's gRPC
 * client.
 *
 * Deliberately does NOT send a `developer-token` header at all. Google's own
 * guidance since the 2026-09-09 retirement is to omit it entirely going
 * forward — confirmed live: sending it as an empty string (rather than
 * leaving it off) gets rejected as DEVELOPER_TOKEN_PARAMETER_MISSING, i.e.
 * the API still treats an empty value as "present but invalid", only a fully
 * absent header is accepted.
 *
 * `search`/`mutate` THROW when called while unconfigured, rather than
 * silently returning an empty result — this component can create/pause real
 * ad spend, so a missing credential must surface as a loud failure to the
 * caller (which already checks `.configured` on its own schedule), never as
 * a quiet "0 results" that a decision loop could mistake for "nothing to do".
 *
 * Credentials come from `PlatformSettingsService` (admin-settable from
 * `/admin/google-ads-agent`) first, falling back to the `GOOGLE_ADS_*` env
 * vars when the DB value is empty — so an existing env-only deployment keeps
 * working untouched. `onModuleInit` + a 60s poll re-reads them and rebuilds
 * the JWT client only when something actually changed (cheap signature
 * compare), so pasting a new key in the admin panel takes effect within a
 * minute, no restart. `configured`/`customerId` stay plain synchronous
 * getters — every caller (`GoogleAdsCpcSyncService`, the 3 agent services,
 * and their tests) is unaffected by this being refresh-based internally.
 */
@Injectable()
export class GoogleAdsApiClient implements OnModuleInit {
  private readonly logger = new Logger(GoogleAdsApiClient.name);
  private jwtClient: JWT | null = null;
  private _customerId = '';
  private loginCustomerId = '';
  private _serviceAccountEmail: string | null = null;
  private lastSignature = '__unloaded__';

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Awaited by Nest before dependent providers' own `onModuleInit` run
   *  (they inject this class), so the very first credential load always
   *  completes before e.g. `GoogleAdsCpcSyncService` checks `.configured`. */
  async onModuleInit(): Promise<void> {
    await this.refresh();
    setInterval(() => void this.refresh(), CREDENTIAL_REFRESH_INTERVAL_MS);
  }

  private async refresh(): Promise<void> {
    let keyBase64: string;
    let customerId: string;
    let loginCustomerId: string;
    try {
      [keyBase64, customerId, loginCustomerId] = await Promise.all([
        this.settings.googleAdsServiceAccountKeyBase64(),
        this.settings.googleAdsCustomerId(),
        this.settings.googleAdsLoginCustomerId(),
      ]);
    } catch (err) {
      this.logger.error(
        'Failed to read Google Ads credentials from platform settings — keeping the previous client.',
        err instanceof Error ? err.stack : err,
      );
      return;
    }
    keyBase64 ||= this.config.get('googleAdsServiceAccountKeyBase64', { infer: true });
    customerId ||= this.config.get('googleAdsCustomerId', { infer: true });
    loginCustomerId ||= this.config.get('googleAdsLoginCustomerId', { infer: true });

    const signature = `${keyBase64}::${customerId}::${loginCustomerId}`;
    if (signature === this.lastSignature) return; // nothing changed — keep the existing JWT client
    this.lastSignature = signature;
    this._customerId = customerId;
    this.loginCustomerId = loginCustomerId;

    if (!keyBase64 || !customerId) {
      this.jwtClient = null;
      this._serviceAccountEmail = null;
      this.logger.log(
        'Google Ads service-account key / customer id not configured — Google Ads API client stays idle.',
      );
      return;
    }

    let key: { client_email?: string; private_key?: string };
    try {
      key = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf8')) as typeof key;
    } catch (err) {
      this.jwtClient = null;
      this._serviceAccountEmail = null;
      this.logger.error(
        'Google Ads service-account key is not valid base64-encoded JSON — Google Ads API client stays idle.',
        err instanceof Error ? err.stack : err,
      );
      return;
    }
    if (!key.client_email || !key.private_key) {
      this.jwtClient = null;
      this._serviceAccountEmail = null;
      this.logger.error(
        "Service account key JSON is missing 'client_email'/'private_key' — Google Ads API client stays idle.",
      );
      return;
    }

    this.jwtClient = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: [GOOGLE_ADS_SCOPE],
    });
    this._serviceAccountEmail = key.client_email;
    this.logger.log(`Google Ads API client (re)configured for customer ${customerId}.`);
  }

  /** True when a service-account key + customer id are configured. */
  get configured(): boolean {
    return !!this.jwtClient;
  }

  get customerId(): string {
    return this._customerId;
  }

  /** For the admin panel's masked credentials preview — never the raw key. */
  get serviceAccountEmail(): string | null {
    return this._serviceAccountEmail;
  }

  private async headers(): Promise<Record<string, string>> {
    if (!this.jwtClient) {
      throw new Error('GoogleAdsApiClient is not configured — check .configured before calling');
    }
    const { token } = await this.jwtClient.getAccessToken();
    if (!token) throw new Error('google-auth-library returned no access token');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (this.loginCustomerId) headers['login-customer-id'] = this.loginCustomerId;
    return headers;
  }

  /** One GAQL query against this customer's account. Throws on any HTTP/API error. */
  async search(query: string): Promise<GoogleAdsSearchRow[]> {
    const headers = await this.headers();
    const res = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${this.customerId}/googleAds:search`,
      { method: 'POST', headers, body: JSON.stringify({ query }) },
    );
    const data = (await res.json()) as GoogleAdsSearchResponse;
    if (!res.ok) {
      throw formatApiError(res.status, data.error, this.logger);
    }
    return data.results ?? [];
  }

  /**
   * One atomic `googleAds:mutate` call — `partialFailure: false` means all
   * operations succeed or none do, so a chain like "create budget → create
   * campaign referencing it" never leaves a half-created campaign behind.
   * Operations can reference each other within the same call via temporary
   * negative resource-name ids (e.g. a budget created as
   * `customers/{id}/campaignBudgets/-1`, then a campaign operation setting
   * `campaignBudget: "customers/{id}/campaignBudgets/-1"`), per the Google
   * Ads API's standard temporary-id convention — the caller is responsible
   * for building those references correctly; this method just sends them.
   */
  async mutate(operations: GoogleAdsMutateOperation[]): Promise<GoogleAdsMutateResult[]> {
    if (!operations.length) return [];
    const headers = await this.headers();
    const res = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${this.customerId}/googleAds:mutate`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ mutateOperations: operations, partialFailure: false }),
      },
    );
    const data = (await res.json()) as GoogleAdsMutateResponse;
    if (!res.ok) {
      throw formatApiError(res.status, data.error, this.logger);
    }
    return data.mutateOperationResponses ?? [];
  }
}
