import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceStatementService } from './finance-statement.service';

@Module({
  imports: [AuthModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceStatementService],
})
export class FinanceModule {}
