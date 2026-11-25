import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WalletTxnType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPrincipal } from '../auth/auth.types';
import { generateTablePdf } from '../common/table-pdf';
import { CreateExpenseDto, DEFAULT_EXPENSE_CURRENCY } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ListExpensesQuery } from './dto/list-expenses.query';
import { DEFAULT_REVENUE_TXN_TYPES, ListRevenueQuery } from './dto/list-revenue.query';
import { FinancePeriodQuery } from './dto/finance-period.query';
import { PagedPeriodQuery } from './dto/paged-period.query';
import { CREDITS_PER_USD } from '../website/builder/pro-v2/ai-usage.service';
import {
  type BalanceSnapshot,
  expenseEurMinor,
  FinanceStatementService,
  type FinancialStatement,
} from './finance-statement.service';
import { ReportExportQuery } from './dto/report-export.query';
import { consumptionCategory, vatOf } from './ledger-engine';
import {
  CONSUMPTION_RO,
  dayRo,
  missingNoteRo,
  MONTHLY_COLUMNS,
  MONTHS_RO,
  statementLines,
  eurNum,
  eurText,
  EXPENSE_CATEGORY_RO,
  EXPENSE_SOURCE_RO,
  TXN_STATUS_RO,
  TXN_TYPE_RO,
} from './finance-export';
import { type Sheet, toCsv, toXlsx } from '../common/spreadsheet';

/** AI spend is tracked in USD (see `AiUsageRecord.estimatedCostUsd`); every
 *  other figure in this module is EUR cents. Treated 1:1 (USD ≈ EUR) for this
 *  report — the same simplification `ai-usage.service.ts` already makes for
 *  its own credit-charging math, not a new approximation introduced here. */
function usdToEurMinor(usd: number): number {
  return Math.round(usd * 100);
}

/** What the client's wallet was actually charged for that AI cost — the same
 *  fixed markup `AiUsageService.record()` charges at write time
 *  (`CREDITS_PER_USD` credits per $1, 1 credit = 1 EUR), so this always
 *  matches the real `chargeAiUsage` amount rather than drifting from it. */
function usdToChargedMinor(usd: number): number {
  return Math.round(usd * CREDITS_PER_USD * 100);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A refund's `refundSources` JSON column — see the field comment on
 *  `WalletTransaction` in schema.prisma for the shape and why `moneyMinor`
 *  (not `amountMinor`) is the real EUR-cents movement behind each source. */
function parseRefundSources(
  json: Prisma.JsonValue,
): { amountMinor: number; moneyMinor?: number }[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (s): s is { amountMinor: number; moneyMinor?: number } =>
      typeof s === 'object' &&
      s !== null &&
      typeof (s as Record<string, unknown>).amountMinor === 'number',
  );
}

/** The real money a completed refund sent back — `refundSources[].moneyMinor`
 *  (falling back to `amountMinor` for pre-discount-feature rows that never
 *  got a `moneyMinor`), minus the processing fee the platform kept. Using
 *  the refund row's own `amountMinor` instead (the credit FACE value) both
 *  over-subtracts the fee portion from revenue and ignores that a
 *  discounted purchase's money slice is smaller than its credit slice. */
function refundMoneyMinor(r: { refundSources: Prisma.JsonValue; feeMinor: number | null }): number {
  const sources = parseRefundSources(r.refundSources);
  const grossMoneyMinor = sources.reduce((s, src) => s + (src.moneyMinor ?? src.amountMinor), 0);
  return grossMoneyMinor - (r.feeMinor ?? 0);
}

/** The real money a completed purchase brought in: `eurCents` when present
 *  (what was actually charged), falling back to the credit face value for
 *  rows that predate the discount feature. Same expression `overview()` uses
 *  for its headline revenue — kept as one helper so the Venituri table, its
 *  PDF and the Dashboard KPI can never drift apart again. */
function purchaseMoneyMinor(r: { amountMinor: number; eurCents: number | null }): number {
  return r.eurCents ?? r.amountMinor;
}

/** Signed real-money movement of a single revenue-ledger row, so a list of
 *  mixed rows sums to exactly the same figure `overview().revenueMinor`
 *  reports: purchases add what was charged, refunds subtract what was
 *  actually sent back (fee-aware), and an `adjustment` (manual wallet
 *  correction / affiliate reward credit) moves NO money — it hands out
 *  credits the platform was never paid for, so it must not inflate revenue.
 *  Its credit face value is still reported separately as `amountMinor`. */
