import { DEFAULT_PRICING, priceWork, validatePricing } from 'src/google-ads-user/pricing';
import { performedWork } from 'src/google-ads-user/work-plan';
import { extractSiteLinks } from 'src/google-ads-user/site-pages';
import { TokenCrypto } from 'src/google-ads-user/token-crypto';
import { readSettings } from 'src/google-ads-user/agent-settings';
import { GoogleAdsUserAgentService } from 'src/google-ads-user/google-ads-user-agent.service';
import { GoogleAdsUserService } from 'src/google-ads-user/google-ads-user.service';

describe('optimizer pricing', () => {
  it('never charges less than the admin minimum', () => {
    const p = priceWork(DEFAULT_PRICING, { analysis: 1 }, 10);
    expect(p.points).toBe(2.2);
    expect(p.credits).toBe(10);
    expect(p.minor).toBe(1000);
  });

  it('grows with the work and applies the complexity level multiplier', () => {
    const small = priceWork(DEFAULT_PRICING, { analysis: 1, rsa_text: 10 }, 50);
    const big = priceWork(
      DEFAULT_PRICING,
      {
        analysis: 1,
        rsa_text: 10,
        extensions: 13,
        keyword_headlines: 4,
        text_rewrite: 6,
        budget_proposal: 1,
      },
      50,
    );
    // 2 + 5 + 1 (elements) = 8 points -> standard (x1.15)
    expect(small.level.key).toBe('standard');
    expect(small.credits).toBe(10); // 9.2 below the minimum
    // 2 + 5 + 5.2 + 3 + 6 + 2 + 1 = 24.2 points -> complex (x1.3) = 31.46
    expect(big.level.key).toBe('complex');
    expect(big.credits).toBe(31.46);
    expect(big.lines.map((l) => l.task)).toContain('budget_proposal');
  });

  it('caps at the admin maximum', () => {
    const p = priceWork({ ...DEFAULT_PRICING, maxCredits: 20 }, { text_rewrite: 100 }, 0);
    expect(p.credits).toBe(20);
  });

  it('validates admin input and requires a level starting at 0', () => {
    expect(validatePricing({ ...DEFAULT_PRICING, minCredits: 0 }).error).toBeTruthy();
    expect(
      validatePricing({
        ...DEFAULT_PRICING,
        levels: [{ key: 'a', label: 'A', minPoints: 5, multiplier: 1 }],
      }).error,
    ).toMatch(/0 puncte/);
    expect(validatePricing(DEFAULT_PRICING).value).toEqual(DEFAULT_PRICING);
  });
});

describe('performed work (settlement)', () => {
  it('counts only applied changes and every proposal', () => {
    const u = performedWork(
      [
        {
          action: 'creative.rsa_gap_fill',
          status: 'applied',
          after: { added: { headlines: ['a', 'b'], descriptions: ['c'] } },
        },
        {
          action: 'creative.assets_gap_fill',
          status: 'failed',
          after: { added: { sitelinks: [1, 2], callouts: ['x'] } },
        },
        {
          action: 'creative.keyword_headlines',
          status: 'applied',
          after: { added: [], replaced: [{}, {}] },
        },
        { action: 'creative.replace_text', status: 'pending_approval', after: { text: 'x' } },
        { action: 'budget.change.proposed', status: 'pending_approval', after: {} },
      ],
      true,
    );
    expect(u).toEqual({
      analysis: 1,
      rsa_text: 3,
      keyword_headlines: 2,
      text_rewrite: 1,
      budget_proposal: 1,
    });
  });
});

describe('site pages for sitelinks', () => {
  it('keeps distinct same-site pages with readable text, skips assets and other hosts', () => {
    const html = `
      <a href="/servicii">Servicii</a>
      <a href="/servicii/">Servicii again</a>
      <a href="https://www.example.ro/contact#form">Contact</a>
      <a href="https://other.ro/x">Other</a>
      <a href="/poza.jpg">Poza</a>
      <a href="mailto:a@b.ro">Mail</a>
      <a href="/despre"><span>Despre&nbsp;noi</span></a>`;
    const links = extractSiteLinks(html, 'https://example.ro/');
    expect(links).toEqual([
      { url: 'https://example.ro/servicii', pageName: 'Servicii' },
      { url: 'https://www.example.ro/contact', pageName: 'Contact' },
      { url: 'https://example.ro/despre', pageName: 'Despre noi' },
    ]);
  });
});

describe('token encryption', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  it('round-trips and refuses tampering', () => {
    const c = new TokenCrypto(key);
    const enc = c.encrypt('1//refresh-token');
    expect(enc).not.toContain('refresh');
    expect(c.decrypt(enc)).toBe('1//refresh-token');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => c.decrypt(parts.join('.'))).toThrow();
  });
  it('is disabled without a valid 32-byte key', () => {
    expect(new TokenCrypto('').configured).toBe(false);
    expect(new TokenCrypto('short').configured).toBe(false);
  });
});

describe('agent settings', () => {
  it('clamps and defaults owner input', () => {
    const s = readSettings({
      creativeCooldownDays: 999,
      schedule: 'hourly',
      businessName: 'x'.repeat(40),
    });
    expect(s.creativeCooldownDays).toBe(60);
    expect(s.schedule).toBe('manual');
    expect(s.businessName).toHaveLength(25);
  });
});

