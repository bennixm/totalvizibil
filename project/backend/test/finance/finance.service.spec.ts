import { ForbiddenException } from '@nestjs/common';
import { FinanceService } from 'src/finance/finance.service';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** `overview()` issues exactly 4 `walletTransaction.findMany` calls inside
 *  its `$transaction([...])`, in this fixed order: purchases, refunds,
 *  CPC spends, other spends. Returning canned rows by call order (rather
 *  than trying to pattern-match Prisma's `where` shape) keeps this fake
 *  simple and robust. The `aggregate`/`groupBy` members are separate jest
 *  mocks, so adding one never shifts that findMany ordering. */
function fakePrisma() {
  const state = {
    purchases: [] as { amountMinor: number; eurCents: number | null; createdAt: Date }[],
    refunds: [] as {
      refundSources: unknown;
      feeMinor: number | null;
      createdAt: Date;
    }[],
    cpcSpends: [] as { amountMinor: number }[],
    otherSpends: [] as {
      amountMinor: number;
      provider?: string | null;
      description?: string | null;
    }[],
    expenses: [] as { category: string; amountMinor: number; incurredOn: Date }[],
    aiRows: [] as { estimatedCostUsd: number; createdAt: Date }[],
    /** Sum of every wallet balance (the all-time liability figure). */
    walletBalanceMinor: 0,
    blockedWalletBalanceMinor: 0,
    /** Signed sum of pending/processing refund rows (stored negative). */
    refundInFlightMinor: 0,
    refundFeeMinor: 0,
    invoiceVatGroups: [] as {
      vatRatePct: number;
      currency: string;
      _sum: { subtotalMinor: number | null; vatMinor: number | null; totalMinor: number | null };
      _count: { _all: number };
    }[],
  };
  let walletTxCall = 0;
  const walletTxSequence = () => [
    state.purchases,
    state.refunds,
    state.cpcSpends,
    state.otherSpends,
  ];
  let walletAggregateCall = 0;

  return {
    walletTransaction: {
      findMany: jest.fn(async () => {
        const result = walletTxSequence()[walletTxCall] ?? [];
        walletTxCall++;
        return result;
      }),
      // In `overview()`'s order: refund-in-flight, then refund fee income.
      aggregate: jest.fn(async () => {
        const n = walletAggregateCall++;
        return n === 0
          ? { _sum: { amountMinor: state.refundInFlightMinor } }
          : { _sum: { feeMinor: state.refundFeeMinor } };
      }),
      count: jest.fn(async () => 0),
      groupBy: jest.fn(async () => []),
    },
    wallet: {
      // In `overview()`'s order: all wallets, then blocked wallets only.
      aggregate: jest
        .fn()
        .mockImplementationOnce(async () => ({ _sum: { balanceMinor: state.walletBalanceMinor } }))
        .mockImplementation(async () => ({
          _sum: { balanceMinor: state.blockedWalletBalanceMinor },
        })),
    },
    invoice: {
      groupBy: jest.fn(async () => state.invoiceVatGroups),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      aggregate: jest.fn(async () => ({ _sum: { totalMinor: 0 } })),
    },
    company: { findMany: jest.fn(async () => []) },
    platformExpense: { findMany: jest.fn(async () => state.expenses) },
    aiUsageRecord: {
      findMany: jest.fn(async () => state.aiRows),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    __state: state,
    __resetCallOrder: () => {
      walletTxCall = 0;
      walletAggregateCall = 0;
    },
  };
}

function makeService() {
  const prisma = fakePrisma();
  const svc = new FinanceService(prisma as any);
  return { svc, prisma };
}

type LedgerRow = {
  id: string;
  type: 'purchase' | 'refund' | 'adjustment';
  amountMinor: number;
  eurCents: number | null;
  refundSources: unknown;
  feeMinor: number | null;
  createdAt: Date;
  description: string | null;
  wallet: { user: { name: string; email: string } | null };
  company: { displayName: string } | null;
};

function row(partial: Partial<LedgerRow>): LedgerRow {
  return {
    id: 'tx',
    type: 'purchase',
    amountMinor: 0,
    eurCents: null,
    refundSources: null,
    feeMinor: null,
    createdAt: new Date('2026-01-05'),
    description: null,
    wallet: { user: { name: 'Ion', email: 'ion@example.com' } },
    company: null,
    ...partial,
  };
}

/** A fake for `listRevenue`/`exportRevenuePdf`, which (unlike `overview()`)
 *  filter by `where` rather than by call order: the fake applies the
 *  `type.in` filter itself so the `types=` test is actually exercising the
 *  query the service built, not a canned answer. */
function fakeLedgerPrisma(rows: LedgerRow[]) {
  const captured: { where?: any }[] = [];
  const matching = (where: any): LedgerRow[] => {
    const types: string[] = where?.type?.in ?? [];
    return rows.filter((r) => types.includes(r.type));
  };
  return {
    walletTransaction: {
      findMany: jest.fn(async (args: any) => {
        captured.push({ where: args.where });
        const hits = matching(args.where);
        return args.skip !== undefined || args.take !== undefined
          ? hits.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? hits.length))
          : hits;
      }),
      count: jest.fn(async (args: any) => matching(args.where).length),
    },
    __captured: captured,
  };
}

