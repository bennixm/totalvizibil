import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { PublicCompanyController } from './public-company.controller';
import { PublicCompanyService } from './public-company.service';

@Module({
  controllers: [FeedController, PublicCompanyController],
  providers: [FeedService, PublicCompanyService],
})
export class FeedModule {}
