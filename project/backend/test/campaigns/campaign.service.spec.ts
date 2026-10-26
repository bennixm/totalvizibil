import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CampaignService } from 'src/campaigns/campaign.service';

function fakeAnalytics() {
  return {
    marginConfig: jest.fn().mockResolvedValue({
      costPromovareMinor: 100,
      marjaProfitMinor: 100,
      marjaPozitionareMinor: 50,
    }),
    marketCpcFor: jest.fn().mockResolvedValue(500),
    recommendedCpcFor: jest.fn().mockResolvedValue({ cpcMinor: 500 }),
    visibilityInputsFor: jest.fn().mockResolvedValue({}),
    feedRanksFor: jest.fn().mockResolvedValue([]),
    companyAnalytics: jest.fn().mockResolvedValue({
      visibility: { parts: {}, weights: {} },
      planMode: 'easy',
      campaign: { activeDays: 0 },
      response: { total: 0 },
    }),
  };
}

function fakeWallet() {
  return {
    ownerIdForCompany: jest.fn().mockResolvedValue('owner1'),
    canAfford: jest.fn().mockResolvedValue(true),
    assertSpendable: jest.fn().mockResolvedValue(undefined),
    getSummary: jest.fn().mockResolvedValue({
      balance: { minor: 100000, credits: 10, display: '10 credite' },
      currency: 'RON',
      eurRonRate: 5.05,
    }),
    consumedByCompany: jest.fn().mockResolvedValue(0),
    chargeClickWithin: jest.fn().mockResolvedValue({ balanceMinor: 90000 }),
  };
}

function fakeAffiliate() {
  return { maybeReward: jest.fn().mockResolvedValue(undefined) };
}

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function makeCampaign(overrides = {}) {
  return {
    id: 'c1',
    companyId: 'co1',
    status: 'draft',
    cpcMinor: 200,
    dailyBudgetMinor: 5000,
    spentTodayMinor: 0,
    spendDay: null,
    appearFirst: false,
    autoOptimize: false,
    activatedAt: null,
    pausedAt: null,
    activeSecondsAccrued: 0,
    depletedNotifiedForDay: null,
    positionAlertNotifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakePrisma() {
  const members = new Map<string, any>();
  const companies = new Map<string, any>();
  const campaigns = new Map<string, any>();
  const websites = new Map<string, any>();

  const txClient = {
    company: {
      findUnique: jest.fn(async ({ where }: any) => companies.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const c = companies.get(where.id);
        if (c) Object.assign(c, data);
        return c ?? {};
      }),
    },
    campaign: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.companyId ?? where.id;
        return campaigns.get(key) ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = campaigns.get(where.id) ?? campaigns.get('co1');
        if (c) Object.assign(c, data);
        return c ?? makeCampaign(data);
      }),
      findMany: jest.fn(async () => []),
    },
    adClick: {
      create: jest.fn(async ({ data }: any) => ({ id: 'click1', ...data })),
      update: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    website: {
      findUnique: jest.fn(async ({ where }: any) => websites.get(where.companyId) ?? null),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    category: {
      findUnique: jest.fn(async () => null),
    },
    $queryRaw: jest.fn(async () => [{ spentTodayMinor: 200 }]),
  };

  return {
    companyUser: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          members.get(`${where.companyId_userId.companyId}:${where.companyId_userId.userId}`) ??
          null,
      ),
    },
    company: {
      findUnique: jest.fn(async ({ where }: any) => companies.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const c = companies.get(where.id);
        if (c) Object.assign(c, data);
        return c ?? {};
      }),
    },
    campaign: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.companyId ?? where.id;
        return campaigns.get(key) ?? null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = campaigns.get(where.companyId);
        const row = existing
          ? makeCampaign({ ...existing, ...update, companyId: where.companyId })
          : makeCampaign({ companyId: where.companyId, ...create });
        campaigns.set(where.companyId, row);
        campaigns.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = campaigns.get(where.id) ?? campaigns.get(where.companyId);
        if (c) Object.assign(c, data);
        return c ?? makeCampaign(data);
      }),
      delete: jest.fn(async () => ({})),
    },
    adClick: {
      create: jest.fn(async ({ data }: any) => ({ id: 'click1', ...data })),
      update: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      groupBy: jest.fn(async () => []),
    },
    website: {
      findUnique: jest.fn(async ({ where }: any) => websites.get(where.companyId) ?? null),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    category: {
      findMany: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (ops: any) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops(txClient);
    }),
    $queryRaw: jest.fn(async () => []),
    __seedMember: (companyId: string, userId: string, role = 'owner') => {
      members.set(`${companyId}:${userId}`, { companyId, userId, status: 'active', role });
    },
    __seedCompany: (data = {}) => {
      const c = {
        id: 'co1',
        status: 'active',
        displayName: 'Acme',
        ownerUserId: 'owner1',
        deletionScheduledAt: null,
        categoryAssignments: [],
        locations: [],
        ...data,
      };
      companies.set(c.id, c);
      return c;
    },
    __seedCampaign: (data = {}) => {
      const c = makeCampaign(data);
      campaigns.set(c.companyId, c);
      campaigns.set(c.id, c);
      return c;
    },
    __seedWebsite: (companyId: string, data = {}) => {
      const w = { companyId, mode: 'easy', content: null, status: 'published', ...data };
      websites.set(companyId, w);
      return w;
    },
  };
}

function makeService() {
  const prisma = fakePrisma();
  const wallet = fakeWallet();
  const analytics = fakeAnalytics();
  const affiliate = fakeAffiliate();
  const notifications = fakeNotifications();
  const svc = new CampaignService(
    prisma as any,
    wallet as any,
    analytics as any,
    affiliate as any,
    notifications as any,
  );
  return { svc, prisma, wallet, analytics, affiliate, notifications };
}

