import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebsiteModule } from '../website/website.module';
import { WalletModule } from '../wallet/wallet.module';
import { CampaignModule } from '../campaigns/campaign.module';
import { LeadsModule } from '../leads/leads.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

@Module({
  imports: [AuthModule, WebsiteModule, WalletModule, CampaignModule, LeadsModule, AnalyticsModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
