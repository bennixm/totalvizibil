import { GoogleAdsAgentRecommendationsService } from 'src/google-ads/google-ads-agent-recommendations.service';

/**
 * Direction 4 (research doc): Google's own auto-apply-eligible set is
 * maintenance-only; budget/bid/targeting recommendations must never be
 * auto-applied here. These tests pin down the 3-way classification
 * (auto-apply / never / queue-for-approval) and the dedup-against-already-
 * handled-rows guard that stops the same recommendation being re-queued
 * every structural tick.
 */
function fakeClient(overrides: { search?: jest.Mock; applyRecommendations?: jest.Mock } = {}) {
  return {
    customerId: '1234567890',
    search: overrides.search ?? jest.fn().mockResolvedValue([]),
    applyRecommendations: overrides.applyRecommendations ?? jest.fn().mockResolvedValue([]),
  } as never;
}

function fakeSettings(autoApplyTypes: string[] = []) {
  return {
    googleAdsAgentAutoApplyRecommendationTypes: jest.fn().mockResolvedValue(autoApplyTypes),
  } as never;
}

function fakePrisma(existingActions: { action: string; status: string }[] = []) {
  return {
    googleAdsAgentAction: {
      findFirst: jest.fn(
        async ({ where }: any) => existingActions.find((a) => a.action === where.action) ?? null,
      ),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
    },
  } as never;
}

