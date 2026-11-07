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
const BUILDER_UNLOCK_DESCRIPTION = 'Advanced website builder';
type OneOffFeeCategory = 'aiUsage' | 'builderUnlock' | 'other';
function oneOffFeeCategory(provider: string | null, description: string | null): OneOffFeeCategory {
  if (provider === AI_USAGE_PROVIDER) return 'aiUsage';
  if (provider === null && description === BUILDER_UNLOCK_DESCRIPTION) return 'builderUnlock';
  return 'other';
}

/** Row labels for the Venituri PDF. `adjustment` only ever shows up when the
 *  caller explicitly asked for it via `?types=adjustment`. */
const REVENUE_TYPE_LABELS: Record<WalletTxnType, string> = {
  purchase: 'Încărcare',
  refund: 'Rambursare',
  adjustment: 'Ajustare',
  spend: 'Consum',
};

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
          select: { category: true, amountMinor: true, incurredOn: true },
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
      // VAT return shape: one row per (rate, currency) over the invoices
      // issued in the period that are still valid.
      this.prisma.invoice.groupBy({
        by: ['vatRatePct', 'currency'],
        where: { voidedAt: null, issuedAt: { gte: from, lte: to } },
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
      other: 0,
    };
    for (const r of otherSpendRows) {
      otherFeesByCategory[oneOffFeeCategory(r.provider ?? null, r.description ?? null)] +=
        -r.amountMinor;
    }

    // Credit consumption is booked at face value, so during a discount period
    // a credit spent was only ever worth `net/gross` of a euro in real money.
    // Applying that same blended ratio to CPC consumption gives the
    // real-money-weighted figure to compare against real-money ad spend.
    const grossToNetRatio = grossRevenueMinor > 0 ? netRevenueMinor / grossRevenueMinor : 1;
    const cpcRevenueRealMoneyMinor = Math.round(cpcConsumedMinor * grossToNetRatio);

    // Same real-money weighting, generalized to ALL credit consumption in the
    // period (CPC + AI usage + builder unlock + other one-off fees), not
    // just CPC — this is the platform's actually-earned revenue for the
    // period: money collected for credits a customer has ALREADY spent, and
    // can therefore never claw back via a refund. `revenueMinor` above (money
    // collected regardless of consumption) still includes credits sitting
    // unconsumed in a wallet, which remain a liability until spent — see
    // `unconsumedRevenueMinor` below.
    const consumedRevenueRealMoneyMinor = Math.round(
      (cpcConsumedMinor + otherFeesConsumedMinor) * grossToNetRatio,
    );
    const unconsumedRevenueMinor = revenueMinor - consumedRevenueRealMoneyMinor;

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
    for (const row of expenseRows) expensesByCategory[row.category] += row.amountMinor;

    const aiCostMinor = usdToEurMinor(aiRows.reduce((s, r) => s + r.estimatedCostUsd, 0));
    const operatingCostMinor = Object.values(expensesByCategory).reduce((s, v) => s + v, 0);
    const totalCostMinor = operatingCostMinor + aiCostMinor;
    // Real profit = earned revenue (credits actually consumed, real money)
    // minus EVERY cost — never `revenueMinor` (money collected): an unspent
    // credit is still refundable, so it isn't profit yet, per the same
    // principle `consumedRevenueRealMoneyMinor` above already applies.
    const profitMinor = consumedRevenueRealMoneyMinor - totalCostMinor;

    const adSpendMinor = expensesByCategory.google_ads;

    // AI Builder profitability: what customers' wallets actually paid for AI
    // usage (real money, same blended weighting as everything else here)
    // minus what the platform actually paid Claude/DeepSeek for it, plus the
    // builder-unlock one-off fee (same weighting) — together "Profit Builder
    // AI". `campaignAgentCostMinor` is a placeholder: the Google-Ads
    // campaign-management AI agent doesn't exist yet (a future addition),
    // so there is nothing real to sum here — `campaignAgentAvailable: false`
    // lets the UI show "coming soon" instead of a misleading €0,00.
    const aiPromptRevenueRealMoneyMinor = Math.round(otherFeesByCategory.aiUsage * grossToNetRatio);
    const aiPromptProfitMinor = aiPromptRevenueRealMoneyMinor - aiCostMinor;
    const aiBuilderUnlockRevenueRealMoneyMinor = Math.round(
      otherFeesByCategory.builderUnlock * grossToNetRatio,
    );
    const aiBuilder = {
      promptRevenueRealMoneyMinor: aiPromptRevenueRealMoneyMinor,
      providerCostMinor: aiCostMinor,
      promptProfitMinor: aiPromptProfitMinor,
      builderUnlockRevenueRealMoneyMinor: aiBuilderUnlockRevenueRealMoneyMinor,
      totalProfitMinor: aiPromptProfitMinor + aiBuilderUnlockRevenueRealMoneyMinor,
      campaignAgentCostMinor: 0,
      campaignAgentAvailable: false,
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
    for (const r of expenseRows) bump(r.incurredOn, 'costMinor', r.amountMinor);
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
    // of the page's adjustable period filter above, same reasoning as the
    // point-in-time wallet-liability figures: an owner wants these three
    // fixed at a glance, not re-derived by fiddling with the date picker.
    // Same formula as `profitMinor` above (consumed-revenue basis), so
    // picking "this month" in the period filter reproduces `finalProfit.month`
    // exactly — the two can never silently disagree.
    const now = new Date();
    const [todayFigures, monthFigures, yearFigures] = await Promise.all([
      this.profitForRange(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        endOfUtcDay(now),
      ),
      this.profitForRange(startOfUtcMonth(now), endOfUtcDay(now)),
      this.profitForRange(new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), endOfUtcDay(now)),
    ]);

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
      expensesByCategory,
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
    };
  }

  /**
   * The same "consumed revenue (real money) minus every cost" formula
   * `overview()` uses for its headline `profitMinor`, reusable for an
   * arbitrary range — the engine behind `finalProfit`'s Today/This
   * month/This year figures. Deliberately computes its OWN gross→net ratio
   * from purchases within THIS range (consistent with how `overview()`
   * already weights the selected period's own consumption), not a global
   * all-time ratio — a range with no purchases of its own (e.g. a quiet day)
   * falls back to ratio=1 (full face value, no discount assumed), the same
   * conservative default `overview()`'s own `grossToNetRatio` already uses.
   */
  private async profitForRange(
    from: Date,
    to: Date,
  ): Promise<{
    consumedRevenueRealMoneyMinor: number;
    totalCostMinor: number;
    profitMinor: number;
  }> {
    const dateFilter = { createdAt: { gte: from, lte: to } };
    const [purchaseRows, spendAgg, expenseAgg, aiAgg] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { type: 'purchase', status: 'completed', ...dateFilter, ...NOT_VOIDED_INVOICE },
        select: { amountMinor: true, eurCents: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { type: 'spend', status: 'completed', ...dateFilter },
        _sum: { amountMinor: true },
      }),
      this.prisma.platformExpense.aggregate({
        where: { incurredOn: { gte: from, lte: to } },
        _sum: { amountMinor: true },
      }),
      this.prisma.aiUsageRecord.aggregate({
        where: dateFilter,
        _sum: { estimatedCostUsd: true },
      }),
    ]);

    const grossRevenueMinor = purchaseRows.reduce((s, r) => s + r.amountMinor, 0);
    const netRevenueMinor = purchaseRows.reduce((s, r) => s + purchaseMoneyMinor(r), 0);
    const grossToNetRatio = grossRevenueMinor > 0 ? netRevenueMinor / grossRevenueMinor : 1;
    // All completed spend rows (CPC daily rollups + one-off fees alike) —
    // the same union `cpcConsumedMinor + otherFeesConsumedMinor` partitions
    // in `overview()`, summed directly here since no per-category breakdown
    // is needed for this range.
    const consumedFaceMinor = -(spendAgg._sum.amountMinor ?? 0);
    const consumedRevenueRealMoneyMinor = Math.round(consumedFaceMinor * grossToNetRatio);

    const operatingCostMinor = expenseAgg._sum.amountMinor ?? 0;
    const aiCostMinor = usdToEurMinor(aiAgg._sum.estimatedCostUsd ?? 0);
    const totalCostMinor = operatingCostMinor + aiCostMinor;

    return {
      consumedRevenueRealMoneyMinor,
      totalCostMinor,
      profitMinor: consumedRevenueRealMoneyMinor - totalCostMinor,
    };
  }

  // -------------------------------------------------------------------------
  // Venituri
  // -------------------------------------------------------------------------

  /** The ledger's `where`. Two things it must get right, both of which it
   *  used to get wrong:
   *   - the period: with no explicit `from`/`to` this used to mean ALL TIME
   *     while the Dashboard's `overview()` meant the current month, so the
   *     two pages silently described different periods. It now runs through
   *     the very same `resolveRange()`.
   *   - the types: `purchase`+`refund` by default (unchanged), but
   *     `?types=` can widen it to include `adjustment` rows (manual wallet
   *     corrections and affiliate-reward credits), which were invisible to
   *     finance platform-wide. */
  private revenueWhere(q: ListRevenueQuery): Prisma.WalletTransactionWhereInput {
    const types: WalletTxnType[] = q.type
      ? [q.type]
      : [...(q.types?.length ? q.types : DEFAULT_REVENUE_TXN_TYPES)];
    const { from, to } = this.resolveRange(q);
    return {
      type: { in: types },
      status: 'completed',
      ...NOT_VOIDED_INVOICE,
      createdAt: { gte: from, lte: to },
    };
  }

  /** Enough of a row to compute both its face value and its real-money
   *  value — the money figure needs `eurCents` for purchases and
   *  `refundSources`/`feeMinor` for refunds. */
  private static readonly REVENUE_ROW_MONEY_SELECT = {
    type: true,
    amountMinor: true,
    eurCents: true,
    refundSources: true,
    feeMinor: true,
  } as const;

  async listRevenue(q: ListRevenueQuery) {
    const where = this.revenueWhere(q);
    const { from, to } = this.resolveRange(q);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;

    const [items, total, allRows] = await Promise.all([
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
      // The period total has to cover the FULL filtered set, not the page an
      // accountant happens to be looking at. Can't be a SQL SUM: a refund's
      // real-money value lives inside its `refundSources` JSON, so the rows
      // (narrowed to the five fields the money math needs) are reduced here.
      this.prisma.walletTransaction.findMany({
        where,
        select: FinanceService.REVENUE_ROW_MONEY_SELECT,
      }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        type: t.type,
        /** Credit face value (what the wallet moved). */
        amountMinor: t.amountMinor,
        /** Real money (what the bank moved) — the figure that reconciles
         *  with the Dashboard KPI. */
        moneyMinor: rowMoneyMinor(t),
        createdAt: t.createdAt,
        userName: t.wallet.user?.name ?? null,
        userEmail: t.wallet.user?.email ?? null,
        companyName: t.company?.displayName ?? null,
        description: t.description,
      })),
      total,
      page,
      pageSize,
      /** The resolved range this list is actually filtered to — so the UI
       *  can show an unambiguous confirmation of what's on screen, the same
       *  way `overview()`'s own `range` already does. */
      range: { from: from.toISOString(), to: to.toISOString() },
      /** Real-money net total of the whole filtered period. With the default
       *  types over the same range this equals `overview().revenueMinor`. */
      periodTotalMinor: allRows.reduce((s, r) => s + rowMoneyMinor(r), 0),
      /** Credit face value net total of the whole filtered period. */
      periodFaceTotalMinor: allRows.reduce((s, r) => s + r.amountMinor, 0),
    };
  }

  async exportRevenuePdf(q: ListRevenueQuery): Promise<Buffer> {
    const where = this.revenueWhere(q);
    const { from, to } = this.resolveRange(q);
    const [rows, allRows] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 2000,
        include: {
          wallet: { select: { user: { select: { name: true, email: true } } } },
          company: { select: { displayName: true } },
        },
      }),
      this.prisma.walletTransaction.findMany({
        where,
        select: FinanceService.REVENUE_ROW_MONEY_SELECT,
      }),
    ]);

    const faceTotalMinor = allRows.reduce((s, r) => s + r.amountMinor, 0);
    const moneyTotalMinor = allRows.reduce((s, r) => s + rowMoneyMinor(r), 0);

    return generateTablePdf({
      title: 'Venituri',
      ownerName: 'Totalvizibil',
      subtitle: q.all ? 'Dintotdeauna' : `${dayKey(from)} – ${dayKey(to)}`,
      columns: [
        { label: 'Data', width: 0.13 },
        { label: 'Tip', width: 0.13 },
        { label: 'Client', width: 0.24 },
        { label: 'Afacere', width: 0.2 },
        { label: 'Credite', width: 0.15, align: 'right' },
        { label: 'Bani încasați', width: 0.15, align: 'right' },
      ],
      rows: rows.length
        ? [
            ...rows.map((t) => [
              t.createdAt.toLocaleDateString('ro-RO'),
              REVENUE_TYPE_LABELS[t.type],
              t.wallet.user?.name ?? '—',
              t.company?.displayName ?? '—',
              `${(t.amountMinor / 100).toFixed(2)} €`,
              `${(rowMoneyMinor(t) / 100).toFixed(2)} €`,
            ]),
            // Totals over the whole period, even if the row list above was
            // capped at 2000 — an accountant reconciling a month needs the
            // period's total, not the total of the page that fit.
            [
              'TOTAL',
              '',
              '',
              '',
              `${(faceTotalMinor / 100).toFixed(2)} €`,
              `${(moneyTotalMinor / 100).toFixed(2)} €`,
            ],
          ]
        : [],
      emptyText: 'Niciun venit în perioada selectată.',
    });
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

    // Unlike `resolveRange()`'s callers, this endpoint has no implicit
    // default — absent `from`/`to` already means "every row ever". Echoed
    // back as-given (not resolved into concrete dates, there's nothing to
    // resolve) so the UI can show the same unambiguous "what's applied"
    // confirmation the other finance pages get from their own `range`.
    const isLifetime = !!q.all || (!q.from && !q.to);
    return {
      items,
      total,
      page,
      pageSize,
      range: { from: isLifetime ? null : (q.from ?? null), to: isLifetime ? null : (q.to ?? null) },
    };
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
      subtitle: q.all
        ? 'Dintotdeauna'
        : q.from || q.to
          ? `${q.from ?? '...'} – ${q.to ?? '...'}`
          : undefined,
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
        // Absent = the schema's own EUR default; passing it explicitly keeps
        // the create and update paths reading the same way.
        currency: dto.currency ?? DEFAULT_EXPENSE_CURRENCY,
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
    return this.prisma.platformExpense.update({
      where: { id },
      data: {
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.incurredOn ? { incurredOn: new Date(dto.incurredOn) } : {}),
        ...(dto.amountMinor !== undefined ? { amountMinor: dto.amountMinor } : {}),
        ...(dto.currency ? { currency: dto.currency } : {}),
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

    // Accumulate raw (unrounded) USD per model and round to minor units
    // exactly ONCE at the end — rounding each row first (as this used to)
    // drops every sub-cent call to 0 individually, so a model made up of
    // many cheap calls could show €0,00 here while still contributing real
    // cost to `totalCostMinor` below, which rounds its sum only once.
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

    const totalCostMinor = usdToEurMinor(rows.reduce((s, r) => s + r.estimatedCostUsd, 0));
    const totalTokens = rows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);

    const byModelMinor = Array.from(byModel.values())
      .map(({ costUsd, ...rest }) => ({
        ...rest,
        costMinor: usdToEurMinor(costUsd),
        chargedMinor: usdToChargedMinor(costUsd),
      }))
      .sort((a, b) => b.costMinor - a.costMinor);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totalCostMinor,
      totalTokens,
      totalCalls: rows.length,
      byModel: byModelMinor,
    };
  }

  async exportAiUsagePdf(q: FinancePeriodQuery): Promise<Buffer> {
    const { rows } = await this.aiRows(q);

    // Same "round once, at the end" fix as `aiUsageReport` — see its comment.
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
        .map(({ costUsd, ...rest }) => ({
          ...rest,
          costMinor: usdToEurMinor(costUsd),
          chargedMinor: usdToChargedMinor(costUsd),
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
