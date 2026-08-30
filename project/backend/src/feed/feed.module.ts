import { Module } from '@nestjs/common';
import { CampaignModule } from '../campaigns/campaign.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { PublicCompanyController } from './public-company.controller';
import { PublicCompanyService } from './public-company.service';

@Module({
  imports: [CampaignModule, AnalyticsModule],
  controllers: [FeedController, PublicCompanyController],
  providers: [FeedService, PublicCompanyService],
})
export class FeedModule {}
