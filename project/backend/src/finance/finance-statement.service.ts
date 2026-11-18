import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConsumptionCategory,
  EngineEvent,
  EngineResult,
  EngineTxn,
  LotSnapshot,
  parseSources,
  runLedger,
} from './ledger-engine';

/**
 * The platform's financial statement (cont de profit și pierdere), built the
 * way an accountant reads it:
 *
 *  1. Cash (încasări): money collected minus money refunded, with the VAT
 *     inside it split out (VAT belongs to the state, not to the platform).
 *  2. Earned revenue (venituri realizate): what customers actually consumed,
 *     valued at the real money behind each consumed credit (FIFO replay, see
 *     `ledger-engine.ts`), net of VAT. Bonus / affiliate credits produce no
 *     revenue. Unconsumed credits stay a customer advance (a liability).
 *  3. Expenses: every recorded cost in EUR (foreign-currency documents at
 *     the rate the accountant booked) + AI provider costs.
 *  4. Result: earned revenue minus expenses (operating profit, before
 *     income tax), plus the cash-basis result for comparison.
 *
 * Every figure is computed from stored data only. Where data is missing
 * (no invoice so VAT is unknown, a foreign-currency cost without a rate,
 * AI costs that are token estimates) the statement says so in `missing`
 * instead of guessing.
 */

export const EXPENSE_CATEGORIES = [
  'hosting',
  'call_center',
  'cloud_storage',
  'domains',
  'google_ads',
  'stripe_fees',
  'other',
] as const;
export type ExpenseCategoryKey = (typeof EXPENSE_CATEGORIES)[number];

export interface StatementRange {
  from: Date;
  to: Date;
}

export interface MissingInfo {
  key:
    | 'vatUnknown'
    | 'expenseFx'
    | 'aiEstimated'
    | 'unmatched'
    | 'forfeit'
    | 'incomeTax'
    | 'expenseVat';
  count?: number;
  amountMinor?: number;
}

export interface FinancialStatement {
  range: { from: string; to: string };
  cash: {
    purchaseCount: number;
    /** Money collected for credit purchases, VAT included. */
    collectedMinor: number;
    collectedVatMinor: number;
    refundCount: number;
    /** Money sent back to customers by completed refunds. */
    refundedMinor: number;
    refundedVatMinor: number;
    netMinor: number;
    netVatMinor: number;
    /** Net cash without VAT: what the platform keeps of what it collected. */
    netExVatMinor: number;
    /** Part of `netMinor` with no invoice issued yet, so its VAT is unknown. */
    vatUnknownMinor: number;
    /** Credit face value sold; minus `collectedMinor` = discount granted. */
    faceValueSoldMinor: number;
    discountMinor: number;
  };
  revenue: {
    /** Earned revenue per service line, net of VAT. */
    byCategory: Record<ConsumptionCategory, number>;
    /** Processing fees kept out of refunds, net of VAT. */
    refundFeesMinor: number;
    totalNetMinor: number;
    totalVatMinor: number;
    totalGrossMinor: number;
    /** Part of the gross whose VAT rate is unknown (counted as net). */
    vatUnknownGrossMinor: number;
  };
  nonCash: {
    /** Bonus / affiliate / admin credits consumed (face value, no money). */
    freeCreditsConsumedMinor: number;
    /** Credits of voided-invoice purchases consumed. */
    voidedCreditsConsumedMinor: number;
    /** Credits removed by an admin (negative adjustments). */
    forfeitedCreditsMinor: number;
    /** Money that was behind the paid part of those removed credits. */
    forfeitedMoneyMinor: number;
    /** Consumption with no credits behind it in the ledger. */
    unmatchedCreditsMinor: number;
  };
  expenses: {
    byCategory: Record<ExpenseCategoryKey, number>;
    ai: {
      builderMinor: number;
      campaignAgentMinor: number;
      searchMinor: number;
      totalMinor: number;
    };
    totalMinor: number;
    /** Foreign-currency documents without an exchange rate: NOT in the total. */
    missingFx: { count: number; byCurrency: Record<string, number> };
  };
  result: {
    /** Earned revenue (net of VAT) minus all expenses. Before income tax. */
    operatingProfitMinor: number;
    /** Net cash without VAT minus all expenses. */
    cashResultMinor: number;
    /** Operating profit / earned revenue, in %, null without revenue. */
    marginPct: number | null;
  };
  missing: MissingInfo[];
}

