import { Controller, Get, Query } from '@nestjs/common';
import { GeoService } from './geo.service';

@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

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
}
