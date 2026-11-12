import { Global, Module } from '@nestjs/common';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformController } from './platform.controller';

@Global()
@Module({
  imports: [GoogleAdsModule],
  controllers: [PlatformController],
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
