import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { BillingModule } from '../billing/billing.module';
import { CampaignModule } from '../campaigns/campaign.module';
import { AffiliateModule } from '../affiliate/affiliate.module';
import { LeadsModule } from '../leads/leads.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { WebsiteModule } from '../website/website.module';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { AdminController } from './admin.controller';
import { AdminGoogleAdsController } from './admin-google-ads.controller';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import { AdminCompaniesService } from './admin-companies.service';
import { AdminCategoriesService } from './admin-categories.service';
import { AdminGoogleAdsService } from './admin-google-ads.service';

@Module({
  imports: [
    AuthModule,
    WalletModule,
    BillingModule,
    CampaignModule,
    AffiliateModule,
    LeadsModule,
    AnalyticsModule,
    WebsiteModule,
    GoogleAdsModule,
  ],
  controllers: [AdminController, AdminGoogleAdsController],
  providers: [
    AdminStatsService,
    AdminUsersService,
    AdminCompaniesService,
    AdminCategoriesService,
    AdminGoogleAdsService,
  ],
})
export class AdminModule {}
