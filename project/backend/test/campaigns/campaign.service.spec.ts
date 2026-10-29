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
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    wallet: {
      findMany: jest.fn(async () => []),
    },
    campaign: {
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 0 })),
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
      const w = {
        companyId,
        mode: 'easy',
        content: null,
        status: 'published',
        publishedAt: null,
        ...data,
      };
      websites.set(companyId, w);
      return w;
    },
  };
}

function fakeConfig() {
  return { get: jest.fn().mockReturnValue('https://totalvizibil.ro') };
}

function makeService() {
  const prisma = fakePrisma();
  const wallet = fakeWallet();
  const analytics = fakeAnalytics();
  const affiliate = fakeAffiliate();
  const notifications = fakeNotifications();
  const config = fakeConfig();
  const svc = new CampaignService(
    prisma as any,
    wallet as any,
    analytics as any,
    affiliate as any,
    notifications as any,
    config as any,
  );
  return { svc, prisma, wallet, analytics, affiliate, notifications, config };
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

  describe('isListingWebsiteReady', () => {
    it('is false with no website row at all', async () => {
      const { svc } = makeService();
      await expect(svc.isListingWebsiteReady('co1')).resolves.toBe(false);
    });

    it('is true for an easy-plan site (fully generated during onboarding)', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedWebsite('co1', { mode: 'easy' });
      await expect(svc.isListingWebsiteReady('co1')).resolves.toBe(true);
    });

    // The regression this method existed for: `createFromDraft` seeds EVERY
    // new website — advanced included — with the onboarding draft's
    // placeholder one-page content, so the old `content.pages.length > 0`
    // test was true before the owner ever opened the real builder, and the
    // "finish your builder first" nudge could never fire.
    it('is false for an advanced site that only has the seeded onboarding placeholder content', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedWebsite('co1', {
        mode: 'advanced',
        content: { pages: [{ sections: [] }] },
        publishedAt: null,
      });
      await expect(svc.isListingWebsiteReady('co1')).resolves.toBe(false);
    });

    it('is true once the advanced site has actually been published from the builder', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedWebsite('co1', {
        mode: 'advanced',
        content: { pages: [{ sections: [] }] },
        publishedAt: new Date('2026-10-01T10:00:00Z'),
      });
      await expect(svc.isListingWebsiteReady('co1')).resolves.toBe(true);
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

    it('blocks an advanced business whose builder was never published (placeholder content only)', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany();
      prisma.__seedCampaign({ companyId: 'co1' });
      prisma.__seedWebsite('co1', {
        mode: 'advanced',
        content: { pages: [{ sections: [] }] },
        publishedAt: null,
      });
      await expect(svc.activate('u1', 'co1')).rejects.toThrow('website_builder_incomplete');
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

  describe('remove', () => {
    it('regression: preserves a suspended company status instead of lifting it to draft', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1', status: 'suspended', deletionScheduledAt: null });
      prisma.__seedCampaign({ companyId: 'co1' });

      await svc.remove('u1', 'co1');

      expect(prisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'co1' }, data: { featured: false } }),
      );
    });

    it('demotes a non-suspended company to draft as before', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1', status: 'active', deletionScheduledAt: null });
      prisma.__seedCampaign({ companyId: 'co1' });

      await svc.remove('u1', 'co1');

      expect(prisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'co1' },
          data: { status: 'draft', featured: false },
        }),
      );
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

  // -------------------------------------------------------------------------
  // S10a — the scheduled day-rollover / depleted-campaign revival job.
  //
  // `reconcile()` has always done this, but ONLY from owner-facing dashboard
  // reads. The public feed never calls it, and a depleted campaign gets zero
  // clicks by definition, so `registerClick` can't revive it either: an owner
  // who didn't open their dashboard the next day stayed silently out of the
  // feed while funded and believing they were live.
  // -------------------------------------------------------------------------
  describe('sweepDayRollover', () => {
    function candidate(overrides: Record<string, any> = {}) {
      return {
        id: 'c1',
        companyId: 'co1',
        cpcMinor: 200,
        dailyBudgetMinor: 5000,
        spentTodayMinor: 0,
        pausedAt: new Date(Date.now() - 60_000),
        company: { ownerUserId: 'owner1' },
        ...overrides,
      };
    }

    it('resets the day counters set-based, for rows carrying spend from a past day', async () => {
      const { svc, prisma } = makeService();

      await (svc as any).sweepDayRollover();

      const [args] = (prisma.campaign.updateMany as jest.Mock).mock.calls[0];
      expect(args.data).toEqual({ spentTodayMinor: 0, spendDay: expect.any(Date) });
      expect(args.where.spentTodayMinor).toEqual({ not: 0 });
      // Null-safe on spendDay — a bare `NOT` would exclude every NULL row.
      expect(args.where.OR).toEqual(
        expect.arrayContaining([
          { spendDay: null },
          expect.objectContaining({ spendDay: expect.objectContaining({ lt: expect.any(Date) }) }),
        ]),
      );
    });

    it('revives a funded depleted campaign with set-based updates, not a per-row loop', async () => {
      const { svc, prisma } = makeService();
      (prisma.campaign.findMany as jest.Mock).mockResolvedValue([
        candidate({ id: 'c1', companyId: 'co1' }),
        candidate({ id: 'c2', companyId: 'co2' }),
      ]);
      (prisma.wallet.findMany as jest.Mock).mockResolvedValue([
        { userId: 'owner1', balanceMinor: 100_000 },
      ]);

      await (svc as any).sweepDayRollover();

      const flips = (prisma.campaign.updateMany as jest.Mock).mock.calls.filter(
        ([a]: [any]) => a.data.status === 'active',
      );
      // Both campaigns go active, and they go in ONE id-list statement —
      // `campaign.update` (the per-row call `setLive` would make) is untouched.
      expect(flips).toHaveLength(1);
      expect(flips[0][0].where.id.in).toEqual(['c1', 'c2']);
      expect(prisma.campaign.update).not.toHaveBeenCalled();
      // Plus the company/website halves of `setLive`'s "publish into the feed".
      expect(prisma.company.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['co1', 'co2'] } },
        data: { status: 'active', featured: true },
      });
      expect(prisma.website.updateMany).toHaveBeenCalledWith({
        where: { companyId: { in: ['co1', 'co2'] } },
        data: { status: 'published' },
      });
    });

    it('only looks at depleted campaigns whose company is not pending deletion', async () => {
      const { svc, prisma } = makeService();

      await (svc as any).sweepDayRollover();

      const where = (prisma.campaign.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.status).toBe('depleted');
      expect(where.company).toEqual({ deletionScheduledAt: null });
    });

    it('leaves a campaign depleted when the wallet cannot cover one click', async () => {
      const { svc, prisma } = makeService();
      (prisma.campaign.findMany as jest.Mock).mockResolvedValue([candidate({ cpcMinor: 500 })]);
      (prisma.wallet.findMany as jest.Mock).mockResolvedValue([
        { userId: 'owner1', balanceMinor: 100 },
      ]);

      await (svc as any).sweepDayRollover();

      expect(prisma.company.updateMany).not.toHaveBeenCalled();
    });

    it('leaves a campaign depleted when it has no wallet row at all (or a blocked one)', async () => {
      const { svc, prisma } = makeService();
      (prisma.campaign.findMany as jest.Mock).mockResolvedValue([candidate()]);
      (prisma.wallet.findMany as jest.Mock).mockResolvedValue([]);

      await (svc as any).sweepDayRollover();

      expect(prisma.company.updateMany).not.toHaveBeenCalled();
    });

    it("leaves a campaign depleted when today's budget still cannot cover a click", async () => {
      const { svc, prisma } = makeService();
      (prisma.campaign.findMany as jest.Mock).mockResolvedValue([
        candidate({ dailyBudgetMinor: 5000, spentTodayMinor: 4900, cpcMinor: 200 }),
      ]);
      (prisma.wallet.findMany as jest.Mock).mockResolvedValue([
        { userId: 'owner1', balanceMinor: 100_000 },
      ]);

      await (svc as any).sweepDayRollover();

      expect(prisma.company.updateMany).not.toHaveBeenCalled();
    });

    it("drops banked run time only for campaigns stopped past the run-score grace window — reconcile()'s own rule", async () => {
      const { svc, prisma } = makeService();
      (prisma.campaign.findMany as jest.Mock).mockResolvedValue([
        // Stopped long ago ⇒ reactivation starts a fresh run.
        candidate({ id: 'old', pausedAt: new Date(Date.now() - 30 * 24 * 3600_000) }),
        // Stopped moments ago ⇒ keeps its accrued time.
        candidate({ id: 'recent', pausedAt: new Date(Date.now() - 1_000) }),
      ]);
      (prisma.wallet.findMany as jest.Mock).mockResolvedValue([
        { userId: 'owner1', balanceMinor: 100_000 },
      ]);

      await (svc as any).sweepDayRollover();

      const flips = (prisma.campaign.updateMany as jest.Mock).mock.calls.filter(
        ([a]: [any]) => a.data.status === 'active',
      );
      const fresh = flips.find(([a]: [any]) => a.where.id.in.includes('old'))![0];
      const kept = flips.find(([a]: [any]) => a.where.id.in.includes('recent'))![0];
      expect(fresh.data.activeSecondsAccrued).toBe(0);
      expect(kept.data).not.toHaveProperty('activeSecondsAccrued');
    });

    it('chunks the wallet lookup so the `in` list cannot blow the bind-param cap', async () => {
      const { svc, prisma } = makeService();
      (prisma.campaign.findMany as jest.Mock).mockResolvedValue(
        Array.from({ length: 2_500 }, (_, i) =>
          candidate({ id: `c${i}`, companyId: `co${i}`, company: { ownerUserId: `o${i}` } }),
        ),
      );

      await (svc as any).sweepDayRollover();

      expect(prisma.wallet.findMany).toHaveBeenCalledTimes(3);
      for (const [{ where }] of (prisma.wallet.findMany as jest.Mock).mock.calls) {
        expect(where.userId.in.length).toBeLessThanOrEqual(1_000);
        expect(where.blockedAt).toBeNull();
      }
    });

    it('bounds the candidate read per tick', async () => {
      const { svc, prisma } = makeService();

      await (svc as any).sweepDayRollover();

      expect((prisma.campaign.findMany as jest.Mock).mock.calls[0][0].take).toBeGreaterThan(0);
    });

    it('runDayRollover swallows failures and releases its guard', async () => {
      const { svc, prisma } = makeService();
      (prisma.campaign.updateMany as jest.Mock).mockRejectedValueOnce(new Error('pool timeout'));

      await expect((svc as any).runDayRollover()).resolves.toBeUndefined();
      expect((svc as any).rollingOver).toBe(false);
    });

    it('runDayRollover skips a concurrent tick instead of stacking', async () => {
      const { svc } = makeService();
      let release!: () => void;
      const inner = jest
        .spyOn(svc as any, 'sweepDayRollover')
        .mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));

      const first = (svc as any).runDayRollover();
      await (svc as any).runDayRollover();

      expect(inner).toHaveBeenCalledTimes(1);
      release();
      await first;
    });

    it('does not set timers when NODE_ENV=test', () => {
      const spy = jest.spyOn(global, 'setInterval');
      const { svc } = makeService();
      svc.onModuleInit();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
