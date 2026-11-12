import { GoogleAdsAgentStructuralService } from 'src/google-ads/google-ads-agent-structural.service';

/**
 * This service can create/pause/resume real Google Ads campaigns, so these
 * tests exist to pin down exactly which mutate calls fire for each of the
 * three structural rules (pause / resume / create-skeleton), and that a
 * local mapping row is only ever written once Google's response actually
 * confirms the objects exist.
 */
function fakeClient(overrides: { configured?: boolean; mutate?: jest.Mock } = {}) {
  return {
    configured: overrides.configured ?? true,
    customerId: '1234567890',
    mutate: overrides.mutate ?? jest.fn().mockResolvedValue([]),
  } as never;
}

function fakeRefData() {
  return {
    getGeoTargetConstantRo: jest.fn().mockResolvedValue('geoTargetConstants/2642'),
    getLanguageConstantRo: jest.fn().mockResolvedValue('languageConstants/1032'),
    getAccountCurrencyCode: jest.fn().mockResolvedValue('EUR'),
  } as never;
}

function fakeSettings(
  overrides: {
    enabled?: boolean;
    dailyBudget?: number;
    maxCpc?: number;
    eurRon?: number;
    intervalMinutes?: number;
  } = {},
) {
  return {
    googleAdsAgentEnabled: jest.fn().mockResolvedValue(overrides.enabled ?? true),
    eurRonRate: jest.fn().mockResolvedValue(overrides.eurRon ?? 5),
    googleAdsAgentDefaultDailyBudgetCredits: jest
      .fn()
      .mockResolvedValue(overrides.dailyBudget ?? 5),
    googleAdsAgentDefaultMaxCpcCredits: jest.fn().mockResolvedValue(overrides.maxCpc ?? 1),
    googleAdsAgentStructuralIntervalMinutes: jest
      .fn()
      .mockResolvedValue(overrides.intervalMinutes ?? 360),
  } as never;
}

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) } as never;
}

