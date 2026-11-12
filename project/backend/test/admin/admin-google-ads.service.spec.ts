import { AdminGoogleAdsService } from 'src/admin/admin-google-ads.service';

function fakeSettings(
  enabled = true,
  overrides: {
    avgCpc?: { credits: number; updatedAt: string } | null;
    bufferPct?: number;
    fallbackCredits?: number;
  } = {},
) {
  return {
    googleAdsAgentEnabled: jest.fn().mockResolvedValue(enabled),
    googleAdsCustomerId: jest.fn().mockResolvedValue(''),
    googleAdsLoginCustomerId: jest.fn().mockResolvedValue(''),
    googleAdsCampaignId: jest.fn().mockResolvedValue(''),
    googleAdsServiceAccountKeyBase64: jest.fn().mockResolvedValue(''),
    setGoogleAdsCustomerId: jest.fn().mockResolvedValue(''),
    setGoogleAdsLoginCustomerId: jest.fn().mockResolvedValue(''),
    setGoogleAdsCampaignId: jest.fn().mockResolvedValue(''),
    setGoogleAdsServiceAccountKeyBase64: jest.fn().mockResolvedValue(undefined),
    googleAdsAvgCpc: jest.fn().mockResolvedValue(overrides.avgCpc ?? null),
    googleAdsCpcBufferPct: jest.fn().mockResolvedValue(overrides.bufferPct ?? 10),
    feedCostPromovareCredits: jest.fn().mockResolvedValue(overrides.fallbackCredits ?? 2),
  } as never;
}

function fakeClient(overrides: { configured?: boolean; customerId?: string; email?: string | null } = {}) {
  return {
    configured: overrides.configured ?? false,
    customerId: overrides.customerId ?? '',
    serviceAccountEmail: overrides.email ?? null,
  } as never;
}

function fakeAgentServices() {
  return {
    structural: { run: jest.fn().mockResolvedValue(undefined) },
    content: { run: jest.fn().mockResolvedValue(undefined) },
    intelligence: {
      run: jest.fn().mockResolvedValue(undefined),
      approveProposal: jest.fn().mockResolvedValue(undefined),
      rejectProposal: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function fakePrisma() {
  return {
    googleAdsSubcategoryCampaign: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'active', _count: { _all: 3 } },
        { status: 'paused', _count: { _all: 1 } },
        { status: 'pending_creation', _count: { _all: 2 } },
      ]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { dailyBudgetMinor: 1500 } }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'map-1', categoryId: 'cat-1', status: 'active' },
        { id: 'map-2', categoryId: 'cat-2', status: 'paused' },
      ]),
    },
    platformExpense: {
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({ _sum: { amountMinor: 200 } }) // today
        .mockResolvedValueOnce({ _sum: { amountMinor: 5000 } }), // month
    },
    category: { count: jest.fn().mockResolvedValue(4) },
    googleAdsAgentRun: {
      findFirst: jest.fn().mockResolvedValue({ id: 'run-x', status: 'success' }),
    },
    googleAdsAgentAction: {
      findMany: jest.fn().mockResolvedValue([{ id: 'action-1', status: 'pending_approval' }]),
      count: jest.fn().mockResolvedValue(1),
    },
    companyCategory: { count: jest.fn().mockResolvedValue(2) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as never;
}

function makeService(
  overrides: {
    client?: ReturnType<typeof fakeClient>;
    settings?: Parameters<typeof fakeSettings>[1];
  } = {},
) {
  const prisma = fakePrisma();
  const settings = fakeSettings(true, overrides.settings);
  const client = overrides.client ?? fakeClient();
  const agents = fakeAgentServices();
  const svc = new AdminGoogleAdsService(
    prisma as any,
    settings as any,
    client as any,
    agents.structural as any,
    agents.content as any,
    agents.intelligence as any,
  );
  return { svc, prisma, settings, client, agents };
}

