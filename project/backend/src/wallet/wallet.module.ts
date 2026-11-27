import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { InfluencersModule } from '../influencers/influencers.module';
import { AffiliateModule } from '../affiliate/affiliate.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [AuthModule, BillingModule, AffiliateModule, InfluencersModule],
  controllers: [WalletController, StripeWebhookController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
