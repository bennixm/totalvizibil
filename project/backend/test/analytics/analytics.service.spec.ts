import { AnalyticsService } from 'src/analytics/analytics.service';

function fakePlatformSettings() {
  return {
    feedCostPromovareCredits: jest.fn().mockResolvedValue(1),   // 1 credit = 100 minor
    feedMarjaProfitCredits: jest.fn().mockResolvedValue(1),
    feedMarjaPozitionareCredits: jest.fn().mockResolvedValue(1),
    eurRonRate: jest.fn().mockResolvedValue(5.05),
  };
}

function fakePrisma() {
  const companies = new Map<string, any>();

  const prisma = {
    company: {
      findUnique: jest.fn(async ({ where }: any) => companies.get(where.id) ?? null) as jest.Mock,
      findMany: jest.fn().mockResolvedValue([]) as jest.Mock,
    },
    campaign: {
      findMany: jest.fn().mockResolvedValue([]) as jest.Mock,
      findUnique: jest.fn().mockResolvedValue(null) as jest.Mock,
      aggregate: jest.fn().mockResolvedValue({ _max: { cpcMinor: null } }) as jest.Mock,
    },
    website: {
      findMany: jest.fn().mockResolvedValue([]) as jest.Mock,
      findUnique: jest.fn().mockResolvedValue(null) as jest.Mock,
    },
    lead: {
      groupBy: jest.fn().mockResolvedValue([]) as jest.Mock,
      findMany: jest.fn().mockResolvedValue([]) as jest.Mock,
      count: jest.fn().mockResolvedValue(0) as jest.Mock,
    },
    adClick: {
      count: jest.fn().mockResolvedValue(0) as jest.Mock,
    },
    walletTransaction: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: null } }) as jest.Mock,
    },
    $queryRaw: jest.fn().mockResolvedValue([]) as jest.Mock,
    __seedCompany: (data: Record<string, any> = {}) => {
      const c = {
        id: 'co1',
        status: 'active',
        categoryAssignments: [] as any[],
        locations: [] as any[],
        ...data,
      };
      companies.set(c.id, c);
      return c;
    },
  };
  return prisma;
}

function makeService() {
  const prisma = fakePrisma();
  const settings = fakePlatformSettings();
  const svc = new AnalyticsService(prisma as any, settings as any);
  return { svc, prisma, settings };
}

