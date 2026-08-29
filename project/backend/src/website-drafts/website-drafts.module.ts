import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompaniesModule } from '../companies/companies.module';
import { WebsiteDraftsController } from './website-drafts.controller';
import { WebsiteDraftsService } from './website-drafts.service';

@Module({
  imports: [AuthModule, CompaniesModule],
  controllers: [WebsiteDraftsController],
  providers: [WebsiteDraftsService],
})
export class WebsiteDraftsModule {}