export interface BalanceSnapshot {
  asOf: string;
  /** Money collected for credits not consumed yet (VAT included). */
  advancesMoneyMinor: number;
  advancesVatMinor: number;
  advancesNetMinor: number;
  advancesVatUnknownMinor: number;
  unconsumedPaidCreditsMinor: number;
  unconsumedFreeCreditsMinor: number;
  unconsumedVoidedCreditsMinor: number;
}

export type CheckSeverity = 'ok' | 'info' | 'warning' | 'error';
export interface CheckItem {
  key:
    | 'duplicatePurchases'
    | 'walletBalance'
    | 'uninvoicedPurchases'
    | 'invoiceMismatch'
    | 'refundSources'
    | 'stripeFeeMissing'
    | 'expenseFx'
    | 'duplicateExpenses'
    | 'unmatchedConsumption'
    | 'forfeitedCredits';
  severity: CheckSeverity;
  count: number;
  amountMinor: number | null;
  samples: { label: string; detail?: string; amountMinor?: number }[];
}

interface CostData {
  expenses: {
    id: string;
    category: string;
    incurredOn: Date;
    amountMinor: number;
    currency: string;
    eurAmountMinor: number | null;
    source: string;
    note: string | null;
  }[];
  ai: { estimatedCostUsd: number; createdAt: Date }[];
  agent: { claudeCostEstimateMinor: number | null; startedAt: Date }[];
  search: { day: Date; aiCostUsd: number }[];
}

/** EUR cents of an expense row, or null when a foreign-currency document
 *  has no exchange rate recorded. */
export function expenseEurMinor(r: {
  currency: string;
  amountMinor: number;
  eurAmountMinor: number | null;
}): number | null {
  // `?? 'EUR'`: the column is non-null with an EUR default; defensive only.
  if ((r.currency ?? 'EUR') === 'EUR') return r.amountMinor;
  return r.eurAmountMinor ?? null;
}

const SAMPLE_LIMIT = 15;

function emptyByCategory(): Record<ConsumptionCategory, number> {
  return { cpc: 0, aiUsage: 0, builderUnlock: 0, other: 0 };
}
function emptyExpenseCategories(): Record<ExpenseCategoryKey, number> {
  return Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0])) as Record<
    ExpenseCategoryKey,
    number
  >;
}
function inRange(d: Date, r: StatementRange): boolean {
  const t = d.getTime();
  return t >= r.from.getTime() && t <= r.to.getTime();
}

