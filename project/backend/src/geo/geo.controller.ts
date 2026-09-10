import { Controller, Get, Query } from '@nestjs/common';
import { GeoService } from './geo.service';

@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  /** Type-ahead city search for the location step. Public. */
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
}
