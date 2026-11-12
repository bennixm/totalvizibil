import { GoogleAdsAgentIntelligenceService } from 'src/google-ads/google-ads-agent-intelligence.service';

/**
 * This service can either auto-apply a budget/CPC CHANGE or queue one for
 * human approval — the one rule that must never break is "an increase on
 * either dimension always waits for approval, a decrease never does", plus
 * the hard server-side clamp to the admin caps regardless of what Claude
 * proposed. `approveProposal`/`rejectProposal` are the only path that ever
 * sends a previously-queued increase to Google Ads.
 */
function fakeClient(overrides: { configured?: boolean; mutate?: jest.Mock } = {}) {
  return {
    configured: overrides.configured ?? true,
    customerId: '1234567890',
    mutate: overrides.mutate ?? jest.fn().mockResolvedValue([]),
  } as never;
}

function fakeRefData() {
  return { getAccountCurrencyCode: jest.fn().mockResolvedValue('EUR') } as never;
}

function fakeAi(overrides: { configured?: boolean; proposals?: jest.Mock } = {}) {
  return {
    configured: overrides.configured ?? true,
    googleAdsBudgetIntelligence:
      overrides.proposals ?? jest.fn().mockResolvedValue({ proposals: [], costEstimateMinor: 0 }),
  } as never;
}

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) } as never;
}

function fakeAnalytics() {
  return {
    marginConfig: jest
      .fn()
      .mockResolvedValue({ costPromovareMinor: 100, marjaProfitMinor: 10, marjaPozitionareMinor: 10 }),
  } as never;
}

function fakeSettings(
  overrides: {
    enabled?: boolean;
    eurRon?: number;
    budgetCap?: number;
    cpcCap?: number;
    intervalMinutes?: number;
  } = {},
) {
  return {
    googleAdsAgentEnabled: jest.fn().mockResolvedValue(overrides.enabled ?? true),
    eurRonRate: jest.fn().mockResolvedValue(overrides.eurRon ?? 5),
    googleAdsAgentMaxDailyBudgetCapCredits: jest.fn().mockResolvedValue(overrides.budgetCap ?? 50),
    googleAdsAgentMaxCpcCapCredits: jest.fn().mockResolvedValue(overrides.cpcCap ?? 5),
    googleAdsAgentIntelligenceIntervalMinutes: jest
      .fn()
      .mockResolvedValue(overrides.intervalMinutes ?? 1440),
  } as never;
}

const MAPPING_ROW = {
  id: 'map-1',
  categoryId: 'cat-1',
  googleCampaignId: '666',
  googleAdGroupId: '777',
  googleBudgetResourceId: '555',
  status: 'active',
  dailyBudgetMinor: 500, // 5 credits
  maxCpcMinor: 100, // 1 credit
  category: { id: 'cat-1', slug: 'electricieni', nameI18n: { ro: 'Electricieni' } },
};

function fakePrisma(
  opts: { mappings?: any[]; existingRun?: any; action?: any; mappingRow?: any } = {},
) {
  const mappings = opts.mappings ?? [MAPPING_ROW];
  const mappingRow = opts.mappingRow ?? MAPPING_ROW;
  let action = opts.action ?? null;

  return {
    googleAdsAgentRun: {
      findFirst: jest.fn().mockResolvedValue(opts.existingRun ?? null),
      create: jest.fn().mockResolvedValue({ id: 'run-1', startedAt: new Date() }),
      update: jest.fn().mockResolvedValue({}),
    },
    googleAdsSubcategoryCampaign: {
      findMany: jest.fn().mockResolvedValue(mappings),
      findUnique: jest.fn().mockResolvedValue(mappingRow),
      findUniqueOrThrow: jest.fn().mockResolvedValue(mappingRow),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: mappings.length }),
    },
    companyCategory: { count: jest.fn().mockResolvedValue(3) },
    googleAdsAgentAction: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(async () => action),
      update: jest.fn(async ({ data }: any) => {
        action = { ...action, ...data };
        return action;
      }),
    },
    __setAction: (a: any) => {
      action = a;
    },
  } as never;
}

function makeService(
  overrides: {
    client?: ReturnType<typeof fakeClient>;
    ai?: ReturnType<typeof fakeAi>;
    settings?: ReturnType<typeof fakeSettings>;
    prisma?: ReturnType<typeof fakePrisma>;
    notifications?: ReturnType<typeof fakeNotifications>;
  } = {},
) {
  const client = overrides.client ?? fakeClient();
  const ai = overrides.ai ?? fakeAi();
  const settings = overrides.settings ?? fakeSettings();
  const prisma = overrides.prisma ?? fakePrisma();
  const notifications = overrides.notifications ?? fakeNotifications();
  const svc = new GoogleAdsAgentIntelligenceService(
    client as any,
    fakeRefData(),
    ai as any,
    fakeAnalytics(),
    settings as any,
    prisma as any,
    notifications as any,
  );
  return { svc, client, ai, settings, prisma, notifications };
}

