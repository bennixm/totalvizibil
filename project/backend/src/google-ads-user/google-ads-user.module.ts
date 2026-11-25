import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditLogModule } from '../admin/audit-log.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminGoogleAdsUserController } from './admin-google-ads-user.controller';
import { GoogleAdsChatService } from './google-ads-chat.service';
import { GoogleAdsOAuthService } from './google-ads-oauth.service';
import { GoogleAdsUserAgentService } from './google-ads-user-agent.service';
import { GoogleAdsUserController } from './google-ads-user.controller';
import { GoogleAdsUserService } from './google-ads-user.service';

/**
 * Google Ads optimization builder: customers connect their own Google Ads
 * account and the platform's optimizer (GoogleAdsModule's optimization/)
 * works on their campaign, billed per cycle in credits.
 * PlatformSettings, AI and Prisma are global modules.
 */
@Module({
  imports: [AuthModule, AuditLogModule, WalletModule],
  controllers: [GoogleAdsUserController, AdminGoogleAdsUserController],
  providers: [
    GoogleAdsOAuthService,
    GoogleAdsUserService,
    GoogleAdsUserAgentService,
    GoogleAdsChatService,
  ],
  exports: [GoogleAdsUserAgentService],
})
export class GoogleAdsUserModule {}
