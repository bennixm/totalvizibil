import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { AffiliateController } from './affiliate.controller';
import { AffiliateService } from './affiliate.service';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [AffiliateController],
  providers: [AffiliateService],
  exports: [AffiliateService],
})
export class AffiliateModule {}
