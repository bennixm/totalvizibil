import { Injectable, Logger } from '@nestjs/common';
import { GoogleAdsApiClient } from './google-ads-api-client.service';

/** Static Google Ads reference data never changes within a process
 *  lifetime (a country's geo-target constant, a language's constant), so a
 *  single successful lookup is cached for the rest of the process rather
 *  than re-queried on every structural pass tick. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  at: number;
}

/**
 * Looks up Google Ads reference IDs the agent needs to create a campaign,
 * instead of hardcoding a guessed resource name — deliberately, per
 * docs/ai/GOOGLE-ADS-AGENT-PLAN.md: a wrong hardcoded geo/language constant
 * would silently mistarget every campaign the agent creates. Each lookup is
 * a live GAQL query against the configured account, cached in memory.
 */
@Injectable()
export class GoogleAdsReferenceDataService {
  private readonly logger = new Logger(GoogleAdsReferenceDataService.name);
  private geoTargetConstantRo: CacheEntry<string> | null = null;
  private languageConstantRo: CacheEntry<string> | null = null;
  private accountCurrencyCode: CacheEntry<string> | null = null;

  constructor(private readonly client: GoogleAdsApiClient) {}

  /** `geoTargetConstants/{id}` for Romania as a whole country. */
  async getGeoTargetConstantRo(): Promise<string> {
    if (this.geoTargetConstantRo && Date.now() - this.geoTargetConstantRo.at < CACHE_TTL_MS) {
      return this.geoTargetConstantRo.value;
    }
    const rows = await this.client.search(
      'SELECT geo_target_constant.resource_name FROM geo_target_constant ' +
        "WHERE geo_target_constant.country_code = 'RO' AND geo_target_constant.target_type = 'Country'",
    );
    const resourceName = rows[0]?.geoTargetConstant?.resourceName;
    if (!resourceName) {
      throw new Error(
        'Google Ads geo_target_constant lookup for RO (country) returned no result — refusing to ' +
          'guess a resource name for geo targeting.',
      );
    }
    this.geoTargetConstantRo = { value: resourceName, at: Date.now() };
    return resourceName;
  }

  /** `languageConstants/{id}` for Romanian. */
  async getLanguageConstantRo(): Promise<string> {
    if (this.languageConstantRo && Date.now() - this.languageConstantRo.at < CACHE_TTL_MS) {
      return this.languageConstantRo.value;
    }
    const rows = await this.client.search(
      'SELECT language_constant.resource_name FROM language_constant ' +
        "WHERE language_constant.code = 'ro'",
    );
    const resourceName = rows[0]?.languageConstant?.resourceName;
    if (!resourceName) {
      throw new Error(
        "Google Ads language_constant lookup for code 'ro' returned no result — refusing to guess " +
          'a resource name for language targeting.',
      );
    }
    this.languageConstantRo = { value: resourceName, at: Date.now() };
    return resourceName;
  }

  /** The Google Ads account's own billing currency (e.g. 'EUR', 'RON'),
   *  read fresh from the `customer` resource rather than assumed. */
  async getAccountCurrencyCode(): Promise<string> {
    if (this.accountCurrencyCode && Date.now() - this.accountCurrencyCode.at < CACHE_TTL_MS) {
      return this.accountCurrencyCode.value;
    }
    const rows = await this.client.search('SELECT customer.currency_code FROM customer LIMIT 1');
    const currencyCode = rows[0]?.customer?.currencyCode;
    if (!currencyCode) {
      throw new Error('Google Ads customer.currency_code lookup returned no result.');
    }
    this.accountCurrencyCode = { value: currencyCode, at: Date.now() };
    return currencyCode;
  }

  /** Test-only: drop all cached values so a test can force a fresh lookup. */
  clearCache(): void {
    this.geoTargetConstantRo = null;
    this.languageConstantRo = null;
    this.accountCurrencyCode = null;
  }
}
