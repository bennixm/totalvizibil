import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceStatementService } from './finance-statement.service';
import { ExternalInvoicesController } from './external-invoices/external-invoices.controller';
import { ExternalInvoicesService } from './external-invoices/external-invoices.service';
import { GoogleAdsInvoiceSource } from './external-invoices/sources/google-ads.source';
import { ExternalInvoiceReportsService } from './external-invoices/external-invoice-reports.service';

@Module({
  imports: [AuthModule, GoogleAdsModule, AiModule],
  controllers: [FinanceController, ExternalInvoicesController],
  providers: [
    FinanceService,
    FinanceStatementService,
    ExternalInvoicesService,
    GoogleAdsInvoiceSource,
    ExternalInvoiceReportsService,
  ],
})
export class FinanceModule {}
