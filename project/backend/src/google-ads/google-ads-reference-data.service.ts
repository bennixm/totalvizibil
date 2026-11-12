import { Injectable, Logger } from '@nestjs/common';
import { foldCounty, resolveCounty } from '../geo/ro-cities';
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
  private countyGeoTargetConstants: CacheEntry<Map<string, string>> | null = null;
  private geoTargetIdToCounty: CacheEntry<Map<string, string>> | null = null;

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

  /**
   * `geoTargetConstants/{id}` for every Romanian județ, keyed by
   * `foldCounty(name)` (diacritic/case-insensitive) so a canonical
   * `RO_COUNTIES` entry (which DOES carry diacritics, e.g. "Constanța")
   * matches Google's own ASCII-only `geo_target_constant.name` (e.g.
   * "Constanta") without a hardcoded translation table either side could
   * silently drift from. One lookup covers all 42 județe (incl. București).
   */
  async getCountyGeoTargetConstants(): Promise<Map<string, string>> {
    if (
      this.countyGeoTargetConstants &&
      Date.now() - this.countyGeoTargetConstants.at < CACHE_TTL_MS
    ) {
      return this.countyGeoTargetConstants.value;
    }
    const rows = await this.client.search(
      'SELECT geo_target_constant.name, geo_target_constant.resource_name FROM geo_target_constant ' +
        "WHERE geo_target_constant.country_code = 'RO' AND geo_target_constant.target_type = 'County'",
    );
    const map = new Map<string, string>();
    for (const row of rows) {
      const name = row.geoTargetConstant?.name;
      const resourceName = row.geoTargetConstant?.resourceName;
      if (name && resourceName) map.set(foldCounty(name), resourceName);
    }
    if (!map.size) {
      throw new Error(
        "Google Ads geo_target_constant lookup for RO (target_type='County') returned no result " +
          '— refusing to guess a resource name for county-level geo targeting.',
      );
    }
    this.countyGeoTargetConstants = { value: map, at: Date.now() };
    return map;
  }

  /**
   * The reverse of `getCountyGeoTargetConstants()`: given the bare numeric
   * id a ValueTrack `{loc_physical_ms}` click param carries (research doc,
   * Direction 6), resolve it to our OWN canonical `RO_COUNTIES` spelling —
   * never Google's ASCII one — or `null` if it isn't a județ-level id at all
   * (country/city-level ids resolve to nothing here, by design: the feed
   * only ever auto-filters by județ). `resolveCounty()` is what actually
   * bridges Google's ASCII name back to our diacritic one.
   */
  async getCountyByGeoTargetId(id: string): Promise<string | null> {
    if (this.geoTargetIdToCounty && Date.now() - this.geoTargetIdToCounty.at < CACHE_TTL_MS) {
      return this.geoTargetIdToCounty.value.get(id) ?? null;
    }
    const rows = await this.client.search(
      'SELECT geo_target_constant.id, geo_target_constant.name FROM geo_target_constant ' +
        "WHERE geo_target_constant.country_code = 'RO' AND geo_target_constant.target_type = 'County'",
    );
    const map = new Map<string, string>();
    for (const row of rows) {
      const rawId = row.geoTargetConstant?.id;
      const name = row.geoTargetConstant?.name;
      const canonical = name ? resolveCounty(name) : null;
      if (rawId && canonical) map.set(rawId, canonical);
    }
    if (!map.size) {
      throw new Error(
        "Google Ads geo_target_constant lookup for RO (target_type='County') returned no result " +
          '— refusing to guess a county for a geo target id.',
      );
    }
    this.geoTargetIdToCounty = { value: map, at: Date.now() };
    return map.get(id) ?? null;
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
    this.countyGeoTargetConstants = null;
    this.geoTargetIdToCounty = null;
  }
}
