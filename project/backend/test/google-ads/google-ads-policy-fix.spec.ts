import { Logger } from '@nestjs/common';
import {
  formatApiErrorForTest,
  policyFindingsOf,
} from 'src/google-ads/google-ads-api-client.service';
import { CampaignData } from 'src/google-ads/optimization/google-ads-account-data';
import { AgentActivity } from 'src/google-ads/optimization/google-ads-activity';
import { GoogleAdsOptimizerService } from 'src/google-ads/optimization/google-ads-optimizer.service';

Logger.overrideLogger(false);

const metrics = () => ({
  impressions: 0,
  clicks: 0,
  costMicros: 0,
  conversions: 0,
  conversionsValue: 0,
});

function campaign(overrides: Partial<CampaignData> = {}): CampaignData {
  return {
    googleCampaignId: '111',
    resourceName: 'customers/1/campaigns/111',
    name: 'TVZ Subcat - auto/vulcanizare',
    channelType: 'SEARCH',
    status: 'ENABLED',
    primaryStatusReasons: [],
    current: metrics(),
    previous: metrics(),
    ads: [
      {
        adResourceName: 'customers/1/ads/9',
        adGroupAdResourceName: 'customers/1/adGroupAds/8~9',
        status: 'ENABLED',
        primaryStatusReasons: [],
        approvalStatus: 'APPROVED_LIMITED',
        finalUrls: ['https://totalvizibil.ro/auto/vulcanizare'],
        headlines: [
          { text: 'Titlu bun 1' },
          {
            text: 'CEL MAI BUN SERVICE',
            approvalStatus: 'DISAPPROVED',
            policyTopics: ['CAPITALIZATION'],
            pinnedField: 'HEADLINE_1',
          },
          { text: 'Titlu bun 2' },
          { text: 'Titlu bun 3' },
        ],
        descriptions: [{ text: 'Descriere bună 1' }, { text: 'Descriere bună 2' }],
        actionItems: [],
        keywords: [],
      },
    ],
    assets: [],
    assetGroups: [],
    openRecommendations: [],
    ...overrides,
  };
}

const target = {
  owner: { categoryId: 'cat' },
  name: 'Vulcanizare',
  imageQuery: 'tire',
  landingFallback: 'https://totalvizibil.ro/auto/vulcanizare',
  businessName: 'Totalvizibil',
  sitelinkDestinations: async () => [],
};

function policyError(): Error {
  return formatApiErrorForTest(400, {
    message: 'Request contains an invalid argument.',
    details: [
      {
        errors: [
          {
            message: 'A policy was violated.',
            errorCode: { policyFindingError: 'POLICY_FINDING' },
            location: {
              fieldPathElements: [
                { fieldName: 'mutate_operations', index: 0 },
                { fieldName: 'ad_operation' },
              ],
            },
            details: { policyFindingDetails: { policyTopicEntries: [{ topic: 'SUPERLATIVES' }] } },
          },
        ],
      },
    ],
  });
}

function setup(
  opts: { ai?: Partial<{ texts: (string | null)[][] }>; validate?: (Error | null)[] } = {},
) {
  const live = new Set<string>();
  const validateQueue = [...(opts.validate ?? [])];
  const mutate = jest.fn(async (ops: any[], o?: { validateOnly?: boolean }) => {
    if (o?.validateOnly) {
      const next = validateQueue.shift();
      if (next) throw next;
      return [];
    }
    const upd = ops[0]?.adOperation?.update?.responsiveSearchAd;
    if (upd) {
      live.clear();
      for (const x of [...(upd.headlines ?? []), ...(upd.descriptions ?? [])]) live.add(x.text);
    }
    return ops.map(() => ({}));
  });
  const search = jest.fn(async (q: string) =>
    q.includes('responsive_search_ad.headlines')
      ? [
          {
            adGroupAd: {
              ad: { responsiveSearchAd: { headlines: [...live].map((text) => ({ text })) } },
            },
          },
        ]
      : [],
  );
  const answers = [...(opts.ai?.texts ?? [])];
  const ai = {
    configured: opts.ai !== undefined,
    googleAdsPolicyFixTexts: jest.fn(async () => {
      const texts = answers.shift();
      return texts ? { texts, costEstimateMinor: 1 } : null;
    }),
  };
  const prisma = {
    googleAdsAgentAction: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'a', ...data })),
    },
    googleAdsAgentEvent: { create: jest.fn().mockResolvedValue({ id: 'e' }), update: jest.fn() },
  };
  const svc = new GoogleAdsOptimizerService(
    { customerId: '1', writesAllowed: true, search, mutate } as any,
    ai as any,
    {
      googleAdsAgentAutoFillGapsEnabled: jest.fn().mockResolvedValue(true),
      googleAdsAgentCreativeCooldownDays: jest.fn().mockResolvedValue(14),
    } as any,
    prisma as any,
    { get: () => '' } as any,
  );
  const activity = new AgentActivity(prisma as any, 'run');
  return { svc, mutate, ai, prisma, activity };
}