describe('AdminGoogleAdsService', () => {
  it('overview() aggregates status counts, budget, spend, and last runs', async () => {
    const { svc } = makeService();
    const result = await svc.overview();

    expect(result.enabled).toBe(true);
    expect(result.campaigns).toEqual({ active: 3, paused: 1, pendingCreation: 2 });
    expect(result.totalActiveDailyBudgetCredits).toBe(15); // 1500 minor -> 15 credits
    expect(result.spendTodayCredits).toBe(2);
    expect(result.spendThisMonthCredits).toBe(50);
    expect(result.subcategoriesWithoutCampaign).toBe(4);
    expect(result.lastRuns).toEqual({
      structural: { id: 'run-x', status: 'success' },
      content: { id: 'run-x', status: 'success' },
      intelligence: { id: 'run-x', status: 'success' },
    });
  });

  describe('overview() — feedCpc (the feed algorithm\'s real Google cost-per-click)', () => {
    it('reports the buffered average as the active cost when the cache is fresh', async () => {
      const { svc } = makeService({
        settings: {
          avgCpc: { credits: 2, updatedAt: new Date().toISOString() },
          bufferPct: 10,
          fallbackCredits: 1,
        },
      });

      const result = await svc.overview();

      expect(result.feedCpc.fresh).toBe(true);
      expect(result.feedCpc.rawAvgCpcCredits).toBe(2);
      expect(result.feedCpc.bufferedCredits).toBeCloseTo(2.2); // 2 * 1.10
      // Mirrors AnalyticsService.googleAdsCostPromovareCredits()'s own choice.
      expect(result.feedCpc.activeCostPromovareCredits).toBeCloseTo(2.2);
    });

    it('falls back to the flat organic default once the cache is stale, same as the feed algorithm itself does', async () => {
      const staleDate = new Date(Date.now() - 60 * 60_000).toISOString(); // 60min old
      const { svc } = makeService({
        settings: {
          avgCpc: { credits: 2, updatedAt: staleDate },
          bufferPct: 10,
          fallbackCredits: 1,
        },
      });

      const result = await svc.overview();

      expect(result.feedCpc.fresh).toBe(false);
      expect(result.feedCpc.activeCostPromovareCredits).toBe(1);
    });

    it('falls back to the flat organic default when the sync job has never run', async () => {
      const { svc } = makeService({ settings: { avgCpc: null, fallbackCredits: 1.5 } });

      const result = await svc.overview();

      expect(result.feedCpc.fresh).toBe(false);
      expect(result.feedCpc.rawAvgCpcCredits).toBeNull();
      expect(result.feedCpc.activeCostPromovareCredits).toBe(1.5);
    });
  });

  it('listProposals() reads only pending_approval actions', async () => {
    const { svc, prisma } = makeService();
    await svc.listProposals();
    expect((prisma as any).googleAdsAgentAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending_approval' } }),
    );
  });

  it('approveProposal / rejectProposal delegate to the intelligence service', async () => {
    const { svc, agents } = makeService();
    await svc.approveProposal('action-1', 'staff-1');
    await svc.rejectProposal('action-2', 'staff-1');
    expect(agents.intelligence.approveProposal).toHaveBeenCalledWith('action-1', 'staff-1');
    expect(agents.intelligence.rejectProposal).toHaveBeenCalledWith('action-2', 'staff-1');
  });

  it('listCampaigns() attaches the active company count to each mapping', async () => {
    const { svc } = makeService();
    const result = await svc.listCampaigns();
    expect(result).toEqual([
      { id: 'map-1', categoryId: 'cat-1', status: 'active', activeCompanyCount: 2 },
      { id: 'map-2', categoryId: 'cat-2', status: 'paused', activeCompanyCount: 2 },
    ]);
  });

  it('listActions() paginates and returns the total', async () => {
    const { svc } = makeService();
    const result = await svc.listActions({ page: 1, pageSize: 20 });
    expect(result).toEqual({
      items: [{ id: 'action-1', status: 'pending_approval' }],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  });

  it('runNow() dispatches to the right agent service per kind', async () => {
    const { svc, agents } = makeService();
    await svc.runNow('structural');
    await svc.runNow('content');
    await svc.runNow('intelligence');
    expect(agents.structural.run).toHaveBeenCalledTimes(1);
    expect(agents.content.run).toHaveBeenCalledTimes(1);
    expect(agents.intelligence.run).toHaveBeenCalledTimes(1);
  });

  describe('googleAdsCredentials / setGoogleAdsCredentials', () => {
    it('never returns the raw secret — only whether one is configured', async () => {
      const client = fakeClient({ configured: true, customerId: '123', email: 'svc@x.iam.gserviceaccount.com' });
      const { svc, settings } = makeService({ client });
      (settings as any).googleAdsServiceAccountKeyBase64.mockResolvedValue('c29tZS1zZWNyZXQ=');

      const result = await svc.googleAdsCredentials();

      expect(result).toEqual({
        customerId: '',
        loginCustomerId: '',
        campaignId: '',
        serviceAccountKeyConfigured: true,
        serviceAccountEmail: 'svc@x.iam.gserviceaccount.com',
        configured: true,
      });
      expect(JSON.stringify(result)).not.toContain('c29tZS1zZWNyZXQ=');
    });

    it('setGoogleAdsCredentials() only touches the fields provided', async () => {
      const { svc, settings } = makeService();

      await svc.setGoogleAdsCredentials({ customerId: '999' });

      expect((settings as any).setGoogleAdsCustomerId).toHaveBeenCalledWith('999');
      expect((settings as any).setGoogleAdsLoginCustomerId).not.toHaveBeenCalled();
      expect((settings as any).setGoogleAdsCampaignId).not.toHaveBeenCalled();
      expect((settings as any).setGoogleAdsServiceAccountKeyBase64).not.toHaveBeenCalled();
    });

    it('setGoogleAdsCredentials() updates the key only when explicitly provided', async () => {
      const { svc, settings } = makeService();

      await svc.setGoogleAdsCredentials({ serviceAccountKeyBase64: 'bmV3LWtleQ==' });

      expect((settings as any).setGoogleAdsServiceAccountKeyBase64).toHaveBeenCalledWith('bmV3LWtleQ==');
    });
  });
});