describe('GoogleAdsAgentRecommendationsService.reconcile', () => {
  it('returns false and does nothing when there are no recommendations', async () => {
    const prisma = fakePrisma();
    const svc = new GoogleAdsAgentRecommendationsService(fakeClient(), fakeSettings(), prisma);
    const changed = await svc.reconcile('cat-1', 'customers/1234567890/campaigns/1');
    expect(changed).toBe(false);
    expect((prisma as any).googleAdsAgentAction.create).not.toHaveBeenCalled();
  });

  it('auto-applies a recommendation whose type is in the admin allowlist', async () => {
    // CALLOUT_ASSET: a real catalog entry classified `ad_quality` (asset-
    // only, genuinely safe to auto-apply) — KEYWORD is deliberately NOT
    // used here any more, see the dedicated "never auto-applies ... even
    // if the admin's setting mistakenly includes it" tests below for why.
    // Google's suggested callout text (`recommendedCampaignCalloutAssets`)
    // must be echoed back as `apply_parameters` — a bare `{resourceName}`
    // 400s for this type (the real bug this fix addresses).
    const suggestedAsset = { calloutAsset: { calloutText: 'Livrare rapidă' } };
    const search = jest.fn().mockResolvedValue([
      {
        recommendation: {
          resourceName: 'customers/1234567890/recommendations/1',
          type: 'CALLOUT_ASSET',
          calloutAssetRecommendation: { recommendedCampaignCalloutAssets: [suggestedAsset] },
        },
      },
    ]);
    const applyRecommendations = jest
      .fn()
      .mockResolvedValue(['customers/1234567890/recommendations/1']);
    const prisma = fakePrisma();
    const svc = new GoogleAdsAgentRecommendationsService(
      fakeClient({ search, applyRecommendations }),
      fakeSettings(['CALLOUT_ASSET']),
      prisma,
    );

    const changed = await svc.reconcile('cat-1', 'customers/1234567890/campaigns/1');

    expect(changed).toBe(true);
    expect(applyRecommendations).toHaveBeenCalledWith([
      {
        resourceName: 'customers/1234567890/recommendations/1',
        calloutAsset: {
          adAssetApplyParameters: { newAssets: [suggestedAsset], scope: 'CAMPAIGN' },
        },
      },
    ]);
    expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'recommendation.CALLOUT_ASSET',
          status: 'applied',
        }),
      }),
    );
  });

  it('queues for manual approval instead of auto-applying when Google gives no suggested content to echo back', async () => {
    // An allowlisted type with an empty/missing suggestion payload can't be
    // turned into a valid apply call — must not attempt the call at all,
    // must fall straight to the manual queue (not throw, not auto-apply).
    const search = jest.fn().mockResolvedValue([
      {
        recommendation: {
          resourceName: 'customers/1234567890/recommendations/8',
          type: 'SITELINK_ASSET',
          sitelinkAssetRecommendation: { recommendedCampaignSitelinkAssets: [] },
        },
      },
    ]);
    const applyRecommendations = jest.fn();
    const prisma = fakePrisma();
    const svc = new GoogleAdsAgentRecommendationsService(
      fakeClient({ search, applyRecommendations }),
      fakeSettings(['SITELINK_ASSET']),
      prisma,
    );

    const changed = await svc.reconcile('cat-1', 'customers/1234567890/campaigns/1');

    expect(changed).toBe(true);
    expect(applyRecommendations).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'recommendation.SITELINK_ASSET',
          status: 'pending_approval',
        }),
      }),
    );
  });

  it("never auto-applies a budget/bid/keyword type, even if the admin's setting mistakenly includes it — but still queues it for review", async () => {
    // The real bug this fixes: the old hand-kept never-apply Set only
    // covered 4 "reach expansion" opt-in types — KEYWORD (and every
    // budget/bid type) could previously have been auto-applied if an old
    // free-text allowlist entry happened to include one, contradicting
    // this class's own documented guarantee.
    const search = jest.fn().mockResolvedValue([
      {
        recommendation: { resourceName: 'customers/1234567890/recommendations/7', type: 'KEYWORD' },
      },
    ]);
    const applyRecommendations = jest.fn();
    const prisma = fakePrisma();
    const svc = new GoogleAdsAgentRecommendationsService(
      fakeClient({ search, applyRecommendations }),
      fakeSettings(['KEYWORD']), // mistakenly allowlisted
      prisma,
    );

    const changed = await svc.reconcile('cat-1', 'customers/1234567890/campaigns/1');

    expect(changed).toBe(true);
    expect(applyRecommendations).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'recommendation.KEYWORD',
          status: 'pending_approval',
        }),
      }),
    );
  });

  it('never auto-applies a targeting/Display-expansion type, even if the admin allowlisted it by mistake', async () => {
    const search = jest.fn().mockResolvedValue([
      {
        recommendation: {
          resourceName: 'customers/1234567890/recommendations/2',
          type: 'DISPLAY_EXPANSION_OPT_IN',
        },
      },
    ]);
    const applyRecommendations = jest.fn();
    const prisma = fakePrisma();
    const svc = new GoogleAdsAgentRecommendationsService(
      fakeClient({ search, applyRecommendations }),
      fakeSettings(['DISPLAY_EXPANSION_OPT_IN']), // admin mistakenly allowlisted it
      prisma,
    );

    const changed = await svc.reconcile('cat-1', 'customers/1234567890/campaigns/1');

    expect(changed).toBe(false);
    expect(applyRecommendations).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentAction.create).not.toHaveBeenCalled();
  });

  it('queues an un-allowlisted recommendation for manual approval instead of applying it', async () => {
    const search = jest.fn().mockResolvedValue([
      {
        recommendation: {
          resourceName: 'customers/1234567890/recommendations/3',
          type: 'FORECASTING_SET_TARGET_CPA',
        },
      },
    ]);
    const applyRecommendations = jest.fn();
    const prisma = fakePrisma();
    const svc = new GoogleAdsAgentRecommendationsService(
      fakeClient({ search, applyRecommendations }),
      fakeSettings([]), // nothing allowlisted (the default)
      prisma,
    );

    const changed = await svc.reconcile('cat-1', 'customers/1234567890/campaigns/1');

    expect(changed).toBe(true);
    expect(applyRecommendations).not.toHaveBeenCalled();
    expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'recommendation.FORECASTING_SET_TARGET_CPA',
          status: 'pending_approval',
        }),
      }),
    );
  });

  it('does not re-queue a recommendation type already pending approval or already applied', async () => {
    const search = jest.fn().mockResolvedValue([
      {
        recommendation: {
          resourceName: 'customers/1234567890/recommendations/4',
          type: 'KEYWORD',
        },
      },
    ]);
    const prisma = fakePrisma([{ action: 'recommendation.KEYWORD', status: 'pending_approval' }]);
    const svc = new GoogleAdsAgentRecommendationsService(
      fakeClient({ search }),
      fakeSettings([]),
      prisma,
    );

    const changed = await svc.reconcile('cat-1', 'customers/1234567890/campaigns/1');

    expect(changed).toBe(false);
    expect((prisma as any).googleAdsAgentAction.create).not.toHaveBeenCalled();
  });

  it('falls back to the manual-approval queue when auto-apply itself fails', async () => {
    const search = jest.fn().mockResolvedValue([
      {
        recommendation: {
          resourceName: 'customers/1234567890/recommendations/5',
          type: 'CALLOUT_ASSET',
          calloutAssetRecommendation: {
            recommendedCampaignCalloutAssets: [{ calloutAsset: { calloutText: 'Test' } }],
          },
        },
      },
    ]);
    const applyRecommendations = jest.fn().mockRejectedValue(new Error('stale recommendation'));
    const prisma = fakePrisma();
    const svc = new GoogleAdsAgentRecommendationsService(
      fakeClient({ search, applyRecommendations }),
      fakeSettings(['CALLOUT_ASSET']),
      prisma,
    );

    const changed = await svc.reconcile('cat-1', 'customers/1234567890/campaigns/1');

    expect(changed).toBe(true);
    expect((prisma as any).googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'recommendation.CALLOUT_ASSET',
          status: 'pending_approval',
        }),
      }),
    );
  });
});

