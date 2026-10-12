import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PlatformRoles, PlatformRolesGuard } from '../auth/platform-roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthPrincipal } from '../auth/auth.types';
import { FinanceService } from './finance.service';
import { FinancePeriodQuery } from './dto/finance-period.query';
import { ListRevenueQuery } from './dto/list-revenue.query';
import { ListExpensesQuery } from './dto/list-expenses.query';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

/** Financial reporting (Contabil + admin) — venituri, costuri, profit. A
 *  separate controller from `AdminController` on purpose: everything here is
 *  also open to the `finance` role, everything there stays `admin`-only. */
@UseGuards(AuthGuard, PlatformRolesGuard)
@PlatformRoles('admin', 'finance')
@Controller('admin/finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('overview')
  overview(@Query() q: FinancePeriodQuery) {
    return this.finance.overview(q);
  }

  @Get('revenue')
  listRevenue(@Query() q: ListRevenueQuery) {
    return this.finance.listRevenue(q);
  }

  @Get('revenue/export')
  async exportRevenue(@Query() q: ListRevenueQuery) {
    const buffer = await this.finance.exportRevenuePdf(q);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'attachment; filename="venituri-totalvizibil.pdf"',
    });
  }

  @Get('expenses')
  listExpenses(@Query() q: ListExpensesQuery) {
    return this.finance.listExpenses(q);
  }

  @Get('expenses/export')
  async exportExpenses(@Query() q: ListExpensesQuery) {
    const buffer = await this.finance.exportExpensesPdf(q);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'attachment; filename="costuri-totalvizibil.pdf"',
    });
  }

  @Post('expenses')
  createExpense(@CurrentUser() user: AuthPrincipal, @Body() dto: CreateExpenseDto) {
    return this.finance.createExpense(dto, user.id);
  }

  @Patch('expenses/:id')
  updateExpense(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseDto) {
    return this.finance.updateExpense(id, dto);
  }

  @Delete('expenses/:id')
  async deleteExpense(@Param('id', ParseUUIDPipe) id: string) {
    await this.finance.deleteExpense(id);
    return { ok: true };
  }

  @Get('ai-usage')
  aiUsage(@Query() q: FinancePeriodQuery) {
    return this.finance.aiUsageReport(q);
  }

  @Get('ai-usage/export')
  async exportAiUsage(@Query() q: FinancePeriodQuery) {
    const buffer = await this.finance.exportAiUsagePdf(q);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'attachment; filename="consum-ai-totalvizibil.pdf"',
    });
  }
}
