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
}
