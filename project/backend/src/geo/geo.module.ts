import { Module } from '@nestjs/common';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';

@Module({
  imports: [GoogleAdsModule],
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