describe('GoogleAdsAgentRecommendationsService.approveProposal', () => {
  it('applies a maintenance-only recommendation with a bare operation', async () => {
    const applyRecommendations = jest
      .fn()
      .mockResolvedValue(['customers/1234567890/recommendations/9']);
    const prisma = fakePrisma();
    (prisma as any).googleAdsAgentAction.findUnique = jest.fn().mockResolvedValue({
      id: 'action-1',
      status: 'pending_approval',
      action: 'recommendation.FORECASTING_SET_TARGET_CPA',
      after: { resourceName: 'customers/1234567890/recommendations/9' },
    });
    const svc = new GoogleAdsAgentRecommendationsService(
      fakeClient({ applyRecommendations }),
      fakeSettings(),
      prisma,
    );

    await svc.approveProposal('action-1', 'admin-1');

    expect(applyRecommendations).toHaveBeenCalledWith([
      { resourceName: 'customers/1234567890/recommendations/9' },
    ]);
    expect((prisma as any).googleAdsAgentAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'action-1' },
        data: expect.objectContaining({ status: 'applied', approvedByUserId: 'admin-1' }),
      }),
    );
  });

  it('rejects approving an action that is not a pending recommendation', async () => {
    const prisma = fakePrisma();
    (prisma as any).googleAdsAgentAction.findUnique = jest.fn().mockResolvedValue({
      id: 'action-2',
      status: 'applied',
      action: 'recommendation.KEYWORD',
    });
    const svc = new GoogleAdsAgentRecommendationsService(fakeClient(), fakeSettings(), prisma);

    await expect(svc.approveProposal('action-2', 'admin-1')).rejects.toThrow();
  });

  it('approves a SITELINK_ASSET proposal by echoing back the suggested sitelinks (the reported crash)', async () => {
    // Regression test: approving used to send a bare `{resourceName}`,
    // which Google 400s for SITELINK_ASSET (surfaced as a 500 to the
    // admin) — it must now echo back the suggested assets captured in
    // `after.recommendation` at queue time.
    const suggestedAsset = { sitelinkAsset: { linkText: 'Program' }, finalUrls: ['https://x.ro'] };
    const applyRecommendations = jest
      .fn()
      .mockResolvedValue(['customers/1234567890/recommendations/11']);
    const prisma = fakePrisma();
    (prisma as any).googleAdsAgentAction.findUnique = jest.fn().mockResolvedValue({
      id: 'action-3',
      status: 'pending_approval',
      action: 'recommendation.SITELINK_ASSET',
      after: {
        resourceName: 'customers/1234567890/recommendations/11',
        type: 'SITELINK_ASSET',
        recommendation: {
          sitelinkAssetRecommendation: { recommendedCampaignSitelinkAssets: [suggestedAsset] },
        },
      },
    });
    const svc = new GoogleAdsAgentRecommendationsService(
      fakeClient({ applyRecommendations }),
      fakeSettings(),
      prisma,
    );

    await svc.approveProposal('action-3', 'admin-1');

    expect(applyRecommendations).toHaveBeenCalledWith([
      {
        resourceName: 'customers/1234567890/recommendations/11',
        sitelinkAsset: {
          adAssetApplyParameters: { newAssets: [suggestedAsset], scope: 'CAMPAIGN' },
        },
      },
    ]);
  });

  it('refuses to approve a CALL_ASSET proposal with a clear error instead of a doomed apply call', async () => {
    const applyRecommendations = jest.fn();
    const prisma = fakePrisma();
    (prisma as any).googleAdsAgentAction.findUnique = jest.fn().mockResolvedValue({
      id: 'action-4',
      status: 'pending_approval',
      action: 'recommendation.CALL_ASSET',
      after: {
        resourceName: 'customers/1234567890/recommendations/12',
        type: 'CALL_ASSET',
      },
    });
    const svc = new GoogleAdsAgentRecommendationsService(
      fakeClient({ applyRecommendations }),
      fakeSettings(),
      prisma,
    );

    await expect(svc.approveProposal('action-4', 'admin-1')).rejects.toThrow(/manual/i);
    expect(applyRecommendations).not.toHaveBeenCalled();
  });
});
