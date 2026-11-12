import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AffiliateModule } from '../affiliate/affiliate.module';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

@Module({
  imports: [AuthModule, WalletModule, AnalyticsModule, AffiliateModule, GoogleAdsModule],
  controllers: [CampaignController],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
