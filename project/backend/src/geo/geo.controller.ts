import { Controller, Get, Logger, Query } from '@nestjs/common';
import { GoogleAdsApiClient } from '../google-ads/google-ads-api-client.service';
import { GoogleAdsReferenceDataService } from '../google-ads/google-ads-reference-data.service';
import { GeoService } from './geo.service';

@Controller('geo')
export class GeoController {
  private readonly logger = new Logger(GeoController.name);

  constructor(
    private readonly geo: GeoService,
    private readonly client: GoogleAdsApiClient,
    private readonly refData: GoogleAdsReferenceDataService,
  ) {}

  /** The closed set of județe (+ București) the location step picks from. Public. */
  @Get('counties')
  counties() {
    return { data: this.geo.counties() };
  }

  /** Type-ahead city search — used only to help pin the map, not for matching. Public. */
  @Get('cities')
  cities(@Query('q') q?: string) {
    return { data: this.geo.searchCities(q ?? '') };
  }

  /** Closest known city to a map point — keeps the city input in sync when the
   *  location pin is moved manually on the map. Public. */
  @Get('nearest')
  nearest(@Query('lat') lat?: string, @Query('lng') lng?: string) {
    return this.geo.nearestCity(Number(lat), Number(lng));
  }

  /** A representative city for a județ — re-centres the map when it's picked
   *  from the dropdown directly. Public. */
  @Get('county-center')
  countyCenter(@Query('name') name?: string) {
    return this.geo.countyCenter(name ?? '');
  }

  /**
   * Resolves a Google Ads geo-target id — the bare numeric id a ValueTrack
   * `{loc_physical_ms}` click param carries (research doc, Direction 6) —
   * to our own canonical județ spelling, so the frontend can auto-filter
   * the feed to the clicker's own county without ever needing the full geo
   * table client-side. Public, read-only, and deliberately fails soft:
   * never configured / lookup error / not a județ-level id all just come
   * back as `{ county: null }` — a visitor's page must never break over
   * this best-effort personalization.
   */
  @Get('resolve-google-ads-county')
  async resolveGoogleAdsCounty(@Query('geoTargetId') geoTargetId?: string) {
    if (!geoTargetId || !this.client.configured) return { county: null };
    try {
      return { county: await this.refData.getCountyByGeoTargetId(geoTargetId) };
    } catch (err) {
      this.logger.warn(
        `Google Ads geo-target id resolution failed for '${geoTargetId}'.`,
        err instanceof Error ? err.stack : String(err),
      );
      return { county: null };
    }
  }
}
