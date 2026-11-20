import { CampaignData, LinkedAsset } from 'src/google-ads/optimization/google-ads-account-data';
import { evaluateCampaign } from 'src/google-ads/optimization/google-ads-campaign-evaluator';
import {
  GoogleAdsOptimizerService,
  acceptTexts,
  textProblem,
} from 'src/google-ads/optimization/google-ads-optimizer.service';
import { AgentActivity } from 'src/google-ads/optimization/google-ads-activity';
import * as kw from 'src/google-ads/optimization/google-ads-headline-keywords';

const metrics = (impressions = 0, clicks = 0, conversions = 0, costMicros = 0) => ({
  impressions,
  clicks,
  costMicros,
  conversions,
  conversionsValue: 0,
});

function searchCampaign(overrides: Partial<CampaignData> = {}): CampaignData {
  return {
    googleCampaignId: '111',
    resourceName: 'customers/1/campaigns/111',
    name: 'TVZ Subcat - auto/vulcanizare',
    channelType: 'SEARCH',
    status: 'ENABLED',
    primaryStatus: 'ELIGIBLE',
    primaryStatusReasons: [],
    current: metrics(),
    previous: metrics(),
    ads: [
      {
        adResourceName: 'customers/1/ads/9',
        adGroupAdResourceName: 'customers/1/adGroupAds/8~9',
        status: 'ENABLED',
        adStrength: 'AVERAGE',
        primaryStatusReasons: [],
        approvalStatus: 'APPROVED',
        finalUrls: ['https://totalvizibil.ro/auto/vulcanizare'],
        headlines: Array.from({ length: 10 }, (_, i) => ({ text: `Titlu numărul ${i + 1}` })),
        descriptions: Array.from({ length: 3 }, (_, i) => ({
          text: `Descriere diferită ${i + 1}`,
        })),
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

const ctx = { managed: true, urlChecks: new Map() };

const sitelink = (n: number): LinkedAsset => ({
  level: 'campaign',
  fieldType: 'SITELINK',
  primaryStatusReasons: [],
  sitelink: { linkText: `Link ${n}`, finalUrl: `https://x.ro/${n}` },
});

describe('evaluateCampaign — Search', () => {
  it('scores proportionally to Google requirements and lists what is missing', () => {
    const ev = evaluateCampaign(searchCampaign(), ctx);
    const h = ev.components.find((c) => c.key === 'headlines')!;
    expect(h.earned).toBe(10); // 10 of 15 headlines → 10/15 points
    expect(h.missing).toEqual(['5 titluri']);
    expect(ev.components.find((c) => c.key === 'descriptions')!.earned).toBe(7.5);
    expect(ev.adStrength).toBe('AVERAGE');
    expect(ev.score).toBeGreaterThan(0);
    expect(ev.score).toBeLessThan(100);
  });

  it('marks gap issues as auto-fixable only for managed campaigns', () => {
    const managed = evaluateCampaign(searchCampaign(), ctx);
    const other = evaluateCampaign(searchCampaign(), { managed: false, urlChecks: new Map() });
    const code = (e: typeof managed) => e.issues.find((i) => i.code === 'sitelinks_missing')!;
    expect(code(managed).autoFixable).toBe(true);
    expect(code(other).autoFixable).toBe(false);
    expect(code(managed).priority).toBe('high');
  });

  it('excludes non-evaluable components (no data) from both earned and max', () => {
    const ev = evaluateCampaign(searchCampaign(), ctx);
    const perf = ev.components.find((c) => c.key === 'performance')!;
    expect(perf.status).toBe('na');
    // Fully optimized on everything evaluable → 100 even with perf "na".
    const full = evaluateCampaign(
      searchCampaign({
        ads: [
          {
            ...searchCampaign().ads[0],
            adStrength: 'EXCELLENT',
            headlines: Array.from({ length: 15 }, (_, i) => ({
              text: `Unghi ${i} ${'abcdefghijklmnop'[i]}`,
            })),
            descriptions: Array.from({ length: 4 }, (_, i) => ({ text: `Text ${i} ${'wxyz'[i]}` })),
          },
        ],
        assets: [
          ...[1, 2, 3, 4, 5, 6].map(sitelink),
          ...[1, 2, 3, 4].map((n) => ({
            level: 'campaign' as const,
            fieldType: 'CALLOUT',
            primaryStatusReasons: [],
            text: `Callout ${n}`,
          })),
          { level: 'campaign', fieldType: 'STRUCTURED_SNIPPET', primaryStatusReasons: [] },
          {
            level: 'campaign',
            fieldType: 'BUSINESS_NAME',
            primaryStatusReasons: [],
            text: 'Totalvizibil',
          },
          {
            level: 'account',
            fieldType: 'BUSINESS_LOGO',
            primaryStatusReasons: [],
            image: { width: 1200, height: 1200, fileSize: 1000 },
          },
          ...[1, 2].map(() => ({
            level: 'campaign' as const,
            fieldType: 'AD_IMAGE',
            primaryStatusReasons: [],
            image: { width: 1200, height: 1200, fileSize: 1000 },
          })),
          ...[1, 2].map(() => ({
            level: 'campaign' as const,
            fieldType: 'AD_IMAGE',
            primaryStatusReasons: [],
            image: { width: 1200, height: 628, fileSize: 1000 },
          })),
        ],
      }),
      ctx,
    );
    expect(full.score).toBe(100);
  });

  it('compares performance only with enough impressions, and flags a major drop as high priority', () => {
    const ev = evaluateCampaign(
      searchCampaign({ current: metrics(1000, 20), previous: metrics(1000, 60) }),
      ctx,
    );
    const perf = ev.components.find((c) => c.key === 'performance')!;
    expect(perf.status).toBe('attention');
    expect(perf.earned).toBe(0);
    expect(ev.issues.find((i) => i.code === 'performance_drop_major')?.priority).toBe('high');
  });

  it('flags clicks without conversions', () => {
    const ev = evaluateCampaign(searchCampaign({ current: metrics(800, 60, 0) }), ctx);
    expect(ev.issues.some((i) => i.code === 'no_conversions')).toBe(true);
  });

  it('a disapproved headline is critical and zeroes the policy component', () => {
    const c = searchCampaign();
    c.ads[0].headlines[0].approvalStatus = 'DISAPPROVED';
    const ev = evaluateCampaign(c, ctx);
    expect(ev.issues[0].priority).toBe('critical');
    expect(ev.components.find((x) => x.key === 'policy')!.earned).toBe(0);
  });

  it('a disapproved ACCOUNT-level asset is reported once as high, without zeroing campaign policy', () => {
    const ev = evaluateCampaign(
      searchCampaign({
        assets: [
          {
            level: 'account',
            fieldType: 'BUSINESS_LOGO',
            primaryStatusReasons: ['ASSET_DISAPPROVED'],
            image: { width: 400, height: 400, fileSize: 1 },
          },
        ],
      }),
      ctx,
    );
    expect(ev.issues.find((i) => i.code === 'account_asset_disapproved')?.priority).toBe('high');
    expect(ev.components.find((x) => x.key === 'policy')!.earned).toBe(14);
  });

  it('a broken final URL is critical', () => {
    const urlChecks = new Map([
      [
        'https://totalvizibil.ro/auto/vulcanizare',
        { url: 'https://totalvizibil.ro/auto/vulcanizare', ok: false, status: 404 },
      ],
    ]);
    const ev = evaluateCampaign(searchCampaign(), { managed: true, urlChecks });
    expect(ev.issues[0]).toMatchObject({ code: 'broken_url', priority: 'critical' });
  });

  it('an enabled campaign Google reports NOT_ELIGIBLE is critical; a paused one is not', () => {
    const blocked = evaluateCampaign(
      searchCampaign({
        primaryStatus: 'NOT_ELIGIBLE',
        primaryStatusReasons: ['CAMPAIGN_BUDGET_EXHAUSTED'],
      }),
      ctx,
    );
    expect(blocked.issues[0].code).toBe('not_serving');
    const paused = evaluateCampaign(
      searchCampaign({
        status: 'PAUSED',
        primaryStatus: 'NOT_ELIGIBLE',
        primaryStatusReasons: ['CAMPAIGN_PAUSED'],
      }),
      ctx,
    );
    expect(paused.issues.some((i) => i.code === 'not_serving')).toBe(false);
  });
});

describe('evaluateCampaign — Performance Max', () => {
  const img = (
    fieldType: string,
    width: number,
    height: number,
    fileSize = 200_000,
  ): LinkedAsset => ({
    level: 'asset_group',
    fieldType,
    primaryStatusReasons: [],
    image: { width, height, fileSize },
  });
  const txt = (fieldType: string, text: string): LinkedAsset => ({
    level: 'asset_group',
    fieldType,
    primaryStatusReasons: [],
    text,
  });

  it('validates image formats against the PMax specs and flags a missing required format', () => {
    const ev = evaluateCampaign(
      searchCampaign({
        channelType: 'PERFORMANCE_MAX',
        ads: [],
        assetGroups: [
          {
            resourceName: 'ag/1',
            name: 'g',
            status: 'ENABLED',
            adStrength: 'GOOD',
            primaryStatusReasons: [],
            finalUrls: [],
          },
        ],
        assets: [
          ...Array.from({ length: 11 }, (_, i) =>
            txt('HEADLINE', i === 0 ? 'Scurt' : `Titlu lung ${i}`),
          ),
          txt('LONG_HEADLINE', 'Un titlu lung'),
          txt('DESCRIPTION', 'd1'),
          txt('DESCRIPTION', 'd2'),
          img('MARKETING_IMAGE', 1200, 628),
          img('MARKETING_IMAGE', 500, 262), // below 600×314 minimum
          img('SQUARE_MARKETING_IMAGE', 1200, 1200, 6_000_000), // over 5 MB
        ],
      }),
      ctx,
    );
    const images = ev.assets.images;
    expect(images.find((i) => i.width === 500)!.valid).toBe(false);
    expect(images.find((i) => i.fileSize === 6_000_000)!.valid).toBe(false);
    // The only square image is invalid → required square format missing.
    expect(ev.issues.find((i) => i.code === 'pmax_required_images')?.priority).toBe('critical');
    expect(ev.components.find((c) => c.key === 'videos')!.explanation).toMatch(
      /nu expune durata sau orientarea/,
    );
    expect(ev.issues.find((i) => i.code === 'pmax_logo')?.priority).toBe('high');
  });
});

describe('text validation', () => {
  it('rejects texts breaking Google limits or editorial rules', () => {
    expect(textProblem('a'.repeat(31), 30, 'headline')).toMatch(/30/);
    expect(textProblem('Sună acum!', 30, 'headline')).toMatch(/exclamare/);
    expect(textProblem('Vezi www.site.ro', 30, 'headline')).toMatch(/URL/);
    expect(textProblem('Sună la 0722 123 456', 90, 'other')).toMatch(/telefon/);
    expect(textProblem('OFERTE SPECIALE AZI', 30, 'headline')).toMatch(/majuscule/);
    expect(textProblem('Vulcanizare rapidă', 30, 'headline')).toBeNull();
  });

  it('drops duplicates of existing texts (case/diacritics-insensitive) and caps the count', () => {
    const r = acceptTexts(
      ['Service Auto', 'Nou unghi', 'Alt unghi', 'Al treilea'],
      ['service auto'],
      30,
      'headline',
      2,
    );
    expect(r.accepted).toEqual(['Nou unghi', 'Alt unghi']);
    expect(r.rejected.map((x) => x.reason)).toEqual(['duplicat', 'peste numărul necesar']);
  });
});

describe('GoogleAdsOptimizerService.fillGaps', () => {
  function setup(opts: {
    writesAllowed: boolean;
    verifyHeadlines?: string[];
    /** Campaign already has a structured snippet + business name. */
    extensions?: boolean;
    /** Live campaign_asset rows returned by the post-apply re-read. */
    assetRows?: unknown[];
  }) {
    const mutate = jest.fn().mockResolvedValue([]);
    const search = jest.fn(async (q: string) => {
      if (q.includes('FROM campaign_asset')) return opts.assetRows ?? [];
      if (q.includes('FROM ad_group_ad')) {
        return [
          {
            adGroupAd: {
              ad: {
                responsiveSearchAd: {
                  headlines: (opts.verifyHeadlines ?? []).map((text) => ({ text })),
                  descriptions: [],
                },
              },
            },
          },
        ];
      }
      return [];
    });
    const client = { writesAllowed: opts.writesAllowed, customerId: '1', mutate, search };
    const ai = {
      configured: true,
      googleAdsCreativeGapFill: jest.fn().mockResolvedValue({
        headlines: [
          'Vulcanizare non-stop',
          'Schimb anvelope rapid',
          'Titlu numărul 1',
          'Cere ofertă azi',
          'Firme verificate',
          'Programare simplă',
        ],
        descriptions: ['Compară vulcanizări din zona ta și alege rapid.'],
        callouts: [],
        snippetValues: ['Montaj anvelope', 'Echilibrare roți', 'Reparații jante', 'Depozitare'],
        sitelinks: [],
        costEstimateMinor: 3,
        inputTokens: 1,
        outputTokens: 1,
        model: 'm',
      }),
    };
    const settings = {
      googleAdsAgentAutoFillGapsEnabled: jest.fn().mockResolvedValue(true),
      googleAdsAgentCreativeCooldownDays: jest.fn().mockResolvedValue(14),
    };
    const prisma = {
      googleAdsAgentAction: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'act-1', ...data })),
      },
      googleAdsCampaignSnapshot: { update: jest.fn().mockResolvedValue({}) },
      googleAdsAgentEvent: { create: jest.fn().mockResolvedValue({ id: 'e' }), update: jest.fn() },
      category: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const config = { get: (k: string) => (k === 'pexelsApiKey' ? '' : 'https://totalvizibil.ro') };
    const svc = new GoogleAdsOptimizerService(
      client as never,
      ai as never,
      settings as never,
      prisma as never,
      config as never,
    );
    const c = searchCampaign({
      assets: [
        ...[1, 2, 3, 4, 5, 6].map(sitelink),
        ...[1, 2, 3, 4].map((n) => ({
          level: 'campaign' as const,
          fieldType: 'CALLOUT',
          primaryStatusReasons: [],
          text: `C${n}`,
        })),
        ...(opts.extensions === false
          ? []
          : [
              {
                level: 'campaign' as const,
                fieldType: 'STRUCTURED_SNIPPET',
                primaryStatusReasons: [],
              },
              {
                level: 'campaign' as const,
                fieldType: 'BUSINESS_NAME',
                primaryStatusReasons: [],
                text: 'Totalvizibil',
              },
            ]),
      ],
    });
    const ev = evaluateCampaign(c, ctx);
    const mapping = {
      categoryId: 'cat',
      category: {
        id: 'cat',
        slug: 'vulcanizare',
        parentId: null,
        parent: null,
        nameI18n: { ro: 'Vulcanizare' },
      },
    };
    const activity = new AgentActivity(prisma as never, 'run');
    return { svc, c, ev, mapping, activity, mutate, prisma };
  }

  it('in a read-only environment: validates with Google, never writes, records nothing as applied', async () => {
    const { svc, c, ev, mapping, activity, mutate, prisma } = setup({ writesAllowed: false });
    const r = await svc.fillGaps(c, ev, svc.platformTarget(mapping as never), activity);
    expect(r.applied).toBe(0);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][1]).toEqual({ validateOnly: true });
    expect(prisma.googleAdsAgentAction.create).not.toHaveBeenCalled();
  });

  it('adds only the missing headlines (dropping a duplicate), keeps existing ones, then verifies and records', async () => {
    const added = [
      'Vulcanizare non-stop',
      'Schimb anvelope rapid',
      'Cere ofertă azi',
      'Firme verificate',
      'Programare simplă',
    ];
    const { svc, c, ev, mapping, activity, mutate, prisma } = setup({
      writesAllowed: true,
      verifyHeadlines: [
        ...c0Headlines(),
        ...added,
        'Compară vulcanizări din zona ta și alege rapid.',
      ],
    });
    const r = await svc.fillGaps(c, ev, svc.platformTarget(mapping as never), activity);
    expect(r.applied).toBe(1);
    // validateOnly first, then the real call with the same operations.
    expect(mutate.mock.calls[0][1]).toEqual({ validateOnly: true });
    expect(mutate.mock.calls[1][1]).toBeUndefined();
    const op = mutate.mock.calls[1][0][0].adOperation;
    const headlines = op.update.responsiveSearchAd.headlines.map((h: { text: string }) => h.text);
    expect(headlines).toHaveLength(15);
    expect(headlines.slice(0, 10)).toEqual(c0Headlines());
    // Claude's duplicate of an existing headline was dropped, not added twice.
    expect(headlines.filter((t: string) => t === 'Titlu numărul 1')).toHaveLength(1);
    expect(op.updateMask).toBe('responsive_search_ad.headlines,responsive_search_ad.descriptions');
    expect(prisma.googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'creative.rsa_gap_fill',
          status: 'applied',
          verifiedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('records a failed action when the post-apply re-read does not show the change', async () => {
    const { svc, c, ev, mapping, activity, prisma } = setup({
      writesAllowed: true,
      verifyHeadlines: [],
    });
    const r = await svc.fillGaps(c, ev, svc.platformTarget(mapping as never), activity);
    expect(r.applied).toBe(0);
    expect(prisma.googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          errorMessage: expect.stringMatching(/Lipsesc/),
        }),
      }),
    );
  });

  it('adds a missing structured snippet and business name even during the ad-text cooldown', async () => {
    const values = ['Montaj anvelope', 'Echilibrare roți', 'Reparații jante', 'Depozitare'];
    const { svc, c, ev, mapping, activity, mutate, prisma } = setup({
      writesAllowed: true,
      extensions: false,
      assetRows: [
        { asset: { structuredSnippetAsset: { values } } },
        { asset: { textAsset: { text: 'Totalvizibil' } } },
      ],
    });
    expect(ev.issues.find((i) => i.code === 'snippets_missing')?.autoFixable).toBe(true);
    expect(ev.issues.find((i) => i.code === 'brand_missing')?.autoFixable).toBe(true);
    // A recent ad-text change: headlines/descriptions wait, extensions don't.
    prisma.googleAdsAgentAction.findFirst.mockResolvedValue({ createdAt: new Date() });
    const r = await svc.fillGaps(c, ev, svc.platformTarget(mapping as never), activity);
    expect(r.applied).toBe(1);
    const ops = mutate.mock.calls[1][0];
    expect(ops.some((o: any) => o.adOperation)).toBe(false);
    expect(ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetOperation: {
            create: expect.objectContaining({
              structuredSnippetAsset: { header: 'Servicii', values },
            }),
          },
        }),
        expect.objectContaining({
          assetOperation: {
            create: expect.objectContaining({ textAsset: { text: 'Totalvizibil' } }),
          },
        }),
        expect.objectContaining({
          campaignAssetOperation: {
            create: expect.objectContaining({ fieldType: 'STRUCTURED_SNIPPET' }),
          },
        }),
        expect.objectContaining({
          campaignAssetOperation: {
            create: expect.objectContaining({ fieldType: 'BUSINESS_NAME' }),
          },
        }),
      ]),
    );
    expect(prisma.googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'creative.assets_gap_fill', status: 'applied' }),
      }),
    );
  });

  it('respects the creative cooldown', async () => {
    const { svc, c, ev, mapping, activity, mutate, prisma } = setup({ writesAllowed: true });
    prisma.googleAdsAgentAction.findFirst.mockResolvedValue({ createdAt: new Date() });
    const r = await svc.fillGaps(c, ev, svc.platformTarget(mapping as never), activity);
    expect(r.applied).toBe(0);
    expect(mutate).not.toHaveBeenCalled();
  });
});

