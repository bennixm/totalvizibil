import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { CampaignModule } from '../campaigns/campaign.module';
import { LeadsModule } from '../leads/leads.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AdminController } from './admin.controller';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import { AdminCompaniesService } from './admin-companies.service';
import { AdminCategoriesService } from './admin-categories.service';

@Module({
  imports: [AuthModule, WalletModule, CampaignModule, LeadsModule, AnalyticsModule],
  controllers: [AdminController],
  providers: [AdminStatsService, AdminUsersService, AdminCompaniesService, AdminCategoriesService],
})
export class AdminModule {}
