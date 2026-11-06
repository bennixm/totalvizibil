import { Module } from '@nestjs/common';
import { GoogleAdsCpcSyncService } from './google-ads-cpc-sync.service';

/** `PlatformSettingsService` and `ConfigService` are both global — nothing
 *  else to wire up. (The one-time OAuth consent controller this module used
 *  to expose is gone: auth is now a service account, which never needs a
 *  human consent round-trip.) */
@Module({
  providers: [GoogleAdsCpcSyncService],
})
export class GoogleAdsModule {}