function fakePrisma(
  opts: { categories?: any[]; activeCompanyCounts?: number[]; existingRun?: any } = {},
) {
  const categories = opts.categories ?? [];
  const counts = opts.activeCompanyCounts ?? [];
  let countCallIndex = 0;

  return {
    googleAdsAgentRun: {
      findFirst: jest.fn().mockResolvedValue(opts.existingRun ?? null),
      create: jest.fn().mockResolvedValue({ id: 'run-1', startedAt: new Date() }),
      update: jest.fn().mockResolvedValue({}),
    },
    category: { findMany: jest.fn().mockResolvedValue(categories) },
    companyCategory: { count: jest.fn(async () => counts[countCallIndex++] ?? 0) },
    googleAdsSubcategoryCampaign: {
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    googleAdsAgentAction: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as never;
}

const CATEGORY = {
  id: 'cat-1',
  slug: 'electricieni',
  parentId: 'parent-1',
  isActive: true,
  parent: { id: 'parent-1', slug: 'constructii' },
};

describe('GoogleAdsAgentStructuralService', () => {
  describe('tick() gating', () => {
    it('does nothing when the client is not configured', async () => {
      const prisma = fakePrisma();
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient({ configured: false }),
        fakeRefData(),
        fakeSettings(),
        prisma,
        fakeNotifications(),
      );
      await (svc as any).tick();
      expect((prisma as any).googleAdsAgentRun.create).not.toHaveBeenCalled();
    });

    it('does nothing when the agent is disabled via platform setting', async () => {
      const prisma = fakePrisma();
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient(),
        fakeRefData(),
        fakeSettings({ enabled: false }),
        prisma,
        fakeNotifications(),
      );
      await (svc as any).tick();
      expect((prisma as any).googleAdsAgentRun.create).not.toHaveBeenCalled();
    });

    it('does not run when the admin-configured interval has not elapsed since the last run', async () => {
      const prisma = fakePrisma({ existingRun: { id: 'run-0', startedAt: new Date() } });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient(),
        fakeRefData(),
        fakeSettings({ intervalMinutes: 360 }),
        prisma,
        fakeNotifications(),
      );
      await (svc as any).tick();
      expect((prisma as any).googleAdsAgentRun.create).not.toHaveBeenCalled();
    });

    it('runs once the admin-configured interval has elapsed since the last run', async () => {
      const longAgo = new Date(Date.now() - 400 * 60 * 1000); // 400min ago > 360min interval
      const prisma = fakePrisma({
        existingRun: { id: 'run-0', startedAt: longAgo, status: 'success' },
      });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient(),
        fakeRefData(),
        fakeSettings({ intervalMinutes: 360 }),
        prisma,
        fakeNotifications(),
      );
      await (svc as any).tick();
      expect((prisma as any).googleAdsAgentRun.create).toHaveBeenCalled();
    });

    it('always runs on the very first tick, when there is no prior run at all', async () => {
      const prisma = fakePrisma({ existingRun: null });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient(),
        fakeRefData(),
        fakeSettings(),
        prisma,
        fakeNotifications(),
      );
      await (svc as any).tick();
      expect((prisma as any).googleAdsAgentRun.create).toHaveBeenCalled();
    });
  });

  describe('failure alerting', () => {
    it('notifies admins when the run hard-fails, and still re-throws', async () => {
      const prisma = fakePrisma();
      (prisma as any).category.findMany = jest.fn().mockRejectedValue(new Error('db exploded'));
      (prisma as any).platformRoleAssignment = {
        findMany: jest.fn().mockResolvedValue([{ userId: 'admin-1' }]),
      };
      const notifications = fakeNotifications();
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient(),
        fakeRefData(),
        fakeSettings(),
        prisma,
        notifications,
      );

      await expect(svc.run()).rejects.toThrow('db exploded');

      expect((notifications as any).notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          type: 'google_ads_agent_run_failed',
          body: 'db exploded',
        }),
      );
      expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed', errorSummary: 'db exploded' }),
        }),
      );
    });
  });

  describe('run() locking', () => {
    it('skips the run when another one is already in progress and fresh', async () => {
      const prisma = fakePrisma({ existingRun: { id: 'run-0', startedAt: new Date() } });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient(),
        fakeRefData(),
        fakeSettings(),
        prisma,
        fakeNotifications(),
      );
      await svc.run();
      expect((prisma as any).googleAdsAgentRun.create).not.toHaveBeenCalled();
    });

    it('treats a stale in_progress lock as abandoned and runs anyway', async () => {
      const staleStart = new Date(Date.now() - 60 * 60 * 1000); // 1h ago > 30min stale threshold
      const prisma = fakePrisma({
        existingRun: { id: 'run-0', startedAt: staleStart },
        categories: [],
      });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient(),
        fakeRefData(),
        fakeSettings(),
        prisma,
        fakeNotifications(),
      );
      await svc.run();
      expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-0' },
          data: expect.objectContaining({ status: 'failed' }),
        }),
      );
      expect((prisma as any).googleAdsAgentRun.create).toHaveBeenCalled();
    });
  });

  describe('structural rules', () => {
    it('pauses an active campaign when 0 companies are active in its subcategory', async () => {
      const mutate = jest.fn().mockResolvedValue([]);
      const mapping = { id: 'map-1', googleCampaignId: '111', status: 'active' };
      const prisma = fakePrisma({
        categories: [{ ...CATEGORY, googleAdsCampaign: mapping }],
        activeCompanyCounts: [0],
      });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient({ mutate }),
        fakeRefData(),
        fakeSettings(),
        prisma,
        fakeNotifications(),
      );

      await svc.run();

      expect(mutate).toHaveBeenCalledWith([
        expect.objectContaining({
          campaignOperation: expect.objectContaining({
            update: expect.objectContaining({
              resourceName: 'customers/1234567890/campaigns/111',
              status: 'PAUSED',
            }),
            updateMask: 'status',
          }),
        }),
      ]);
      expect((prisma as any).googleAdsSubcategoryCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'map-1' },
          data: expect.objectContaining({ status: 'paused' }),
        }),
      );
      expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'campaign.pause' }) }),
      );
      expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'success', actionsTaken: 1 }),
        }),
      );
    });

    it('resumes a paused campaign when ≥1 company is active again', async () => {
      const mutate = jest.fn().mockResolvedValue([]);
      const mapping = { id: 'map-1', googleCampaignId: '111', status: 'paused' };
      const prisma = fakePrisma({
        categories: [{ ...CATEGORY, googleAdsCampaign: mapping }],
        activeCompanyCounts: [2],
      });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient({ mutate }),
        fakeRefData(),
        fakeSettings(),
        prisma,
        fakeNotifications(),
      );

      await svc.run();

      expect(mutate).toHaveBeenCalledWith([
        expect.objectContaining({
          campaignOperation: expect.objectContaining({
            update: expect.objectContaining({ status: 'ENABLED' }),
          }),
        }),
      ]);
      expect((prisma as any).googleAdsSubcategoryCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'active' }) }),
      );
      expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'campaign.resume' }) }),
      );
    });

    it('does nothing (just touches the timestamp) for an active campaign that still has companies', async () => {
      const mutate = jest.fn();
      const mapping = { id: 'map-1', googleCampaignId: '111', status: 'active' };
      const prisma = fakePrisma({
        categories: [{ ...CATEGORY, googleAdsCampaign: mapping }],
        activeCompanyCounts: [3],
      });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient({ mutate }),
        fakeRefData(),
        fakeSettings(),
        prisma,
        fakeNotifications(),
      );

      await svc.run();

      expect(mutate).not.toHaveBeenCalled();
      expect((prisma as any).googleAdsSubcategoryCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'map-1' },
          data: expect.objectContaining({ lastStructuralCheckAt: expect.any(Date) }),
        }),
      );
      expect((prisma as any).googleAdsAgentAction.create).not.toHaveBeenCalled();
      expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ actionsTaken: 0 }) }),
      );
    });

    it('does nothing for a subcategory with 0 companies and no existing mapping', async () => {
      const mutate = jest.fn();
      const prisma = fakePrisma({
        categories: [{ ...CATEGORY, googleAdsCampaign: null }],
        activeCompanyCounts: [0],
      });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient({ mutate }),
        fakeRefData(),
        fakeSettings(),
        prisma,
        fakeNotifications(),
      );

      await svc.run();

      expect(mutate).not.toHaveBeenCalled();
      expect((prisma as any).googleAdsSubcategoryCampaign.create).not.toHaveBeenCalled();
      expect((prisma as any).googleAdsAgentAction.create).not.toHaveBeenCalled();
    });

    it('creates a full skeleton (budget + campaign + geo/language targeting + ad group) for a new subcategory with ≥1 active company', async () => {
      const mutate = jest
        .fn()
        .mockResolvedValue([
          { campaignBudgetResult: { resourceName: 'customers/1234567890/campaignBudgets/555' } },
          { campaignResult: { resourceName: 'customers/1234567890/campaigns/666' } },
          { campaignCriterionResult: { resourceName: 'customers/1234567890/campaigns/666~111' } },
          { campaignCriterionResult: { resourceName: 'customers/1234567890/campaigns/666~222' } },
          { adGroupResult: { resourceName: 'customers/1234567890/adGroups/777' } },
        ]);
      const prisma = fakePrisma({
        categories: [{ ...CATEGORY, googleAdsCampaign: null }],
        activeCompanyCounts: [1],
      });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient({ mutate }),
        fakeRefData(),
        fakeSettings({ dailyBudget: 5, maxCpc: 1, eurRon: 5 }),
        prisma,
        fakeNotifications(),
      );

      await svc.run();

      expect(mutate).toHaveBeenCalledTimes(1);
      const ops = mutate.mock.calls[0][0];
      expect(ops).toHaveLength(5);
      expect(ops[0].campaignBudgetOperation.create.amountMicros).toBe('5000000'); // 5 credits EUR
      expect(ops[1].campaignOperation.create.status).toBe('PAUSED');
      // Required by Google Ads since the 2025-09-03 EU political-advertising
      // enforcement — a real 400 REQUIRED field error without it.
      expect(ops[1].campaignOperation.create.containsEuPoliticalAdvertising).toBe(
        'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
      );
      expect(ops[1].campaignOperation.create.campaignBudget).toBe(
        'customers/1234567890/campaignBudgets/-1',
      );
      expect(ops[2].campaignCriterionOperation.create.location.geoTargetConstant).toBe(
        'geoTargetConstants/2642',
      );
      expect(ops[3].campaignCriterionOperation.create.language.languageConstant).toBe(
        'languageConstants/1032',
      );
      expect(ops[4].adGroupOperation.create.status).toBe('ENABLED');
      expect(ops[4].adGroupOperation.create.cpcBidMicros).toBe('1000000'); // 1 credit EUR

      expect((prisma as any).googleAdsSubcategoryCampaign.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            categoryId: 'cat-1',
            googleCampaignId: '666',
            googleAdGroupId: '777',
            googleBudgetResourceId: '555',
            status: 'pending_creation',
            dailyBudgetMinor: 500,
            maxCpcMinor: 100,
          }),
        }),
      );
      expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'campaign.create' }) }),
      );
    });

    it('does not record a mapping when the mutate response is missing a resource name, and marks the run partial', async () => {
      const mutate = jest.fn().mockResolvedValue([
        { campaignBudgetResult: { resourceName: 'customers/1234567890/campaignBudgets/555' } },
        { campaignResult: { resourceName: 'customers/1234567890/campaigns/666' } },
        {},
        {},
        {}, // missing adGroupResult
      ]);
      const prisma = fakePrisma({
        categories: [{ ...CATEGORY, googleAdsCampaign: null }],
        activeCompanyCounts: [1],
      });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient({ mutate }),
        fakeRefData(),
        fakeSettings(),
        prisma,
        fakeNotifications(),
      );

      await svc.run();

      expect((prisma as any).googleAdsSubcategoryCampaign.create).not.toHaveBeenCalled();
      expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'partial' }) }),
      );
    });

    it('one category erroring does not stop the rest of the pass', async () => {
      const mutate = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
      const mappingA = { id: 'map-a', googleCampaignId: '1', status: 'active' };
      const mappingB = { id: 'map-b', googleCampaignId: '2', status: 'active' };
      const prisma = fakePrisma({
        categories: [
          { ...CATEGORY, id: 'cat-a', googleAdsCampaign: mappingA },
          { ...CATEGORY, id: 'cat-b', googleAdsCampaign: mappingB },
        ],
        activeCompanyCounts: [0, 0],
      });
      const svc = new GoogleAdsAgentStructuralService(
        fakeClient({ mutate }),
        fakeRefData(),
        fakeSettings(),
        prisma,
        fakeNotifications(),
      );

      await svc.run();

      expect(mutate).toHaveBeenCalledTimes(2);
      expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'partial',
            categoriesScanned: 2,
            actionsTaken: 1,
          }),
        }),
      );
    });
  });
});