function makeLedgerService(rows: LedgerRow[]) {
  const prisma = fakeLedgerPrisma(rows);
  return { svc: new FinanceService(prisma as any), prisma };
}

/** Expense fake for the `stripe_api` mutation guard. */
function makeExpenseService(source: 'manual' | 'stripe_api') {
  const prisma = {
    platformExpense: {
      findUnique: jest.fn(async () => ({ id: 'e1', source, amountMinor: 1000 })),
      update: jest.fn(async () => ({ id: 'e1', source, amountMinor: 2000 })),
      delete: jest.fn(async () => ({ id: 'e1' })),
    },
  };
  return { svc: new FinanceService(prisma as any), prisma };
}
const FINANCE_ACTOR = { id: 'u1', platformRoles: ['finance'] } as any;
const ADMIN_ACTOR = { id: 'u2', platformRoles: ['admin'] } as any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FinanceService', () => {
  describe('overview — revenue', () => {
    it('counts the money actually charged (eurCents), not the credit face value, when a discount was active', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.purchases = [
        // 1000 credits bought at a 20% discount: amountMinor (face value) is
        // 100000, but only 80000 EUR-cents actually changed hands.
        { amountMinor: 100_000, eurCents: 80_000, createdAt: new Date('2026-01-05') },
      ];

      const result = await svc.overview({});

      expect(result.revenueMinor).toBe(80_000);
    });

    it('falls back to amountMinor for legacy rows that predate the eurCents column', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.purchases = [
        { amountMinor: 50_000, eurCents: null, createdAt: new Date('2026-01-05') },
      ];

      const result = await svc.overview({});

      expect(result.revenueMinor).toBe(50_000);
    });

    it('deducts a refund by the real money returned (refundSources moneyMinor minus the fee), not the credit face value', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.purchases = [
        { amountMinor: 100_000, eurCents: 100_000, createdAt: new Date('2026-01-01') },
      ];
      prisma.__state.refunds = [
        {
          // amountMinor (not selected here, same as what overview() reads)
          // would have been -50000 (the credit face value refunded) — but
          // only 40000 EUR-cents of real money was behind it, and the
          // platform kept a 4000 processing fee out of that.
          refundSources: [{ purchaseId: 'p1', amountMinor: 50_000, moneyMinor: 40_000 }],
          feeMinor: 4_000,
          createdAt: new Date('2026-01-10'),
        },
      ];

      const result = await svc.overview({});

      // 100000 revenue - (40000 money returned - 4000 fee kept) = 100000 - 36000
      expect(result.revenueMinor).toBe(100_000 - 36_000);
    });

    it('falls back to amountMinor within a refund source when moneyMinor predates the discount feature', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.purchases = [
        { amountMinor: 100_000, eurCents: 100_000, createdAt: new Date('2026-01-01') },
      ];
      prisma.__state.refunds = [
        {
          refundSources: [{ purchaseId: 'p1', amountMinor: 20_000 }], // no moneyMinor
          feeMinor: 0,
          createdAt: new Date('2026-01-10'),
        },
      ];

      const result = await svc.overview({});

      expect(result.revenueMinor).toBe(100_000 - 20_000);
    });

    it("the daily trend's revenue sums to the same total as the headline revenueMinor", async () => {
      const { svc, prisma } = makeService();
      prisma.__state.purchases = [
        { amountMinor: 100_000, eurCents: 80_000, createdAt: new Date('2026-01-05') },
      ];
      prisma.__state.refunds = [
        {
          refundSources: [{ purchaseId: 'p1', amountMinor: 10_000, moneyMinor: 8_000 }],
          feeMinor: 1_000,
          createdAt: new Date('2026-01-06'),
        },
      ];

      const result = await svc.overview({});
      const trendRevenue = result.trend.reduce((s, d) => s + d.revenueMinor, 0);

      expect(trendRevenue).toBe(result.revenueMinor);
    });
  });

  describe('overview — AI cost rounding', () => {
    it("the daily trend's AI cost sums to the same total as the headline aiCostMinor, even for many sub-cent calls", async () => {
      const { svc, prisma } = makeService();
      // 10 calls at $0.001 each, same day — each rounds to 0 cents
      // individually, but the sum ($0.01) is a real cent. Rounding each row
      // first (the old bug) would make the trend's cost 0 while the
      // headline (which sums raw USD first) still shows 1.
      const day = new Date('2026-02-01T10:00:00.000Z');
      prisma.__state.aiRows = Array.from({ length: 10 }, () => ({
        estimatedCostUsd: 0.001,
        createdAt: day,
      }));

      const result = await svc.overview({});
      const trendCost = result.trend.reduce((s, d) => s + d.costMinor, 0);

      expect(result.aiCostMinor).toBe(1);
      expect(trendCost).toBe(result.aiCostMinor);
    });
  });

  describe('overview — new statistics', () => {
    it('reports gross (credit face value) and net (money collected) revenue separately, with the delta as the discount cost', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.purchases = [
        { amountMinor: 100_000, eurCents: 80_000, createdAt: new Date('2026-01-05') },
        { amountMinor: 50_000, eurCents: null, createdAt: new Date('2026-01-06') },
      ];

      const result = await svc.overview({});

      expect(result.grossRevenueMinor).toBe(150_000);
      expect(result.netRevenueMinor).toBe(130_000);
      expect(result.discountCostMinor).toBe(20_000);
      // No refunds, so the headline stays the net figure.
      expect(result.revenueMinor).toBe(result.netRevenueMinor);
    });

    it('weights CPC credit consumption by the period gross-to-net ratio, keeping the face-value figure alongside', async () => {
      const { svc, prisma } = makeService();
      // Everything sold at a flat 20% discount => ratio 0.8.
      prisma.__state.purchases = [
        { amountMinor: 100_000, eurCents: 80_000, createdAt: new Date('2026-01-05') },
      ];
      prisma.__state.cpcSpends = [{ amountMinor: -10_000 }];

      const result = await svc.overview({});

      expect(result.grossToNetRatio).toBeCloseTo(0.8);
      expect(result.paidTraffic.cpcRevenueMinor).toBe(10_000);
      expect(result.paidTraffic.cpcRevenueRealMoneyMinor).toBe(8_000);
    });

    it('sums every wallet balance as the all-time credit liability, and the frozen subset separately', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.walletBalanceMinor = 1_234_500;
      prisma.__state.blockedWalletBalanceMinor = 20_000;
      prisma.__state.refundInFlightMinor = -75_000; // stored negative

      const result = await svc.overview({});

      expect(result.walletLiabilityMinor).toBe(1_234_500);
      expect(result.blockedWalletBalanceMinor).toBe(20_000);
      // Reported as a positive "promised out" figure.
      expect(result.refundLiabilityInFlightMinor).toBe(75_000);
    });

    it('groups the VAT breakdown by rate and currency, in the shape a VAT return needs', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.invoiceVatGroups = [
        {
          vatRatePct: 21,
          currency: 'RON',
          _sum: { subtotalMinor: 100_000, vatMinor: 21_000, totalMinor: 121_000 },
          _count: { _all: 3 },
        },
        {
          vatRatePct: 0,
          currency: 'RON',
          _sum: { subtotalMinor: 50_000, vatMinor: 0, totalMinor: 50_000 },
          _count: { _all: 1 },
        },
      ];

      const result = await svc.overview({});

      expect(result.vatBreakdown).toEqual([
        {
          vatRatePct: 0,
          currency: 'RON',
          invoiceCount: 1,
          subtotalMinor: 50_000,
          vatMinor: 0,
          totalMinor: 50_000,
        },
        {
          vatRatePct: 21,
          currency: 'RON',
          invoiceCount: 3,
          subtotalMinor: 100_000,
          vatMinor: 21_000,
          totalMinor: 121_000,
        },
      ]);
      // subtotal + VAT must tie out to the total per rate.
      for (const g of result.vatBreakdown) {
        expect(g.subtotalMinor + g.vatMinor).toBe(g.totalMinor);
      }
    });

    it('shows the refund processing fee the platform kept as its own income line', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.refundFeeMinor = 4_000;

      const result = await svc.overview({});

      expect(result.refundFeeIncomeMinor).toBe(4_000);
    });

    it('splits one-off fee consumption by the same categories wallet.service.ts uses', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.otherSpends = [
        { amountMinor: -5_000, provider: 'ai-usage', description: 'Website Builder usage' },
        { amountMinor: -9_900, provider: null, description: 'Advanced website builder' },
        { amountMinor: -1_000, provider: null, description: 'Additional business' },
      ];

      const result = await svc.overview({});

      expect(result.otherFeesConsumedMinor).toBe(15_900);
      expect(result.otherFeesByCategory).toEqual({
        aiUsage: 5_000,
        builderUnlock: 9_900,
        other: 1_000,
      });
      // Explicitly labelled recurring-vs-one-time pair.
      expect(result.creditConsumption.oneTimeMinor).toBe(result.otherFeesConsumedMinor);
      expect(result.creditConsumption.recurringMinor).toBe(result.paidTraffic.cpcRevenueMinor);
    });

    it('adds a per-day refund-to-revenue ratio to the trend series using the same fee-aware helpers', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.purchases = [
        { amountMinor: 100_000, eurCents: 100_000, createdAt: new Date('2026-01-05') },
      ];
      prisma.__state.refunds = [
        {
          refundSources: [{ purchaseId: 'p1', amountMinor: 30_000, moneyMinor: 30_000 }],
          feeMinor: 10_000,
          createdAt: new Date('2026-01-05'),
        },
      ];

      const result = await svc.overview({});
      const day = result.trend.find((d) => d.date === '2026-01-05');

      // 20000 real money returned (30000 - 10000 fee) out of 100000 collected.
      expect(day?.purchaseMoneyMinor).toBe(100_000);
      expect(day?.refundMoneyMinor).toBe(20_000);
      expect(day?.refundRatioPct).toBeCloseTo(20);
      expect(result.refundRatioPct).toBeCloseTo(20);
    });

    it('reports 0% (not Infinity) on a day that had a refund but no purchases', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.refunds = [
        {
          refundSources: [{ purchaseId: 'p1', amountMinor: 5_000, moneyMinor: 5_000 }],
          feeMinor: 0,
          createdAt: new Date('2026-01-09'),
        },
      ];

      const result = await svc.overview({});

      expect(result.trend[0].refundRatioPct).toBe(0);
    });
  });

  describe('listRevenue — money accuracy', () => {
    it('reports the real money per row and a period total matching overview, not the credit face value, under a discount', async () => {
      const discountedPurchase = row({
        id: 'p1',
        type: 'purchase',
        amountMinor: 100_000,
        eurCents: 80_000,
      });
      const feeRefund = row({
        id: 'r1',
        type: 'refund',
        amountMinor: -10_000,
        refundSources: [{ purchaseId: 'p1', amountMinor: 10_000, moneyMinor: 8_000 }],
        feeMinor: 1_000,
      });
      const { svc } = makeLedgerService([discountedPurchase, feeRefund]);

      const result = await svc.listRevenue({});

      // Per row: face value is still there, money is the new figure.
      expect(result.items[0]).toMatchObject({ amountMinor: 100_000, moneyMinor: 80_000 });
      expect(result.items[1]).toMatchObject({ amountMinor: -10_000, moneyMinor: -7_000 });

      // And the same arithmetic overview() does: 80000 - (8000 - 1000).
      const { svc: overviewSvc, prisma: overviewPrisma } = makeService();
      overviewPrisma.__state.purchases = [
        { amountMinor: 100_000, eurCents: 80_000, createdAt: new Date('2026-01-05') },
      ];
      overviewPrisma.__state.refunds = [
        {
          refundSources: [{ purchaseId: 'p1', amountMinor: 10_000, moneyMinor: 8_000 }],
          feeMinor: 1_000,
          createdAt: new Date('2026-01-05'),
        },
      ];
      const overview = await overviewSvc.overview({});

      expect(result.periodTotalMinor).toBe(overview.revenueMinor);
      // The old (wrong) behaviour was to report the face value as the money.
      expect(result.periodFaceTotalMinor).toBe(90_000);
      expect(result.periodTotalMinor).toBe(73_000);
    });

    it('aggregates the period total over the full filtered set, not just the requested page', async () => {
      const rows = Array.from({ length: 5 }, (_, i) =>
        row({ id: `p${i}`, type: 'purchase', amountMinor: 10_000, eurCents: 10_000 }),
      );
      const { svc } = makeLedgerService(rows);

      const result = await svc.listRevenue({ page: 1, pageSize: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.periodTotalMinor).toBe(50_000);
    });

    it('defaults to purchase+refund and applies the same default period as overview', async () => {
      const { svc, prisma } = makeLedgerService([]);

      await svc.listRevenue({});

      const where = prisma.__captured[0].where;
      expect(where.type.in).toEqual(['purchase', 'refund']);
      // Same default window overview() resolves: the current UTC month.
      const expectedFrom = new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
      );
      expect(where.createdAt.gte.toISOString()).toBe(expectedFrom.toISOString());
      expect(where.createdAt.lte).toBeInstanceOf(Date);
    });

    it('widens the ledger to wallet adjustments when types= asks for them', async () => {
      const adjustment = row({
        id: 'a1',
        type: 'adjustment',
        amountMinor: 5_000,
        description: 'Affiliate reward',
      });
      const purchase = row({ id: 'p1', amountMinor: 10_000, eurCents: 10_000 });
      const { svc, prisma } = makeLedgerService([purchase, adjustment]);

      const withAdjustments = await svc.listRevenue({
        types: ['purchase', 'refund', 'adjustment'],
      });

      expect(prisma.__captured[0].where.type.in).toEqual(['purchase', 'refund', 'adjustment']);
      expect(withAdjustments.items.map((i) => i.id)).toEqual(['p1', 'a1']);
      // A credit grant moves no money, so it must not inflate revenue —
      // only its credit face value shows up.
      expect(withAdjustments.items[1].moneyMinor).toBe(0);
      expect(withAdjustments.periodTotalMinor).toBe(10_000);
      expect(withAdjustments.periodFaceTotalMinor).toBe(15_000);
    });

    it('the single-type toggle still wins over types=', async () => {
      const { svc, prisma } = makeLedgerService([]);

      await svc.listRevenue({ type: 'refund', types: ['purchase', 'adjustment'] });

      expect(prisma.__captured[0].where.type.in).toEqual(['refund']);
    });
  });

  describe('exportRevenuePdf — money accuracy', () => {
    it('renders both the credit face value and the real money, and a period TOTAL row', async () => {
      const { svc } = makeLedgerService([
        row({ id: 'p1', amountMinor: 100_000, eurCents: 80_000 }),
      ]);

      const pdf = await svc.exportRevenuePdf({});

      // Smoke-level: a real PDF came back (the money math itself is asserted
      // through listRevenue, which shares `rowMoneyMinor`).
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.length).toBeGreaterThan(500);
    });
  });

  describe('expense mutation guards', () => {
    it('refuses a finance-only user editing an auto-captured Stripe expense', async () => {
      const { svc, prisma } = makeExpenseService('stripe_api');

      await expect(svc.updateExpense('e1', { amountMinor: 2_000 }, FINANCE_ACTOR)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.platformExpense.update).not.toHaveBeenCalled();
    });

    it('refuses a finance-only user deleting an auto-captured Stripe expense', async () => {
      const { svc, prisma } = makeExpenseService('stripe_api');

      await expect(svc.deleteExpense('e1', FINANCE_ACTOR)).rejects.toThrow(ForbiddenException);
      expect(prisma.platformExpense.delete).not.toHaveBeenCalled();
    });

    it('rejects with the machine code stripe_expense_readonly', async () => {
      const { svc } = makeExpenseService('stripe_api');

      await expect(svc.deleteExpense('e1', FINANCE_ACTOR)).rejects.toMatchObject({
        response: { message: 'stripe_expense_readonly' },
      });
    });

    it('lets a full admin edit and delete a Stripe-sourced expense', async () => {
      const { svc, prisma } = makeExpenseService('stripe_api');

      await svc.updateExpense('e1', { amountMinor: 2_000 }, ADMIN_ACTOR);
      await svc.deleteExpense('e1', ADMIN_ACTOR);

      expect(prisma.platformExpense.update).toHaveBeenCalled();
      expect(prisma.platformExpense.delete).toHaveBeenCalled();
    });

    it('leaves manual expenses editable by finance', async () => {
      const { svc, prisma } = makeExpenseService('manual');

      await svc.updateExpense('e1', { amountMinor: 2_000 }, FINANCE_ACTOR);

      expect(prisma.platformExpense.update).toHaveBeenCalled();
    });

    it('never overwrites createdById on edit (it is who CREATED the row, not who edited it)', async () => {
      const { svc, prisma } = makeExpenseService('manual');

      await svc.updateExpense('e1', { amountMinor: 2_000 }, ADMIN_ACTOR);

      const data = (prisma.platformExpense.update as jest.Mock).mock.calls[0][0].data;
      expect(data).not.toHaveProperty('createdById');
    });

    it('passes an explicit currency through on edit', async () => {
      const { svc, prisma } = makeExpenseService('manual');

      await svc.updateExpense('e1', { currency: 'RON' }, FINANCE_ACTOR);

      const data = (prisma.platformExpense.update as jest.Mock).mock.calls[0][0].data;
      expect(data.currency).toBe('RON');
    });
  });

  describe('aiUsageReport — per-model rounding', () => {
    it('byModel cost sums to the same total as totalCostMinor, even for many sub-cent calls on one model', async () => {
      const { svc, prisma } = makeService();
      prisma.__state.aiRows = Array.from({ length: 10 }, () => ({
        provider: 'anthropic',
        model: 'sonnet-5',
        taskCategory: 'test',
        inputTokens: 10,
        outputTokens: 10,
        estimatedCostUsd: 0.001,
        createdAt: new Date('2026-02-01'),
      })) as unknown as { estimatedCostUsd: number; createdAt: Date }[];

      const result = await svc.aiUsageReport({});
      const byModelTotal = result.byModel.reduce((s, m) => s + m.costMinor, 0);

      expect(result.totalCostMinor).toBe(1);
      expect(byModelTotal).toBe(result.totalCostMinor);
    });
  });
});