function c0Headlines(): string[] {
  return Array.from({ length: 10 }, (_, i) => `Titlu numărul ${i + 1}`);
}

describe('GoogleAdsOptimizerService.proposeAdStrengthRewrite', () => {
  const H = Array.from({ length: 15 }, (_, i) => `Titlu numărul ${i + 1}`);
  const D = Array.from({ length: 4 }, (_, i) => `Descriere diferită ${i + 1}`);

  function setup(strength = 'AVERAGE') {
    const search = jest.fn(async (q: string) => {
      if (q.includes('FROM ad_group_criterion')) {
        return [{ adGroupCriterion: { keyword: { text: 'vulcanizare bucuresti' } } }];
      }
      if (q.includes('FROM ad_group_ad')) {
        return [
          {
            adGroupAd: {
              adStrength: strength,
              actionItems: ['Try including more keywords in your headlines.'],
            },
          },
        ];
      }
      return [];
    });
    const mutate = jest.fn();
    const ai = {
      configured: true,
      // Keeps 12 headlines, rewrites 3 (one of them invalid: "!"), keeps descriptions.
      googleAdsImproveAdStrength: jest.fn().mockResolvedValue({
        headlines: [
          ...H.slice(0, 12),
          'Vulcanizare Bucuresti',
          'Vulcanizare bucuresti rapid',
          'Sună acum!',
        ],
        descriptions: D,
        costEstimateMinor: 2,
      }),
    };
    const settings = {
      googleAdsAgentAutoFillGapsEnabled: jest.fn().mockResolvedValue(true),
      googleAdsAgentCreativeCooldownDays: jest.fn().mockResolvedValue(14),
    };
    const prisma = {
      googleAdsAgentAction: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'a', ...data })),
      },
      googleAdsAgentEvent: { create: jest.fn().mockResolvedValue({ id: 'e' }), update: jest.fn() },
    };
    const svc = new GoogleAdsOptimizerService(
      { writesAllowed: true, customerId: '1', search, mutate } as never,
      ai as never,
      settings as never,
      prisma as never,
      { get: (k: string) => (k === 'pexelsApiKey' ? '' : 'https://totalvizibil.ro') } as never,
    );
    const base = searchCampaign();
    const c = searchCampaign({
      ads: [
        {
          ...base.ads[0],
          headlines: H.map((text) => ({ text })),
          descriptions: D.map((text) => ({ text })),
        },
      ],
    });
    const mapping = {
      categoryId: 'cat',
      category: { id: 'cat', slug: 'vulcanizare', parent: null, nameI18n: { ro: 'Vulcanizare' } },
    };
    const activity = new AgentActivity(prisma as never, 'run');
    return { svc, c, mapping, activity, prisma, mutate, ai };
  }

  it('turns Google action items into approval proposals, never applying anything', async () => {
    const { svc, c, mapping, activity, prisma, mutate, ai } = setup();
    const r = await svc.proposeAdStrengthRewrite(c, svc.platformTarget(mapping as never), activity);
    expect(mutate).not.toHaveBeenCalled();
    expect(ai.googleAdsImproveAdStrength).toHaveBeenCalledWith(
      expect.objectContaining({
        keywords: ['vulcanizare bucuresti'],
        googleActionItems: ['Try including more keywords in your headlines.'],
      }),
    );
    // Two valid new headlines ("!" rejected) replace two removed ones.
    expect(r.proposed).toBe(2);
    const rows = prisma.googleAdsAgentAction.create.mock.calls.map((x: any) => x[0].data);
    expect(rows.every((d: any) => d.status === 'pending_approval')).toBe(true);
    expect(rows.every((d: any) => d.action === 'creative.replace_text')).toBe(true);
    expect(rows.map((d: any) => d.before.text)).toEqual(['Titlu numărul 13', 'Titlu numărul 14']);
    expect(rows.map((d: any) => d.after.text)).toEqual([
      'Vulcanizare Bucuresti',
      'Vulcanizare bucuresti rapid',
    ]);
  });

  it('does nothing when Google already rates the ad GOOD', async () => {
    const { svc, c, mapping, activity, prisma } = setup('GOOD');
    c.ads[0].adStrength = 'GOOD';
    const r = await svc.proposeAdStrengthRewrite(c, svc.platformTarget(mapping as never), activity);
    expect(r.proposed).toBe(0);
    expect(prisma.googleAdsAgentAction.create).not.toHaveBeenCalled();
  });

  it('waits while an ad-text proposal is open or the cooldown runs', async () => {
    const { svc, c, mapping, activity, prisma, ai } = setup();
    prisma.googleAdsAgentAction.count.mockResolvedValue(1);
    const r = await svc.proposeAdStrengthRewrite(c, svc.platformTarget(mapping as never), activity);
    expect(r.proposed).toBe(0);
    expect(ai.googleAdsImproveAdStrength).not.toHaveBeenCalled();
  });
});

