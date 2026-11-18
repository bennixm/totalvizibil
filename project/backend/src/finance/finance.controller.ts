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
import { PagedPeriodQuery } from './dto/paged-period.query';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { MonthlyReportQuery, ReportExportQuery } from './dto/report-export.query';
import type { ExportFile } from './finance.service';

function fileResponse(f: ExportFile): StreamableFile {
  return new StreamableFile(f.buffer, {
    type: f.contentType,
    disposition: `attachment; filename="${f.filename}"`,
  });
}

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

  /** `?format=pdf|csv|xlsx` (default pdf), same filters as the list. */
  @Get('revenue/export')
  async exportRevenue(@Query() q: ListRevenueQuery) {
    return fileResponse(await this.finance.exportRevenue(q));
  }

  @Get('expenses')
  listExpenses(@Query() q: ListExpensesQuery) {
    return this.finance.listExpenses(q);
  }

  /** `?format=pdf|csv|xlsx` (default pdf), same filters as the list. */
  @Get('expenses/export')
  async exportExpenses(@Query() q: ListExpensesQuery) {
    return fileResponse(await this.finance.exportExpenses(q));
  }

  /** The financial report (profit and loss) for a period, or `?year=` for
   *  the annual report broken down by month. `?format=pdf|csv|xlsx`. */
  @Get('report/export')
  async exportReport(@Query() q: ReportExportQuery) {
    return fileResponse(await this.finance.exportReport(q));
  }

  /** Annual view: twelve monthly statements + the year total. */
  @Get('report/monthly')
  monthlyReport(@Query() q: MonthlyReportQuery) {
    return this.finance.monthlyReport(q.year);
  }

  /** Data-integrity checks (duplicates, balance reconciliation, ...). */
  @Get('checks')
  checks() {
    return this.finance.checks();
  }

  @Post('expenses')
  createExpense(@CurrentUser() user: AuthPrincipal, @Body() dto: CreateExpenseDto) {
    return this.finance.createExpense(dto, user.id);
  }

  @Patch('expenses/:id')
  updateExpense(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.finance.updateExpense(id, dto, user);
  }

  @Delete('expenses/:id')
  async deleteExpense(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    await this.finance.deleteExpense(id, user);
    return { ok: true };
  }

  /** Register of invoices annulled in the period (count + voided total). */
  @Get('voided-invoices')
  voidedInvoices(@Query() q: PagedPeriodQuery) {
    return this.finance.listVoidedInvoices(q);
  }

  /** CPC spend per business for the period, biggest spender first. */
  @Get('top-companies')
  topCompanies(@Query() q: PagedPeriodQuery) {
    return this.finance.listTopCompanies(q);
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
