import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WalletTxnType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateTablePdf } from '../common/table-pdf';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ListExpensesQuery } from './dto/list-expenses.query';
import { ListRevenueQuery } from './dto/list-revenue.query';
import { FinancePeriodQuery } from './dto/finance-period.query';

/** AI spend is tracked in USD (see `AiUsageRecord.estimatedCostUsd`); every
 *  other figure in this module is EUR cents. Treated 1:1 (USD ≈ EUR) for this
 *  report — the same simplification `ai-usage.service.ts` already makes for
 *  its own credit-charging math, not a new approximation introduced here. */
function usdToEurMinor(usd: number): number {
  return Math.round(usd * 100);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

const EXPENSE_CATEGORIES = [
  'hosting',
  'call_center',
  'cloud_storage',
  'domains',
  'google_ads',
  'stripe_fees',
  'other',
] as const;

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Both ends inclusive; defaults to the current calendar month (UTC). */
  private resolveRange(q: FinancePeriodQuery): { from: Date; to: Date } {
    const now = new Date();
    const from = q.from ? new Date(q.from) : startOfUtcMonth(now);
    const to = q.to ? endOfUtcDay(new Date(q.to)) : endOfUtcDay(now);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('from must be before to');
    }
    return { from, to };
  }

  // -------------------------------------------------------------------------
  // Overview (the Dashboard Financiar page)
  // -------------------------------------------------------------------------

  async overview(q: FinancePeriodQuery) {
    const { from, to } = this.resolveRange(q);
    const dateFilter = { createdAt: { gte: from, lte: to } };

    const [purchaseRows, refundRows, cpcSpendRows, otherSpendRows, expenseRows, aiRows] =
      await this.prisma.$transaction([
        this.prisma.walletTransaction.findMany({
          where: { type: 'purchase', status: 'completed', ...dateFilter },
          select: { amountMinor: true, createdAt: true },
        }),
        this.prisma.walletTransaction.findMany({
          where: { type: 'refund', status: 'completed', ...dateFilter },
          select: { amountMinor: true, createdAt: true },
        }),
        this.prisma.walletTransaction.findMany({
          where: {
            type: 'spend',
            status: 'completed',
            spendDay: { not: null },
            ...dateFilter,
          },
          select: { amountMinor: true },
        }),
        this.prisma.walletTransaction.findMany({
          where: {
            type: 'spend',
            status: 'completed',
            spendDay: null,
            ...dateFilter,
          },
          select: { amountMinor: true },
        }),
        this.prisma.platformExpense.findMany({
          where: { incurredOn: { gte: from, lte: to } },
          select: { category: true, amountMinor: true, incurredOn: true },
        }),
        this.prisma.aiUsageRecord.findMany({
          where: dateFilter,
          select: { estimatedCostUsd: true, createdAt: true },
        }),
      ]);

    const revenueMinor =
      purchaseRows.reduce((s, r) => s + r.amountMinor, 0) +
      refundRows.reduce((s, r) => s + r.amountMinor, 0);
    const cpcConsumedMinor = -cpcSpendRows.reduce((s, r) => s + r.amountMinor, 0);
    const otherFeesConsumedMinor = -otherSpendRows.reduce((s, r) => s + r.amountMinor, 0);

    const expensesByCategory: Record<string, number> = Object.fromEntries(
      EXPENSE_CATEGORIES.map((c) => [c, 0]),
    );
    for (const row of expenseRows) expensesByCategory[row.category] += row.amountMinor;

    const aiCostMinor = usdToEurMinor(aiRows.reduce((s, r) => s + r.estimatedCostUsd, 0));
    const operatingCostMinor = Object.values(expensesByCategory).reduce((s, v) => s + v, 0);
    const totalCostMinor = operatingCostMinor + aiCostMinor;
    const profitMinor = revenueMinor - totalCostMinor;

    const adSpendMinor = expensesByCategory.google_ads;

    // Daily trend for the chart — bucket every row into its UTC day.
    const days = new Map<string, { revenueMinor: number; costMinor: number }>();
    const bump = (date: Date, field: 'revenueMinor' | 'costMinor', amount: number) => {
      const key = dayKey(date);
      const bucket = days.get(key) ?? { revenueMinor: 0, costMinor: 0 };
      bucket[field] += amount;
      days.set(key, bucket);
    };
    for (const r of purchaseRows) bump(r.createdAt, 'revenueMinor', r.amountMinor);
    for (const r of refundRows) bump(r.createdAt, 'revenueMinor', r.amountMinor);
    for (const r of expenseRows) bump(r.incurredOn, 'costMinor', r.amountMinor);
    for (const r of aiRows) bump(r.createdAt, 'costMinor', usdToEurMinor(r.estimatedCostUsd));

    const trend = Array.from(days.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      revenueMinor,
      operatingCostMinor,
      aiCostMinor,
      totalCostMinor,
      profitMinor,
      expensesByCategory,
      paidTraffic: {
        cpcRevenueMinor: cpcConsumedMinor,
        adSpendMinor,
        profitMinor: cpcConsumedMinor - adSpendMinor,
      },
      otherFeesConsumedMinor,
      trend,
    };
  }

  // -------------------------------------------------------------------------
  // Venituri
  // -------------------------------------------------------------------------

  private revenueWhere(q: ListRevenueQuery): Prisma.WalletTransactionWhereInput {
    const types: WalletTxnType[] = q.type ? [q.type] : ['purchase', 'refund'];
    return {
      type: { in: types },
      status: 'completed',
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: endOfUtcDay(new Date(q.to)) } : {}),
            },
          }
        : {}),
    };
  }

  async listRevenue(q: ListRevenueQuery) {
    const where = this.revenueWhere(q);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;

    const [items, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          wallet: { select: { user: { select: { name: true, email: true } } } },
          company: { select: { displayName: true } },
        },
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        type: t.type,
        amountMinor: t.amountMinor,
        createdAt: t.createdAt,
        userName: t.wallet.user?.name ?? null,
        userEmail: t.wallet.user?.email ?? null,
        companyName: t.company?.displayName ?? null,
        description: t.description,
      })),
      total,
      page,
      pageSize,
    };
  }

  async exportRevenuePdf(q: ListRevenueQuery): Promise<Buffer> {
    const where = this.revenueWhere(q);
    const rows = await this.prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 2000,
      include: {
        wallet: { select: { user: { select: { name: true, email: true } } } },
        company: { select: { displayName: true } },
      },
    });

    return generateTablePdf({
      title: 'Venituri',
      ownerName: 'Totalvizibil',
      subtitle: q.from || q.to ? `${q.from ?? '...'} – ${q.to ?? '...'}` : undefined,
      columns: [
        { label: 'Data', width: 0.15 },
        { label: 'Tip', width: 0.12 },
        { label: 'Client', width: 0.28 },
        { label: 'Afacere', width: 0.25 },
        { label: 'Sumă', width: 0.2, align: 'right' },
      ],
      rows: rows.map((t) => [
        t.createdAt.toLocaleDateString('ro-RO'),
        t.type === 'purchase' ? 'Încărcare' : 'Rambursare',
        t.wallet.user?.name ?? '—',
        t.company?.displayName ?? '—',
        `${(t.amountMinor / 100).toFixed(2)} €`,
      ]),
      emptyText: 'Niciun venit în perioada selectată.',
    });
  }

  // -------------------------------------------------------------------------
  // Costuri (manual CRUD)
  // -------------------------------------------------------------------------

  private expensesWhere(q: ListExpensesQuery) {
    return {
      ...(q.category ? { category: q.category } : {}),
      ...(q.from || q.to
        ? {
            incurredOn: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
  }

  async listExpenses(q: ListExpensesQuery) {
    const where = this.expensesWhere(q);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.platformExpense.findMany({
        where,
        orderBy: { incurredOn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { createdBy: { select: { name: true } } },
      }),
      this.prisma.platformExpense.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async exportExpensesPdf(q: ListExpensesQuery): Promise<Buffer> {
    const where = this.expensesWhere(q);
    const rows = await this.prisma.platformExpense.findMany({
      where,
      orderBy: { incurredOn: 'desc' },
      take: 2000,
    });

    return generateTablePdf({
      title: 'Costuri',
      ownerName: 'Totalvizibil',
      subtitle: q.from || q.to ? `${q.from ?? '...'} – ${q.to ?? '...'}` : undefined,
      columns: [
        { label: 'Data', width: 0.15 },
        { label: 'Categorie', width: 0.2 },
        { label: 'Sursă', width: 0.15 },
        { label: 'Notă', width: 0.3 },
        { label: 'Sumă', width: 0.2, align: 'right' },
      ],
      rows: rows.map((r) => [
        r.incurredOn.toLocaleDateString('ro-RO'),
        r.category,
        r.source === 'stripe_api' ? 'Automat (Stripe)' : 'Manual',
        r.note ?? '—',
        `${(r.amountMinor / 100).toFixed(2)} €`,
      ]),
      emptyText: 'Niciun cost înregistrat în perioada selectată.',
    });
  }

  createExpense(dto: CreateExpenseDto, createdById: string) {
    return this.prisma.platformExpense.create({
      data: {
        category: dto.category,
        incurredOn: new Date(dto.incurredOn),
        amountMinor: dto.amountMinor,
        note: dto.note,
        source: 'manual',
        createdById,
      },
    });
  }

  async updateExpense(id: string, dto: UpdateExpenseDto) {
    const existing = await this.prisma.platformExpense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Expense not found');

    return this.prisma.platformExpense.update({
      where: { id },
      data: {
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.incurredOn ? { incurredOn: new Date(dto.incurredOn) } : {}),
        ...(dto.amountMinor !== undefined ? { amountMinor: dto.amountMinor } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });
  }

  async deleteExpense(id: string): Promise<void> {
    const existing = await this.prisma.platformExpense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Expense not found');
    await this.prisma.platformExpense.delete({ where: { id } });
  }

  // -------------------------------------------------------------------------
  // Consum AI
  // -------------------------------------------------------------------------

  private async aiRows(q: FinancePeriodQuery) {
    const { from, to } = this.resolveRange(q);
    const rows = await this.prisma.aiUsageRecord.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        provider: true,
        model: true,
        taskCategory: true,
        inputTokens: true,
        outputTokens: true,
        estimatedCostUsd: true,
        createdAt: true,
      },
    });
    return { rows, from, to };
  }

  async aiUsageReport(q: FinancePeriodQuery) {
    const { rows, from, to } = await this.aiRows(q);

    const byModel = new Map<
      string,
      { provider: string; model: string; calls: number; tokens: number; costMinor: number }
    >();
    for (const r of rows) {
      const key = `${r.provider}:${r.model}`;
      const bucket = byModel.get(key) ?? {
        provider: r.provider,
        model: r.model,
        calls: 0,
        tokens: 0,
        costMinor: 0,
      };
      bucket.calls += 1;
      bucket.tokens += r.inputTokens + r.outputTokens;
      bucket.costMinor += usdToEurMinor(r.estimatedCostUsd);
      byModel.set(key, bucket);
    }

    const totalCostMinor = usdToEurMinor(rows.reduce((s, r) => s + r.estimatedCostUsd, 0));
    const totalTokens = rows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totalCostMinor,
      totalTokens,
      totalCalls: rows.length,
      byModel: Array.from(byModel.values()).sort((a, b) => b.costMinor - a.costMinor),
    };
  }

  async exportAiUsagePdf(q: FinancePeriodQuery): Promise<Buffer> {
    const { rows } = await this.aiRows(q);

    const byModel = new Map<
      string,
      { provider: string; model: string; calls: number; tokens: number; costMinor: number }
    >();
    for (const r of rows) {
      const key = `${r.provider}:${r.model}`;
      const bucket = byModel.get(key) ?? {
        provider: r.provider,
        model: r.model,
        calls: 0,
        tokens: 0,
        costMinor: 0,
      };
      bucket.calls += 1;
      bucket.tokens += r.inputTokens + r.outputTokens;
      bucket.costMinor += usdToEurMinor(r.estimatedCostUsd);
      byModel.set(key, bucket);
    }

    return generateTablePdf({
      title: 'Consum AI',
      ownerName: 'Totalvizibil',
      subtitle: q.from || q.to ? `${q.from ?? '...'} – ${q.to ?? '...'}` : undefined,
      columns: [
        { label: 'Furnizor', width: 0.2 },
        { label: 'Model', width: 0.3 },
        { label: 'Apeluri', width: 0.15, align: 'right' },
        { label: 'Tokeni', width: 0.15, align: 'right' },
        { label: 'Cost', width: 0.2, align: 'right' },
      ],
      rows: Array.from(byModel.values())
        .sort((a, b) => b.costMinor - a.costMinor)
        .map((b) => [
          b.provider,
          b.model,
          String(b.calls),
          b.tokens.toLocaleString('ro-RO'),
          `${(b.costMinor / 100).toFixed(2)} €`,
        ]),
      emptyText: 'Niciun consum AI în perioada selectată.',
    });
  }
}
