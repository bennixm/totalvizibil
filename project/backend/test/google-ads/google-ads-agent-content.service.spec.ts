import { GoogleAdsAgentContentService } from 'src/google-ads/google-ads-agent-content.service';

/**
 * This service is the only path that flips an agent-created campaign from
 * `pending_creation` to `active` — these tests pin down that it NEVER does
 * so without a real, validated keyword plan, and that the keywords/ad/
 * enable-campaign mutate all go out together.
 */
function fakeClient(
  overrides: { configured?: boolean; mutate?: jest.Mock; search?: jest.Mock } = {},
) {
  return {
    configured: overrides.configured ?? true,
    customerId: '1234567890',
    mutate: overrides.mutate ?? jest.fn().mockResolvedValue([]),
    search: overrides.search ?? jest.fn().mockResolvedValue([]),
  } as never;
}

function fakeAi(overrides: { configured?: boolean; plan?: jest.Mock } = {}) {
  return {
    configured: overrides.configured ?? true,
    googleAdsKeywordPlan:
      overrides.plan ??
      jest.fn().mockResolvedValue({
        keywords: ['electrician bucuresti', 'reparatii electrice', 'instalatii electrice'],
        headlines: ['Electricieni verificați', 'Programează rapid', 'Firme locale'],
        descriptions: ['Găsește un electrician de încredere.', 'Comparații rapide.'],
        costEstimateMinor: 1,
      }),
  } as never;
}

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) } as never;
}

function fakeSettings(
  overrides: {
    enabled?: boolean;
    intervalMinutes?: number;
    conversionActionResourceName?: string | null;
    setConversionActionResourceName?: jest.Mock;
  } = {},
) {
  return {
    googleAdsAgentEnabled: jest.fn().mockResolvedValue(overrides.enabled ?? true),
    googleAdsAgentContentIntervalMinutes: jest
      .fn()
      .mockResolvedValue(overrides.intervalMinutes ?? 360),
    // Defaults to "already created" so existing tests that don't care about
    // Direction 3 aren't exercising ensureConversionAction()'s create path
    // (and its own extra mutate call) incidentally — see the dedicated
    // 'ensureConversionAction' describe block below for that path.
    googleAdsConversionActionResourceName: jest
      .fn()
      .mockResolvedValue(
        overrides.conversionActionResourceName === undefined
          ? 'customers/1234567890/conversionActions/1'
          : overrides.conversionActionResourceName,
      ),
    setGoogleAdsConversionActionResourceName:
      overrides.setConversionActionResourceName ?? jest.fn().mockResolvedValue(undefined),
  } as never;
}

function fakeConfig() {
  return { get: () => 'https://totalvizibil.ro' } as never;
}