@Injectable()
export class FinanceStatementService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  /** Every balance-moving ledger row up to `upTo`, shaped for the engine. */
  async loadLedger(upTo: Date): Promise<EngineTxn[]> {
    const rows = await this.prisma.walletTransaction.findMany({
      where: {
        createdAt: { lte: upTo },
        OR: [
          { status: 'completed' },
          { type: 'refund', status: { in: ['pending', 'processing'] } },
        ],
      },
      select: {
        id: true,
        walletId: true,
        type: true,
        status: true,
        amountMinor: true,
        eurCents: true,
        createdAt: true,
        refundSources: true,
        feeMinor: true,
        provider: true,
        description: true,
        spendDay: true,
        invoice: { select: { vatRatePct: true, voidedAt: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      walletId: r.walletId,
      type: r.type,
      status: r.status,
      amountMinor: r.amountMinor,
      eurCents: r.eurCents,
      createdAt: r.createdAt,
      refundSources: r.refundSources,
      feeMinor: r.feeMinor,
      provider: r.provider,
      description: r.description,
      spendDay: r.spendDay,
      vatRatePct: r.invoice ? r.invoice.vatRatePct : null,
      invoiceVoided: !!r.invoice?.voidedAt,
    }));
  }

  private async loadCosts(from: Date, to: Date): Promise<CostData> {
    const dayFrom = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
    );
    const [expenses, ai, agent, search] = await Promise.all([
      this.prisma.platformExpense.findMany({
        where: { incurredOn: { gte: dayFrom, lte: to } },
        select: {
          id: true,
          category: true,
          incurredOn: true,
          amountMinor: true,
          currency: true,
          eurAmountMinor: true,
          source: true,
          note: true,
        },
      }),
      this.prisma.aiUsageRecord.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { estimatedCostUsd: true, createdAt: true },
      }),
      this.prisma.googleAdsAgentRun.findMany({
        where: { startedAt: { gte: from, lte: to } },
        select: { claudeCostEstimateMinor: true, startedAt: true },
      }),
      this.prisma.feedSearchDaily.findMany({
        where: { day: { gte: dayFrom, lte: to } },
        select: { day: true, aiCostUsd: true },
      }),
    ]);
    return { expenses, ai, agent, search };
  }

  // -------------------------------------------------------------------------
  // Statements
  // -------------------------------------------------------------------------

  /** One statement per range, sharing a single ledger replay and cost load. */
  async statements(ranges: StatementRange[]): Promise<FinancialStatement[]> {
    if (!ranges.length) return [];
    const minFrom = new Date(Math.min(...ranges.map((r) => r.from.getTime())));
    const maxTo = new Date(Math.max(...ranges.map((r) => r.to.getTime())));
    const [ledger, costs] = await Promise.all([
      this.loadLedger(maxTo),
      this.loadCosts(minFrom, maxTo),
    ]);
    const result = runLedger(ledger);
    return ranges.map((r) => this.buildStatement(result.events, costs, r));
  }

  async statement(range: StatementRange): Promise<FinancialStatement> {
    const [s] = await this.statements([range]);
    return s;
  }

  /** Customer advances (unconsumed paid credits) as of `asOf`. */
  async balanceAsOf(asOf: Date, ledger?: EngineTxn[]): Promise<BalanceSnapshot> {
    const rows = ledger ?? (await this.loadLedger(asOf));
    const { remaining } = runLedger(rows.filter((t) => t.createdAt.getTime() <= asOf.getTime()));
    return this.snapshot(remaining, asOf);
  }

  private snapshot(remaining: LotSnapshot, asOf: Date): BalanceSnapshot {
    return {
      asOf: asOf.toISOString(),
      advancesMoneyMinor: remaining.paidMoneyMinor,
      advancesVatMinor: remaining.paidVatMinor,
      advancesNetMinor: remaining.paidMoneyMinor - remaining.paidVatMinor,
      advancesVatUnknownMinor: remaining.paidMoneyVatUnknownMinor,
      unconsumedPaidCreditsMinor: remaining.paidCreditsMinor,
      unconsumedFreeCreditsMinor: remaining.freeCreditsMinor,
      unconsumedVoidedCreditsMinor: remaining.voidedCreditsMinor,
    };
  }

  /** Twelve monthly statements (UTC calendar months) plus the year total. */
  async monthly(year: number): Promise<{
    year: number;
    months: FinancialStatement[];
    total: FinancialStatement;
  }> {
    const ranges: StatementRange[] = [];
    for (let m = 0; m < 12; m++) {
      ranges.push({
        from: new Date(Date.UTC(year, m, 1)),
        to: new Date(Date.UTC(year, m + 1, 0, 23, 59, 59, 999)),
      });
    }
    const yearRange = { from: ranges[0].from, to: ranges[11].to };
    const all = await this.statements([...ranges, yearRange]);
    return { year, months: all.slice(0, 12), total: all[12] };
  }

  buildStatement(events: EngineEvent[], costs: CostData, r: StatementRange): FinancialStatement {
    const cash = {
      purchaseCount: 0,
      collectedMinor: 0,
      collectedVatMinor: 0,
      refundCount: 0,
      refundedMinor: 0,
      refundedVatMinor: 0,
      netMinor: 0,
      netVatMinor: 0,
      netExVatMinor: 0,
      vatUnknownMinor: 0,
      faceValueSoldMinor: 0,
      discountMinor: 0,
    };
    const byCategory = emptyByCategory();
    let refundFeesNet = 0;
    let revVat = 0;
    let revGross = 0;
    let revVatUnknown = 0;
    let vatUnknownCount = 0;
    const nonCash = {
      freeCreditsConsumedMinor: 0,
      voidedCreditsConsumedMinor: 0,
      forfeitedCreditsMinor: 0,
      forfeitedMoneyMinor: 0,
      unmatchedCreditsMinor: 0,
    };

    for (const e of events) {
      if (!inRange(e.at, r)) continue;
      switch (e.kind) {
        case 'cashIn':
          cash.purchaseCount++;
          cash.collectedMinor += e.moneyMinor;
          cash.collectedVatMinor += e.vatMinor;
          cash.faceValueSoldMinor += e.creditsMinor;
          if (!e.vatKnown) {
            cash.vatUnknownMinor += e.moneyMinor;
            vatUnknownCount++;
          }
          break;
        case 'cashOut':
          cash.refundCount++;
          cash.refundedMinor += e.moneyMinor;
          cash.refundedVatMinor += e.vatMinor;
          if (!e.vatKnown) cash.vatUnknownMinor -= e.moneyMinor;
          break;
        case 'revenue':
        case 'refundFee': {
          const net = e.moneyMinor - e.vatMinor;
          if (e.kind === 'revenue' && e.category) byCategory[e.category] += net;
          else refundFeesNet += net;
          revVat += e.vatMinor;
          revGross += e.moneyMinor;
          if (!e.vatKnown) revVatUnknown += e.moneyMinor;
          break;
        }
        case 'free':
          nonCash.freeCreditsConsumedMinor += e.creditsMinor;
          break;
        case 'voided':
          nonCash.voidedCreditsConsumedMinor += e.creditsMinor;
          break;
        case 'forfeit':
          nonCash.forfeitedCreditsMinor += e.creditsMinor;
          nonCash.forfeitedMoneyMinor += e.moneyMinor;
          break;
        case 'unmatched':
          nonCash.unmatchedCreditsMinor += e.creditsMinor;
          break;
      }
    }
    cash.netMinor = cash.collectedMinor - cash.refundedMinor;
    cash.netVatMinor = cash.collectedVatMinor - cash.refundedVatMinor;
    cash.netExVatMinor = cash.netMinor - cash.netVatMinor;
    cash.discountMinor = cash.faceValueSoldMinor - cash.collectedMinor;

    const totalNet =
      byCategory.cpc +
      byCategory.aiUsage +
      byCategory.builderUnlock +
      byCategory.other +
      refundFeesNet;

    // --- expenses ---------------------------------------------------------
    const expByCat = emptyExpenseCategories();
    const missingFx = { count: 0, byCurrency: {} as Record<string, number> };
    for (const x of costs.expenses) {
      if (!inRange(x.incurredOn, r)) continue;
      const eur = expenseEurMinor(x);
      if (eur === null) {
        missingFx.count++;
        missingFx.byCurrency[x.currency] = (missingFx.byCurrency[x.currency] ?? 0) + x.amountMinor;
        continue;
      }
      if (x.category in expByCat) expByCat[x.category as ExpenseCategoryKey] += eur;
      else expByCat.other += eur;
    }
    // AI costs: raw USD summed first and rounded once (sub-cent calls).
    const builderUsd = costs.ai
      .filter((a) => inRange(a.createdAt, r))
      .reduce((s, a) => s + a.estimatedCostUsd, 0);
    const searchUsd = costs.search
      .filter((d) => inRange(d.day, r))
      .reduce((s, d) => s + d.aiCostUsd, 0);
    const ai = {
      builderMinor: Math.round(builderUsd * 100),
      campaignAgentMinor: costs.agent
        .filter((a) => inRange(a.startedAt, r))
        .reduce((s, a) => s + (a.claudeCostEstimateMinor ?? 0), 0),
      searchMinor: Math.round(searchUsd * 100),
      totalMinor: 0,
    };
    ai.totalMinor = ai.builderMinor + ai.campaignAgentMinor + ai.searchMinor;
    const recordedExpenses = Object.values(expByCat).reduce((s, v) => s + v, 0);
    const totalExpenses = recordedExpenses + ai.totalMinor;

    const operatingProfit = totalNet - totalExpenses;

    const missing: MissingInfo[] = [];
    if (cash.vatUnknownMinor !== 0 || revVatUnknown !== 0) {
      missing.push({
        key: 'vatUnknown',
        count: vatUnknownCount,
        amountMinor: Math.max(cash.vatUnknownMinor, revVatUnknown),
      });
    }
    if (missingFx.count) missing.push({ key: 'expenseFx', count: missingFx.count });
    if (ai.totalMinor > 0) missing.push({ key: 'aiEstimated', amountMinor: ai.totalMinor });
    if (nonCash.unmatchedCreditsMinor > 0) {
      missing.push({ key: 'unmatched', amountMinor: nonCash.unmatchedCreditsMinor });
    }
    if (nonCash.forfeitedMoneyMinor > 0) {
      missing.push({ key: 'forfeit', amountMinor: nonCash.forfeitedMoneyMinor });
    }
    missing.push({ key: 'expenseVat' }, { key: 'incomeTax' });

    return {
      range: { from: r.from.toISOString(), to: r.to.toISOString() },
      cash,
      revenue: {
        byCategory,
        refundFeesMinor: refundFeesNet,
        totalNetMinor: totalNet,
        totalVatMinor: revVat,
        totalGrossMinor: revGross,
        vatUnknownGrossMinor: revVatUnknown,
      },
      nonCash,
      expenses: { byCategory: expByCat, ai, totalMinor: totalExpenses, missingFx },
      result: {
        operatingProfitMinor: operatingProfit,
        cashResultMinor: cash.netExVatMinor - totalExpenses,
        marginPct: totalNet > 0 ? Math.round((operatingProfit / totalNet) * 1000) / 10 : null,
      },
      missing,
    };
  }

  /** Daily earned revenue / expenses / net cash for the chart. */
  dailyFrom(
    result: EngineResult,
    costs: CostData,
    r: StatementRange,
  ): { date: string; revenueMinor: number; expenseMinor: number; cashNetMinor: number }[] {
    const days = new Map<
      string,
      { revenueMinor: number; expenseMinor: number; cashNetMinor: number; aiUsd: number }
    >();
    const bucket = (d: Date) => {
      const k = d.toISOString().slice(0, 10);
      let b = days.get(k);
      if (!b) {
        b = { revenueMinor: 0, expenseMinor: 0, cashNetMinor: 0, aiUsd: 0 };
        days.set(k, b);
      }
      return b;
    };
    for (const e of result.events) {
      if (!inRange(e.at, r)) continue;
      if (e.kind === 'revenue' || e.kind === 'refundFee')
        bucket(e.at).revenueMinor += e.moneyMinor - e.vatMinor;
      else if (e.kind === 'cashIn') bucket(e.at).cashNetMinor += e.moneyMinor;
      else if (e.kind === 'cashOut') bucket(e.at).cashNetMinor -= e.moneyMinor;
    }
    for (const x of costs.expenses) {
      if (!inRange(x.incurredOn, r)) continue;
      const eur = expenseEurMinor(x);
      if (eur !== null) bucket(x.incurredOn).expenseMinor += eur;
    }
    for (const a of costs.ai)
      if (inRange(a.createdAt, r)) bucket(a.createdAt).aiUsd += a.estimatedCostUsd;
    for (const d of costs.search) if (inRange(d.day, r)) bucket(d.day).aiUsd += d.aiCostUsd;
    for (const a of costs.agent) {
      if (inRange(a.startedAt, r))
        bucket(a.startedAt).expenseMinor += a.claudeCostEstimateMinor ?? 0;
    }
    return [...days.entries()]
      .map(([date, b]) => ({
        date,
        revenueMinor: b.revenueMinor,
        expenseMinor: b.expenseMinor + Math.round(b.aiUsd * 100),
        cashNetMinor: b.cashNetMinor,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Everything the dashboard needs in one replay: the period statement,
   *  today / this month / this year, the balance at the period end, the
   *  daily series. */
  async dashboard(r: StatementRange, now = new Date()) {
    const endToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
    );
    const fixed: StatementRange[] = [
      {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        to: endToday,
      },
      { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: endToday },
      { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: endToday },
    ];
    const maxTo = new Date(Math.max(r.to.getTime(), endToday.getTime()));
    const minFrom = new Date(Math.min(r.from.getTime(), fixed[2].from.getTime()));
    const [ledger, costs] = await Promise.all([
      this.loadLedger(maxTo),
      this.loadCosts(minFrom, maxTo),
    ]);
    const result = runLedger(ledger);
    const statement = this.buildStatement(result.events, costs, r);
    const [today, month, year] = fixed.map((f) => this.buildStatement(result.events, costs, f));
    // Customer advances as they stood at the END of the selected period.
    const asOfLedger = ledger.filter((t) => t.createdAt.getTime() <= r.to.getTime());
    const balance = this.snapshot(runLedger(asOfLedger).remaining, r.to);
    return {
      statement,
      fixed: { today, month, year },
      balance,
      daily: this.dailyFrom(result, costs, r),
    };
  }

  // -------------------------------------------------------------------------
  // Integrity checks
  // -------------------------------------------------------------------------

  async checks(): Promise<{ generatedAt: string; items: CheckItem[] }> {
    const now = new Date();
    const [ledger, wallets, purchases, invoices, refunds, fees, expenses] = await Promise.all([
      this.loadLedger(now),
      this.prisma.wallet.findMany({
        select: { id: true, balanceMinor: true, user: { select: { email: true } } },
      }),
      this.prisma.walletTransaction.findMany({
        where: { type: 'purchase', status: 'completed' },
        select: {
          id: true,
          providerRef: true,
          amountMinor: true,
          eurCents: true,
          createdAt: true,
          invoice: { select: { id: true } },
          wallet: { select: { user: { select: { email: true } } } },
        },
      }),
      this.prisma.invoice.findMany({
        where: { voidedAt: null, kind: 'topup' },
        select: {
          number: true,
          totalMinor: true,
          eurCents: true,
          walletTransaction: { select: { ronBani: true, eurCents: true, amountMinor: true } },
        },
      }),
      this.prisma.walletTransaction.findMany({
        where: { type: 'refund', status: { in: ['pending', 'processing', 'completed'] } },
        select: { id: true, amountMinor: true, refundSources: true, createdAt: true },
      }),
      this.prisma.platformExpense.findMany({
        where: { externalRef: { startsWith: 'stripe_fee:' } },
        select: { externalRef: true },
      }),
      this.prisma.platformExpense.findMany({
        select: {
          id: true,
          category: true,
          incurredOn: true,
          amountMinor: true,
          currency: true,
          eurAmountMinor: true,
          source: true,
          note: true,
        },
      }),
    ]);
    const engine = runLedger(ledger);
    const items: CheckItem[] = [];
    const sev = (n: number, bad: CheckSeverity): CheckSeverity => (n > 0 ? bad : 'ok');
    const day = (d: Date) => d.toISOString().slice(0, 10);

    // 1. The same Stripe payment booked twice.
    const byRef = new Map<string, typeof purchases>();
    for (const p of purchases) {
      if (!p.providerRef) continue;
      byRef.set(p.providerRef, [...(byRef.get(p.providerRef) ?? []), p]);
    }
    const dupGroups = [...byRef.entries()].filter(([, rows]) => rows.length > 1);
    items.push({
      key: 'duplicatePurchases',
      severity: sev(dupGroups.length, 'error'),
      count: dupGroups.length,
      amountMinor: dupGroups.reduce(
        (s, [, rows]) => s + rows.slice(1).reduce((x, r) => x + (r.eurCents ?? r.amountMinor), 0),
        0,
      ),
      samples: dupGroups.slice(0, SAMPLE_LIMIT).map(([ref, rows]) => ({
        label: ref,
        detail: `${rows.length}× · ${rows[0].wallet.user?.email ?? ''}`,
        amountMinor: rows[0].eurCents ?? rows[0].amountMinor,
      })),
    });

    // 2. Stored wallet balance vs the balance rebuilt from the ledger.
    const mismatched = wallets
      .map((w) => ({ w, expected: engine.balanceByWallet.get(w.id) ?? 0 }))
      .filter(({ w, expected }) => w.balanceMinor !== expected);
    items.push({
      key: 'walletBalance',
      severity: sev(mismatched.length, 'error'),
      count: mismatched.length,
      amountMinor: mismatched.reduce((s, { w, expected }) => s + (w.balanceMinor - expected), 0),
      samples: mismatched.slice(0, SAMPLE_LIMIT).map(({ w, expected }) => ({
        label: w.user?.email ?? w.id,
        detail: `${(w.balanceMinor / 100).toFixed(2)} / ${(expected / 100).toFixed(2)}`,
        amountMinor: w.balanceMinor - expected,
      })),
    });

    // 3. Purchases with no invoice: VAT not documented.
    const uninvoiced = purchases.filter((p) => !p.invoice);
    items.push({
      key: 'uninvoicedPurchases',
      severity: sev(uninvoiced.length, 'warning'),
      count: uninvoiced.length,
      amountMinor: uninvoiced.reduce((s, p) => s + (p.eurCents ?? p.amountMinor), 0),
      samples: uninvoiced.slice(0, SAMPLE_LIMIT).map((p) => ({
        label: p.wallet.user?.email ?? p.id,
        detail: day(p.createdAt),
        amountMinor: p.eurCents ?? p.amountMinor,
      })),
    });

    // 4. Invoice totals that don't match the payment they document.
    const badInvoices = invoices.filter((i) => {
      const t = i.walletTransaction;
      if (t.ronBani !== null && t.ronBani !== i.totalMinor) return true;
      return i.eurCents !== null && t.eurCents !== null && i.eurCents !== t.eurCents;
    });
    items.push({
      key: 'invoiceMismatch',
      severity: sev(badInvoices.length, 'error'),
      count: badInvoices.length,
      amountMinor: null,
      samples: badInvoices.slice(0, SAMPLE_LIMIT).map((i) => ({
        label: i.number,
        detail: `${(i.totalMinor / 100).toFixed(2)} RON / ${((i.walletTransaction.ronBani ?? 0) / 100).toFixed(2)} RON`,
      })),
    });

    // 5. Refunds whose allocation doesn't add up to the refunded credits.
    const badRefunds = refunds.filter((r) => {
      const sources = parseSources(r.refundSources);
      return sources.reduce((s, x) => s + x.amountMinor, 0) !== Math.abs(r.amountMinor);
    });
    items.push({
      key: 'refundSources',
      severity: sev(badRefunds.length, 'warning'),
      count: badRefunds.length,
      amountMinor: badRefunds.reduce((s, r) => s + Math.abs(r.amountMinor), 0),
      samples: badRefunds.slice(0, SAMPLE_LIMIT).map((r) => ({
        label: r.id.slice(0, 8),
        detail: day(r.createdAt),
        amountMinor: Math.abs(r.amountMinor),
      })),
    });

    // 6. Stripe payments whose processing fee was never booked as a cost.
    const feeRefs = new Set(fees.map((f) => f.externalRef?.slice('stripe_fee:'.length)));
    const noFee = purchases.filter(
      (p) => p.providerRef?.startsWith('pi_') && !feeRefs.has(p.providerRef),
    );
    items.push({
      key: 'stripeFeeMissing',
      severity: sev(noFee.length, 'warning'),
      count: noFee.length,
      amountMinor: noFee.reduce((s, p) => s + (p.eurCents ?? p.amountMinor), 0),
      samples: noFee.slice(0, SAMPLE_LIMIT).map((p) => ({
        label: p.providerRef ?? p.id,
        detail: day(p.createdAt),
        amountMinor: p.eurCents ?? p.amountMinor,
      })),
    });

    // 7. Foreign-currency costs without an exchange rate (left out of totals).
    const noFx = expenses.filter((x) => expenseEurMinor(x) === null);
    items.push({
      key: 'expenseFx',
      severity: sev(noFx.length, 'error'),
      count: noFx.length,
      amountMinor: null,
      samples: noFx.slice(0, SAMPLE_LIMIT).map((x) => ({
        label: `${day(x.incurredOn)} · ${x.category}`,
        detail: `${(x.amountMinor / 100).toFixed(2)} ${x.currency}${x.note ? ` · ${x.note}` : ''}`,
      })),
    });

    // 8. Manual costs entered twice (same day, category, amount, currency).
    const expGroups = new Map<string, typeof expenses>();
    for (const x of expenses) {
      if (x.source !== 'manual') continue;
      const k = `${day(x.incurredOn)}|${x.category}|${x.amountMinor}|${x.currency}`;
      expGroups.set(k, [...(expGroups.get(k) ?? []), x]);
    }
    const dupExp = [...expGroups.values()].filter((g) => g.length > 1);
    items.push({
      key: 'duplicateExpenses',
      severity: sev(dupExp.length, 'warning'),
      count: dupExp.length,
      amountMinor: dupExp.reduce(
        (s, g) => s + g.slice(1).reduce((x, r) => x + (expenseEurMinor(r) ?? 0), 0),
        0,
      ),
      samples: dupExp.slice(0, SAMPLE_LIMIT).map((g) => ({
        label: `${day(g[0].incurredOn)} · ${g[0].category}`,
        detail: `${g.length}× ${(g[0].amountMinor / 100).toFixed(2)} ${g[0].currency}`,
        amountMinor: expenseEurMinor(g[0]) ?? undefined,
      })),
    });

    // 9. Consumption the ledger can't back with credits.
    const unmatched = engine.events.filter((e) => e.kind === 'unmatched');
    items.push({
      key: 'unmatchedConsumption',
      severity: sev(unmatched.length, 'error'),
      count: unmatched.length,
      amountMinor: unmatched.reduce((s, e) => s + e.creditsMinor, 0),
      samples: unmatched.slice(0, SAMPLE_LIMIT).map((e) => ({
        label: e.txnId.slice(0, 8),
        detail: day(e.at),
        amountMinor: e.creditsMinor,
      })),
    });

    // 10. Paid credits removed by an admin (money kept, nothing delivered).
    const forfeits = engine.events.filter((e) => e.kind === 'forfeit' && e.moneyMinor > 0);
    items.push({
      key: 'forfeitedCredits',
      severity: forfeits.length ? 'info' : 'ok',
      count: forfeits.length,
      amountMinor: forfeits.reduce((s, e) => s + e.moneyMinor, 0),
      samples: forfeits.slice(0, SAMPLE_LIMIT).map((e) => ({
        label: e.txnId.slice(0, 8),
        detail: day(e.at),
        amountMinor: e.moneyMinor,
      })),
    });

    return { generatedAt: now.toISOString(), items };
  }
}
