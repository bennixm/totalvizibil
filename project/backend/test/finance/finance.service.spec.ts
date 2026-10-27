import { FinanceService } from 'src/finance/finance.service';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** `overview()` issues exactly 4 `walletTransaction.findMany` calls inside
 *  its `$transaction([...])`, in this fixed order: purchases, refunds,
 *  CPC spends, other spends. Returning canned rows by call order (rather
 *  than trying to pattern-match Prisma's `where` shape) keeps this fake
 *  simple and robust. */
function fakePrisma() {
  const state = {
    purchases: [] as { amountMinor: number; eurCents: number | null; createdAt: Date }[],
    refunds: [] as {
      refundSources: unknown;
      feeMinor: number | null;
      createdAt: Date;
    }[],
    cpcSpends: [] as { amountMinor: number }[],
    otherSpends: [] as { amountMinor: number }[],
    expenses: [] as { category: string; amountMinor: number; incurredOn: Date }[],
    aiRows: [] as { estimatedCostUsd: number; createdAt: Date }[],
  };
  let walletTxCall = 0;
  const walletTxSequence = () => [
    state.purchases,
    state.refunds,
    state.cpcSpends,
    state.otherSpends,
  ];

  return {
    walletTransaction: {
      findMany: jest.fn(async () => {
        const result = walletTxSequence()[walletTxCall] ?? [];
        walletTxCall++;
        return result;
      }),
    },
    platformExpense: { findMany: jest.fn(async () => state.expenses) },
    aiUsageRecord: {
      findMany: jest.fn(async () => state.aiRows),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    __state: state,
    __resetCallOrder: () => {
      walletTxCall = 0;
    },
  };
}

function makeService() {
  const prisma = fakePrisma();
  const svc = new FinanceService(prisma as any);
  return { svc, prisma };
}

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
