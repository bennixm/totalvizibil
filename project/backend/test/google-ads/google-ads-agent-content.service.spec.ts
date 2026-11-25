import { formatApiErrorForTest } from 'src/google-ads/google-ads-api-client.service';
import { GoogleAdsAgentContentService } from 'src/google-ads/google-ads-agent-content.service';

/**
 * This service is the only path that flips an agent-created campaign from
 * `pending_creation` to `active` — these tests pin down that it NEVER does
 * so without a real, validated keyword plan. Order of Google calls for a
 * new campaign: keywords + ad (campaign still PAUSED) → optional assets →
 * Ad Strength read/improve loop → enable. The campaign is only enabled
 * after the ad exists.
 */
function fakeClient(
  overrides: { configured?: boolean; mutate?: jest.Mock; search?: jest.Mock } = {},
) {
  return {
    configured: overrides.configured ?? true,
    writesAllowed: true,
    customerId: '1234567890',
    // The content pass Google-validates keywords + ad first (validateOnly,
    // see dropPolicyViolations): accepted here without touching the test's
    // own mock, so its call counts and queued answers stay about real calls.
    mutate: wrapValidate(overrides.mutate ?? jest.fn().mockResolvedValue([])),
    search: overrides.search ?? jest.fn().mockResolvedValue([]),
  } as never;
}

function wrapValidate(mutate: jest.Mock) {
  return (ops: unknown[], opts?: { validateOnly?: boolean }) =>
    opts?.validateOnly &&
    ops.some((o) => (o as { adGroupAdOperation?: unknown }).adGroupAdOperation)
      ? Promise.resolve([])
      : mutate(ops, opts);
}