describe('Google Ads policy findings', () => {
  it('extracts the operation index and topics from a POLICY_FINDING error', () => {
    const f = policyFindingsOf(policyError());
    expect(f).toEqual([
      {
        operationIndex: 0,
        topics: ['SUPERLATIVES'],
        message: 'A policy was violated.',
        path: [{ field: 'mutate_operations', index: 0 }, { field: 'ad_operation' }],
      },
    ]);
    expect(policyFindingsOf(new Error('x'))).toEqual([]);
  });
});

describe('GoogleAdsOptimizerService.fixPolicyViolations', () => {
  it('rewrites a disapproved headline, keeps its pin, and records the fix', async () => {
    const { svc, mutate, prisma, activity } = setup({
      ai: { texts: [['Service rapid și sigur']] },
    });
    const r = await svc.fixPolicyViolations(campaign(), target as any, activity);
    expect(r.applied).toBe(1);
    const real = mutate.mock.calls.find((c) => !c[1]?.validateOnly)![0];
    const hl = real[0].adOperation.update.responsiveSearchAd.headlines;
    expect(hl[1]).toEqual({ text: 'Service rapid și sigur', pinnedField: 'HEADLINE_1' });
    expect(hl.map((h: any) => h.text)).not.toContain('CEL MAI BUN SERVICE');
    const row = prisma.googleAdsAgentAction.create.mock.calls[0][0].data;
    expect(row.action).toBe('policy.fix_text');
    expect(row.status).toBe('applied');
    expect(row.before.texts).toEqual(['CEL MAI BUN SERVICE']);
  });

  it('feeds a Google policy rejection back to the AI and retries', async () => {
    const { svc, ai, activity } = setup({
      ai: { texts: [['Cel mai bun service'], ['Service verificat']] },
      validate: [policyError(), null],
    });
    const r = await svc.fixPolicyViolations(campaign(), target as any, activity);
    expect(r.applied).toBe(1);
    expect(ai.googleAdsPolicyFixTexts).toHaveBeenCalledTimes(2);
    const second = (ai.googleAdsPolicyFixTexts.mock.calls as any[])[1][0];
    expect(second.googleFeedback).toContain('SUPERLATIVES');
  });

  it('removes the disapproved text when no compliant rewrite exists and the ad stays valid', async () => {
    const { svc, mutate, activity } = setup();
    const r = await svc.fixPolicyViolations(campaign(), target as any, activity);
    expect(r.applied).toBe(1);
    const real = mutate.mock.calls.find((c) => !c[1]?.validateOnly)![0];
    const texts = real[0].adOperation.update.responsiveSearchAd.headlines.map((h: any) => h.text);
    expect(texts).toEqual(['Titlu bun 1', 'Titlu bun 2', 'Titlu bun 3']);
  });

  it('never drops below Google minimum headlines', async () => {
    const c = campaign();
    c.ads[0].headlines = c.ads[0].headlines.slice(0, 3); // 3 = minimum, one disapproved
    const { svc, mutate, activity } = setup();
    const r = await svc.fixPolicyViolations(c, target as any, activity);
    expect(r.applied).toBe(0);
    expect(mutate.mock.calls.filter((x) => !x[1]?.validateOnly)).toHaveLength(0);
  });

  it('unlinks disapproved campaign assets and removes disapproved keywords', async () => {
    const c = campaign({
      ads: [],
      assets: [
        {
          level: 'campaign',
          fieldType: 'CALLOUT',
          text: 'Garantat 100%',
          primaryStatusReasons: ['ASSET_DISAPPROVED'],
          linkResourceName: 'customers/1/campaignAssets/111~5~CALLOUT',
        },
        { level: 'account', fieldType: 'CALLOUT', text: 'Ok', primaryStatusReasons: [] },
      ],
      disapprovedKeywords: [
        { resourceName: 'customers/1/adGroupCriteria/8~77', text: 'pastile slabit' },
      ],
    });
    const { svc, mutate, activity } = setup();
    const r = await svc.fixPolicyViolations(c, target as any, activity);
    expect(r.applied).toBe(2);
    const ops = mutate.mock.calls.filter((x) => !x[1]?.validateOnly).map((x) => x[0][0]);
    expect(ops).toContainEqual({
      campaignAssetOperation: { remove: 'customers/1/campaignAssets/111~5~CALLOUT' },
    });
    expect(ops).toContainEqual({
      adGroupCriterionOperation: { remove: 'customers/1/adGroupCriteria/8~77' },
    });
  });

  it('does nothing when Google disapproved nothing', async () => {
    const c = campaign();
    c.ads[0].headlines = c.ads[0].headlines.filter((h) => !h.approvalStatus);
    const { svc, mutate, activity } = setup();
    expect((await svc.fixPolicyViolations(c, target as any, activity)).applied).toBe(0);
    expect(mutate).not.toHaveBeenCalled();
  });
});