function rowMoneyMinor(r: {
  type: WalletTxnType;
  amountMinor: number;
  eurCents: number | null;
  refundSources: Prisma.JsonValue;
  feeMinor: number | null;
}): number {
  if (r.type === 'refund') return -refundMoneyMinor(r);
  if (r.type === 'purchase') return purchaseMoneyMinor(r);
  return r.eurCents ?? 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Spreadsheet exports carry every row up to this; PDFs fewer (paper). */
const EXPORT_ROW_CAP = 50_000;
const PDF_ROW_CAP = 3_000;

type RevenueRowOut = ReturnType<FinanceService['mapRevenueRow']>;

export interface ExportFile {
  buffer: Buffer;
  contentType: string;
  filename: string;
}
function pdfFile(stem: string, buffer: Buffer): ExportFile {
  return { buffer, contentType: 'application/pdf', filename: `${stem}.pdf` };
}
function csvFile(stem: string, buffer: Buffer): ExportFile {
  return { buffer, contentType: 'text/csv; charset=utf-8', filename: `${stem}.csv` };
}
function xlsxFile(stem: string, buffer: Buffer): ExportFile {
  return {
    buffer,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: `${stem}.xlsx`,
  };
}

function startOfUtcMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/** Excludes a purchase whose invoice was voided — the admin told the
 *  customer the sale was annulled, so it shouldn't still count as revenue.
 *  A row with no invoice at all (refunds, or any row this join doesn't
 *  apply to) is unaffected — only an invoice that exists AND is voided
 *  excludes its row. */
const NOT_VOIDED_INVOICE: Prisma.WalletTransactionWhereInput = {
  OR: [{ invoice: { is: null } }, { invoice: { is: { voidedAt: null } } }],
};

/** Mirrors `wallet.service.ts`'s own `categoryOf(provider, description)`
 *  classification of non-CPC spend rows (`CPC_PROVIDER`/`'ai-usage'`/
 *  `BUILDER_UNLOCK_DESCRIPTION` there) so the finance breakdown of
 *  `otherFeesConsumedMinor` can never bucket a row differently from the
 *  owner-facing wallet breakdown. Duplicated rather than imported on
 *  purpose: those are private module constants of the wallet module and
 *  exporting them would mean editing that file. Read-only use only.
 *  NOTE: if the wallet-side strings ever change, change these too. */
const AI_USAGE_PROVIDER = 'ai-usage';
/** "Consum AI" bucket for the homepage search's Claude backup. */
const SEARCH_PROVIDER = 'cautare-homepage';
/** Customers' Google Ads optimization cycles (google-ads-user/). */
const OPTIMIZER_PROVIDER = 'google-ads-optimizer';
interface OptimizerCycleUsage {
  aiModel: string | null;
  aiCostMinor: number;
  aiCallCount: number;
  chargedMinor: number;
}
/** What customers paid for the work done with one model (each model is its
 *  own row, so the total must not repeat on every row). */
function optimizerCharged(usage: OptimizerCycleUsage[], model: string): number {
  return usage
    .filter((r) => (r.aiModel ?? 'necunoscut') === model)
    .reduce((s, r) => s + r.chargedMinor, 0);
}
/** Platform-side AI spend no customer is ever billed for. */
const NEVER_CHARGED = new Set(['google-ads-agent', SEARCH_PROVIDER]);
interface SearchUsage {
  days: {
    total: number;
    stored: number;
    keyword: number;
    local: number;
    ai: number;
    guess: number;
    aiCostUsd: number;
    aiInputTokens: number;
    aiOutputTokens: number;
  }[];
  model: string;
}
const BUILDER_UNLOCK_DESCRIPTION = 'Advanced website builder';
/** Customers' Google Ads optimization cycles (billed; google-ads-user/). */
const GOOGLE_ADS_OPTIMIZER_PROVIDER = OPTIMIZER_PROVIDER;
type OneOffFeeCategory = 'aiUsage' | 'builderUnlock' | 'googleAds' | 'other';
function oneOffFeeCategory(provider: string | null, description: string | null): OneOffFeeCategory {
  if (provider === AI_USAGE_PROVIDER) return 'aiUsage';
  if (provider === GOOGLE_ADS_OPTIMIZER_PROVIDER) return 'googleAds';
  if (provider === null && description === BUILDER_UNLOCK_DESCRIPTION) return 'builderUnlock';
  return 'other';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly statements: FinanceStatementService,
  ) {}

  /** Both ends inclusive; defaults to the current calendar month (UTC).
   *  `all: true` asks for literally every row instead — the lower bound
   *  becomes the Unix epoch (no real row predates it, so this is an exact
   *  "no lower bound", not a guessed business-specific cutoff date), while
   *  `to` still defaults to today (or an explicit `to`, if given one
   *  alongside `all` — "everything up to date X"). */
  private resolveRange(q: { from?: string; to?: string; all?: boolean }): { from: Date; to: Date } {
    const now = new Date();
    const to = q.to ? endOfUtcDay(new Date(q.to)) : endOfUtcDay(now);
    if (q.all) {
      return { from: new Date(0), to };
    }
    const from = q.from ? new Date(q.from) : startOfUtcMonth(now);
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

    // The invoice VAT grouping runs alongside rather than inside the
    // `$transaction` tuple: Prisma's tuple inference widens a `groupBy`
    // payload (its `_sum`/`_count` become optional unions), which would cost
    // the compile-time guarantee that these field names exist.
    const [
      [
        purchaseRows,
        refundRows,
        cpcSpendRows,
        otherSpendRows,
        expenseRows,
        aiRows,
        walletTotals,
        blockedWalletTotals,
        refundInFlightTotals,
        refundFeeTotals,
      ],
      invoiceVatGroups,
    ] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.walletTransaction.findMany({
          where: {
            type: 'purchase',
            status: 'completed',
            ...dateFilter,
            ...NOT_VOIDED_INVOICE,
          },
          select: { amountMinor: true, eurCents: true, createdAt: true },
        }),
        this.prisma.walletTransaction.findMany({
          where: { type: 'refund', status: 'completed', ...dateFilter },
          select: { refundSources: true, feeMinor: true, createdAt: true },
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
          select: { amountMinor: true, provider: true, description: true },
        }),
        this.prisma.platformExpense.findMany({
          where: { incurredOn: { gte: from, lte: to } },
          select: {
            category: true,
            amountMinor: true,
            incurredOn: true,
            currency: true,
            eurAmountMinor: true,
          },
        }),
        this.prisma.aiUsageRecord.findMany({
          where: dateFilter,
          select: { estimatedCostUsd: true, createdAt: true },
        }),
        // --- point-in-time balance-sheet figures (deliberately NOT period
        // scoped: a liability is what's owed right now, not what was owed
        // during some past month) ----------------------------------------
        this.prisma.wallet.aggregate({ _sum: { balanceMinor: true } }),
        this.prisma.wallet.aggregate({
          _sum: { balanceMinor: true },
          where: { blockedAt: { not: null } },
        }),
        this.prisma.walletTransaction.aggregate({
          _sum: { amountMinor: true },
          where: { type: 'refund', status: { in: ['pending', 'processing'] } },
        }),
        // Period-scoped: the processing fee the platform KEPT out of
        // completed refunds. Real income, but until now only ever netted out
        // of the refund deduction, never shown as a line of its own.
        this.prisma.walletTransaction.aggregate({
          _sum: { feeMinor: true },
          where: { type: 'refund', status: 'completed', ...dateFilter },
        }),
      ]),
      // VAT return shape: one row per (rate, currency) over the SALES
      // invoices issued in the period that are still valid. Affiliate-reward
      // documents are payouts, not sales, so they never belong here.
      this.prisma.invoice.groupBy({
        by: ['vatRatePct', 'currency'],
        where: { voidedAt: null, kind: 'topup', issuedAt: { gte: from, lte: to } },
        _sum: { subtotalMinor: true, vatMinor: true, totalMinor: true },
        _count: { _all: true },
        orderBy: { vatRatePct: 'asc' },
      }),
    ]);

    // Revenue is the real money that changed hands — a purchase's `eurCents`
    // (which can be less than its credit face value `amountMinor` whenever
    // the site-wide discount was active), minus what refunds actually sent
    // back (also real-money, fee-aware — see `refundMoneyMinor`). Using
    // `amountMinor` for either side overstates revenue during a discount
    // and overstates the refund deduction by the processing fee. Both sides
    // are reported: "gross" = the credit FACE value sold (list price),
    // "net" = the money actually collected for it, and the delta is exactly
    // what the site-wide discount cost the platform over this period.
    const grossRevenueMinor = purchaseRows.reduce((s, r) => s + r.amountMinor, 0);
    const netRevenueMinor = purchaseRows.reduce((s, r) => s + purchaseMoneyMinor(r), 0);
    const discountCostMinor = grossRevenueMinor - netRevenueMinor;
    const refundsMoneyTotalMinor = refundRows.reduce((s, r) => s + refundMoneyMinor(r), 0);
    const revenueMinor = netRevenueMinor - refundsMoneyTotalMinor;
    const refundRatioPct =
      netRevenueMinor > 0 ? (refundsMoneyTotalMinor / netRevenueMinor) * 100 : 0;
    const refundFeeIncomeMinor = refundFeeTotals._sum.feeMinor ?? 0;

    const cpcConsumedMinor = -cpcSpendRows.reduce((s, r) => s + r.amountMinor, 0);
    const otherFeesConsumedMinor = -otherSpendRows.reduce((s, r) => s + r.amountMinor, 0);
    const otherFeesByCategory: Record<OneOffFeeCategory, number> = {
      aiUsage: 0,
      builderUnlock: 0,
      googleAds: 0,
      other: 0,
    };
    for (const r of otherSpendRows) {
      otherFeesByCategory[oneOffFeeCategory(r.provider ?? null, r.description ?? null)] +=
        -r.amountMinor;
    }

    // Gross (face value sold) vs net (money collected) — kept for the
    // discount KPI only. Earned revenue no longer uses this blended ratio:
    // the statement below values every consumed credit at the money that
    // was actually paid for THAT credit (FIFO replay, see ledger-engine.ts).
    const grossToNetRatio = grossRevenueMinor > 0 ? netRevenueMinor / grossRevenueMinor : 1;

    const walletLiabilityMinor = walletTotals._sum.balanceMinor ?? 0;
    const blockedWalletBalanceMinor = blockedWalletTotals._sum.balanceMinor ?? 0;
    // Refund rows carry a negative `amountMinor` (credit leaving the wallet);
    // reported here as a positive "this much is promised out" figure.
    const refundLiabilityInFlightMinor = Math.abs(refundInFlightTotals._sum.amountMinor ?? 0);

    const vatBreakdown = invoiceVatGroups
      .map((g) => ({
        vatRatePct: g.vatRatePct,
        currency: g.currency,
        invoiceCount: g._count._all,
        subtotalMinor: g._sum.subtotalMinor ?? 0,
        vatMinor: g._sum.vatMinor ?? 0,
        totalMinor: g._sum.totalMinor ?? 0,
      }))
      .sort((a, b) => a.vatRatePct - b.vatRatePct || a.currency.localeCompare(b.currency));

    const expensesByCategory: Record<string, number> = Object.fromEntries(
      EXPENSE_CATEGORIES.map((c) => [c, 0]),
    );
    // EUR cents: a foreign-currency document counts at the rate it was booked
    // at; one with no rate is left out (and flagged by the statement) instead
    // of being summed as if its RON/USD amount were euros.
    for (const row of expenseRows) {
      const eur = expenseEurMinor(row);
      if (eur !== null) expensesByCategory[row.category] += eur;
    }

    // --- The financial statement --------------------------------------
    // Earned revenue (credits consumed, valued at the real money behind
    // each one, NET OF VAT), every expense in EUR, and the operating profit,
    // plus Today / This month / This year and the customer advances at the
    // period end, all from ONE ledger replay (FinanceStatementService).
    const dash = await this.statements.dashboard({ from, to });
    const st = dash.statement;
    const aiCostMinor = st.expenses.ai.builderMinor;
    const campaignAgentCostMinor = st.expenses.ai.campaignAgentMinor;
    const operatingCostMinor = Object.values(st.expenses.byCategory).reduce((s, v) => s + v, 0);
    const totalCostMinor = st.expenses.totalMinor;
    const consumedRevenueRealMoneyMinor = st.revenue.totalNetMinor;
    const profitMinor = st.result.operatingProfitMinor;
    const unconsumedRevenueMinor = dash.balance.advancesMoneyMinor;
    const adSpendMinor = st.expenses.byCategory.google_ads;
    const cpcRevenueRealMoneyMinor = st.revenue.byCategory.cpc;

    // AI Builder profitability: earned AI-usage revenue (net of VAT) minus
    // what the platform paid the AI providers for it, plus the builder
    // unlock fee. The campaign agent and the homepage search are platform
    // costs with no revenue counterpart, so they're not folded in here
    // (they ARE in `totalCostMinor`).
    const aiBuilder = {
      promptRevenueRealMoneyMinor: st.revenue.byCategory.aiUsage,
      providerCostMinor: aiCostMinor,
      promptProfitMinor: st.revenue.byCategory.aiUsage - aiCostMinor,
      builderUnlockRevenueRealMoneyMinor: st.revenue.byCategory.builderUnlock,
      totalProfitMinor:
        st.revenue.byCategory.aiUsage - aiCostMinor + st.revenue.byCategory.builderUnlock,
      campaignAgentCostMinor,
      campaignAgentAvailable: true,
    };

    // Daily trend for the chart — bucket every row into its UTC day. AI cost
    // is accumulated as raw (unrounded) USD per day and converted to minor
    // units exactly once per day when the trend is finalised below — summing
    // already-rounded per-row cents first would under-count any day made up
    // of several sub-cent calls, same class of bug as `aiCostMinor` above
    // already avoids by rounding its own sum once.
    type DayBucket = {
      revenueMinor: number;
      costMinor: number;
      purchaseMoneyMinor: number;
      refundMoneyMinor: number;
    };
    const days = new Map<string, DayBucket>();
    const aiUsdByDay = new Map<string, number>();
    const bump = (date: Date, field: keyof DayBucket, amount: number) => {
      const key = dayKey(date);
      const bucket = days.get(key) ?? {
        revenueMinor: 0,
        costMinor: 0,
        purchaseMoneyMinor: 0,
        refundMoneyMinor: 0,
      };
      bucket[field] += amount;
      days.set(key, bucket);
    };
    for (const r of purchaseRows) {
      const money = purchaseMoneyMinor(r);
      bump(r.createdAt, 'revenueMinor', money);
      bump(r.createdAt, 'purchaseMoneyMinor', money);
    }
    for (const r of refundRows) {
      const money = refundMoneyMinor(r);
      bump(r.createdAt, 'revenueMinor', -money);
      bump(r.createdAt, 'refundMoneyMinor', money);
    }
    for (const r of expenseRows) bump(r.incurredOn, 'costMinor', expenseEurMinor(r) ?? 0);
    for (const r of aiRows) {
      const key = dayKey(r.createdAt);
      aiUsdByDay.set(key, (aiUsdByDay.get(key) ?? 0) + r.estimatedCostUsd);
    }
    for (const [key, usd] of aiUsdByDay) {
      bump(new Date(`${key}T00:00:00.000Z`), 'costMinor', usdToEurMinor(usd));
    }

    const trend = Array.from(days.entries())
      .map(([date, v]) => ({
        date,
        ...v,
        // Refunds as a share of the SAME day's collected money. 0 on a day
        // with no purchases (a refund of an earlier day's purchase has no
        // same-day denominator — reporting Infinity/100% there would read as
        // "everything we sold today came back", which isn't what happened).
        refundRatioPct:
          v.purchaseMoneyMinor > 0 ? (v.refundMoneyMinor / v.purchaseMoneyMinor) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // "Profit final" — always Today/This month/This year (UTC), independent
    // of the period filter, computed by the very same statement, so picking
    // "this month" in the filter reproduces `finalProfit.month` exactly.
    const figures = (x: typeof st) => ({
      consumedRevenueRealMoneyMinor: x.revenue.totalNetMinor,
      totalCostMinor: x.expenses.totalMinor,
      profitMinor: x.result.operatingProfitMinor,
    });
    const todayFigures = figures(dash.fixed.today);
    const monthFigures = figures(dash.fixed.month);
    const yearFigures = figures(dash.fixed.year);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      revenueMinor,
      /** Real money behind credits ALREADY consumed in the period — the
       *  actual basis for `profitMinor` (see its own comment above). */
      consumedRevenueRealMoneyMinor,
      /** `revenueMinor` minus the above: money collected for credits still
       *  sitting unconsumed in a wallet — not profit, still refundable. */
      unconsumedRevenueMinor,
      operatingCostMinor,
      aiCostMinor,
      totalCostMinor,
      profitMinor,
      /** Always Today/This month/This year (UTC) — see the comment above
       *  `todayFigures` for why these ignore the period filter. */
      finalProfit: { today: todayFigures, month: monthFigures, year: yearFigures },
      aiBuilder,
      expensesByCategory: st.expenses.byCategory,
      paidTraffic: {
        /** Credit face value of CPC clicks billed — unchanged. */
        cpcRevenueMinor: cpcConsumedMinor,
        /** The same consumption weighted by the period's gross→net ratio,
         *  i.e. the real money behind those credits. */
        cpcRevenueRealMoneyMinor,
        adSpendMinor,
        profitMinor: cpcConsumedMinor - adSpendMinor,
        realMoneyProfitMinor: cpcRevenueRealMoneyMinor - adSpendMinor,
      },
      otherFeesConsumedMinor,
      /** Breakdown of `otherFeesConsumedMinor` using the same classification
       *  `wallet.service.ts` applies to non-CPC spend rows. */
      otherFeesByCategory,
      /** The CPC-vs-one-off split, labelled for what it actually is:
       *  recurring (daily click billing) vs one-time (builder unlock, extra
       *  business, AI usage). Both halves are credit consumption at face
       *  value — the same two numbers as `paidTraffic.cpcRevenueMinor` and
       *  `otherFeesConsumedMinor`, kept here as an explicit pair. */
      creditConsumption: {
        recurringMinor: cpcConsumedMinor,
        oneTimeMinor: otherFeesConsumedMinor,
        oneTimeByCategory: otherFeesByCategory,
      },
      /** Gross (credit face value sold) vs net (money collected); the delta
       *  is the period's discount cost. */
      grossRevenueMinor,
      netRevenueMinor,
      discountCostMinor,
      grossToNetRatio,
      refundsMoneyMinor: refundsMoneyTotalMinor,
      refundRatioPct,
      refundFeeIncomeMinor,
      /** Point-in-time (all-time) balance-sheet figures — see the queries. */
      walletLiabilityMinor,
      blockedWalletBalanceMinor,
      refundLiabilityInFlightMinor,
      vatBreakdown,
      trend,
      /** The full financial statement for the period (see
       *  FinanceStatementService): cash, earned revenue, expenses, result,
       *  and what information is missing for an exact figure. */
      statement: st,
      /** Customer advances (paid credits not consumed yet) at the period end. */
      balance: dash.balance,
      /** Daily earned revenue / expenses / net cash, same figures as `statement`. */
      daily: dash.daily,
    };
  }

  // -------------------------------------------------------------------------
  // Raport financiar (cont de profit și pierdere) + verificări
  // -------------------------------------------------------------------------

  /** The annual view: one statement per calendar month + the year total. */
  monthlyReport(year: number) {
    return this.statements.monthly(year);
  }

  /** Data-integrity checks an accountant runs before trusting the figures. */
  checks() {
    return this.statements.checks();
  }

  /** Sales invoices issued in the range (the sales journal). */
  private async invoiceSheet(from: Date, to: Date): Promise<Sheet> {
    const invoices = await this.prisma.invoice.findMany({
      where: { kind: 'topup', issuedAt: { gte: from, lte: to } },
      orderBy: { issuedAt: 'asc' },
      take: EXPORT_ROW_CAP,
      select: {
        number: true,
        issuedAt: true,
        buyerName: true,
        buyerTaxId: true,
        buyerKind: true,
        currency: true,
        subtotalMinor: true,
        vatRatePct: true,
        vatMinor: true,
        totalMinor: true,
        eurCents: true,
        fxRate: true,
        voidedAt: true,
        voidReason: true,
      },
    });
    const valid = invoices.filter((i) => !i.voidedAt);
    return {
      name: 'Jurnal vânzări',
      title: ['Facturi emise (vânzări de credite)'],
      columns: [
        { label: 'Număr', width: 16 },
        { label: 'Data', width: 12 },
        { label: 'Client', width: 30 },
        { label: 'CUI / CNP', width: 16 },
        { label: 'Tip client', width: 12 },
        { label: 'Monedă', width: 8 },
        { label: 'Bază', width: 14, money: true },
        { label: 'Cotă TVA %', width: 10 },
        { label: 'TVA', width: 14, money: true },
        { label: 'Total', width: 14, money: true },
        { label: 'Echivalent EUR', width: 14, money: true },
        { label: 'Curs EUR/RON', width: 12 },
        { label: 'Anulată', width: 12 },
        { label: 'Motiv anulare', width: 30 },
      ],
      rows: [
        ...invoices.map((i) => [
          i.number,
          dayRo(i.issuedAt),
          i.buyerName,
          i.buyerTaxId ?? '',
          i.buyerKind,
          i.currency,
          eurNum(i.subtotalMinor),
          i.vatRatePct,
          eurNum(i.vatMinor),
          eurNum(i.totalMinor),
          i.eurCents === null ? null : eurNum(i.eurCents),
          i.fxRate === null ? '' : Number(i.fxRate),
          i.voidedAt ? dayRo(i.voidedAt) : '',
          i.voidReason ?? '',
        ]),
        {
          bold: true,
          cells: [
            'TOTAL (fără anulate)',
            '',
            `${valid.length} facturi`,
            '',
            '',
            '',
            eurNum(valid.reduce((s, i) => s + i.subtotalMinor, 0)),
            '',
            eurNum(valid.reduce((s, i) => s + i.vatMinor, 0)),
            eurNum(valid.reduce((s, i) => s + i.totalMinor, 0)),
            eurNum(valid.reduce((s, i) => s + (i.eurCents ?? 0), 0)),
            '',
            '',
            '',
          ],
        },
      ],
    };
  }

  private statementSheet(
    st: FinancialStatement,
    balance: BalanceSnapshot | null,
    title: string[],
  ): Sheet {
    return {
      name: 'Profit și pierdere',
      title,
      columns: [
        { label: 'Indicator', width: 70 },
        { label: 'Sumă (EUR)', width: 16, money: true },
      ],
      rows: [
        ...statementLines(st, balance).map((l) => ({
          bold: l.bold,
          cells: [l.label, l.amountMinor === null ? (l.text ?? null) : eurNum(l.amountMinor)],
        })),
        { cells: ['', null] },
        { bold: true, cells: ['Informații lipsă / de reținut', null] },
        ...st.missing.map((m) => ({ cells: [missingNoteRo(m), null] })),
      ],
    };
  }

  /** The financial report export: a period (from/to/all) or a whole `year`
   *  broken down by month. PDF / CSV / XLSX carry the exact same figures as
   *  the dashboard statement (same service, same lines). */
  async exportReport(q: ReportExportQuery): Promise<ExportFile> {
    const format = q.format ?? 'pdf';

    if (q.year) {
      const year = q.year;
      const { months, total } = await this.statements.monthly(year);
      const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
      const now = new Date();
      const balance = await this.statements.balanceAsOf(yearEnd < now ? yearEnd : now);
      const stem = `raport-financiar-${year}`;
      const title = [
        `Totalvizibil - Raport financiar anual ${year}`,
        'Sume în EUR. Venituri și cheltuieli fără TVA.',
      ];

      // The full statement, one column per month: every month gives the
      // exact same lines (`counts: false`), so the rows line up.
      const matrixLines = months.map((m) => statementLines(m, null, { counts: false }));
      const totalLines = statementLines(total, null, { counts: false });
      const matrix: Sheet = {
        name: `Pe luni ${year}`,
        title,
        columns: [
          { label: 'Indicator', width: 60 },
          ...MONTHS_RO.map((m) => ({ label: m, width: 13, money: true })),
          { label: `Total ${year}`, width: 15, money: true },
        ],
        rows: totalLines.map((l, i) => ({
          bold: l.bold,
          cells: [
            l.label,
            ...matrixLines.map((ml) => {
              const x = ml[i];
              return x.amountMinor === null ? (x.text ?? null) : eurNum(x.amountMinor);
            }),
            l.amountMinor === null ? (l.text ?? null) : eurNum(l.amountMinor),
          ],
        })),
      };

      if (format === 'csv') return csvFile(stem, toCsv(matrix));
      if (format === 'xlsx') {
        const yearStart = new Date(Date.UTC(year, 0, 1));
        const [txRows, expRows, invSheet] = await Promise.all([
          this.revenueExportRows(
            {
              from: dayKey(yearStart),
              to: dayKey(yearEnd),
              types: ['purchase', 'refund', 'adjustment', 'spend'],
              status: 'all',
            },
            EXPORT_ROW_CAP,
          ),
          this.prisma.platformExpense.findMany({
            where: { incurredOn: { gte: yearStart, lte: yearEnd } },
            orderBy: { incurredOn: 'asc' },
            include: { createdBy: { select: { name: true } } },
          }),
          this.invoiceSheet(yearStart, yearEnd),
        ]);
        return xlsxFile(
          stem,
          await toXlsx([
            this.statementSheet(total, balance, [...title, `Perioada: ${year}`]),
            matrix,
            this.revenueSheet(txRows, [`Toate tranzacțiile ${year}`]),
            this.expensesSheet(expRows, [`Cheltuieli ${year}`]),
            invSheet,
          ]),
        );
      }

      const pick = (s: FinancialStatement) => MONTHLY_COLUMNS.map((c) => eurText(c.pick(s)));
      const buffer = await generateTablePdf({
        title: `Raport financiar anual ${year}`,
        ownerName: 'Totalvizibil',
        subtitle: `01.01.${year} - 31.12.${year}`,
        landscape: true,
        fontSize: 8,
        columns: [
          { label: 'Luna', width: 0.13 },
          ...MONTHLY_COLUMNS.map((c) => ({
            label: c.label,
            width: 0.87 / MONTHLY_COLUMNS.length,
            align: 'right' as const,
          })),
        ],
        rows: [
          ...months.map((m, i) => [MONTHS_RO[i], ...pick(m)]),
          { bold: true, cells: [`TOTAL ${year}`, ...pick(total)] },
        ],
        emptyText: '',
        footnotes: total.missing.map(missingNoteRo),
        appendix: [
          {
            title: `Cont de profit și pierdere ${year}`,
            columns: [
              { label: 'Indicator', width: 0.75 },
              { label: 'Sumă', width: 0.25, align: 'right' },
            ],
            rows: statementLines(total, balance).map((l) => ({
              bold: l.bold,
              cells: [l.label, l.amountMinor === null ? (l.text ?? '') : eurText(l.amountMinor)],
            })),
          },
        ],
      });
      return pdfFile(stem, buffer);
    }

    const { from, to } = this.resolveRange(q);
    const [st, balance] = await Promise.all([
      this.statements.statement({ from, to }),
      this.statements.balanceAsOf(to),
    ]);
    const label = this.periodLabel(q, from, to);
    const stem = `raport-financiar-${dayKey(from)}_${dayKey(to)}`;
    const title = [
      'Totalvizibil - Cont de profit și pierdere',
      `Perioada: ${label}`,
      'Sume în EUR.',
    ];
    const sheet = this.statementSheet(st, balance, title);

    if (format === 'csv') return csvFile(stem, toCsv(sheet));
    if (format === 'xlsx') {
      const [txRows, expRows, invSheet] = await Promise.all([
        this.revenueExportRows(
          {
            from: q.all ? undefined : dayKey(from),
            to: dayKey(to),
            all: q.all,
            types: ['purchase', 'refund', 'adjustment', 'spend'],
            status: 'all',
          },
          EXPORT_ROW_CAP,
        ),
        this.prisma.platformExpense.findMany({
          where: { incurredOn: { gte: from, lte: to } },
          orderBy: { incurredOn: 'asc' },
          include: { createdBy: { select: { name: true } } },
        }),
        this.invoiceSheet(from, to),
      ]);
      return xlsxFile(
        stem,
        await toXlsx([
          sheet,
          this.revenueSheet(txRows, [`Toate tranzacțiile: ${label}`]),
          this.expensesSheet(expRows, [`Cheltuieli: ${label}`]),
          invSheet,
        ]),
      );
    }
    const buffer = await generateTablePdf({
      title: 'Cont de profit și pierdere',
      ownerName: 'Totalvizibil',
      subtitle: label,
      columns: [
        { label: 'Indicator', width: 0.75 },
        { label: 'Sumă', width: 0.25, align: 'right' },
      ],
      rows: statementLines(st, balance).map((l) => ({
        bold: l.bold,
        cells: [l.label, l.amountMinor === null ? (l.text ?? '') : eurText(l.amountMinor)],
      })),
      emptyText: '',
      footnotes: st.missing.map(missingNoteRo),
    });
    return pdfFile(stem, buffer);
  }

  // -------------------------------------------------------------------------
  // Registrul tranzacțiilor (Venituri)
  // -------------------------------------------------------------------------

  /** The register's `where`, shared by the list, its totals and every export,
   *  so a download can never cover a different slice than the screen:
   *   - the period runs through the same `resolveRange()` as the overview;
   *   - types default to `purchase`+`refund` (the cash rows), widened by
   *     `types=` to adjustments and consumption;
   *   - status defaults to `completed` (the rows that actually moved money);
   *   - `q` searches client, business, description, payment reference,
   *     invoice number and transaction id; min/max bound the absolute amount. */
  private revenueWhere(q: ListRevenueQuery): Prisma.WalletTransactionWhereInput {
    const types: WalletTxnType[] = q.type
      ? [q.type]
      : [...(q.types?.length ? q.types : DEFAULT_REVENUE_TXN_TYPES)];
    const { from, to } = this.resolveRange(q);
    const status = q.status ?? 'completed';
    const and: Prisma.WalletTransactionWhereInput[] = [NOT_VOIDED_INVOICE];
    if (q.minAmount !== undefined || q.maxAmount !== undefined) {
      const min = q.minAmount ?? 0;
      const max = q.maxAmount ?? 2_000_000_000;
      and.push({
        OR: [{ amountMinor: { gte: min, lte: max } }, { amountMinor: { gte: -max, lte: -min } }],
      });
    }
    if (q.q) {
      const c = { contains: q.q, mode: 'insensitive' as const };
      const or: Prisma.WalletTransactionWhereInput[] = [
        { wallet: { user: { name: c } } },
        { wallet: { user: { email: c } } },
        { company: { displayName: c } },
        { description: c },
        { providerRef: c },
        { invoice: { is: { number: c } } },
      ];
      if (UUID_RE.test(q.q)) or.push({ id: q.q });
      and.push({ OR: or });
    }
    return {
      type: { in: types },
      ...(status === 'all' ? {} : { status }),
      createdAt: { gte: from, lte: to },
      AND: and,
    };
  }

  private revenueOrder(q: ListRevenueQuery): Prisma.WalletTransactionOrderByWithRelationInput[] {
    switch (q.sort) {
      case 'date_asc':
        return [{ createdAt: 'asc' }, { id: 'asc' }];
      case 'amount_desc':
        return [{ amountMinor: 'desc' }, { createdAt: 'desc' }];
      case 'amount_asc':
        return [{ amountMinor: 'asc' }, { createdAt: 'desc' }];
      default:
        return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  }

  private static readonly REVENUE_ROW_INCLUDE = {
    wallet: { select: { user: { select: { id: true, name: true, email: true } } } },
    company: { select: { displayName: true } },
    invoice: { select: { number: true, vatRatePct: true } },
  } as const;

  /** Enough of a row to compute its money value (purchases need `eurCents`,
   *  refunds `refundSources`/`feeMinor`) and its status, since only a
   *  completed row moved real money. */
  private static readonly REVENUE_ROW_MONEY_SELECT = {
    type: true,
    status: true,
    amountMinor: true,
    eurCents: true,
    refundSources: true,
    feeMinor: true,
  } as const;

  private static moneyOf(r: Parameters<typeof rowMoneyMinor>[0] & { status: string }): number {
    return r.status === 'completed' ? rowMoneyMinor(r) : 0;
  }

  private mapRevenueRow(
    t: Prisma.WalletTransactionGetPayload<{ include: typeof FinanceService.REVENUE_ROW_INCLUDE }>,
  ) {
    const moneyMinor = FinanceService.moneyOf(t);
    return {
      id: t.id,
      type: t.type,
      status: t.status,
      /** Credit face value (what the wallet moved). */
      amountMinor: t.amountMinor,
      /** Real money (what the bank moved), 0 for rows that moved none. */
      moneyMinor,
      /** VAT inside a purchase's money, from its invoice (null = no invoice). */
      vatMinor: t.type === 'purchase' && t.invoice ? vatOf(moneyMinor, t.invoice.vatRatePct) : null,
      createdAt: t.createdAt,
      userId: t.wallet.user?.id ?? null,
      userName: t.wallet.user?.name ?? null,
      userEmail: t.wallet.user?.email ?? null,
      companyName: t.company?.displayName ?? null,
      description: t.description,
      invoiceNumber: t.invoice?.number ?? null,
      providerRef: t.providerRef,
      clickCount: t.clickCount,
      category: t.type === 'spend' ? consumptionCategory(t) : null,
    };
  }

  async listRevenue(q: ListRevenueQuery) {
    const where = this.revenueWhere(q);
    const { from, to } = this.resolveRange(q);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;

    const [items, total, allRows] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: this.revenueOrder(q),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: FinanceService.REVENUE_ROW_INCLUDE,
      }),
      this.prisma.walletTransaction.count({ where }),
      // The period total covers the FULL filtered set, not the page. Can't be
      // a SQL SUM: a refund's real-money value lives in its JSON sources.
      this.prisma.walletTransaction.findMany({
        where,
        select: FinanceService.REVENUE_ROW_MONEY_SELECT,
      }),
    ]);

    return {
      items: items.map((t) => this.mapRevenueRow(t)),
      total,
      page,
      pageSize,
      range: { from: from.toISOString(), to: to.toISOString() },
      /** Real-money net total of the whole filtered set. With the default
       *  types/status over the same range this equals `overview().revenueMinor`. */
      periodTotalMinor: allRows.reduce((s, r) => s + FinanceService.moneyOf(r), 0),
      /** Credit face value net total of the whole filtered set. */
      periodFaceTotalMinor: allRows.reduce((s, r) => s + r.amountMinor, 0),
      /** Per-type subtotals (count, credits, money) of the filtered set. */
      byType: Object.fromEntries(
        (['purchase', 'refund', 'adjustment', 'spend'] as const).map((type) => {
          const rows = allRows.filter((r) => r.type === type);
          return [
            type,
            {
              count: rows.length,
              amountMinor: rows.reduce((s, r) => s + r.amountMinor, 0),
              moneyMinor: rows.reduce((s, r) => s + FinanceService.moneyOf(r), 0),
            },
          ];
        }),
      ),
    };
  }

  /** Every row of the filtered register, for the exports (capped). */
  private async revenueExportRows(q: ListRevenueQuery, cap: number) {
    const rows = await this.prisma.walletTransaction.findMany({
      where: this.revenueWhere(q),
      orderBy: this.revenueOrder(q),
      take: cap,
      include: FinanceService.REVENUE_ROW_INCLUDE,
    });
    return rows.map((t) => this.mapRevenueRow(t));
  }

  private revenueSheet(rows: RevenueRowOut[], title: string[]): Sheet {
    const sum = (f: (r: RevenueRowOut) => number) => rows.reduce((s, r) => s + f(r), 0);
    return {
      name: 'Tranzacții',
      title,
      columns: [
        { label: 'Data', width: 12 },
        { label: 'Ora (UTC)', width: 9 },
        { label: 'Tip', width: 20 },
        { label: 'Status', width: 12 },
        { label: 'Client', width: 24 },
        { label: 'Email', width: 28 },
        { label: 'Afacere', width: 22 },
        { label: 'Descriere', width: 30 },
        { label: 'Nr. factură', width: 16 },
        { label: 'Referință plată', width: 30 },
        { label: 'Credite (EUR)', width: 14, money: true },
        { label: 'Bani (EUR)', width: 14, money: true },
        { label: 'din care TVA (EUR)', width: 14, money: true },
        { label: 'ID tranzacție', width: 38 },
      ],
      rows: [
        ...rows.map((r) => [
          dayRo(r.createdAt),
          r.createdAt.toISOString().slice(11, 16),
          r.type === 'spend' && r.category
            ? `${TXN_TYPE_RO.spend}: ${CONSUMPTION_RO[r.category]}`
            : TXN_TYPE_RO[r.type],
          TXN_STATUS_RO[r.status] ?? r.status,
          r.userName ?? '',
          r.userEmail ?? '',
          r.companyName ?? '',
          r.description ?? '',
          r.invoiceNumber ?? '',
          r.providerRef ?? '',
          eurNum(r.amountMinor),
          eurNum(r.moneyMinor),
          r.vatMinor === null ? null : eurNum(r.vatMinor),
          r.id,
        ]),
        {
          bold: true,
          cells: [
            'TOTAL',
            '',
            `${rows.length} rânduri`,
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            eurNum(sum((r) => r.amountMinor)),
            eurNum(sum((r) => r.moneyMinor)),
            eurNum(sum((r) => r.vatMinor ?? 0)),
            '',
          ],
        },
      ],
    };
  }

  private periodLabel(q: { all?: boolean }, from: Date, to: Date): string {
    return q.all ? `Dintotdeauna, până la ${dayRo(to)}` : `${dayRo(from)} - ${dayRo(to)}`;
  }

  async exportRevenue(q: ListRevenueQuery): Promise<ExportFile> {
    const format = q.format ?? 'pdf';
    const { from, to } = this.resolveRange(q);
    const label = this.periodLabel(q, from, to);
    const stem = `tranzactii-${dayKey(from)}_${dayKey(to)}`;

    if (format !== 'pdf') {
      const rows = await this.revenueExportRows(q, EXPORT_ROW_CAP);
      const sheet = this.revenueSheet(rows, [
        'Totalvizibil - Registrul tranzacțiilor',
        `Perioada: ${label}`,
        ...(rows.length >= EXPORT_ROW_CAP ? [`Limitat la primele ${EXPORT_ROW_CAP} rânduri.`] : []),
      ]);
      return format === 'csv' ? csvFile(stem, toCsv(sheet)) : xlsxFile(stem, await toXlsx([sheet]));
    }

    const [rows, totals] = await Promise.all([
      this.revenueExportRows(q, PDF_ROW_CAP),
      this.listRevenue({ ...q, page: 1, pageSize: 1 }),
    ]);
    const buffer = await generateTablePdf({
      title: 'Registrul tranzacțiilor',
      ownerName: 'Totalvizibil',
      subtitle: label,
      landscape: true,
      fontSize: 8,
      columns: [
        { label: 'Data', width: 0.08 },
        { label: 'Tip', width: 0.1 },
        { label: 'Status', width: 0.08 },
        { label: 'Client', width: 0.2 },
        { label: 'Afacere', width: 0.14 },
        { label: 'Factură / ref.', width: 0.16 },
        { label: 'Credite', width: 0.08, align: 'right' },
        { label: 'Bani', width: 0.08, align: 'right' },
        { label: 'TVA', width: 0.08, align: 'right' },
      ],
      rows: rows.length
        ? [
            ...rows.map((t) => [
              dayRo(t.createdAt),
              t.type === 'spend' && t.category ? CONSUMPTION_RO[t.category] : TXN_TYPE_RO[t.type],
              TXN_STATUS_RO[t.status] ?? t.status,
              [t.userName, t.userEmail].filter(Boolean).join('\n') || '-',
              t.companyName ?? '-',
              t.invoiceNumber ?? t.providerRef ?? '-',
              eurText(t.amountMinor),
              eurText(t.moneyMinor),
              t.vatMinor === null ? '-' : eurText(t.vatMinor),
            ]),
            // Totals over the whole filtered set, even if the rows were capped.
            {
              bold: true,
              cells: [
                'TOTAL',
                `${totals.total} rânduri`,
                '',
                '',
                '',
                '',
                eurText(totals.periodFaceTotalMinor),
                eurText(totals.periodTotalMinor),
                '',
              ],
            },
          ]
        : [],
      emptyText: 'Nicio tranzacție în perioada selectată.',
      footnotes: [
        ...(totals.total > PDF_ROW_CAP
          ? [
              `PDF-ul listează primele ${PDF_ROW_CAP} rânduri; totalul acoperă toate cele ${totals.total}. Pentru lista completă exportați în Excel sau CSV.`,
            ]
          : []),
        'Bani = suma reală încasată (cumpărare) sau returnată (rambursare). Consumul și ajustările nu mișcă bani. TVA = din factura emisă.',
      ],
    });
    return pdfFile(stem, buffer);
  }

  // -------------------------------------------------------------------------
  // Costuri (manual CRUD)
  // -------------------------------------------------------------------------

  private expensesWhere(q: ListExpensesQuery) {
    return {
      ...(q.category ? { category: q.category } : {}),
      ...(!q.all && (q.from || q.to)
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

    const [items, total, all] = await this.prisma.$transaction([
      this.prisma.platformExpense.findMany({
        where,
        orderBy: { incurredOn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { createdBy: { select: { name: true } } },
      }),
      this.prisma.platformExpense.count({ where }),
      this.prisma.platformExpense.findMany({
        where,
        select: { currency: true, amountMinor: true, eurAmountMinor: true },
      }),
    ]);

    // Unlike `resolveRange()`'s callers, this endpoint has no implicit
    // default: absent `from`/`to` already means "every row ever".
    const isLifetime = !!q.all || (!q.from && !q.to);
    return {
      items: items.map((x) => ({
        ...x,
        fxRate: x.fxRate === null ? null : Number(x.fxRate),
        /** EUR cents every report sums (null = foreign currency, no rate). */
        eurMinor: expenseEurMinor(x),
      })),
      total,
      page,
      pageSize,
      range: { from: isLifetime ? null : (q.from ?? null), to: isLifetime ? null : (q.to ?? null) },
      /** EUR total of the whole filtered set (rows without a rate excluded). */
      totalEurMinor: all.reduce((s, x) => s + (expenseEurMinor(x) ?? 0), 0),
      /** Rows left out of the EUR total for lack of an exchange rate. */
      missingFxCount: all.filter((x) => expenseEurMinor(x) === null).length,
    };
  }

  async exportExpenses(q: ListExpensesQuery): Promise<ExportFile> {
    const format = q.format ?? 'pdf';
    const where = this.expensesWhere(q);
    const rows = await this.prisma.platformExpense.findMany({
      where,
      orderBy: { incurredOn: 'desc' },
      take: format === 'pdf' ? PDF_ROW_CAP : EXPORT_ROW_CAP,
      include: { createdBy: { select: { name: true } } },
    });
    const lifetime = !!q.all || (!q.from && !q.to);
    const label = lifetime ? 'Dintotdeauna' : `${q.from ?? '...'} - ${q.to ?? '...'}`;
    const stem = `cheltuieli-${lifetime ? 'toate' : `${q.from ?? 'start'}_${q.to ?? 'azi'}`}`;
    const totalEur = rows.reduce((s, r) => s + (expenseEurMinor(r) ?? 0), 0);

    if (format !== 'pdf') {
      const sheet = this.expensesSheet(rows, ['Totalvizibil - Cheltuieli', `Perioada: ${label}`]);
      return format === 'csv' ? csvFile(stem, toCsv(sheet)) : xlsxFile(stem, await toXlsx([sheet]));
    }
    const buffer = await generateTablePdf({
      title: 'Cheltuieli',
      ownerName: 'Totalvizibil',
      subtitle: label,
      columns: [
        { label: 'Data', width: 0.12 },
        { label: 'Categorie', width: 0.18 },
        { label: 'Sursă', width: 0.13 },
        { label: 'Notă', width: 0.25 },
        { label: 'Sumă document', width: 0.16, align: 'right' },
        { label: 'Sumă EUR', width: 0.16, align: 'right' },
      ],
      rows: rows.length
        ? [
            ...rows.map((r) => {
              const eur = expenseEurMinor(r);
              return [
                dayRo(r.incurredOn),
                EXPENSE_CATEGORY_RO[r.category] ?? r.category,
                EXPENSE_SOURCE_RO[r.source] ?? r.source,
                r.note ?? '-',
                `${(r.amountMinor / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} ${r.currency}`,
                eur === null ? 'fără curs' : eurText(eur),
              ];
            }),
            { bold: true, cells: ['TOTAL', '', '', '', '', eurText(totalEur)] },
          ]
        : [],
      emptyText: 'Nicio cheltuială înregistrată în perioada selectată.',
      footnotes: rows.some((r) => expenseEurMinor(r) === null)
        ? [
            'Cheltuielile marcate "fără curs" sunt în altă monedă și nu au curs de schimb: nu sunt incluse în total.',
          ]
        : [],
    });
    return pdfFile(stem, buffer);
  }

  private expensesSheet(
    rows: {
      incurredOn: Date;
      category: string;
      source: string;
      note: string | null;
      amountMinor: number;
      currency: string;
      fxRate: Prisma.Decimal | null;
      eurAmountMinor: number | null;
      externalRef?: string | null;
      createdBy?: { name: string } | null;
    }[],
    title: string[],
  ): Sheet {
    const total = rows.reduce((s, r) => s + (expenseEurMinor(r) ?? 0), 0);
    return {
      name: 'Cheltuieli',
      title,
      columns: [
        { label: 'Data', width: 12 },
        { label: 'Categorie', width: 22 },
        { label: 'Sursă', width: 18 },
        { label: 'Notă', width: 34 },
        { label: 'Sumă document', width: 14, money: true },
        { label: 'Monedă', width: 8 },
        { label: 'Curs (unități / 1 EUR)', width: 14 },
        { label: 'Sumă EUR', width: 14, money: true },
        { label: 'Adăugat de', width: 18 },
        { label: 'Referință externă', width: 30 },
      ],
      rows: [
        ...rows.map((r) => {
          const eur = expenseEurMinor(r);
          return [
            dayRo(r.incurredOn),
            EXPENSE_CATEGORY_RO[r.category] ?? r.category,
            EXPENSE_SOURCE_RO[r.source] ?? r.source,
            r.note ?? '',
            eurNum(r.amountMinor),
            r.currency,
            r.currency === 'EUR' ? 1 : r.fxRate === null ? 'lipsă' : Number(r.fxRate),
            eur === null ? null : eurNum(eur),
            r.createdBy?.name ?? '',
            r.externalRef ?? '',
          ];
        }),
        { bold: true, cells: ['TOTAL', '', '', '', null, '', '', eurNum(total), '', ''] },
      ],
    };
  }

  /** EUR cents of a document: itself for EUR, `amount / rate` otherwise. */
  private resolveExpenseFx(
    currency: string,
    amountMinor: number,
    fxRate: number | undefined,
  ): { fxRate: Prisma.Decimal | null; eurAmountMinor: number | null } {
    if (currency === 'EUR') return { fxRate: null, eurAmountMinor: null };
    if (!fxRate || fxRate <= 0) {
      throw new BadRequestException({ message: 'fx_rate_required', statusCode: 400 });
    }
    return {
      fxRate: new Prisma.Decimal(fxRate),
      eurAmountMinor: Math.round(amountMinor / fxRate),
    };
  }

  createExpense(dto: CreateExpenseDto, createdById: string) {
    const currency = dto.currency ?? DEFAULT_EXPENSE_CURRENCY;
    const fx = this.resolveExpenseFx(currency, dto.amountMinor, dto.fxRate);
    return this.prisma.platformExpense.create({
      data: {
        category: dto.category,
        incurredOn: new Date(dto.incurredOn),
        amountMinor: dto.amountMinor,
        // Absent = the schema's own EUR default; passing it explicitly keeps
        // the create and update paths reading the same way.
        currency,
        ...fx,
        note: dto.note,
        source: 'manual',
        createdById,
      },
    });
  }

  /** Any non-`manual` expense row is auto-captured bookkeeping (Stripe fees,
   *  the daily real Google Ads cost — see `GoogleAdsCpcSyncService`, and any
   *  future automated source): it exists so the platform's books reconcile
   *  against an external system's own record. Editing or deleting one breaks
   *  that reconciliation silently, so it takes a full `admin` — the
   *  `finance` role alone (which otherwise has complete access to this
   *  module) is not enough. */
  private assertMayMutate(
    expense: { source: string },
    actor: Pick<AuthPrincipal, 'platformRoles'>,
  ): void {
    if (expense.source === 'manual') return;
    if (actor.platformRoles.includes('admin')) return;
    throw new ForbiddenException({
      message: 'automated_expense_readonly',
      statusCode: 403,
    });
  }

  async updateExpense(id: string, dto: UpdateExpenseDto, actor: AuthPrincipal) {
    const existing = await this.prisma.platformExpense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Expense not found');
    this.assertMayMutate(existing, actor);

    // `createdById` is deliberately NOT touched — it answers "who created
    // this", not "who last changed it", so overwriting it with the editor
    // would destroy the original attribution. `updatedAt` (the model's own
    // @updatedAt) moves on its own, so the WHEN of an edit is recorded; the
    // WHO has no column to go in yet — `PlatformExpense` has no
    // `updatedById`, and adding one is a migration (out of scope here).
    // The EUR value is re-derived whenever the amount, currency or rate
    // changes, from the row's resulting values (a partial edit keeps the
    // stored rate unless a new one is sent).
    const currency = dto.currency ?? existing.currency;
    const amountMinor = dto.amountMinor ?? existing.amountMinor;
    const touchesMoney =
      dto.currency !== undefined || dto.amountMinor !== undefined || dto.fxRate !== undefined;
    const fx = touchesMoney
      ? this.resolveExpenseFx(
          currency,
          amountMinor,
          dto.fxRate ?? (existing.fxRate == null ? undefined : Number(existing.fxRate)),
        )
      : {};
    return this.prisma.platformExpense.update({
      where: { id },
      data: {
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.incurredOn ? { incurredOn: new Date(dto.incurredOn) } : {}),
        ...(dto.amountMinor !== undefined ? { amountMinor: dto.amountMinor } : {}),
        ...(dto.currency ? { currency: dto.currency } : {}),
        ...fx,
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });
  }

  async deleteExpense(id: string, actor: AuthPrincipal): Promise<void> {
    const existing = await this.prisma.platformExpense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Expense not found');
    this.assertMayMutate(existing, actor);
    await this.prisma.platformExpense.delete({ where: { id } });
  }

  // -------------------------------------------------------------------------
  // Registrul facturilor anulate / Top afaceri (small tabular reports)
  // -------------------------------------------------------------------------

  /** Invoices VOIDED inside the period (filtered on `voidedAt`, not
   *  `issuedAt` — the event being reported is the annulment, which is what a
   *  fiscal register of voided documents has to account for). */
  async listVoidedInvoices(q: PagedPeriodQuery) {
    const { from, to } = this.resolveRange(q);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where: Prisma.InvoiceWhereInput = {
      voidedAt: { not: null, gte: from, lte: to },
    };

    const [items, total, totals] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        orderBy: { voidedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          number: true,
          kind: true,
          issuedAt: true,
          voidedAt: true,
          voidReason: true,
          currency: true,
          subtotalMinor: true,
          vatMinor: true,
          totalMinor: true,
          buyerName: true,
        },
      }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.aggregate({ _sum: { totalMinor: true }, where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      range: { from: from.toISOString(), to: to.toISOString() },
      /** Header figure: the face value annulled over the whole period. */
      voidedTotalMinor: totals._sum.totalMinor ?? 0,
    };
  }

  /** CPC spend per business for the period, biggest spender first. Grouped
   *  on the daily-rollup spend rows (`spendDay != null`) — the same rows the
   *  overview's `paidTraffic.cpcRevenueMinor` is built from, so the column
   *  sums back to that figure. */
  async listTopCompanies(q: PagedPeriodQuery) {
    const { from, to } = this.resolveRange(q);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;

    const groups = await this.prisma.walletTransaction.groupBy({
      by: ['companyId'],
      where: {
        type: 'spend',
        status: 'completed',
        spendDay: { not: null },
        companyId: { not: null },
        createdAt: { gte: from, lte: to },
      },
      _sum: { amountMinor: true, clickCount: true },
      // Spend is stored negative, so ascending = largest spender first.
      orderBy: { _sum: { amountMinor: 'asc' } },
    });

    // Paged in memory on purpose: the row count here is "businesses that ran
    // ads this month" (tens, not millions), and the total needs the full
    // group list anyway.
    const pageGroups = groups.slice((page - 1) * pageSize, page * pageSize);
    const companies = pageGroups.length
      ? await this.prisma.company.findMany({
          where: { id: { in: pageGroups.map((g) => g.companyId as string) } },
          select: { id: true, displayName: true, slug: true },
        })
      : [];
    const byId = new Map(companies.map((c) => [c.id, c]));

    return {
      items: pageGroups.map((g) => {
        const company = byId.get(g.companyId as string);
        return {
          companyId: g.companyId as string,
          companyName: company?.displayName ?? null,
          companySlug: company?.slug ?? null,
          spendMinor: -(g._sum.amountMinor ?? 0),
          clicks: g._sum.clickCount ?? 0,
        };
      }),
      total: groups.length,
      page,
      pageSize,
      range: { from: from.toISOString(), to: to.toISOString() },
      totalSpendMinor: -groups.reduce((s, g) => s + (g._sum.amountMinor ?? 0), 0),
    };
  }

  // -------------------------------------------------------------------------
  // Consum AI
  // -------------------------------------------------------------------------

  private async aiRows(q: FinancePeriodQuery) {
    const { from, to } = this.resolveRange(q);
    const [rows, googleAdsAgentRuns, cycles, chatTurns] = await Promise.all([
      this.prisma.aiUsageRecord.findMany({
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
      }),
      // The Google Ads campaign-management agent's own Claude spend — kept
      // under a distinct `provider` ("google-ads-agent", never "claude") so
      // it can never silently merge into — and get mistaken for — ordinary
      // builder usage of the same underlying model.
      this.prisma.googleAdsAgentRun.findMany({
        where: { startedAt: { gte: from, lte: to }, claudeCostEstimateMinor: { not: null } },
        select: {
          claudeModel: true,
          claudeInputTokens: true,
          claudeOutputTokens: true,
          claudeCostEstimateMinor: true,
          claudeCallCount: true,
        },
      }),
      // Customers' Google Ads optimization cycles (google-ads-user/): real
      // AI cost estimate per cycle, next to the credits actually charged.
      this.prisma.googleAdsOptimizationCycle.findMany({
        where: { startedAt: { gte: from, lte: to } },
        select: { aiModel: true, aiCostMinor: true, aiCallCount: true, chargedMinor: true },
      }),
      // The agent chat, billed per message (same customers, same category).
      this.prisma.googleAdsChatTurn.findMany({
        where: { createdAt: { gte: from, lte: to }, status: { not: 'running' } },
        select: { aiModel: true, aiCostUsd: true, aiCallCount: true, chargedMinor: true },
      }),
    ]);
    // Unrounded cost per message: sub-cent calls are rounded once, in totals.
    const optimizerCycles: OptimizerCycleUsage[] = [
      ...cycles,
      ...chatTurns.map(({ aiCostUsd, ...t }) => ({ ...t, aiCostMinor: aiCostUsd * 100 })),
    ];
    // Homepage "ask" search: per-day tallies (its Claude spend is summed
    // there at write time). Day rows are matched by the calendar days the
    // range touches.
    const dayFrom = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
    );
    const [searchDays, latestSearchCall] = await Promise.all([
      this.prisma.feedSearchDaily.findMany({ where: { day: { gte: dayFrom, lte: to } } }),
      this.prisma.feedQueryCache.findFirst({
        where: { model: { not: '' } },
        orderBy: { createdAt: 'desc' },
        select: { model: true },
      }),
    ]);
    const search = {
      days: searchDays,
      model: latestSearchCall?.model ?? 'claude',
    };
    return {
      rows,
      googleAdsAgentRuns,
      optimizerCycles,
      optimizerCycleCount: cycles.length,
      optimizerChatCount: chatTurns.length,
      search,
      from,
      to,
    };
  }

  /** Builds the same "accumulate raw USD, round once" per-(provider,model)
   *  map `aiUsageReport`/`exportAiUsagePdf` both render, folding in the
   *  campaign agent's runs (already EUR-minor at write time — see
   *  `GoogleAdsAgentRun.claudeCostEstimateMinor`'s field comment — divided
   *  back by 100 here so it accumulates in the same raw-USD unit as every
   *  other bucket, and reassembled into minor units the same way for all of
   *  them below). Never charged to any customer, unlike the AiUsageRecord
   *  rows, so its bucket is never included in `usdToChargedMinor`. */
  private buildAiByModelMap(
    rows: {
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
    }[],
    googleAdsAgentRuns: {
      claudeModel: string | null;
      claudeInputTokens: number;
      claudeOutputTokens: number;
      claudeCostEstimateMinor: number | null;
      claudeCallCount: number;
    }[],
    search: SearchUsage,
    optimizerCycles: OptimizerCycleUsage[] = [],
  ) {
    const byModel = new Map<
      string,
      { provider: string; model: string; calls: number; tokens: number; costUsd: number }
    >();
    for (const r of rows) {
      const key = `${r.provider}:${r.model}`;
      const bucket = byModel.get(key) ?? {
        provider: r.provider,
        model: r.model,
        calls: 0,
        tokens: 0,
        costUsd: 0,
      };
      bucket.calls += 1;
      bucket.tokens += r.inputTokens + r.outputTokens;
      bucket.costUsd += r.estimatedCostUsd;
      byModel.set(key, bucket);
    }
    for (const r of googleAdsAgentRuns) {
      const model = r.claudeModel ?? 'necunoscut';
      const key = `google-ads-agent:${model}`;
      const bucket = byModel.get(key) ?? {
        provider: 'google-ads-agent',
        model,
        calls: 0,
        tokens: 0,
        costUsd: 0,
      };
      bucket.calls += r.claudeCallCount;
      bucket.tokens += r.claudeInputTokens + r.claudeOutputTokens;
      bucket.costUsd += (r.claudeCostEstimateMinor ?? 0) / 100;
      byModel.set(key, bucket);
    }
    // Customers' Google Ads optimization cycles: billed per cycle on the
    // work's complexity (credits), not on this AI cost.
    for (const r of optimizerCycles) {
      const model = r.aiModel ?? 'necunoscut';
      const key = `${OPTIMIZER_PROVIDER}:${model}`;
      const bucket = byModel.get(key) ?? {
        provider: OPTIMIZER_PROVIDER,
        model,
        calls: 0,
        tokens: 0,
        costUsd: 0,
      };
      bucket.calls += r.aiCallCount;
      bucket.costUsd += r.aiCostMinor / 100;
      byModel.set(key, bucket);
    }
    // The homepage search's Claude backup: platform cost, never charged.
    const searchCalls = search.days.reduce((n, d) => n + d.ai, 0);
    if (searchCalls > 0) {
      byModel.set(`${SEARCH_PROVIDER}:${search.model}`, {
        provider: SEARCH_PROVIDER,
        model: search.model,
        calls: searchCalls,
        tokens: search.days.reduce((n, d) => n + d.aiInputTokens + d.aiOutputTokens, 0),
        costUsd: search.days.reduce((n, d) => n + d.aiCostUsd, 0),
      });
    }
    return byModel;
  }

  async aiUsageReport(q: FinancePeriodQuery) {
    const {
      rows,
      googleAdsAgentRuns,
      optimizerCycles,
      optimizerCycleCount,
      optimizerChatCount,
      search,
      from,
      to,
    } = await this.aiRows(q);
    const byModel = this.buildAiByModelMap(rows, googleAdsAgentRuns, search, optimizerCycles);
    const optimizerCostMinor = Math.round(optimizerCycles.reduce((s, r) => s + r.aiCostMinor, 0));
    const optimizerChargedMinor = optimizerCycles.reduce((s, r) => s + r.chargedMinor, 0);
    const sum = (k: 'total' | 'stored' | 'keyword' | 'local' | 'ai' | 'guess') =>
      search.days.reduce((n, d) => n + d[k], 0);
    const searchCostUsd = search.days.reduce((n, d) => n + d.aiCostUsd, 0);

    const campaignAgentCostMinor = googleAdsAgentRuns.reduce(
      (s, r) => s + (r.claudeCostEstimateMinor ?? 0),
      0,
    );
    // Accumulate raw (unrounded) USD per model and round to minor units
    // exactly ONCE at the end — rounding each row first (as this used to)
    // drops every sub-cent call to 0 individually, so a model made up of
    // many cheap calls could show €0,00 here while still contributing real
    // cost to `totalCostMinor` below, which rounds its sum only once.
    const totalCostMinor =
      usdToEurMinor(rows.reduce((s, r) => s + r.estimatedCostUsd, 0) + searchCostUsd) +
      campaignAgentCostMinor +
      optimizerCostMinor;
    const totalTokens =
      rows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0) +
      googleAdsAgentRuns.reduce((s, r) => s + r.claudeInputTokens + r.claudeOutputTokens, 0) +
      search.days.reduce((n, d) => n + d.aiInputTokens + d.aiOutputTokens, 0);
    const totalCalls =
      rows.length +
      googleAdsAgentRuns.reduce((s, r) => s + r.claudeCallCount, 0) +
      optimizerCycles.reduce((s, r) => s + r.aiCallCount, 0) +
      sum('ai');

    // `chargedMinor` only ever applies to the AiUsageRecord-backed buckets —
    // the campaign agent's own spend is never billed to any customer wallet.
    const byModelMinor = Array.from(byModel.values())
      .map(({ costUsd, provider, ...rest }) => ({
        provider,
        ...rest,
        costMinor: usdToEurMinor(costUsd),
        // Optimizer cycles are billed in credits on complexity: their
        // "charged" is what was really taken from customers' wallets.
        chargedMinor:
          provider === OPTIMIZER_PROVIDER
            ? optimizerCharged(optimizerCycles, rest.model)
            : NEVER_CHARGED.has(provider)
              ? 0
              : usdToChargedMinor(costUsd),
      }))
      .sort((a, b) => b.costMinor - a.costMinor);

    const searches = sum('total');
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totalCostMinor,
      totalTokens,
      totalCalls,
      byModel: byModelMinor,
      // Customers' Google Ads optimization cycles: real AI cost vs charged.
      googleAdsOptimizer: {
        cycles: optimizerCycleCount,
        chatMessages: optimizerChatCount,
        aiCostMinor: optimizerCostMinor,
        chargedMinor: optimizerChargedMinor,
        aiCalls: optimizerCycles.reduce((s, r) => s + r.aiCallCount, 0),
      },
      // Homepage "ask" search: how searches were answered + what Claude cost.
      search: {
        searches,
        stored: sum('stored'),
        keyword: sum('keyword'),
        local: sum('local'),
        ai: sum('ai'),
        guess: sum('guess'),
        costMinor: usdToEurMinor(searchCostUsd),
        /** Exact sub-cent cost, so a tiny spend doesn't read as €0,00. */
        costUsd: searchCostUsd,
        avgCostUsd: sum('ai') ? searchCostUsd / sum('ai') : 0,
      },
    };
  }

  async exportAiUsagePdf(q: FinancePeriodQuery): Promise<Buffer> {
    const { rows, googleAdsAgentRuns, optimizerCycles, search } = await this.aiRows(q);
    const byModel = this.buildAiByModelMap(rows, googleAdsAgentRuns, search, optimizerCycles);

    return generateTablePdf({
      title: 'Consum AI',
      ownerName: 'Totalvizibil',
      subtitle: q.all
        ? 'Dintotdeauna'
        : q.from || q.to
          ? `${q.from ?? '...'} – ${q.to ?? '...'}`
          : undefined,
      columns: [
        { label: 'Furnizor', width: 0.17 },
        { label: 'Model', width: 0.25 },
        { label: 'Apeluri', width: 0.13, align: 'right' },
        { label: 'Tokeni', width: 0.15, align: 'right' },
        { label: 'Cost', width: 0.15, align: 'right' },
        { label: 'Încasat', width: 0.15, align: 'right' },
      ],
      rows: Array.from(byModel.values())
        .map(({ costUsd, provider, ...rest }) => ({
          provider,
          ...rest,
          costMinor: usdToEurMinor(costUsd),
          chargedMinor:
            provider === OPTIMIZER_PROVIDER
              ? optimizerCharged(optimizerCycles, rest.model)
              : NEVER_CHARGED.has(provider)
                ? 0
                : usdToChargedMinor(costUsd),
        }))
        .sort((a, b) => b.costMinor - a.costMinor)
        .map((b) => [
          b.provider,
          b.model,
          String(b.calls),
          b.tokens.toLocaleString('ro-RO'),
          `${(b.costMinor / 100).toFixed(2)} €`,
          `${(b.chargedMinor / 100).toFixed(2)} €`,
        ]),
      emptyText: 'Niciun consum AI în perioada selectată.',
    });
  }
}