describe('GoogleAdsOptimizerService.fillGaps — images (Pexels)', () => {
  const photo = (id: number, width = 4000, height = 3000) => ({
    id,
    width,
    height,
    url: `https://www.pexels.com/photo/${id}/`,
    photographer: 'P',
    photographerUrl: '',
    avgColor: '',
    alt: `Tire service ${id}`,
    src: { original: `https://images.pexels.com/photos/${id}/x.jpeg` },
  });
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function setup(previousIds: number[] = []) {
    const mutate = jest.fn();
    let linked: string[] = [];
    mutate.mockImplementation(async (ops: any[], o?: { validateOnly?: boolean }) => {
      if (o?.validateOnly) return [];
      // Google answers each op; attach ops get a campaignAsset resource name.
      const res = ops.map((x, i) =>
        x.campaignAssetOperation
          ? {
              campaignAssetResult: { resourceName: `customers/1/campaignAssets/111~${i}~AD_IMAGE` },
            }
          : { assetResult: { resourceName: `customers/1/assets/${i}` } },
      );
      linked = res.map((r: any) => r.campaignAssetResult?.resourceName).filter(Boolean) as string[];
      return res;
    });
    const search = jest.fn(async (q: string) =>
      q.includes("field_type = 'AD_IMAGE'")
        ? linked.map((resourceName) => ({ campaignAsset: { resourceName } }))
        : [],
    );
    const prisma = {
      googleAdsAgentAction: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest
          .fn()
          .mockResolvedValue(
            previousIds.length
              ? [{ after: { added: { images: previousIds.map((pexelsId) => ({ pexelsId })) } } }]
              : [],
          ),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'a', ...data })),
      },
      googleAdsCampaignSnapshot: { update: jest.fn().mockResolvedValue({}) },
      googleAdsAgentEvent: { create: jest.fn().mockResolvedValue({ id: 'e' }), update: jest.fn() },
      category: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new GoogleAdsOptimizerService(
      { writesAllowed: true, customerId: '1', mutate, search } as never,
      { configured: true } as never,
      {
        googleAdsAgentAutoFillGapsEnabled: jest.fn().mockResolvedValue(true),
        googleAdsAgentCreativeCooldownDays: jest.fn().mockResolvedValue(14),
      } as never,
      prisma as never,
      { get: (k: string) => (k === 'pexelsApiKey' ? 'key' : 'https://totalvizibil.ro') } as never,
    );
    const pexelsSearch = jest.fn(async (_q: string, o: { orientation: string }) => ({
      photos:
        o.orientation === 'square'
          ? [photo(1), photo(2, 800, 800), photo(3), photo(4)]
          : [photo(1), photo(5), photo(6)],
      rateLimit: {},
      errored: false,
    }));
    (svc as any).pexels = { configured: true, search: pexelsSearch };
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })) as never;
    // Complete text + extensions so only images are missing.
    const c = searchCampaign({
      ads: [
        {
          ...searchCampaign().ads[0],
          headlines: Array.from({ length: 15 }, (_, i) => ({ text: `Titlu numărul ${i + 1}` })),
          descriptions: Array.from({ length: 4 }, (_, i) => ({ text: `Descriere ${i + 1}` })),
        },
      ],
      assets: [
        ...[1, 2, 3, 4, 5, 6].map(sitelink),
        ...[1, 2, 3, 4].map((n) => ({
          level: 'campaign' as const,
          fieldType: 'CALLOUT',
          primaryStatusReasons: [],
          text: `C${n}`,
        })),
        { level: 'campaign' as const, fieldType: 'STRUCTURED_SNIPPET', primaryStatusReasons: [] },
        {
          level: 'campaign' as const,
          fieldType: 'BUSINESS_NAME',
          primaryStatusReasons: [],
          text: 'Totalvizibil',
        },
      ],
    });
    const ev = evaluateCampaign(c, ctx);
    const mapping = {
      categoryId: 'cat',
      category: {
        id: 'cat',
        slug: 'vulcanizare',
        parent: null,
        nameI18n: { ro: 'Vulcanizare', en: 'Tire & wheel service' },
      },
    };
    const activity = new AgentActivity(prisma as never, 'run');
    return { svc, c, ev, mapping, activity, mutate, prisma, pexelsSearch };
  }

  it('adds 2 landscape + 2 square Pexels photos cropped to Google sizes, skipping reused/small ones', async () => {
    const { svc, c, ev, mapping, activity, mutate, prisma, pexelsSearch } = setup([1]);
    expect(ev.issues.find((i) => i.code === 'images_missing')?.autoFixable).toBe(true);
    const r = await svc.fillGaps(c, ev, svc.platformTarget(mapping as never), activity);
    expect(r.applied).toBe(1);
    expect(pexelsSearch).toHaveBeenCalledWith('Tire   wheel service', expect.anything());
    const urls = (global.fetch as jest.Mock).mock.calls.map((x) => x[0]);
    expect(urls).toEqual([
      'https://images.pexels.com/photos/5/x.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=1200&h=628',
      'https://images.pexels.com/photos/6/x.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=1200&h=628',
      'https://images.pexels.com/photos/3/x.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=1200&h=1200',
      'https://images.pexels.com/photos/4/x.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=1200&h=1200',
    ]);
    const ops = mutate.mock.calls[1][0];
    expect(
      ops.filter((o: any) => o.campaignAssetOperation?.create.fieldType === 'AD_IMAGE'),
    ).toHaveLength(4);
    expect(prisma.googleAdsAgentAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'creative.images_gap_fill',
          status: 'applied',
          verifiedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('does nothing when Pexels is not configured', async () => {
    const { svc, c, ev, mapping, activity, mutate } = setup();
    (svc as any).pexels = { configured: false };
    const r = await svc.fillGaps(c, ev, svc.platformTarget(mapping as never), activity);
    expect(r.applied).toBe(0);
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('headline keyword coverage', () => {
  it('counts a keyword only when the whole phrase is in one headline (diacritics ignored)', () => {
    const cov = kw.keywordCoverage(
      ['Vulcanizare București Rapid', 'Schimb anvelope azi'],
      ['vulcanizare bucuresti', 'echilibrare roti', '"schimb anvelope"', 'vulcanizare bucuresti'],
      ['Try including more keywords in your headlines.'],
    );
    expect(cov.keywords).toEqual(['vulcanizare bucuresti', 'echilibrare roti', 'schimb anvelope']);
    expect(cov.covered).toEqual(['vulcanizare bucuresti', 'schimb anvelope']);
    expect(cov.missing).toEqual(['echilibrare roti']);
    expect(cov.googleFlagged).toBe(true);
  });

  it('flags Ad Strength impact only below EXCELLENT', () => {
    const cov = kw.keywordCoverage(['Titlu'], ['vulcanizare'], []);
    expect(kw.keywordsHurtAdStrength('AVERAGE', cov)).toBe(true);
    expect(kw.keywordsHurtAdStrength('EXCELLENT', cov)).toBe(false);
    expect(kw.keywordsHurtAdStrength('PENDING', cov)).toBe(false);
  });

  it('evaluator reports the missing keywords as an auto-fixable headline issue', () => {
    const c = searchCampaign();
    c.ads[0].keywords = ['vulcanizare bucuresti', 'echilibrare roti'];
    c.ads[0].actionItems = ['Try including more keywords in your headlines.'];
    const ev = evaluateCampaign(c, ctx);
    const issue = ev.issues.find((i) => i.code === 'headlines_missing_keywords');
    expect(issue).toBeDefined();
    expect(issue!.priority).toBe('high');
    expect(issue!.autoFixable).toBe(true);
    expect(ev.assets.headlineKeywords?.missing).toEqual([
      'vulcanizare bucuresti',
      'echilibrare roti',
    ]);
  });
});

describe('GoogleAdsOptimizerService.fixHeadlineKeywords', () => {
  function setup(headlineCount: number, aiHeadlines: string[]) {
    const H = Array.from({ length: headlineCount }, (_, i) => `Titlu numărul ${i + 1}`);
    let live = H.map((text) => ({ text }));
    const mutate = jest.fn(async (ops: any[], opts?: { validateOnly?: boolean }) => {
      if (!opts?.validateOnly) live = ops[0].adOperation.update.responsiveSearchAd.headlines;
      return [];
    });
    const search = jest.fn(async () => [
      { adGroupAd: { ad: { responsiveSearchAd: { headlines: live } } } },
    ]);
    const ai = {
      configured: true,
      googleAdsKeywordHeadlines: jest
        .fn()
        .mockResolvedValue({ headlines: aiHeadlines, costEstimateMinor: 1 }),
    };
    const settings = {
      googleAdsAgentAutoFillGapsEnabled: jest.fn().mockResolvedValue(true),
      googleAdsAgentCreativeCooldownDays: jest.fn().mockResolvedValue(14),
    };
    const prisma = {
      googleAdsAgentAction: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'a1', ...data })),
      },
      googleAdsAgentEvent: { create: jest.fn().mockResolvedValue({ id: 'e' }), update: jest.fn() },
    };
    const svc = new GoogleAdsOptimizerService(
      { writesAllowed: true, customerId: '1', search, mutate } as never,
      ai as never,
      settings as never,
      prisma as never,
      { get: (k: string) => (k === 'pexelsApiKey' ? '' : 'https://totalvizibil.ro') } as never,
    );
    jest.spyOn(svc, 'scheduleKeywordReadback').mockImplementation(() => undefined);
    const base = searchCampaign();
    const c = searchCampaign({
      ads: [
        {
          ...base.ads[0],
          headlines: H.map((text, i) => ({
            text,
            ...(i === 0 ? { performanceLabel: 'BEST' } : {}),
          })),
          keywords: ['vulcanizare bucuresti', 'echilibrare roti'],
          actionItems: ['Try including more keywords in your headlines.'],
        },
      ],
    });
    const mapping = {
      categoryId: 'cat',
      category: { id: 'cat', slug: 'vulcanizare', parent: null, nameI18n: { ro: 'Vulcanizare' } },
    };
    const activity = new AgentActivity(prisma as never, 'run');
    return { svc, c, mapping, activity, prisma, mutate, ai, live: () => live };
  }

  it('adds keyword headlines when the ad has room, keeping existing ones', async () => {
    const t = setup(10, ['Vulcanizare Bucuresti Rapid', 'Echilibrare Roti pe Loc', 'Sună acum!']);
    const r = await t.svc.fixHeadlineKeywords(t.c, t.svc.platformTarget(t.mapping as never), t.activity);
    expect(r.applied).toBe(1);
    expect(t.live().map((h: any) => h.text)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `Titlu numărul ${i + 1}`),
      'Vulcanizare Bucuresti Rapid',
      'Echilibrare Roti pe Loc',
    ]);
    const row = t.prisma.googleAdsAgentAction.create.mock.calls[0][0].data;
    expect(row.action).toBe('creative.keyword_headlines');
    expect(row.status).toBe('applied');
    expect(row.after.missingKeywords).toEqual(['vulcanizare bucuresti', 'echilibrare roti']);
    expect(t.svc.scheduleKeywordReadback).toHaveBeenCalled();
  });

  it('in a full ad rewrites only keyword-less, non-BEST headlines', async () => {
    const t = setup(15, ['Vulcanizare Bucuresti Rapid', 'Echilibrare Roti pe Loc']);
    const r = await t.svc.fixHeadlineKeywords(t.c, t.svc.platformTarget(t.mapping as never), t.activity);
    expect(r.applied).toBe(1);
    const texts = t.live().map((h: any) => h.text);
    expect(texts).toHaveLength(15);
    expect(texts[0]).toBe('Titlu numărul 1'); // BEST stays
    expect(texts).toContain('Vulcanizare Bucuresti Rapid');
    expect(texts).toContain('Echilibrare Roti pe Loc');
  });

  it('rejects AI headlines that do not really contain a missing keyword', async () => {
    const t = setup(10, ['Service auto rapid', 'Cel mai bun preț']);
    const r = await t.svc.fixHeadlineKeywords(t.c, t.svc.platformTarget(t.mapping as never), t.activity);
    expect(r.applied).toBe(0);
    expect(t.mutate).not.toHaveBeenCalled();
  });

  it('does nothing when every keyword is already in the headlines', async () => {
    const t = setup(10, []);
    t.c.ads[0].keywords = ['titlu numarul 1'];
    const r = await t.svc.fixHeadlineKeywords(t.c, t.svc.platformTarget(t.mapping as never), t.activity);
    expect(r.applied).toBe(0);
    expect(t.ai.googleAdsKeywordHeadlines).not.toHaveBeenCalled();
  });
});
