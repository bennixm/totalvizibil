import { AdminStatsService } from 'src/admin/admin-stats.service';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function fakePrisma() {
  return {
    $transaction: jest.fn(async (arr: Promise<any>[]) => Promise.all(arr)),
    $queryRaw: jest.fn(async () => []),
    user: {
      count: jest.fn(async () => 10),
    },
    company: {
      count: jest.fn(async () => 5),
      groupBy: jest.fn(async () => [{ country: 'RO', _count: { _all: 5 } }]),
    },
    website: {
      count: jest.fn(async () => 2),
    },
    session: {
      count: jest.fn(async () => 3),
    },
    platformRoleAssignment: {
      groupBy: jest.fn(async () => [{ role: 'admin', _count: { _all: 1 } }]),
    },
    campaign: {
      groupBy: jest.fn(async () => [
        { status: 'active', _count: { _all: 2 } },
        { status: 'paused', _count: { _all: 1 } },
      ]),
      count: jest.fn(async () => 1),
      aggregate: jest.fn(async () => ({ _sum: { dailyBudgetMinor: 5000 } })),
    },
    adClick: {
      count: jest.fn(async () => 50),
    },
    lead: {
      count: jest.fn(async () => 20),
    },
    wallet: {
      count: jest.fn(async () => 0),
    },
    walletTransaction: {
      count: jest.fn(async () => 3),
      aggregate: jest.fn(async () => ({
        _sum: { amountMinor: 100000, ronBani: 50000 },
      })),
      // Completed-refund rows, read individually because the real refunded
      // money is per-row (`refundSources[].moneyMinor` minus that row's fee).
      findMany: jest.fn(async () => [] as { refundSources: unknown; feeMinor: number | null }[]),
    },
  };
}

function fakeSettings(rate = 5.05) {
  return {
    eurRonRate: jest.fn(async () => rate),
  };
}

