import { Module } from '@nestjs/common';
import { GoogleAdsCpcSyncService } from './google-ads-cpc-sync.service';

/** `PlatformSettingsService` and `ConfigService` are both global — nothing
 *  to import here beyond the sync service itself. */
@Module({
  providers: [GoogleAdsCpcSyncService],
})
export class GoogleAdsModule {}