function fakeAi(overrides: { configured?: boolean; plan?: jest.Mock } = {}) {
  return {
    configured: overrides.configured ?? true,
    writesAllowed: true,
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

    // Call 1: keywords + ad (campaign stays PAUSED). Call 2: enable.
    expect(mutate).toHaveBeenCalledTimes(2);
    const ops = mutate.mock.calls[0][0];
    expect(ops).toHaveLength(4);
    expect(ops.some((o: any) => o.campaignOperation)).toBe(false);
    expect(ops.filter((o: any) => o.adGroupCriterionOperation)).toHaveLength(3);
    expect(
      ops.find((o: any) => o.adGroupAdOperation).adGroupAdOperation.create.ad.finalUrls,
    ).toEqual(['https://totalvizibil.ro/constructii/electricieni']);
    // Direction 6 (research doc): carries the click's physical județ +
    // Google's own click id through to the feed via ValueTrack.
    expect(
      ops.find((o: any) => o.adGroupAdOperation).adGroupAdOperation.create.ad.finalUrlSuffix,
    ).toBe('loc={loc_physical_ms}&gclid={gclid}');
    const enableOp = mutate.mock.calls[1][0][0];
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

  it('drops a keyword Google refuses for policy and still activates the campaign', async () => {
    let validations = 0;
    const mutate = jest.fn(async (ops: any[], opts?: { validateOnly?: boolean }) => {
      if (opts?.validateOnly && ops.some((o) => o.adGroupAdOperation)) {
        validations++;
        const flagged = ops.findIndex(
          (o) => o.adGroupCriterionOperation?.create?.keyword?.text === 'reparatii electrice',
        );
        if (flagged >= 0) {
          throw formatApiErrorForTest(400, {
            message: 'policy',
            details: [
              {
                errors: [
                  {
                    message: 'A policy was violated.',
                    errorCode: { policyFindingError: 'POLICY_FINDING' },
                    location: {
                      fieldPathElements: [{ fieldName: 'mutate_operations', index: flagged }],
                    },
                    details: {
                      policyFindingDetails: {
                        policyTopicEntries: [{ topic: 'UNVERIFIED_CLAIMS' }],
                      },
                    },
                  },
                ],
              },
            ],
          });
        }
      }
      return [];
    });
    const client = {
      configured: true,
      writesAllowed: true,
      customerId: '1234567890',
      mutate,
      search: jest.fn().mockResolvedValue([]),
    };
    const prisma = fakePrisma({ pending: [MAPPING] });
    const svc = makeService({ client: client as never, prisma });

    await svc.run();

    expect(validations).toBe(2);
    const real = mutate.mock.calls.filter((c) => !c[1]?.validateOnly);
    const kws = real[0][0]
      .filter((o: any) => o.adGroupCriterionOperation)
      .map((o: any) => o.adGroupCriterionOperation.create.keyword.text);
    expect(kws).toEqual(['electrician bucuresti', 'instalatii electrice']);
    expect((prisma as any).googleAdsSubcategoryCampaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'active' }) }),
    );
    const row = (prisma as any).googleAdsAgentAction.create.mock.calls.at(-1)[0].data;
    expect(row.after.droppedForPolicy[0]).toContain('reparatii electrice');
  });

  it('records a visible failure with the Google reason when activation fails', async () => {
    const mutate = jest
      .fn()
      .mockRejectedValue(new Error('Google Ads a respins cererea (HTTP 400): ceva'));
    const prisma = fakePrisma({ pending: [MAPPING] });
    const svc = makeService({ client: fakeClient({ mutate }), prisma });
    await svc.run();
    const row = (prisma as any).googleAdsAgentAction.create.mock.calls.at(-1)[0].data;
    expect(row.status).toBe('failed');
    expect(row.errorMessage).toContain('Google Ads a respins cererea');
  });

  it('leaves the campaign pending_creation when Claude returns no usable plan', async () => {
    const mutate = jest.fn();
    const plan = jest.fn().mockResolvedValue(null);
    const prisma = fakePrisma({ pending: [MAPPING] });
    const svc = makeService({ client: fakeClient({ mutate }), ai: fakeAi({ plan }), prisma });

    await svc.run();

    expect(mutate).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsSubcategoryCampaign.update).not.toHaveBeenCalled();
    // The failure is recorded (visible in History), nothing is applied.
    expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'keywords.updated',
          status: 'failed',
          errorMessage: expect.stringMatching(/Nu s-a putut genera planul/),
        }),
      }),
    );
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

      // keywords+ad, enable, then the sibling negative-keyword push.
      expect(mutate).toHaveBeenCalledTimes(3);
      expect(mutate.mock.calls[2][0]).toEqual([
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

      expect(mutate).toHaveBeenCalledTimes(2); // keywords+ad, then enable
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

    it('after an account switch, reuses the action of this account or creates one', async () => {
      for (const existing of ['customers/1234567890/conversionActions/9', null]) {
        const mutate = jest
          .fn()
          .mockResolvedValueOnce([
            {
              conversionActionResult: { resourceName: 'customers/1234567890/conversionActions/2' },
            },
          ])
          .mockResolvedValue([]);
        const search = jest
          .fn()
          .mockResolvedValueOnce(existing ? [{ conversionAction: { resourceName: existing } }] : [])
          .mockResolvedValue([]);
        const setConversionActionResourceName = jest.fn().mockResolvedValue(undefined);
        const settings = fakeSettings({
          conversionActionResourceName: 'customers/9178508093/conversionActions/7',
          setConversionActionResourceName,
        });
        const prisma = fakePrisma({ pending: [MAPPING] });
        const svc = makeService({ client: fakeClient({ mutate, search }), settings, prisma });
        await svc.run();
        expect(search.mock.calls[0][0]).toContain('FROM conversion_action');
        expect(setConversionActionResourceName).toHaveBeenCalledWith(
          existing ?? 'customers/1234567890/conversionActions/2',
        );
        expect(!!mutate.mock.calls[0][0][0].conversionActionOperation).toBe(!existing);
      }
    });

    it('never recreates the conversion action once it already exists', async () => {
      const mutate = jest.fn().mockResolvedValue([]);
      const settings = fakeSettings({
        conversionActionResourceName: 'customers/1234567890/conversionActions/1',
      });
      const prisma = fakePrisma({ pending: [MAPPING] });

      const svc = makeService({ client: fakeClient({ mutate }), settings, prisma });
      await svc.run();

      expect(mutate).toHaveBeenCalledTimes(2); // keywords+ad, enable — no conversionActionOperation
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

  describe('addOptionalAdAssets (Direction 2, research doc — sitelinks count toward Ad Strength)', () => {
    it('creates callout + sitelink assets and attaches them to the campaign with the right field types', async () => {
      const mutate = jest.fn((ops: any[]) => {
        if (ops[0]?.assetOperation) {
          return Promise.resolve(
            ops.map((_: unknown, i: number) => ({ assetResult: { resourceName: `asset-${i}` } })),
          );
        }
        return Promise.resolve([]);
      });
      const plan = jest.fn().mockResolvedValue({
        keywords: ['electrician bucuresti'],
        headlines: ['Electricieni verificați'],
        descriptions: ['Găsește un electrician de încredere.'],
        callouts: ['Firme verificate'],
        sitelinkLabels: ['Vezi firme', 'Cere o ofertă'],
        costEstimateMinor: 1,
      });
      const prisma = fakePrisma({ pending: [MAPPING] });

      const svc = makeService({ client: fakeClient({ mutate }), ai: fakeAi({ plan }), prisma });
      await svc.run();

      // Call 1: keywords + ad. Call 2: create the 3 assets. Call 3: attach
      // them (BEFORE Ad Strength is read: sitelinks count toward it).
      // Call 4: enable the campaign.
      expect(mutate).toHaveBeenCalledTimes(4);
      expect(mutate.mock.calls[3][0][0].campaignOperation.update.status).toBe('ENABLED');
      const createOps = mutate.mock.calls[1][0];
      expect(createOps).toEqual([
        { assetOperation: { create: { calloutAsset: { calloutText: 'Firme verificate' } } } },
        {
          assetOperation: {
            create: {
              finalUrls: ['https://totalvizibil.ro/constructii/electricieni'],
              sitelinkAsset: { linkText: 'Vezi firme' },
            },
          },
        },
        {
          assetOperation: {
            create: {
              finalUrls: ['https://totalvizibil.ro/constructii/electricieni'],
              sitelinkAsset: { linkText: 'Cere o ofertă' },
            },
          },
        },
      ]);
      const attachOps = mutate.mock.calls[2][0];
      expect(attachOps).toEqual([
        {
          campaignAssetOperation: {
            create: {
              campaign: 'customers/1234567890/campaigns/666',
              asset: 'asset-0',
              fieldType: 'CALLOUT',
            },
          },
        },
        {
          campaignAssetOperation: {
            create: {
              campaign: 'customers/1234567890/campaigns/666',
              asset: 'asset-1',
              fieldType: 'SITELINK',
            },
          },
        },
        {
          campaignAssetOperation: {
            create: {
              campaign: 'customers/1234567890/campaigns/666',
              asset: 'asset-2',
              fieldType: 'SITELINK',
            },
          },
        },
      ]);
    });

    it('no-ops with no extra mutate calls when the plan has no callouts/sitelinks/image query', async () => {
      const mutate = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ pending: [MAPPING] });
      const svc = makeService({ client: fakeClient({ mutate }), prisma }); // default fakeAi() plan

      await svc.run();

      expect(mutate).toHaveBeenCalledTimes(2); // keywords+ad, then enable
    });
  });

  describe('Ad Strength maximization (real Google feedback)', () => {
    const AGA = 'customers/1234567890/adGroupAds/777~999';
    const reading = (strength: string, items: string[] = []) => [
      {
        adGroupAd: {
          adStrength: strength,
          actionItems: items,
          ad: {
            responsiveSearchAd: {
              headlines: ['Electricieni verificați', 'Programează rapid', 'Firme locale'].map(
                (text) => ({ text }),
              ),
              descriptions: ['Găsește un electrician de încredere.', 'Comparații rapide.'].map(
                (text) => ({ text }),
              ),
            },
          },
        },
      },
    ];
    function setup(strengths: string[]) {
      const queue = [...strengths];
      const search = jest.fn(async (q: string) => {
        if (q.includes('FROM ad_group_criterion')) {
          return [{ adGroupCriterion: { keyword: { text: 'electrician bucuresti' } } }];
        }
        if (q.includes('ad_group_ad.action_items')) {
          const s = queue.length > 1 ? queue.shift()! : queue[0];
          return reading(
            s,
            s === 'EXCELLENT' ? [] : ['Try including more keywords in your headlines.'],
          );
        }
        return [];
      });
      const mutate = jest.fn(async (ops: any[], _opts?: any) =>
        ops.some((o) => o.adGroupAdOperation)
          ? [{}, {}, {}, { adGroupAdResult: { resourceName: AGA } }]
          : [],
      );
      const improve = jest.fn().mockResolvedValue({
        headlines: Array.from({ length: 15 }, (_, i) => `Electrician bucuresti ${i + 1}`),
        descriptions: [
          'Electrician bucuresti verificat.',
          'Compară firme locale.',
          'Cere ofertă rapid.',
          'Programează simplu.',
        ],
        costEstimateMinor: 2,
      });
      const ai = { ...(fakeAi() as any), googleAdsImproveAdStrength: improve };
      const prisma = fakePrisma({ pending: [MAPPING] });
      const svc = makeService({ client: fakeClient({ mutate, search }), ai: ai as never, prisma });
      (svc as any).adStrength.sleep = () => Promise.resolve();
      return { svc, mutate, improve, prisma };
    }

    it('reads Google, improves from Google action items, re-reads, and records the CONFIRMED result', async () => {
      const { svc, mutate, improve, prisma } = setup(['AVERAGE', 'EXCELLENT']);
      await svc.run();
      expect(improve).toHaveBeenCalledWith(
        expect.objectContaining({
          adStrength: 'AVERAGE',
          googleActionItems: ['Try including more keywords in your headlines.'],
          keywords: ['electrician bucuresti'],
        }),
      );
      // validateOnly then real update, then enable last.
      const adUpdates = mutate.mock.calls.filter((c: any[]) => c[0][0]?.adOperation);
      expect(adUpdates[0][1]).toEqual({ validateOnly: true });
      expect(adUpdates[1][1]).toBeUndefined();
      expect(mutate.mock.calls.at(-1)![0][0].campaignOperation.update.status).toBe('ENABLED');
      expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'keywords.updated',
            after: expect.objectContaining({ adStrength: 'EXCELLENT' }),
            executionResult: expect.stringMatching(/confirmat Ad Strength „Excelent”/),
          }),
        }),
      );
    });

    it("when Excellent is not reached, reports the real rating and Google's remaining suggestions", async () => {
      const { svc, prisma } = setup(['AVERAGE', 'GOOD', 'GOOD']);
      await svc.run();
      const data = (prisma as any).googleAdsAgentAction.create.mock.calls.find(
        (c: any[]) => c[0].data.action === 'keywords.updated',
      )[0].data;
      expect(data.after.adStrength).toBe('GOOD');
      expect(data.executionResult).toMatch(/confirmat de Google: GOOD/);
      expect(data.executionResult).toMatch(/Try including more keywords/);
    });

    it('restores the better-rated version when a rewrite makes Ad Strength worse', async () => {
      const { svc, mutate } = setup(['GOOD', 'AVERAGE', 'GOOD']);
      await svc.run();
      const realUpdates = mutate.mock.calls.filter((c: any[]) => c[0][0]?.adOperation && !c[1]);
      // the rewrite, then the restore of the GOOD-rated texts
      expect(realUpdates).toHaveLength(2);
      const restored = realUpdates[1][0][0].adOperation.update.responsiveSearchAd.headlines.map(
        (h: any) => h.text,
      );
      expect(restored).toEqual(['Electricieni verificați', 'Programează rapid', 'Firme locale']);
    });
  });
});