describe('CampaignService', () => {
  describe('save', () => {
    it('throws NotFoundException when user is not a company member', async () => {
      const { svc } = makeService();
      await expect(svc.save('u1', 'co1', { cpc: 2, dailyBudget: 50 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when company is pending deletion', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1', deletionScheduledAt: new Date() });
      await expect(svc.save('u1', 'co1', { cpc: 2, dailyBudget: 50 })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when cpc exceeds daily budget', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany();
      prisma.__seedWebsite('co1');
      await expect(svc.save('u1', 'co1', { cpc: 100, dailyBudget: 50 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('activate', () => {
    it('throws BadRequestException when no campaign exists', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany();
      await expect(svc.activate('u1', 'co1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when website builder not complete', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany();
      prisma.__seedCampaign({ companyId: 'co1' });
      // no website seeded → not ready
      await expect(svc.activate('u1', 'co1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when wallet cannot afford daily budget', async () => {
      const { svc, prisma, wallet } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany();
      prisma.__seedCampaign({ companyId: 'co1' });
      prisma.__seedWebsite('co1');
      wallet.canAfford.mockResolvedValue(false);
      await expect(svc.activate('u1', 'co1')).rejects.toThrow(BadRequestException);
    });

    it('calls affiliate.maybeReward on first activation', async () => {
      const { svc, prisma, wallet, affiliate } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1', ownerUserId: 'owner1' });
      prisma.__seedCampaign({ companyId: 'co1', activatedAt: null });
      prisma.__seedWebsite('co1');
      wallet.canAfford.mockResolvedValue(true);
      // reconcile → campaign.findUnique via companyId key
      prisma.campaign.findUnique.mockResolvedValue(
        makeCampaign({ companyId: 'co1', status: 'draft', activatedAt: null }),
      );
      prisma.company.findUnique.mockResolvedValue({
        id: 'co1',
        status: 'active',
        displayName: 'Acme',
        deletionScheduledAt: null,
        ownerUserId: 'owner1',
        categoryAssignments: [],
        locations: [],
      });
      await svc.activate('u1', 'co1');
      expect(affiliate.maybeReward).toHaveBeenCalledWith('owner1');
    });
  });

  describe('pause', () => {
    it('throws NotFoundException when no campaign', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany();
      await expect(svc.pause('u1', 'co1')).rejects.toThrow(NotFoundException);
    });

    it('calls setLive with paused for active campaign', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1', ownerUserId: 'owner1' });
      prisma.campaign.findUnique.mockResolvedValue(
        makeCampaign({ companyId: 'co1', status: 'active', activatedAt: new Date() }),
      );
      prisma.company.findUnique.mockResolvedValue({
        id: 'co1',
        status: 'active',
        displayName: 'Acme',
        deletionScheduledAt: null,
        ownerUserId: 'owner1',
        categoryAssignments: [],
        locations: [],
      });
      await svc.pause('u1', 'co1');
      const calls = (prisma.$transaction as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  describe('registerClick', () => {
    it('returns { billed: false, reason: "bot" } for bot user-agent', async () => {
      const { svc, prisma } = makeService();
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          company: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ ownerUserId: 'o1', categoryAssignments: [], locations: [] }),
          },
          adClick: {
            create: jest.fn().mockResolvedValue({ id: 'c1' }),
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
          },
          campaign: {
            findUnique: jest.fn().mockResolvedValue(makeCampaign({ status: 'active' })),
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
          },
          website: { updateMany: jest.fn().mockResolvedValue({}) },
          category: { findUnique: jest.fn().mockResolvedValue(null) },
          $queryRaw: jest.fn().mockResolvedValue([{ spentTodayMinor: 200 }]),
        }),
      );
      const result = await svc.registerClick('co1', '1.2.3.4', 'Googlebot/2.1');
      expect(result).toMatchObject({ billed: false, reason: 'bot' });
    });

    it('returns { billed: false } on P2002 duplicate click', async () => {
      const { svc, prisma } = makeService();
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          company: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ ownerUserId: 'o1', categoryAssignments: [], locations: [] }),
          },
          adClick: {
            create: jest.fn().mockRejectedValue(
              new Prisma.PrismaClientKnownRequestError('Unique constraint', {
                code: 'P2002',
                clientVersion: '5',
              }),
            ),
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
          },
          campaign: {
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
          },
          website: { updateMany: jest.fn().mockResolvedValue({}) },
          category: { findUnique: jest.fn().mockResolvedValue(null) },
          $queryRaw: jest.fn().mockResolvedValue([]),
        }),
      );
      const result = await svc.registerClick('co1', '1.2.3.4', 'Mozilla/5.0');
      expect(result).toMatchObject({ billed: false, reason: 'repeat' });
    });

    it('returns { billed: false, reason: "no_campaign" } when campaign not active', async () => {
      const { svc, prisma } = makeService();
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          company: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ ownerUserId: 'o1', categoryAssignments: [], locations: [] }),
          },
          adClick: {
            create: jest.fn().mockResolvedValue({ id: 'c1' }),
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
          },
          campaign: {
            findUnique: jest.fn().mockResolvedValue(makeCampaign({ status: 'paused' })),
            update: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
          },
          website: { updateMany: jest.fn().mockResolvedValue({}) },
          category: { findUnique: jest.fn().mockResolvedValue(null) },
          $queryRaw: jest.fn().mockResolvedValue([]),
        }),
      );
      const result = await svc.registerClick('co1', '1.2.3.4', 'Mozilla/5.0');
      expect(result).toMatchObject({ billed: false, reason: 'no_campaign' });
    });
  });
});