describe('cycle settlement (billing)', () => {
  function setup(cycle: Record<string, unknown>) {
    const updates: Record<string, unknown>[] = [];
    const captured: { id: string; final: number }[] = [];
    const tx = {
      googleAdsOptimizationCycle: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => updates.push(data)),
      },
      googleAdsUserCampaign: {
        findUnique: jest.fn(async () => ({ settings: {} })),
        update: jest.fn(),
      },
    };
    const prisma = {
      googleAdsOptimizationCycle: { findUnique: jest.fn(async () => cycle) },
      googleAdsAgentEvent: { count: jest.fn(async () => 2) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const wallet = {
      captureHold: jest.fn(async (_tx: unknown, id: string, final: number) => {
        captured.push({ id, final });
        return { capturedMinor: final, releasedMinor: 0 };
      }),
    };
    const settings = { googleAdsOptimizerPricing: jest.fn(async () => DEFAULT_PRICING) };
    const svc = new GoogleAdsUserAgentService(
      prisma as never,
      {} as never,
      wallet as never,
      settings as never,
      {} as never,
      { get: () => 'claude-sonnet-5' } as never,
      { notify: jest.fn() } as never,
      { maybeReward: jest.fn().mockResolvedValue(undefined) } as never,
    );
    return { svc, updates, captured };
  }

  it('captures only the performed work (at least the minimum) and returns the rest', async () => {
    const { svc, updates, captured } = setup({
      id: 'c1',
      status: 'running',
      userId: 'u1',
      userCampaignId: 'uc1',
      quotedMinor: 3_000,
      chargeTxnId: 't1',
      elementsAnalyzed: 20,
      actions: [{ action: 'creative.replace_text', status: 'pending_approval', after: {} }],
    });
    await svc.settle('c1', { error: null, ai: { costMinor: 3 }, scoreAfter: 80 });
    expect(captured).toEqual([{ id: 't1', final: 1_000 }]);
    expect(updates[0]).toMatchObject({
      chargedMinor: 1_000,
      refundedMinor: 2_000,
      aiCostMinor: 3,
      aiCallCount: 2,
      tasksProposed: 1,
    });
  });

  it('refunds everything when the cycle failed before doing any work', async () => {
    const { svc, updates, captured } = setup({
      id: 'c2',
      status: 'running',
      userId: 'u1',
      userCampaignId: 'uc1',
      quotedMinor: 1_500,
      chargeTxnId: 't2',
      elementsAnalyzed: 20,
      actions: [],
    });
    await svc.settle('c2', { error: 'Google error', ai: { costMinor: 0 }, scoreAfter: null });
    expect(captured).toEqual([{ id: 't2', final: 0 }]);
    expect(updates[0]).toMatchObject({
      chargedMinor: 0,
      refundedMinor: 1_500,
      errorMessage: 'Google error',
    });
  });

  it('never settles a cycle twice', async () => {
    const { svc, captured } = setup({ id: 'c3', status: 'completed', actions: [] });
    await svc.settle('c3', { error: null, ai: { costMinor: 0 }, scoreAfter: null });
    expect(captured).toEqual([]);
  });
});

describe('connected Google accounts', () => {
  function setup(ownerId: string) {
    const conn = {
      id: 'conn1',
      userId: ownerId,
      status: 'connected',
      refreshTokenEnc: 'enc',
      selections: null,
    };
    const client = {
      search: jest.fn(async (q: string) =>
        q.includes('segments.date')
          ? []
          : [
              {
                campaign: {
                  id: '1',
                  name: 'A',
                  status: 'ENABLED',
                  advertisingChannelType: 'SEARCH',
                },
              },
              {
                campaign: {
                  id: '2',
                  name: 'B',
                  status: 'ENABLED',
                  advertisingChannelType: 'SEARCH',
                },
              },
            ],
      ),
    };
    const prisma = {
      googleAdsConnection: { findUnique: jest.fn(async () => conn) },
      googleAdsUserCampaign: {
        findMany: jest.fn(async () => [{ googleCampaignId: '2', status: 'active' }]),
      },
    };
    const oauth = { adsClient: jest.fn(async () => client) };
    const svc = new GoogleAdsUserService(
      prisma as never,
      oauth as never,
      {} as never,
      {} as never,
      {} as never,
      { log: jest.fn() } as never,
      { get: () => 'https://x.ro' } as never,
    );
    return { svc };
  }

  it("never exposes another user's connection", async () => {
    const { svc } = setup('owner');
    await expect(svc.connectionAccounts('intruder', 'conn1')).rejects.toThrow();
    await expect(svc.disconnectConnection('intruder', 'conn1')).rejects.toThrow();
  });

  it("flags the campaigns already in the owner's panel", async () => {
    const { svc } = setup('owner');
    const list = await svc.connectionCampaigns('owner', 'conn1', '1234567890', null);
    expect(list.map((c: { id: string; managed: boolean }) => [c.id, c.managed])).toEqual([
      ['1', false],
      ['2', true],
    ]);
  });
});