describe('GoogleAdsAgentIntelligenceService.run()', () => {
  it('does nothing (success, no Claude call) when there are no active campaigns', async () => {
    const ai = fakeAi();
    const prisma = fakePrisma({ mappings: [] });
    const { svc } = makeService({ ai, prisma });

    await svc.run();

    expect((ai as any).googleAdsBudgetIntelligence).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'success', categoriesScanned: 0 }) }),
    );
  });

  it('auto-applies a pure decrease — mutates Google Ads immediately, no approval', async () => {
    const mutate = jest.fn().mockResolvedValue([]);
    const proposals = jest.fn().mockResolvedValue({
      proposals: [
        { categorySlug: 'electricieni', proposedDailyBudgetCredits: 3, proposedMaxCpcCredits: 0.8, reasoning: 'Cerere mai mică.' },
      ],
      costEstimateMinor: 1,
    });
    const prisma = fakePrisma();
    const { svc } = makeService({ client: fakeClient({ mutate }), ai: fakeAi({ proposals }), prisma });

    await svc.run();

    expect(mutate).toHaveBeenCalledWith([
      expect.objectContaining({
        campaignBudgetOperation: expect.objectContaining({
          update: expect.objectContaining({ amountMicros: '3000000' }),
          updateMask: 'amount_micros',
        }),
      }),
      expect.objectContaining({
        adGroupOperation: expect.objectContaining({
          update: expect.objectContaining({ cpcBidMicros: '800000' }),
          updateMask: 'cpc_bid_micros',
        }),
      }),
    ]);
    expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'cpc.adjusted', status: 'applied' }) }),
    );
    expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'success', actionsTaken: 1, actionsPendingApproval: 0 }),
      }),
    );
  });

  it('queues a pure increase for approval — never mutates Google Ads on its own', async () => {
    const mutate = jest.fn();
    const proposals = jest.fn().mockResolvedValue({
      proposals: [
        { categorySlug: 'electricieni', proposedDailyBudgetCredits: 10, proposedMaxCpcCredits: 1, reasoning: 'Cerere în creștere.' },
      ],
      costEstimateMinor: 1,
    });
    const prisma = fakePrisma();
    const { svc } = makeService({ client: fakeClient({ mutate }), ai: fakeAi({ proposals }), prisma });

    await svc.run();

    expect(mutate).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'budget.increase.proposed', status: 'pending_approval' }),
      }),
    );
    expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actionsTaken: 0, actionsPendingApproval: 1 }),
      }),
    );
  });

  it('clamps a proposal above the admin cap, and still gates it as an increase needing approval', async () => {
    const mutate = jest.fn();
    const proposals = jest.fn().mockResolvedValue({
      proposals: [
        { categorySlug: 'electricieni', proposedDailyBudgetCredits: 999, proposedMaxCpcCredits: 999, reasoning: 'x' },
      ],
      costEstimateMinor: 1,
    });
    const prisma = fakePrisma();
    const { svc } = makeService({
      client: fakeClient({ mutate }),
      ai: fakeAi({ proposals }),
      settings: fakeSettings({ budgetCap: 50, cpcCap: 5 }),
      prisma,
    });

    await svc.run();

    expect(mutate).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          after: { proposedDailyBudgetCredits: 50, proposedMaxCpcCredits: 5 },
        }),
      }),
    );
  });

  it('does nothing for a proposal identical to the current budget/CPC', async () => {
    const mutate = jest.fn();
    const proposals = jest.fn().mockResolvedValue({
      proposals: [
        { categorySlug: 'electricieni', proposedDailyBudgetCredits: 5, proposedMaxCpcCredits: 1, reasoning: 'x' },
      ],
      costEstimateMinor: 1,
    });
    const prisma = fakePrisma();
    const { svc } = makeService({ client: fakeClient({ mutate }), ai: fakeAi({ proposals }), prisma });

    await svc.run();

    expect(mutate).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentAction.create).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actionsTaken: 0, actionsPendingApproval: 0 }) }),
    );
  });

  it('marks the run failed and notifies admins when Claude is unavailable/unparseable', async () => {
    const proposals = jest.fn().mockResolvedValue(null);
    const prisma = fakePrisma();
    (prisma as any).platformRoleAssignment = {
      findMany: jest.fn().mockResolvedValue([{ userId: 'admin-1' }]),
    };
    const notifications = fakeNotifications();
    const { svc } = makeService({ ai: fakeAi({ proposals }), prisma, notifications });

    await svc.run();

    expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
    expect((notifications as any).notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', type: 'google_ads_agent_run_failed' }),
    );
  });

  it('records the rough Claude cost estimate and token/model usage on the run row (finance module reads these)', async () => {
    const proposals = jest.fn().mockResolvedValue({
      proposals: [],
      costEstimateMinor: 7,
      inputTokens: 400,
      outputTokens: 150,
      model: 'claude-sonnet-5',
    });
    const prisma = fakePrisma();
    const { svc } = makeService({ ai: fakeAi({ proposals }), prisma });

    await svc.run();

    expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claudeCostEstimateMinor: 7,
          claudeModel: 'claude-sonnet-5',
          claudeInputTokens: 400,
          claudeOutputTokens: 150,
          claudeCallCount: 1,
        }),
      }),
    );
  });

  it('notifies admins when the run hard-fails unexpectedly, and still re-throws', async () => {
    const prisma = fakePrisma();
    (prisma as any).googleAdsSubcategoryCampaign.findMany = jest
      .fn()
      .mockRejectedValue(new Error('db exploded'));
    (prisma as any).platformRoleAssignment = {
      findMany: jest.fn().mockResolvedValue([{ userId: 'admin-1' }]),
    };
    const notifications = fakeNotifications();
    const { svc } = makeService({ prisma, notifications });

    await expect(svc.run()).rejects.toThrow('db exploded');

    expect((notifications as any).notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        type: 'google_ads_agent_run_failed',
        body: 'db exploded',
      }),
    );
  });

  it('skips when a run is already in progress and fresh', async () => {
    const prisma = fakePrisma({ existingRun: { id: 'run-0', startedAt: new Date() } });
    const { svc } = makeService({ prisma });
    await svc.run();
    expect((prisma as any).googleAdsAgentRun.create).not.toHaveBeenCalled();
  });
});

