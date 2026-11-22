import { Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import {
  GOOGLE_ADS_API_VERSION,
  GoogleAdsApiError,
  GoogleAdsMutateOperation,
  GoogleAdsMutateResult,
  GoogleAdsSearchRow,
  GoogleAdsWritesDisabledError,
  formatApiError,
  readJson,
} from '../google-ads/google-ads-api-client.service';
import type { AdsClient } from '../google-ads/optimization/google-ads-optimizer.service';
import {
  parsePlannerMetrics,
  plannerBody,
} from '../google-ads/optimization/google-ads-keyword-popularity';

const BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
/** Safety bound on paged searches (Google returns up to 10,000 rows/page). */
const MAX_PAGES = 10;

/** Google refused the stored refresh token: the customer must reconnect. */
export class GoogleAdsConnectionRevokedError extends Error {
  constructor(detail?: string) {
    super(`google_ads_connection_revoked${detail ? `: ${detail}` : ''}`);
    this.name = 'GoogleAdsConnectionRevokedError';
  }
}

function isInvalidGrant(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error === 'invalid_grant' || /invalid_grant/i.test(msg);
}

/**
 * The same REST transport as the platform's GoogleAdsApiClient (same API
 * version, same error formatting, same production-only write guard), but
 * authenticated as a CUSTOMER through their OAuth consent and pointed at
 * their own Google Ads account. Implements the optimizer's `AdsClient`, so
 * every existing optimization works on it unchanged.
 */
export class GoogleAdsUserClient implements AdsClient {
  private readonly logger = new Logger(GoogleAdsUserClient.name);

  constructor(
    private readonly oauth: OAuth2Client,
    readonly customerId: string,
    private readonly loginCustomerId: string | null,
    readonly writesAllowed: boolean,
  ) {}

  private async headers(withCustomer = true): Promise<Record<string, string>> {
    let token: string | null | undefined;
    try {
      token = (await this.oauth.getAccessToken()).token;
    } catch (err) {
      if (isInvalidGrant(err)) throw new GoogleAdsConnectionRevokedError();
      throw err;
    }
    if (!token) throw new GoogleAdsConnectionRevokedError('no access token');
    const h: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (withCustomer && this.loginCustomerId) h['login-customer-id'] = this.loginCustomerId;
    return h;
  }

  async search(query: string): Promise<GoogleAdsSearchRow[]> {
    const headers = await this.headers();
    const out: GoogleAdsSearchRow[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch(`${BASE}/customers/${this.customerId}/googleAds:search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      });
      const data = (await readJson(res)) as {
        results?: GoogleAdsSearchRow[];
        nextPageToken?: string;
        error?: GoogleAdsApiError;
      };
      if (!res.ok) throw formatApiError(res.status, data.error, this.logger);
      out.push(...(data.results ?? []));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  async mutate(
    operations: GoogleAdsMutateOperation[],
    opts: { validateOnly?: boolean } = {},
  ): Promise<GoogleAdsMutateResult[]> {
    if (!operations.length) return [];
    if (!opts.validateOnly && !this.writesAllowed) throw new GoogleAdsWritesDisabledError();
    const headers = await this.headers();
    const res = await fetch(`${BASE}/customers/${this.customerId}/googleAds:mutate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mutateOperations: operations,
        partialFailure: false,
        ...(opts.validateOnly ? { validateOnly: true } : {}),
      }),
    });
    const data = (await readJson(res)) as {
      mutateOperationResponses?: GoogleAdsMutateResult[];
      error?: GoogleAdsApiError;
    };
    if (!res.ok) throw formatApiError(res.status, data.error, this.logger);
    return data.mutateOperationResponses ?? [];
  }

  /** Google Keyword Planner: folded keyword → average monthly searches. */
  async keywordHistoricalMetrics(keywords: string[]): Promise<Record<string, number>> {
    if (!keywords.length) return {};
    const headers = await this.headers();
    const res = await fetch(
      `${BASE}/customers/${this.customerId}:generateKeywordHistoricalMetrics`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(plannerBody(keywords)),
      },
    );
    const data = (await readJson(res)) as { error?: GoogleAdsApiError };
    if (!res.ok) throw formatApiError(res.status, data.error, this.logger);
    return parsePlannerMetrics(data);
  }

  /** Customer ids this Google user can reach directly (CustomerService). */
  async listAccessibleCustomers(): Promise<string[]> {
    const headers = await this.headers(false);
    const res = await fetch(`${BASE}/customers:listAccessibleCustomers`, { headers });
    const data = (await readJson(res)) as { resourceNames?: string[]; error?: GoogleAdsApiError };
    if (!res.ok) throw formatApiError(res.status, data.error, this.logger);
    return (data.resourceNames ?? []).map((r) => r.split('/').pop()!).filter(Boolean);
  }
}
