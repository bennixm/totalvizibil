import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import {
  AdminInfluencersController,
  AdminUserReferralController,
  InfluencerController,
} from './influencers.controller';
import { InfluencersService } from './influencers.service';

/** Influencers (promoter accounts with their own discount code). Depends
 *  only on Auth + Billing, so Wallet and Affiliate can import it without a
 *  cycle (same layering as AffiliateModule). */
@Module({
  imports: [AuthModule, BillingModule],
  controllers: [InfluencerController, AdminInfluencersController, AdminUserReferralController],
  providers: [InfluencersService],
  exports: [InfluencersService],
})
export class InfluencersModule {}