describe('GoogleAdsAgentIntelligenceService.tick() gating', () => {
  it('does nothing when the agent is disabled via platform setting', async () => {
    const prisma = fakePrisma();
    const { svc } = makeService({ prisma, settings: fakeSettings({ enabled: false }) });
    const runSpy = jest.spyOn(svc, 'run').mockResolvedValue(undefined);
    await (svc as any).tick();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('does not run when the admin-configured interval has not elapsed since the last run', async () => {
    const prisma = fakePrisma({ existingRun: { id: 'run-0', startedAt: new Date() } });
    const { svc } = makeService({ prisma, settings: fakeSettings({ intervalMinutes: 1440 }) });
    const runSpy = jest.spyOn(svc, 'run').mockResolvedValue(undefined);
    await (svc as any).tick();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('runs once the admin-configured interval has elapsed since the last run', async () => {
    const longAgo = new Date(Date.now() - 2000 * 60 * 1000); // ~33h ago > 24h interval
    const prisma = fakePrisma({ existingRun: { id: 'run-0', startedAt: longAgo, status: 'success' } });
    const { svc } = makeService({ prisma, settings: fakeSettings({ intervalMinutes: 1440 }) });
    const runSpy = jest.spyOn(svc, 'run').mockResolvedValue(undefined);
    await (svc as any).tick();
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it('always runs on the very first tick, when there is no prior run at all', async () => {
    const prisma = fakePrisma({ existingRun: null });
    const { svc } = makeService({ prisma });
    const runSpy = jest.spyOn(svc, 'run').mockResolvedValue(undefined);
    await (svc as any).tick();
    expect(runSpy).toHaveBeenCalledTimes(1);
  });
});

describe('GoogleAdsAgentIntelligenceService.approveProposal / rejectProposal', () => {
  const PENDING_ACTION = {
    id: 'action-1',
    categoryId: 'cat-1',
    action: 'budget.increase.proposed',
    status: 'pending_approval',
    after: { proposedDailyBudgetCredits: 10, proposedMaxCpcCredits: 2 },
  };

  it('approveProposal sends the real mutate and marks the action applied', async () => {
    const mutate = jest.fn().mockResolvedValue([]);
    const prisma = fakePrisma({ action: PENDING_ACTION });
    const { svc } = makeService({ client: fakeClient({ mutate }), prisma });

    await svc.approveProposal('action-1', 'staff-1');

    expect(mutate).toHaveBeenCalledWith([
      expect.objectContaining({
        campaignBudgetOperation: expect.objectContaining({ update: expect.objectContaining({ amountMicros: '10000000' }) }),
      }),
      expect.objectContaining({
        adGroupOperation: expect.objectContaining({ update: expect.objectContaining({ cpcBidMicros: '2000000' }) }),
      }),
    ]);
    expect((prisma as any).googleAdsAgentAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'action-1' },
        data: expect.objectContaining({ status: 'applied', approvedByUserId: 'staff-1' }),
      }),
    );
  });

  it('approveProposal rejects an action that is not a pending budget increase', async () => {
    const prisma = fakePrisma({ action: { ...PENDING_ACTION, status: 'applied' } });
    const { svc } = makeService({ prisma });
    await expect(svc.approveProposal('action-1', 'staff-1')).rejects.toThrow();
  });

  it('rejectProposal marks the action rejected without ever mutating Google Ads', async () => {
    const mutate = jest.fn();
    const prisma = fakePrisma({ action: PENDING_ACTION });
    const { svc } = makeService({ client: fakeClient({ mutate }), prisma });

    await svc.rejectProposal('action-1', 'staff-1');

    expect(mutate).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'action-1' },
        data: expect.objectContaining({ status: 'rejected', approvedByUserId: 'staff-1' }),
      }),
    );
  });

  it('rejectProposal rejects an action that is not pending', async () => {
    const prisma = fakePrisma({ action: { ...PENDING_ACTION, status: 'rejected' } });
    const { svc } = makeService({ prisma });
    await expect(svc.rejectProposal('action-1', 'staff-1')).rejects.toThrow();
  });
});