function fakePrisma(opts: { pending?: any[]; existingRun?: any } = {}) {
  return {
    googleAdsAgentRun: {
      findFirst: jest.fn().mockResolvedValue(opts.existingRun ?? null),
      create: jest.fn().mockResolvedValue({ id: 'run-1', startedAt: new Date() }),
      update: jest.fn().mockResolvedValue({}),
    },
    googleAdsSubcategoryCampaign: {
      findMany: jest.fn().mockResolvedValue(opts.pending ?? []),
      update: jest.fn().mockResolvedValue({}),
    },
    company: { findMany: jest.fn().mockResolvedValue([]) },
    googleAdsAgentAction: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as never;
}

const MAPPING = {
  id: 'map-1',
  categoryId: 'cat-1',
  googleCampaignId: '666',
  googleAdGroupId: '777',
  googleBudgetResourceId: '555',
  status: 'pending_creation',
  category: {
    id: 'cat-1',
    slug: 'electricieni',
    nameI18n: { ro: 'Electricieni' },
    parent: { slug: 'constructii', nameI18n: { ro: 'Construcții' } },
  },
};

function makeService(
  overrides: {
    client?: ReturnType<typeof fakeClient>;
    ai?: ReturnType<typeof fakeAi>;
    settings?: ReturnType<typeof fakeSettings>;
    prisma?: ReturnType<typeof fakePrisma>;
    notifications?: ReturnType<typeof fakeNotifications>;
  } = {},
) {
  return new GoogleAdsAgentContentService(
    (overrides.client ?? fakeClient()) as any,
    (overrides.ai ?? fakeAi()) as any,
    (overrides.settings ?? fakeSettings()) as any,
    (overrides.prisma ?? fakePrisma()) as any,
    (overrides.notifications ?? fakeNotifications()) as any,
    fakeConfig(),
  );
}

describe('GoogleAdsAgentContentService', () => {
  describe('tick() gating', () => {
    it('does nothing when the client is not configured', async () => {
      const prisma = fakePrisma();
      const svc = makeService({ client: fakeClient({ configured: false }), prisma });
      await (svc as any).tick();
      expect((prisma as any).googleAdsAgentRun.create).not.toHaveBeenCalled();
    });

    it('does nothing when Claude is not configured', async () => {
      const prisma = fakePrisma();
      const svc = makeService({ ai: fakeAi({ configured: false }), prisma });
      await (svc as any).tick();
      expect((prisma as any).googleAdsAgentRun.create).not.toHaveBeenCalled();
    });

    it('does nothing when the agent is disabled via platform setting', async () => {
      const prisma = fakePrisma();
      const svc = makeService({ settings: fakeSettings({ enabled: false }), prisma });
      await (svc as any).tick();
      expect((prisma as any).googleAdsAgentRun.create).not.toHaveBeenCalled();
    });

    it('does not run when the admin-configured interval has not elapsed since the last run', async () => {
      const prisma = fakePrisma({ existingRun: { id: 'run-0', startedAt: new Date() } });
      const svc = makeService({ settings: fakeSettings({ intervalMinutes: 360 }), prisma });
      await (svc as any).tick();
      expect((prisma as any).googleAdsAgentRun.create).not.toHaveBeenCalled();
    });

    it('runs once the admin-configured interval has elapsed since the last run', async () => {
      const longAgo = new Date(Date.now() - 400 * 60 * 1000);
      const prisma = fakePrisma({
        existingRun: { id: 'run-0', startedAt: longAgo, status: 'success' },
      });
      const svc = makeService({ settings: fakeSettings({ intervalMinutes: 360 }), prisma });
      await (svc as any).tick();
      expect((prisma as any).googleAdsAgentRun.create).toHaveBeenCalled();
    });
  });

  it('activates a pending_creation campaign once Claude returns a valid plan', async () => {
    const mutate = jest.fn().mockResolvedValue([]);
    const prisma = fakePrisma({ pending: [MAPPING] });
    const svc = makeService({ client: fakeClient({ mutate }), prisma });

    await svc.run();

    expect(mutate).toHaveBeenCalledTimes(1);
    const ops = mutate.mock.calls[0][0];
    // 3 keyword ops + 1 ad op + 1 campaign-enable op.
    expect(ops).toHaveLength(5);
    expect(ops.filter((o: any) => o.adGroupCriterionOperation)).toHaveLength(3);
    expect(
      ops.find((o: any) => o.adGroupAdOperation).adGroupAdOperation.create.ad.finalUrls,
    ).toEqual(['https://totalvizibil.ro/constructii/electricieni']);
    // Direction 6 (research doc): carries the click's physical județ +
    // Google's own click id through to the feed via ValueTrack.
    expect(
      ops.find((o: any) => o.adGroupAdOperation).adGroupAdOperation.create.ad.finalUrlSuffix,
    ).toBe('loc={loc_physical_ms}&gclid={gclid}');
    const enableOp = ops.find((o: any) => o.campaignOperation);
    expect(enableOp.campaignOperation.update.status).toBe('ENABLED');

    expect((prisma as any).googleAdsSubcategoryCampaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'map-1' },
        data: expect.objectContaining({ status: 'active' }),
      }),
    );
    expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'keywords.updated' }) }),
    );
  });

  it('leaves the campaign pending_creation when Claude returns no usable plan', async () => {
    const mutate = jest.fn();
    const plan = jest.fn().mockResolvedValue(null);
    const prisma = fakePrisma({ pending: [MAPPING] });
    const svc = makeService({ client: fakeClient({ mutate }), ai: fakeAi({ plan }), prisma });

    await svc.run();

    expect(mutate).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsSubcategoryCampaign.update).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentAction.create).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'success', actionsTaken: 0 }),
      }),
    );
  });

  it('skips the run when a content pass is already in progress and fresh', async () => {
    const prisma = fakePrisma({ existingRun: { id: 'run-0', startedAt: new Date() } });
    const svc = makeService({ prisma });
    await svc.run();
    expect((prisma as any).googleAdsAgentRun.create).not.toHaveBeenCalled();
  });

  it('records the rough Claude cost estimate on the run row', async () => {
    const prisma = fakePrisma({ pending: [MAPPING] });
    const svc = makeService({ prisma });

    await svc.run();

    expect((prisma as any).googleAdsAgentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ claudeCostEstimateMinor: 1 }) }),
    );
  });

  it('notifies admins when the run hard-fails, and still re-throws', async () => {
    const prisma = fakePrisma();
    (prisma as any).googleAdsSubcategoryCampaign.findMany = jest
      .fn()
      .mockRejectedValue(new Error('db exploded'));
    (prisma as any).platformRoleAssignment = {
      findMany: jest.fn().mockResolvedValue([{ userId: 'admin-1' }]),
    };
    const notifications = fakeNotifications();
    const svc = makeService({ prisma, notifications });

    await expect(svc.run()).rejects.toThrow('db exploded');

    expect((notifications as any).notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        type: 'google_ads_agent_run_failed',
        body: 'db exploded',
      }),
    );
  });

  describe('sibling negative-keyword push (Direction 1, research doc)', () => {
    it('pushes the newly generated keywords onto sibling sets when the category has a parent', async () => {
      const mapping = { ...MAPPING, category: { ...MAPPING.category, parentId: 'parent-1' } };
      const search = jest.fn().mockResolvedValue([]); // no existing negatives, no sibling positives
      const mutate = jest.fn().mockResolvedValue([]);
      const findMany = jest.fn((args: any) => {
        if (args?.where?.status === 'pending_creation') return Promise.resolve([mapping]);
        return Promise.resolve([
          {
            negativeKeywordSetResourceId: '9',
            googleAdGroupId: '88',
            category: { slug: 'vopsitorie' },
          },
        ]);
      });
      const prisma = fakePrisma();
      (prisma as any).googleAdsSubcategoryCampaign.findMany = findMany;

      const svc = makeService({ client: fakeClient({ mutate, search }), prisma });
      await svc.run();

      // One mutate call for the main keyword/ad/enable batch, one for the
      // sibling negative-keyword push.
      expect(mutate).toHaveBeenCalledTimes(2);
      expect(mutate.mock.calls[1][0]).toEqual([
        {
          sharedCriterionOperation: {
            create: {
              sharedSet: 'customers/1234567890/sharedSets/9',
              keyword: { text: 'electrician bucuresti', matchType: 'PHRASE' },
            },
          },
        },
        {
          sharedCriterionOperation: {
            create: {
              sharedSet: 'customers/1234567890/sharedSets/9',
              keyword: { text: 'reparatii electrice', matchType: 'PHRASE' },
            },
          },
        },
        {
          sharedCriterionOperation: {
            create: {
              sharedSet: 'customers/1234567890/sharedSets/9',
              keyword: { text: 'instalatii electrice', matchType: 'PHRASE' },
            },
          },
        },
      ]);
    });

    it('does not attempt a sibling push when the category has no parent', async () => {
      const mutate = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ pending: [MAPPING] }); // MAPPING.category has no parentId
      const svc = makeService({ client: fakeClient({ mutate }), prisma });

      await svc.run();

      expect(mutate).toHaveBeenCalledTimes(1); // only the main keyword/ad/enable batch
    });
  });

  describe('ensureConversionAction (Direction 3, research doc)', () => {
    it('creates the account-wide conversion action once and persists its resource name', async () => {
      const mutate = jest
        .fn()
        .mockResolvedValueOnce([
          { conversionActionResult: { resourceName: 'customers/1234567890/conversionActions/1' } },
        ])
        .mockResolvedValueOnce([]); // the main keyword/ad/enable batch
      const setConversionActionResourceName = jest.fn().mockResolvedValue(undefined);
      const settings = fakeSettings({
        conversionActionResourceName: null,
        setConversionActionResourceName,
      });
      const prisma = fakePrisma({ pending: [MAPPING] });

      const svc = makeService({ client: fakeClient({ mutate }), settings, prisma });
      await svc.run();

      expect(mutate.mock.calls[0][0]).toEqual([
        {
          conversionActionOperation: {
            create: {
              name: 'TVZ Feed Click-Through',
              type: 'WEBPAGE',
              category: 'DEFAULT',
              status: 'ENABLED',
            },
          },
        },
      ]);
      expect(setConversionActionResourceName).toHaveBeenCalledWith(
        'customers/1234567890/conversionActions/1',
      );
    });

    it('never recreates the conversion action once it already exists', async () => {
      const mutate = jest.fn().mockResolvedValue([]);
      const settings = fakeSettings({
        conversionActionResourceName: 'customers/1234567890/conversionActions/1',
      });
      const prisma = fakePrisma({ pending: [MAPPING] });

      const svc = makeService({ client: fakeClient({ mutate }), settings, prisma });
      await svc.run();

      expect(mutate).toHaveBeenCalledTimes(1); // only the main batch — no conversionActionOperation
      expect(mutate.mock.calls[0][0].some((o: any) => o.conversionActionOperation)).toBe(false);
    });

    it('never blocks ad activation when conversion-action creation fails', async () => {
      const mutate = jest
        .fn()
        .mockRejectedValueOnce(new Error('API down'))
        .mockResolvedValueOnce([]);
      const settings = fakeSettings({ conversionActionResourceName: null });
      const prisma = fakePrisma({ pending: [MAPPING] });

      const svc = makeService({ client: fakeClient({ mutate }), settings, prisma });
      await svc.run();

      expect((prisma as any).googleAdsSubcategoryCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'active' }) }),
      );
    });
  });
});