describe('AnalyticsService', () => {
  describe('marginConfig', () => {
    it('delegates to platformSettings and returns minor units (1 credit = 100 minor)', async () => {
      const { svc } = makeService();
      const cfg = await svc.marginConfig();
      expect(cfg).toEqual({
        costPromovareMinor: 100,
        marjaProfitMinor: 100,
        marjaPozitionareMinor: 100,
      });
    });
  });

  describe('visibilityInputsFor', () => {
    it('empty array returns empty Map', async () => {
      const { svc } = makeService();
      const result = await svc.visibilityInputsFor([]);
      expect(result.size).toBe(0);
    });

    it('company without campaign gets zero cpcMinor', async () => {
      const { svc } = makeService();
      const result = await svc.visibilityInputsFor(['co1']);
      const entry = result.get('co1');
      expect(entry).toBeDefined();
      expect(entry!.cpcMinor).toBe(0);
    });

    it('company with campaign gets correct cpcMinor and planMode', async () => {
      const { svc, prisma } = makeService();
      prisma.campaign.findMany.mockResolvedValue([
        {
          companyId: 'co1',
          cpcMinor: 400,
          dailyBudgetMinor: 5000,
          status: 'active',
          activatedAt: null,
          activeSecondsAccrued: 0,
          pausedAt: null,
        },
      ]);
      prisma.website.findMany.mockResolvedValue([
        { companyId: 'co1', mode: 'pro' },
      ]);
      const result = await svc.visibilityInputsFor(['co1']);
      const entry = result.get('co1');
      expect(entry!.cpcMinor).toBe(400);
      expect(entry!.planMode).toBe('pro');
    });

    it('company with responded leads gets leadsTotal and leadsResponded', async () => {
      const { svc, prisma } = makeService();
      prisma.lead.groupBy.mockResolvedValue([{ companyId: 'co1', _count: { _all: 5 } }]);
      prisma.lead.findMany.mockResolvedValue([
        { companyId: 'co1', createdAt: new Date(Date.now() - 3600000), firstResponseAt: new Date() },
      ]);
      const result = await svc.visibilityInputsFor(['co1']);
      const entry = result.get('co1');
      expect(entry!.leadsTotal).toBe(5);
      expect(entry!.leadsResponded).toBe(1);
    });
  });

  describe('marketCpcFor', () => {
    it('no category assignments → returns 0 without querying campaign', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany({ id: 'co1', categoryAssignments: [] });
      const result = await svc.marketCpcFor('co1');
      expect(result).toBe(0);
      expect(prisma.campaign.aggregate).not.toHaveBeenCalled();
    });

    it('company not found → returns 0', async () => {
      const { svc } = makeService();
      const result = await svc.marketCpcFor('missing');
      expect(result).toBe(0);
    });

    it('aggregate returns null → returns 0', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany({
        id: 'co1',
        categoryAssignments: [{ categoryId: 'cat1' }],
      });
      prisma.campaign.aggregate.mockResolvedValue({ _max: { cpcMinor: null } });
      const result = await svc.marketCpcFor('co1');
      expect(result).toBe(0);
    });

    it('aggregate returns rival CPC → returns it', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany({
        id: 'co1',
        categoryAssignments: [{ categoryId: 'cat1' }],
      });
      prisma.campaign.aggregate.mockResolvedValue({ _max: { cpcMinor: 600 } });
      const result = await svc.marketCpcFor('co1');
      expect(result).toBe(600);
    });
  });

  describe('recommendedCpcFor', () => {
    it('company not found → null', async () => {
      const { svc } = makeService();
      const result = await svc.recommendedCpcFor('missing');
      expect(result).toBeNull();
    });

    it('company with no feeds (no category assignments) → null', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany({ id: 'co1', categoryAssignments: [], locations: [] });
      const result = await svc.recommendedCpcFor('co1');
      expect(result).toBeNull();
    });

    it('company with feed, no rivals → returns cpcMinor = CPC minim (cost+profit)', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany({
        id: 'co1',
        categoryAssignments: [
          { categoryId: 'cat1', isPrimary: true, createdAt: new Date() },
        ],
        locations: [
          { county: 'Cluj', nationwide: false, isPrimary: true, createdAt: new Date() },
        ],
      });
      // feedEligiblePeers calls company.findMany — return empty (no rivals)
      prisma.company.findMany.mockResolvedValue([]);
      const result = await svc.recommendedCpcFor('co1');
      expect(result).not.toBeNull();
      // cpcMinor = costPromovare(100) + marjaProfit(100) + rivals(0)*marjaPozitionare = 200
      expect(result!.cpcMinor).toBe(200);
      expect(result!.dailyBudgetMinor).toBeGreaterThan(0);
    });

    it('company with feed and 2 rivals → cpcMinor includes pozitionare for 3-way competition', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany({
        id: 'co1',
        categoryAssignments: [
          { categoryId: 'cat1', isPrimary: true, createdAt: new Date() },
        ],
        locations: [
          { county: 'Cluj', nationwide: false, isPrimary: true, createdAt: new Date() },
        ],
      });
      // 2 rivals eligible (cpcMinor >= feedCpcMin = 200)
      prisma.company.findMany.mockResolvedValue([
        { id: 'rival1', campaign: { cpcMinor: 300 } },
        { id: 'rival2', campaign: { cpcMinor: 400 } },
      ]);
      const result = await svc.recommendedCpcFor('co1');
      // recommended = feedCpcMin + rivalCount * marjaPozitionare = 200 + 2*100 = 400
      expect(result!.cpcMinor).toBe(400);
    });
  });
});
