import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminInvoicePdfController, BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [AuthModule],
  controllers: [BillingController, AdminInvoicePdfController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