function makeService(
  prisma: ReturnType<typeof fakePrisma> = fakePrisma(),
  settings: ReturnType<typeof fakeSettings> = fakeSettings(),
) {
  return { svc: new AdminStatsService(prisma as any, settings as any), prisma, settings };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminStatsService', () => {
  describe('overview()', () => {
    it('returns an object with all expected top-level keys', async () => {
      const { svc } = makeService();
      const result = await svc.overview();
      expect(result).toMatchObject({
        users: expect.any(Object),
        companies: expect.any(Object),
        staffByRole: expect.any(Array),
        activeSessions: expect.any(Number),
        signups: expect.any(Array),
        economySeries: expect.any(Array),
        eurRonRate: expect.any(Number),
        economy: expect.any(Object),
        campaigns: expect.any(Object),
        generatedAt: expect.any(String),
      });
    });

    it('users block contains all expected fields', async () => {
      const { svc } = makeService();
      const { users } = await svc.overview();
      expect(users).toMatchObject({
        total: expect.any(Number),
        active: expect.any(Number),
        suspended: expect.any(Number),
        withTwoFactor: expect.any(Number),
        staff: expect.any(Number),
        new7d: expect.any(Number),
        new30d: expect.any(Number),
      });
    });

    it('companies block contains all expected fields including byCountry array', async () => {
      const { svc } = makeService();
      const { companies } = await svc.overview();
      expect(companies).toMatchObject({
        total: expect.any(Number),
        draft: expect.any(Number),
        active: expect.any(Number),
        suspended: expect.any(Number),
        withWebsite: expect.any(Number),
        websitesPublished: expect.any(Number),
        new7d: expect.any(Number),
        new30d: expect.any(Number),
        byCountry: expect.any(Array),
      });
    });

    it('campaigns block contains all expected fields with money shapes', async () => {
      const { svc } = makeService();
      const { campaigns } = await svc.overview();
      expect(campaigns).toMatchObject({
        active: expect.any(Number),
        paused: expect.any(Number),
        depleted: expect.any(Number),
        draft: expect.any(Number),
        autoOptimize: expect.any(Number),
        committedDailyBudget: expect.objectContaining({
          minor: expect.any(Number),
          credits: expect.any(Number),
        }),
        clicks30d: expect.any(Number),
        leads30d: expect.any(Number),
      });
    });

    it('economy block contains money shape objects', async () => {
      const { svc } = makeService();
      const { economy } = await svc.overview();
      expect(economy).toMatchObject({
        creditsSold: expect.objectContaining({
          minor: expect.any(Number),
          credits: expect.any(Number),
        }),
        creditsSold30d: expect.objectContaining({
          minor: expect.any(Number),
          credits: expect.any(Number),
        }),
        cpcConsumed: expect.objectContaining({
          minor: expect.any(Number),
          credits: expect.any(Number),
        }),
        cpcConsumed30d: expect.objectContaining({
          minor: expect.any(Number),
          credits: expect.any(Number),
        }),
        refunded: expect.objectContaining({
          minor: expect.any(Number),
          credits: expect.any(Number),
        }),
        pendingPurchases: expect.any(Number),
        walletsBlocked: expect.any(Number),
      });
    });

    it('forwards eurRonRate from platformSettings into the response', async () => {
      const settings = fakeSettings(4.97);
      const { svc } = makeService(fakePrisma(), settings);
      const result = await svc.overview();
      expect(result.eurRonRate).toBe(4.97);
      expect(settings.eurRonRate).toHaveBeenCalled();
    });

    it('coerces BigInt values from $queryRaw to JS numbers in signups timeseries', async () => {
      const prisma = fakePrisma();
      // Use a date within the 14-day window (3 days ago)
      const d = new Date();
      d.setDate(d.getDate() - 3);
      d.setHours(0, 0, 0, 0);
      const dateKey = d.toISOString().slice(0, 10);

      // signupTimeseries runs two $queryRaw calls (users then companies),
      // followed by one $queryRaw call inside economyTimeseries.
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ day: d, n: BigInt(42) }])
        .mockResolvedValueOnce([{ day: d, n: BigInt(7) }])
        .mockResolvedValueOnce([]);

      const { svc } = makeService(prisma);
      const result = await svc.overview();

      for (const point of result.signups) {
        expect(typeof point.users).toBe('number');
        expect(typeof point.companies).toBe('number');
      }

      const hit = result.signups.find((p) => p.date === dateKey);
      expect(hit?.users).toBe(42);
      expect(hit?.companies).toBe(7);
    });

    it('coerces BigInt values from $queryRaw to JS numbers in economySeries', async () => {
      const prisma = fakePrisma();
      // Use a date within the 14-day window (5 days ago)
      const d = new Date();
      d.setDate(d.getDate() - 5);
      d.setHours(0, 0, 0, 0);
      const dateKey = d.toISOString().slice(0, 10);

      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([]) // signupTimeseries users
        .mockResolvedValueOnce([]) // signupTimeseries companies
        .mockResolvedValueOnce([{ day: d, sold: BigInt(50000), consumed: BigInt(12000) }]);

      const { svc } = makeService(prisma);
      const result = await svc.overview();

      for (const point of result.economySeries) {
        expect(typeof point.sold).toBe('number');
        expect(typeof point.consumed).toBe('number');
      }

      const hit = result.economySeries.find((p) => p.date === dateKey);
      // credits = minor / 100
      expect(hit?.sold).toBe(500);
      expect(hit?.consumed).toBe(120);
    });

    it('signups and economySeries cover 14 data points each', async () => {
      const { svc } = makeService();
      const result = await svc.overview();
      expect(result.signups).toHaveLength(14);
      expect(result.economySeries).toHaveLength(14);
    });

    it("counts only CPC rows as 'consumed' — a bare type:'spend' filter also swept up builder-unlock / AI-usage / additional-business / domain fees and inflated the ad-spend card", async () => {
      const prisma = fakePrisma();
      const { svc } = makeService(prisma);

      await svc.overview();

      const spendCalls = (prisma.walletTransaction.aggregate as jest.Mock).mock.calls
        .map((c) => c[0] as { where: Record<string, unknown> })
        .filter((a) => a.where.type === 'spend');

      // Both the all-time and the 30-day aggregate.
      expect(spendCalls).toHaveLength(2);
      for (const call of spendCalls) {
        expect(call.where.provider).toBe('cpc');
      }
    });

    it("restricts the economySeries 'consumed' SQL to the CPC provider too, so the chart agrees with the card", async () => {
      const prisma = fakePrisma();
      const { svc } = makeService(prisma);

      await svc.overview();

      // The third $queryRaw is economyTimeseries (two signup queries first).
      const call = (prisma.$queryRaw as jest.Mock).mock.calls[2] as [
        { strings?: string[] } & string[],
        ...unknown[],
      ];
      const sql = (Array.isArray(call[0]) ? call[0].join('?') : String(call[0])).replace(
        /\s+/g,
        ' ',
      );
      expect(sql).toContain('"provider" =');
      // The interpolated value is the CPC provider constant.
      expect(call.slice(1)).toContain('cpc');
    });

    it('refunded is the real money sent back (refundSources.moneyMinor minus the withheld fee), not the credit face value', async () => {
      const prisma = fakePrisma();
      // 100 credits refunded, but the money behind them was only 90.00 EUR
      // (a discounted purchase) and the platform kept a 450-cent fee.
      (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
        {
          refundSources: [{ purchaseId: 'p1', amountMinor: 10_000, moneyMinor: 9_000 }],
          feeMinor: 450,
        },
      ]);
      const { svc } = makeService(prisma);

      const { economy } = await svc.overview();

      expect(economy.refunded.minor).toBe(9_000 - 450);
    });

    it('falls back to a source slice amountMinor when it has no moneyMinor (pre-discount-feature rows)', async () => {
      const prisma = fakePrisma();
      (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValue([
        { refundSources: [{ purchaseId: 'p1', amountMinor: 2_500 }], feeMinor: null },
      ]);
      const { svc } = makeService(prisma);

      const { economy } = await svc.overview();

      expect(economy.refunded.minor).toBe(2_500);
    });

    it('reads only COMPLETED refunds — a pending or canceled refund sent no money back', async () => {
      const prisma = fakePrisma();
      const { svc } = makeService(prisma);

      await svc.overview();

      expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'refund', status: 'completed' }),
        }),
      );
    });

    it('generatedAt is a valid ISO date string', async () => {
      const { svc } = makeService();
      const { generatedAt } = await svc.overview();
      expect(() => new Date(generatedAt)).not.toThrow();
      expect(new Date(generatedAt).toISOString()).toBe(generatedAt);
    });
  });
});
