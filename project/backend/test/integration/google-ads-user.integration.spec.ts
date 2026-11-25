import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AiService } from 'src/ai/ai.service';
import { GoogleAdsChatService } from 'src/google-ads-user/google-ads-chat.service';
import { GoogleAdsUserService } from '../../src/google-ads-user/google-ads-user.service';
import { GoogleAdsUserAgentService } from '../../src/google-ads-user/google-ads-user-agent.service';
import { GoogleAdsOAuthService } from 'src/google-ads-user/google-ads-oauth.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { createAndLoginUser, TestUser } from './helpers/auth';
import { resetDb } from './helpers/db';

/**
 * Customers' Google Ads agent, end to end over HTTP on a real database and
 * wallet. Only the two outside worlds are faked: Google Ads (an in-memory
 * account) and Claude (scripted answers). Nothing here can reach a real
 * Google Ads account.
 */

let landing = '';
jest.mock('src/google-ads-user/site-pages', () => ({
  ...jest.requireActual('src/google-ads-user/site-pages'),
  landingText: async () => landing,
  checkUrls: async () => new Map(),
  responds: async () => true,
  discoverSitePages: async () => [],
}));

class FakeGoogle {
  readonly customerId = '1234567890';
  writesAllowed = true;
  status = 'ENABLED';
  budget = 20_000_000;
  hasAd = true;
  keywords = ['instalator cluj', 'reparatii instalatii', 'instalator urgent', 'centrale', 'tevi'];
  headlines = ['Instalator Cluj', 'Reparatii rapide', 'Suna acum'];
  descriptions = ['Interventii in aceeasi zi.', 'Echipa cu experienta.'];
  validated: unknown[][] = [];
  applied: unknown[][] = [];
  validateError: Error | null = null;

  search = async (q: string): Promise<Record<string, unknown>[]> => {
    const from = /FROM (\w+)/.exec(q)?.[1];
    const campaign = {
      id: '77',
      resourceName: 'customers/1234567890/campaigns/77',
      name: 'Instalatii',
      status: this.status,
      advertisingChannelType: 'SEARCH',
      campaignBudget: 'customers/1234567890/campaignBudgets/5',
    };
    switch (from) {
      case 'campaign':
        return [
          {
            campaign,
            campaignBudget: { amountMicros: String(this.budget), explicitlyShared: false },
            customer: { currencyCode: 'RON' },
            metrics: { impressions: '500', clicks: '20', costMicros: '1000000' },
          },
        ];
      case 'ad_group':
        return [
          { adGroup: { resourceName: 'customers/1234567890/adGroups/9', status: 'ENABLED' } },
        ];
      case 'ad_group_ad':
        return this.hasAd
          ? [
              {
                campaign: { id: '77' },
                adGroupAd: {
                  resourceName: 'customers/1234567890/adGroupAds/9~3',
                  status: 'ENABLED',
                  adStrength: 'AVERAGE',
                  ad: {
                    resourceName: 'customers/1234567890/ads/3',
                    type: 'RESPONSIVE_SEARCH_AD',
                    finalUrls: ['https://instal.example/'],
                    responsiveSearchAd: {
                      headlines: this.headlines.map((text) => ({ text })),
                      descriptions: this.descriptions.map((text) => ({ text })),
                    },
                  },
                },
              },
            ]
          : [];
      case 'ad_group_criterion':
        return this.keywords.map((text, i) => ({
          campaign: { id: '77' },
          adGroup: { id: '9' },
          adGroupCriterion: {
            resourceName: `customers/1234567890/adGroupCriteria/9~${i}`,
            status: 'ENABLED',
            keyword: { text, matchType: 'PHRASE' },
          },
        }));
      default:
        return [];
    }
  };

  mutate = async (ops: Record<string, any>[], opts: { validateOnly?: boolean } = {}) => {
    if (opts.validateOnly) {
      if (this.validateError) throw this.validateError;
      this.validated.push(ops);
      return [];
    }
    this.applied.push(ops);
    for (const o of ops) {
      const ad = o.adOperation?.update?.responsiveSearchAd;
      if (ad?.headlines) this.headlines = ad.headlines.map((h: { text: string }) => h.text);
      if (ad?.descriptions)
        this.descriptions = ad.descriptions.map((h: { text: string }) => h.text);
      if (o.adGroupCriterionOperation?.create)
        this.keywords.push(o.adGroupCriterionOperation.create.keyword.text);
      if (o.campaignBudgetOperation?.update)
        this.budget = Number(o.campaignBudgetOperation.update.amountMicros);
      if (o.campaignOperation?.update) this.status = o.campaignOperation.update.status;
    }
    return [];
  };
}

type Reply = { text?: string; tools?: [string, unknown][]; stop?: string } | null;
const message = (r: NonNullable<Reply>) => ({
  content: [
    ...(r.text ? [{ type: 'text', text: r.text }] : []),
    ...(r.tools ?? []).map(([name, input], i) => ({ type: 'tool_use', id: `t${i}`, name, input })),
  ],
  stop_reason: r.stop ?? (r.tools ? 'tool_use' : 'end_turn'),
  usage: { input_tokens: 5000, output_tokens: 1000 },
});

let app: INestApplication;
let prisma: PrismaService;
let google: FakeGoogle;
let script: (Reply | Promise<Reply>)[];
let aiCalls: any[];
let user: TestUser;
let campaignId: string;

const http = () => request(app.getHttpServer());
const url = (p = '') => `/api/v1/google-ads-user/campaigns/${campaignId}${p}`;
const post = (p: string, body: object = {}) =>
  http().post(url(p)).set('Cookie', user.cookie).send(body);
const get = (p = '') => http().get(url(p)).set('Cookie', user.cookie);
const say = (text = 'salut', key: string = randomUUID()) =>
  post('/chat', { text, idempotencyKey: key, locale: 'ro' });

async function credits(n: number) {
  await prisma.wallet.upsert({
    where: { userId: user.id },
    create: { userId: user.id, balanceMinor: n * 100 },
    update: { balanceMinor: n * 100 },
  });
}
const balance = async () =>
  (await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).balanceMinor;

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timeout');
}
const settled = (id: string) =>
  waitFor(async () => {
    const t = await prisma.googleAdsChatTurn.findUnique({
      where: { id },
      include: { actions: true },
    });
    return t && t.status !== 'running' ? t : null;
  });
async function chat(text?: string) {
  const res = await say(text).expect(201);
  return settled(res.body.turnId);
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  const ai = app.get(AiService);
  Object.defineProperty(ai, 'configured', { get: () => true, configurable: true });
  jest.spyOn(ai, 'agentMessage').mockImplementation(async (p) => {
    aiCalls.push(structuredClone(p));
    const r = await script.shift();
    return r ? (message(r) as never) : null;
  });
  jest
    .spyOn(app.get(GoogleAdsOAuthService), 'adsClient')
    .mockImplementation(async () => google as never);
});

beforeEach(async () => {
  await resetDb(prisma, app);
  google = new FakeGoogle();
  script = [];
  aiCalls = [];
  landing = 'Instalatii sanitare si termice in Cluj. '.repeat(20);
  user = await createAndLoginUser(app, prisma, {
    email: 'ion@example.com',
    password: 'password123',
    name: 'Ion',
  });
  const conn = await prisma.googleAdsConnection.create({
    data: { userId: user.id, status: 'connected', refreshTokenEnc: 'x' },
  });
  const row = await prisma.googleAdsUserCampaign.create({
    data: {
      userId: user.id,
      connectionId: conn.id,
      customerId: '1234567890',
      googleCampaignId: '77',
      name: 'Instalatii',
    },
  });
  campaignId = row.id;
  await credits(50);
});

afterAll(async () => app.close());

describe('agent chat: access', () => {
  it('needs the signed-in owner', async () => {
    await http().get(url('/chat')).expect(401);
    const other = await createAndLoginUser(app, prisma, {
      email: 'alt@example.com',
      password: 'password123',
      name: 'Alt',
    });
    await http().get(url('/chat')).set('Cookie', other.cookie).expect(404);
    await http()
      .post(url('/chat'))
      .set('Cookie', other.cookie)
      .send({ text: 'x', idempotencyKey: randomUUID() })
      .expect(404);
    await http().patch(url('/brief')).set('Cookie', other.cookie).send({ goal: 'x' }).expect(404);
  });

  it('rejects empty, oversized and keyless messages before charging', async () => {
    await say('   ').expect(400);
    await say('a'.repeat(2001)).expect(400);
    await post('/chat', { text: 'x' }).expect(400);
    expect(await balance()).toBe(5000);
  });
});

describe('agent chat: billing', () => {
  it('holds the ceiling, then captures base + AI cost × markup', async () => {
    let answer!: (r: Reply) => void;
    script = [new Promise<Reply>((r) => (answer = r))];
    const res = await say().expect(201);
    expect(await balance()).toBe(4500); // 5 credits held
    answer({ text: 'Salut!' });
    const t = await settled(res.body.turnId);
    // 5000 in × $2/M + 1000 out × $10/M = $0.02; × 4 = 0.08; + 0.10 base = 0.18 → min 0.20
    expect(t).toMatchObject({ status: 'completed', chargedMinor: 20, assistantText: 'Salut!' });
    expect(t.aiCostUsd).toBeCloseTo(0.02);
    expect(await balance()).toBe(4980);
    const txn = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: t.chargeTxnId! } });
    expect(txn).toMatchObject({
      status: 'completed',
      amountMinor: -20,
      provider: 'google-ads-optimizer',
      description: 'Google Ads agent chat',
    });
    // Counted in the customer's own spend category, apart from cycles.
    expect(await prisma.googleAdsOptimizationCycle.count()).toBe(0);
  });

  it('costs nothing when the AI does not answer', async () => {
    script = [null];
    const t = await chat();
    expect(t).toMatchObject({ status: 'failed', chargedMinor: 0, errorCode: 'ai_error' });
    expect(await balance()).toBe(5000);
  });

  it('costs nothing when Google cannot be read', async () => {
    google.search = async () => {
      throw new Error('boom');
    };
    const t = await chat();
    expect(t).toMatchObject({ status: 'failed', chargedMinor: 0, errorCode: 'google_error' });
    expect(aiCalls).toHaveLength(0);
    expect(await balance()).toBe(5000);
  });

  it('never runs a truncated tool call and does not charge for it', async () => {
    script = [{ tools: [['propose_status', { status: 'PAUSED' }]], stop: 'max_tokens' }];
    const t = await chat();
    expect(t).toMatchObject({ status: 'failed', chargedMinor: 0 });
    expect(t.actions).toHaveLength(0);
  });

  it('refuses without credits, without calling the AI', async () => {
    await credits(0.1);
    const r = await say().expect(400);
    expect(r.body.message).toBe('insufficient_credits');
    expect(aiCalls).toHaveLength(0);
  });

  it('with a small balance never charges more than the balance', async () => {
    await credits(0.25);
    script = [
      { tools: [['propose_ad_texts', { headlines: { add: ['A unu', 'B doi'] }, reason: 'x' }]] },
      { text: 'gata' },
    ];
    const t = await chat();
    expect(t.heldMinor).toBe(25);
    expect(t.chargedMinor).toBe(25);
    expect(await balance()).toBe(0);
    // The reservation was used up after the first call: no second one.
    expect(aiCalls).toHaveLength(1);
  });

  it('enforces the owner daily limit', async () => {
    await prisma.googleAdsUserCampaign.update({
      where: { id: campaignId },
      data: { settings: { chatDailyLimitCredits: 0.3 } },
    });
    script = [{ text: 'a' }];
    expect((await chat()).heldMinor).toBe(30);
    const r = await say().expect(400); // 0.10 left, the minimum is 0.20
    expect(r.body.message).toBe('chat_daily_limit');
  });

  it('one message at a time: parallel sends charge once', async () => {
    let answer!: (r: Reply) => void;
    script = [new Promise<Reply>((r) => (answer = r))];
    const all = await Promise.all([say('a'), say('b'), say('c')]);
    expect(all.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await balance()).toBe(4500);
    answer({ text: 'ok' });
    await settled(all.find((r) => r.status === 201)!.body.turnId);
    expect(await balance()).toBe(4980);
  });

  it('a retried request with the same key is one message', async () => {
    script = [{ text: 'ok' }, { text: 'never' }];
    const key = randomUUID();
    const a = await say('a', key).expect(201);
    await settled(a.body.turnId);
    const b = await say('a', key).expect(201);
    expect(b.body.turnId).toBe(a.body.turnId);
    expect(aiCalls).toHaveLength(1);
    expect(await balance()).toBe(4980);
  });

  it('returns the hold of a message interrupted by a restart', async () => {
    script = [new Promise<Reply>(() => undefined)];
    const res = await say().expect(201);
    const svc = app.get(GoogleAdsChatService);
    (svc as unknown as { running: Set<string> }).running.clear();
    await svc.settleStale(); // too recent
    expect(await balance()).toBe(4500);
    await prisma.googleAdsChatTurn.update({
      where: { id: res.body.turnId },
      data: { createdAt: new Date(Date.now() - 3_600_000) },
    });
    await svc.settleStale();
    await svc.settleStale(); // only once
    expect(await balance()).toBe(5000);
    expect(await settled(res.body.turnId)).toMatchObject({
      status: 'failed',
      errorCode: 'interrupted',
    });
  });

  it('after a restart, interrupted work is settled at once and keeps its AI cost', async () => {
    // One answer arrived (and was paid for) before the process died.
    script = [
      { tools: [['save_business_facts', { services: 'x' }]] },
      new Promise<Reply>(() => undefined),
    ];
    const res = await say().expect(201);
    await waitFor(async () => {
      const t = await prisma.googleAdsChatTurn.findUnique({ where: { id: res.body.turnId } });
      return t && t.aiCallCount > 0;
    });
    const cycle = await prisma.googleAdsOptimizationCycle.create({
      data: {
        userCampaignId: campaignId,
        userId: user.id,
        trigger: 'manual',
        quote: {},
        quotedMinor: 1000,
        aiCostMinor: 7,
        inputTokens: 900,
      },
    });
    const restarted = new Date(Date.now() + 1000);
    for (const svc of [
      app.get(GoogleAdsChatService),
      app.get(GoogleAdsUserAgentService),
    ] as any[]) {
      const before = svc.bootedAt;
      svc.running.clear();
      svc.bootedAt = restarted;
      await (svc.settleStale ? svc.settleStale() : svc.settleStaleCycles());
      svc.bootedAt = before;
    }
    const t = await settled(res.body.turnId);
    expect(t).toMatchObject({ status: 'failed', chargedMinor: 0, aiCallCount: 1 });
    expect(t.aiCostUsd).toBeGreaterThan(0);
    expect(await balance()).toBe(5000);
    expect(
      await prisma.googleAdsOptimizationCycle.findUniqueOrThrow({ where: { id: cycle.id } }),
    ).toMatchObject({ status: 'failed', aiCostMinor: 7, inputTokens: 900 });
  });

  it('starts nothing while shutting down', async () => {
    const svc = app.get(GoogleAdsChatService) as any;
    const agent = app.get(GoogleAdsUserAgentService) as any;
    svc.stopping = agent.stopping = true;
    try {
      expect((await say().expect(503)).body.message).toBe('restarting');
      expect((await post('/cycles').expect(503)).body.message).toBe('restarting');
    } finally {
      svc.stopping = agent.stopping = false;
    }
    expect(await balance()).toBe(5000);
  });

  it('a running message blocks removing the campaign', async () => {
    let answer!: (r: Reply) => void;
    script = [new Promise<Reply>((r) => (answer = r))];
    const res = await say().expect(201);
    const del = await http().delete(url()).set('Cookie', user.cookie).expect(400);
    expect(del.body.message).toBe('chat_running');
    answer({ text: 'ok' });
    await settled(res.body.turnId);
  });

  it('counts chat in the admin usage and AI report, not as cycles', async () => {
    script = [{ text: 'ok' }];
    await chat();
    await prisma.platformRoleAssignment.create({ data: { userId: user.id, role: 'admin' } });
    const usage = await http()
      .get('/api/v1/admin/google-ads-optimizer/usage')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(usage.body.chat).toMatchObject({ messages: 1, chargedMinor: 20, aiCostMinor: 2 });
    expect(usage.body.totals.cycles).toBe(0);
    const bad = await http()
      .patch('/api/v1/admin/google-ads-optimizer/chat-pricing')
      .set('Cookie', user.cookie)
      .send({ minCredits: 5, maxCredits: 1 });
    expect(bad.status).toBe(400);
  });
});

describe('agent chat: asking and remembering', () => {
  it('asks when information is missing and remembers the answer', async () => {
    script = [
      { tools: [['ask_user', { questions: [{ question: 'Ce zone?', options: ['Cluj'] }] }]] },
      { tools: [['save_business_facts', { areas: 'Cluj și Florești', hack: 'x' }]] },
      { text: 'Am notat.' },
    ];
    const t = await chat('Optimizează');
    expect(t.questions).toEqual([{ question: 'Ce zone?', options: ['Cluj'] }]);
    expect(t.chargedMinor).toBe(20);
    await chat('Cluj și Florești');
    const conv = await get('/chat').expect(200);
    expect(conv.body.brief).toEqual({ areas: 'Cluj și Florești' });
    expect(conv.body.readiness.gaps.map((g: { key: string }) => g.key)).not.toContain('areas');
    // The second message carried the first question and answer as history.
    const roles = aiCalls[1].messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user']);
    expect(aiCalls[1].messages[1].content).toContain('Ce zone?');
    expect(conv.body.turns[0]).not.toHaveProperty('aiCostUsd');
  });

  it('the owner edits the facts by hand for free', async () => {
    await http()
      .patch(url('/brief'))
      .set('Cookie', user.cookie)
      .send({ goal: 'Apeluri', other: 1 })
      .expect(200, { goal: 'Apeluri' });
    expect(await balance()).toBe(5000);
  });

  it('a cycle on a campaign without enough information asks first, free', async () => {
    landing = '';
    const q = await get('/quote').expect(200);
    expect(q.body.readiness.level).toBe('insufficient');
    const r = await post('/cycles', { idempotencyKey: randomUUID() }).expect(409);
    expect(r.body.message).toBe('needs_information');
    expect(await balance()).toBe(5000);
    await http()
      .patch(url('/brief'))
      .set('Cookie', user.cookie)
      .send({ services: 'Instalații' })
      .expect(200);
    const q2 = await get('/quote').expect(200);
    expect(q2.body.readiness.level).not.toBe('insufficient');
  });
});

describe('agent chat: changes', () => {
  const texts = {
    headlines: {
      add: ['Instalator non stop'],
      replace: [{ old: 'Suna acum', new: 'Cere o ofertă' }],
    },
    reason: 'Mai clar',
  };

  it('prepares, validates at Google, applies only after approval', async () => {
    script = [{ tools: [['propose_ad_texts', texts]] }, { text: 'Am pregătit.' }];
    const t = await chat();
    expect(google.validated).toHaveLength(1);
    expect(google.applied).toHaveLength(0);
    // 2 calls: $0.04 × 4 = 0.16; 2 texts × 0.30; 0.10 base
    expect(t.chargedMinor).toBe(86);
    const [a] = t.actions;
    expect(a).toMatchObject({ action: 'chat.ad_texts', status: 'pending_approval' });
    const before = await balance();
    const res = await post(`/actions/${a.id}/approve`).expect(201);
    expect(res.body.status).toBe('applied');
    expect(google.headlines).toEqual([
      'Instalator Cluj',
      'Reparatii rapide',
      'Cere o ofertă',
      'Instalator non stop',
    ]);
    await post(`/actions/${a.id}/approve`).expect(400); // never twice
    expect(google.applied).toHaveLength(1);
    expect(await balance()).toBe(before); // approving is free
  });

  it('refuses to apply when the ad changed in the meantime', async () => {
    script = [{ tools: [['propose_ad_texts', texts]] }, { text: 'ok' }];
    const t = await chat();
    google.headlines.push('Schimbat manual');
    const res = await post(`/actions/${t.actions[0].id}/approve`).expect(201);
    expect(res.body.status).toBe('failed');
    expect(google.applied).toHaveLength(0);
  });

  it('a refused change goes back to the agent and is not charged', async () => {
    script = [
      { tools: [['propose_ad_texts', { headlines: { add: ['x'.repeat(31)] }, reason: '' }]] },
      { text: 'Titlul e prea lung.' },
    ];
    const t = await chat();
    expect(t.actions).toHaveLength(0);
    expect(t.chargedMinor).toBe(26);
    const result = aiCalls[1].messages.at(-1).content[0];
    expect(result).toMatchObject({ type: 'tool_result', is_error: true });
    expect(result.content).toContain('peste 30 caractere');
  });

  it('a change Google rejects is never stored', async () => {
    google.validateError = new Error('POLICY');
    script = [{ tools: [['propose_ad_texts', texts]] }, { text: 'Google a refuzat.' }];
    expect((await chat()).actions).toHaveLength(0);
  });

  it('a newer version of the same change replaces the pending one', async () => {
    script = [
      { tools: [['propose_ad_texts', texts]] },
      { text: '1' },
      {
        tools: [['propose_ad_texts', { headlines: { add: ['Alt titlu'] }, reason: 'y' }]],
      },
      { text: '2' },
    ];
    const one = await chat();
    const two = await chat();
    await post(`/actions/${one.actions[0].id}/approve`).expect(400);
    await post(`/actions/${two.actions[0].id}/approve`).expect(201);
    expect(google.headlines).toContain('Alt titlu');
  });

  it('keywords, extensions and status, each verified', async () => {
    script = [
      {
        tools: [
          [
            'propose_keywords',
            {
              add: [
                { text: 'instalator nonstop', match_type: 'PHRASE' },
                { text: 'tevi', match_type: 'PHRASE' },
              ],
              reason: 'x',
            },
          ],
          ['propose_status', { status: 'PAUSED', reason: 'x' }],
          ['propose_extensions', { callouts: ['Garantie'], reason: 'x' }],
          [
            'propose_extensions',
            { sitelinks: [{ text: 'Rău', url: 'https://evil.example/' }], reason: 'x' },
          ],
        ],
      },
      { text: 'ok' },
    ];
    const t = await chat();
    expect(t.actions.map((a) => a.action).sort()).toEqual([
      'chat.extensions',
      'chat.keywords',
      'chat.status',
    ]);
    const kw = t.actions.find((a) => a.action === 'chat.keywords')!;
    expect((kw.after as any).add).toHaveLength(1); // the existing one is skipped
    expect((await post(`/actions/${kw.id}/approve`)).body.status).toBe('applied');
    const st = t.actions.find((a) => a.action === 'chat.status')!;
    expect((await post(`/actions/${st.id}/approve`)).body.status).toBe('applied');
    expect(google.status).toBe('PAUSED');
  });

  it('budget: bounded, approved by the owner', async () => {
    script = [
      { tools: [['propose_budget', { daily_amount: 900, reason: 'x' }]] },
      { tools: [['propose_budget', { daily_amount: 25.5, reason: 'x' }]] },
      { text: 'ok' },
    ];
    const t = await chat('mărește bugetul');
    expect(t.actions).toHaveLength(1);
    const res = await post(`/actions/${t.actions[0].id}/approve`).expect(201);
    expect(res.body.status).toBe('applied');
    expect(google.budget).toBe(25_500_000);
  });

  it('creates the first ad of a campaign without one', async () => {
    google.hasAd = false;
    script = [
      {
        tools: [
          [
            'propose_new_ad',
            {
              final_url: 'https://instal.example/',
              headlines: ['Unu', 'Doi', 'Trei'],
              descriptions: ['Prima descriere', 'A doua descriere'],
              reason: 'x',
            },
          ],
        ],
      },
      { text: 'ok' },
    ];
    const t = await chat();
    expect(t.actions[0]).toMatchObject({ action: 'chat.ad_create' });
  });

  it('a proposal cannot be applied where writes are blocked, and stays pending', async () => {
    google.writesAllowed = false;
    script = [{ tools: [['propose_ad_texts', texts]] }, { text: 'ok' }];
    const t = await chat();
    await post(`/actions/${t.actions[0].id}/approve`).expect(400);
    const a = await prisma.googleAdsUserAction.findUniqueOrThrow({
      where: { id: t.actions[0].id },
    });
    expect(a.status).toBe('pending_approval');
  });

  it('stops at the configured number of AI calls', async () => {
    script = Array.from({ length: 10 }, () => ({
      text: 'mai citesc',
      tools: [['read_campaign', { what: 'keywords' }] as [string, unknown]],
    }));
    const t = await chat();
    expect(aiCalls).toHaveLength(6);
    expect(t.status).toBe('completed');
  });
});

describe('optimization cycles', () => {
  it('does not plan or price a business name Google refuses', async () => {
    await prisma.googleAdsUserCampaign.update({
      where: { id: campaignId },
      data: { settings: { businessName: 'Instal SRL' } },
    });
    const units = async () =>
      (await get('/quote').expect(200)).body.tasks.find(
        (t: { task: string }) => t.task === 'extensions',
      ).units as number;
    const open = await units();
    google.validateError = new Error('Customer is not verified. (CUSTOMER_NOT_VERIFIED)');
    expect(await units()).toBe(open - 1);
    const d = await get().expect(200);
    const brand = d.body.snapshot.evaluation.issues.find(
      (i: { code: string }) => i.code === 'brand_missing',
    );
    expect(brand.autoFixable).toBe(false);
  });

  it('refuses a cycle with nothing to do, without charging', async () => {
    await prisma.googleAdsUserCampaign.update({
      where: { id: campaignId },
      data: {
        settings: { autoApply: false, textRewriteProposals: false, budgetProposals: false },
      },
    });
    expect((await get('/quote').expect(200)).body.nothingToDo).toBe(true);
    const r = await post('/cycles').expect(409);
    expect(r.body.message).toBe('nothing_to_do');
    expect(await balance()).toBe(5000);
  });

  it('quote is free; a cycle that changes nothing is returned in full', async () => {
    google.writesAllowed = false; // validate only: nothing is applied
    const q = await get('/quote').expect(200);
    expect(await balance()).toBe(5000);
    expect(q.body.quote.minor).toBeGreaterThanOrEqual(1000);
    const key = randomUUID();
    const body = { idempotencyKey: key, expectedQuoteMinor: q.body.quote.minor };
    const a = await post('/cycles', body).expect(201);
    const b = await post('/cycles', body).expect(201);
    expect(b.body.cycleId).toBe(a.body.cycleId);
    const c = await waitFor(async () => {
      const x = await prisma.googleAdsOptimizationCycle.findUnique({
        where: { id: a.body.cycleId },
      });
      return x && x.status !== 'running' ? x : null;
    });
    expect(c.status).toBe('completed');
    // Nothing changed or proposed: everything goes back and the owner is told.
    expect(c.chargedMinor).toBe(0);
    expect(c.refundedMinor).toBe(c.quotedMinor);
    expect(await balance()).toBe(5000);
    await waitFor(() =>
      prisma.notification.findFirst({
        where: { userId: user.id, type: 'google_ads_no_change' },
      }),
    );
    // The same cycle is not offered again until something changes.
    expect((await get('/quote').expect(200)).body.nothingToDo).toBe(true);
    expect((await post('/cycles').expect(409)).body.message).toBe('nothing_to_do');
    await http()
      .patch(url('/settings'))
      .set('Cookie', user.cookie)
      .send({ images: true })
      .expect(200);
    expect((await get('/quote').expect(200)).body.nothingToDo).toBe(false);
    expect(await prisma.googleAdsChatTurn.count()).toBe(0);
  });

  it('refuses when the price went up since it was shown', async () => {
    const r = await post('/cycles', { expectedQuoteMinor: 1 }).expect(409);
    expect(r.body.message).toBe('quote_changed');
    expect(await balance()).toBe(5000);
  });

  it('refuses without credits and while paused', async () => {
    await credits(1);
    await post('/cycles').expect(400);
    await credits(50);
    await post('/pause').expect(201);
    const r = await post('/cycles').expect(400);
    expect(r.body.message).toBe('campaign_paused');
  });

  it('turning a schedule on long after the last cycle does not start one at once', async () => {
    const old = new Date(Date.now() - 90 * 86_400_000);
    await prisma.googleAdsUserCampaign.update({
      where: { id: campaignId },
      data: { lastCycleAt: old },
    });
    await http()
      .patch(url('/settings'))
      .set('Cookie', user.cookie)
      .send({ schedule: 'weekly' })
      .expect(200);
    const at = async () =>
      (await prisma.googleAdsUserCampaign.findUniqueOrThrow({ where: { id: campaignId } }))
        .nextCycleAt!;
    expect((await at()).getTime()).toBeGreaterThan(Date.now());
    // Same for resuming an overdue schedule.
    await post('/pause').expect(201);
    await prisma.googleAdsUserCampaign.update({
      where: { id: campaignId },
      data: { nextCycleAt: old },
    });
    await post('/resume').expect(201);
    expect((await at()).getTime()).toBeGreaterThan(Date.now());
  });

  it('forgets the picked campaigns when the builder disconnects the account', async () => {
    const start = await http().post('/api/v1/google-ads-user/builder/start').send({}).expect(201);
    const draft = start.body.draftToken as string;
    await prisma.googleAdsConnection.update({
      where: { id: start.body.connection.id },
      data: { selections: [{ customerId: '1', loginCustomerId: null, campaignId: '2' }] },
    });
    await http()
      .post('/api/v1/google-ads-user/builder/disconnect')
      .set('x-ads-draft', draft)
      .expect(201);
    const c = await prisma.googleAdsConnection.findUniqueOrThrow({
      where: { id: start.body.connection.id },
    });
    expect(c.selections).toBeNull();
  });
});

describe('connection safety', () => {
  const BASE = '/api/v1/google-ads-user';
  const row = () => prisma.googleAdsUserCampaign.findUniqueOrThrow({ where: { id: campaignId } });
  const connId = async () => (await row()).connectionId;
  const set = (data: object) =>
    prisma.googleAdsUserCampaign.update({ where: { id: campaignId }, data });
  const consent = async (id: string) => {
    const r = await http()
      .post(`${BASE}/connections/${id}/reconnect-url`)
      .set('Cookie', user.cookie)
      .expect(201);
    expect(Object.keys(r.body)).toEqual(['url']);
    const cookie = (r.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/HttpOnly/);
    return { state: r.body.url as string, cookie: cookie.split(';')[0] };
  };
  beforeEach(() => {
    const oauth = app.get(GoogleAdsOAuthService);
    jest.spyOn(oauth, 'missingConfig').mockResolvedValue([]);
    jest.spyOn(oauth, 'authUrl').mockImplementation(async (s) => s);
    jest.spyOn(oauth, 'revoke').mockResolvedValue(undefined);
    jest
      .spyOn(oauth, 'exchange')
      .mockResolvedValue({ refreshTokenEnc: 'new', email: 'ion@example.com', sub: 'g-ion' });
  });

  it('a consent finished in another browser is refused and gives no access', async () => {
    const id = await connId();
    const { state, cookie } = await consent(id);
    for (const c of ['', 'tvz_ads_oauth=other']) {
      const r = await http()
        .get(`${BASE}/oauth/callback`)
        .query({ code: 'x', state })
        .set('Cookie', c)
        .expect(302);
      expect(r.headers.location).toContain('error=state');
    }
    const token = async () =>
      (await prisma.googleAdsConnection.findUniqueOrThrow({ where: { id } })).refreshTokenEnc;
    expect(await token()).toBe('x');
    const ok = await http()
      .get(`${BASE}/oauth/callback`)
      .query({ code: 'x', state })
      .set('Cookie', cookie)
      .expect(302);
    expect(ok.headers.location).toContain('reconnected=1');
    expect(await token()).toBe('new');
  });

  it('reconnecting keeps a paused agent paused and starts no overdue cycle', async () => {
    const old = new Date(Date.now() - 30 * 86_400_000);
    for (const status of ['paused', 'active'] as const) {
      await set({ status, settings: { schedule: 'weekly' }, nextCycleAt: old });
      const id = await connId();
      await http()
        .post(`${BASE}/connections/${id}/disconnect`)
        .set('Cookie', user.cookie)
        .expect(201);
      expect((await row()).status).toBe('disconnected');
      const { state, cookie } = await consent(id);
      await http()
        .get(`${BASE}/oauth/callback`)
        .query({ code: 'x', state })
        .set('Cookie', cookie)
        .expect(302);
      const r = await row();
      expect([r.status, r.resumeStatus]).toEqual([status, null]);
      expect(r.nextCycleAt!.getTime()).toBeGreaterThan(Date.now());
    }
  });

  const other = () =>
    createAndLoginUser(app, prisma, {
      email: 'ana@example.com',
      password: 'password123',
      name: 'Ana',
    });
  const draftFor = async (data: object = {}) => {
    const start = await http().post(`${BASE}/builder/start`).send({}).expect(201);
    await prisma.googleAdsConnection.update({
      where: { id: start.body.connection.id },
      data: {
        status: 'connected',
        refreshTokenEnc: 'draft',
        googleSub: 'g-ion',
        selections: [{ customerId: '1234567890', loginCustomerId: null, campaignId: '77' }],
        ...data,
      },
    });
    return { token: start.body.draftToken as string, id: start.body.connection.id as string };
  };
  const claim = (token: string, u = user) =>
    http().post(`${BASE}/builder/claim`).set('x-ads-draft', token).set('Cookie', u.cookie);

  it('refuses to reconnect with a different Google account', async () => {
    const id = await connId();
    await prisma.googleAdsConnection.update({ where: { id }, data: { googleSub: 'g-other' } });
    const { state, cookie } = await consent(id);
    const r = await http()
      .get(`${BASE}/oauth/callback`)
      .query({ code: 'x', state })
      .set('Cookie', cookie)
      .expect(302);
    expect(r.headers.location).toContain('/google-ads/connections?error=account');
    const c = await prisma.googleAdsConnection.findUniqueOrThrow({ where: { id } });
    expect(c.refreshTokenEnc).toBe('x');
  });

  it('does not revoke Google access another connection still uses', async () => {
    const revoke = jest.spyOn(app.get(GoogleAdsOAuthService), 'revoke');
    revoke.mockClear();
    const id = await connId();
    await prisma.googleAdsConnection.update({ where: { id }, data: { googleSub: 'g-ion' } });
    const d = await draftFor();
    await http()
      .post(`${BASE}/connections/${id}/disconnect`)
      .set('Cookie', user.cookie)
      .expect(201);
    expect(revoke).not.toHaveBeenCalled();
    await http().post(`${BASE}/builder/disconnect`).set('x-ads-draft', d.token).expect(201);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('claiming the same Google account again keeps one connection', async () => {
    const id = await connId();
    await prisma.googleAdsConnection.update({ where: { id }, data: { googleSub: 'g-ion' } });
    const d = await draftFor();
    await claim(d.token).expect(201);
    const all = await prisma.googleAdsConnection.findMany({ where: { userId: user.id } });
    expect(all.map((c) => [c.id, c.refreshTokenEnc])).toEqual([[id, 'draft']]);
    expect((await row()).connectionId).toBe(id);
  });

  it('one account manages a Google campaign; a failed claim can be retried', async () => {
    const ana = await other();
    const d = await draftFor({ googleSub: 'g-ana' });
    const no = await claim(d.token, ana).expect(400);
    expect(no.body.message).toBe('campaign_managed_elsewhere');
    await http().delete(url()).set('Cookie', user.cookie).expect(200);
    await claim(d.token, ana).expect(201);
    expect(
      await prisma.googleAdsUserCampaign.count({ where: { userId: ana.id, status: 'active' } }),
    ).toBe(1);
  });

  it('a removed campaign disappears, its costs stay and its words are erased', async () => {
    script = [{ text: 'Salut!' }];
    const turn = await chat('secretul meu');
    const action = await prisma.googleAdsUserAction.create({
      data: { userCampaignId: campaignId, action: 'chat.status', status: 'pending_approval' },
    });
    await http().delete(url()).set('Cookie', user.cookie).expect(200);
    await get().expect(404);
    const list = await http().get(`${BASE}/campaigns`).set('Cookie', user.cookie).expect(200);
    expect(list.body).toEqual([]);
    const t = await prisma.googleAdsChatTurn.findUniqueOrThrow({ where: { id: turn.id } });
    expect([t.userText, t.assistantText]).toEqual(['', null]);
    expect(t.chargedMinor).toBe(turn.chargedMinor);
    expect(t.aiCostUsd).toBeGreaterThan(0);
    expect(
      (await prisma.googleAdsUserAction.findUniqueOrThrow({ where: { id: action.id } })).status,
    ).toBe('expired');
    // Added again: the same row, starting fresh.
    const d = await draftFor();
    await claim(d.token).expect(201);
    expect((await row()).status).toBe('active');
    const c = await http().get(url('/chat')).set('Cookie', user.cookie).expect(200);
    expect(c.body.turns).toEqual([]);
  });

  it('forgets abandoned drafts and unites duplicate connections', async () => {
    const revoke = jest.spyOn(app.get(GoogleAdsOAuthService), 'revoke');
    revoke.mockClear();
    const old = await draftFor({
      googleSub: 'g-gone',
      updatedAt: new Date(Date.now() - 8 * 86_400_000),
    });
    const fresh = await draftFor({ googleSub: 'g-fresh' });
    const id = await connId();
    await prisma.googleAdsConnection.update({
      where: { id },
      data: { googleEmail: 'ion@x.ro', status: 'revoked' },
    });
    const keep = await prisma.googleAdsConnection.create({
      data: { userId: user.id, status: 'connected', refreshTokenEnc: 'y', googleEmail: 'Ion@x.ro' },
    });
    await app.get(GoogleAdsUserService).cleanUp();
    const ids = (await prisma.googleAdsConnection.findMany()).map((c) => c.id);
    expect(ids.sort()).toEqual([fresh.id, keep.id].sort());
    expect(ids).not.toContain(old.id);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect((await row()).connectionId).toBe(keep.id);
  });

  it('expires old proposals and closes interrupted approvals by what Google shows', async () => {
    const agent = app.get(GoogleAdsUserAgentService);
    const make = (data: object) =>
      prisma.googleAdsUserAction.create({
        data: { userCampaignId: campaignId, action: 'budget.change.proposed', ...data } as never,
      });
    const past = new Date(Date.now() - 31 * 86_400_000);
    const old = await make({ status: 'pending_approval', createdAt: past });
    const live = String(google.budget);
    const stuck = { status: 'approved', approvedAt: new Date(Date.now() - 3_600_000) };
    const done = await make({ ...stuck, after: { amountMicros: live } });
    const lost = await make({ ...stuck, after: { amountMicros: '1' } });
    const now = await make({
      status: 'approved',
      approvedAt: new Date(),
      after: { amountMicros: '1' },
    });
    await agent.expireProposals();
    await agent.settleStuckApprovals();
    const st = async (x: { id: string }) =>
      (await prisma.googleAdsUserAction.findUniqueOrThrow({ where: { id: x.id } })).status;
    expect([await st(old), await st(done), await st(lost), await st(now)]).toEqual([
      'expired',
      'applied',
      'failed',
      'approved',
    ]);
  });

  const notes = (type: string) =>
    prisma.notification.findMany({ where: { userId: user.id, type } });

  it('tells the owner once when Google withdraws the access', async () => {
    const agent = app.get(GoogleAdsUserAgentService);
    const id = await connId();
    await agent.connectionLost(id);
    await agent.connectionLost(id);
    expect((await row()).status).toBe('disconnected');
    const n = await notes('google_ads_connection_lost');
    expect(n).toHaveLength(1);
    expect([...n[0].channels].sort()).toEqual(['email', 'panel']);
  });

  it('a scheduled cycle that could not start is explained once, by email too', async () => {
    await credits(0);
    const due = new Date(Date.now() - 1000);
    await set({ settings: { schedule: 'weekly', chatDailyLimitCredits: 0 }, nextCycleAt: due });
    const ready = {
      services: 'Instalatii sanitare',
      areas: 'Cluj',
      goal: 'Cereri',
    };
    await set({ brief: ready });
    await (app.get(GoogleAdsUserAgentService) as any).tick();
    const n = await notes('google_ads_cycle_skipped');
    expect(n).toHaveLength(1);
    expect(n[0].body).toContain('Instalatii');
    expect((await row()).nextCycleAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('several scheduled cycles of one owner end in one message', async () => {
    const agent = app.get(GoogleAdsUserAgentService);
    const second = await prisma.googleAdsUserCampaign.create({
      data: {
        userId: user.id,
        connectionId: await connId(),
        customerId: '1234567890',
        googleCampaignId: '78',
        name: 'Termice',
      },
    });
    const cycle = (userCampaignId: string) =>
      prisma.googleAdsOptimizationCycle.create({
        data: {
          userCampaignId,
          userId: user.id,
          trigger: 'scheduled',
          quote: {},
          quotedMinor: 1000,
        },
      });
    const a = await cycle(campaignId);
    const b = await cycle(second.id);
    for (const c of [a, b])
      await prisma.googleAdsUserAction.create({
        data: {
          userCampaignId: c.userCampaignId,
          cycleId: c.id,
          action: 'creative.replace_text',
          status: 'pending_approval',
        },
      });
    await agent.settle(a.id, { error: null, scoreAfter: null });
    expect(await notes('google_ads_cycle_done')).toHaveLength(0);
    await agent.settle(b.id, { error: null, scoreAfter: null });
    const n = await notes('google_ads_cycle_done');
    expect(n).toHaveLength(1);
    expect(n[0].body).toContain('Instalatii');
    expect(n[0].body).toContain('Termice');
  });

  it('logs what the owner did, visible to staff', async () => {
    await post('/pause').expect(201);
    await http()
      .patch(url('/settings'))
      .set('Cookie', user.cookie)
      .send({ images: true })
      .expect(200);
    const rows = await prisma.businessActionLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.action, r.companyId, r.targetId])).toEqual([
      ['ads.pause', null, campaignId],
      ['ads.settings', null, campaignId],
    ]);
    expect([rows[1].before, rows[1].after]).toEqual([{ images: false }, { images: true }]);
    const staff = await createAndLoginUser(app, prisma, {
      email: 'sup@example.com',
      password: 'password123',
      name: 'Sup',
    });
    await prisma.platformRoleAssignment.create({ data: { userId: staff.id, role: 'support' } });
    const log = await http()
      .get('/api/v1/admin/business-action-log')
      .set('Cookie', staff.cookie)
      .expect(200);
    expect(log.body.total).toBe(2);
  });

  it('a ticket can be about a campaign; staff see it read-only', async () => {
    const ana = await other();
    const ticket = (u: TestUser) =>
      http().post('/api/v1/support/tickets').set('Cookie', u.cookie).send({
        subject: 'Nu merge',
        body: 'Campania mea nu mai merge deloc.',
        category: 'problem',
        adsCampaignId: campaignId,
      });
    expect((await ticket(ana).expect(400)).body.message).toBe('not_your_campaign');
    const t = await ticket(user).expect(201);
    expect(t.body.adsCampaign).toEqual({ id: campaignId, name: 'Instalatii' });
    const path = `/api/v1/support/tickets/${t.body.id}/google-ads`;
    await http().get(path).set('Cookie', user.cookie).expect(403);
    await prisma.platformRoleAssignment.create({ data: { userId: ana.id, role: 'support' } });
    const r = await http().get(path).set('Cookie', ana.cookie).expect(200);
    expect(r.body.items).toMatchObject([{ id: campaignId, about: true, status: 'active' }]);
    expect(JSON.stringify(r.body)).not.toContain('refreshToken');
  });

  it('admin lists every campaign and finds the ones with problems', async () => {
    const staff = await createAndLoginUser(app, prisma, {
      email: 'boss2@example.com',
      password: 'password123',
      name: 'Boss',
    });
    const list = (q: string) =>
      http().get(`/api/v1/admin/google-ads-optimizer/campaigns${q}`).set('Cookie', staff.cookie);
    await list('').expect(403);
    await prisma.platformRoleAssignment.create({ data: { userId: staff.id, role: 'admin' } });
    expect((await list('?search=ion@ex').expect(200)).body.total).toBe(1);
    expect((await list('?problem=1').expect(200)).body.total).toBe(0);
    await set({ status: 'disconnected' });
    expect((await list('?problem=1&status=disconnected').expect(200)).body.items[0]).toMatchObject({
      id: campaignId,
      user: { id: user.id },
    });
    const usage = await http()
      .get('/api/v1/admin/google-ads-optimizer/usage?from=2020-01-01&to=2020-01-31&page=2')
      .set('Cookie', staff.cookie)
      .expect(200);
    expect(usage.body.totals.cycles).toBe(0);
    const stats = await http().get('/api/v1/admin/stats').set('Cookie', staff.cookie).expect(200);
    expect(stats.body.googleAds.disconnected).toBe(1);
  });

  it('suspending the account stops its agent and its scheduled cycles', async () => {
    const staff = await createAndLoginUser(app, prisma, {
      email: 'boss@example.com',
      password: 'password123',
      name: 'Boss',
    });
    await prisma.platformRoleAssignment.create({ data: { userId: staff.id, role: 'admin' } });
    await http()
      .patch(`/api/v1/admin/users/${user.id}`)
      .set('Cookie', staff.cookie)
      .send({ status: 'suspended' })
      .expect(200);
    expect((await row()).status).toBe('paused');
    // Even if something left it active, the scheduler skips the account.
    const due = new Date(Date.now() - 1000);
    await set({ status: 'active', settings: { schedule: 'weekly' }, nextCycleAt: due });
    await (app.get(GoogleAdsUserAgentService) as any).tick();
    expect((await row()).nextCycleAt!.getTime()).toBe(due.getTime());
    expect(await prisma.googleAdsOptimizationCycle.count()).toBe(0);
  });
});

describe('admin: one customer’s campaigns', () => {
  let admin: TestUser;
  const base = () => `/api/v1/admin/users/${user.id}/google-ads/campaigns/${campaignId}`;
  const aGet = (p = '') =>
    http()
      .get(base() + p)
      .set('Cookie', admin.cookie);
  const aPost = (p: string, body: object = {}) =>
    http()
      .post(base() + p)
      .set('Cookie', admin.cookie)
      .send(body);
  const change = (kind: string, input: object, reason = 'Cerut de client') =>
    aPost('/changes', { kind, input, reason });
  const audits = () => prisma.adminAuditLog.findMany({ where: { targetId: campaignId } });
  const notices = () =>
    prisma.notification.count({ where: { userId: user.id, type: 'google_ads_staff_change' } });

  beforeEach(async () => {
    admin = await createAndLoginUser(app, prisma, {
      email: 'staff@example.com',
      password: 'password123',
      name: 'Staff',
    });
    await prisma.platformRoleAssignment.create({ data: { userId: admin.id, role: 'admin' } });
  });

  it('is for admins, and only for the campaigns of that user', async () => {
    await http().get(base()).set('Cookie', user.cookie).expect(403);
    await http().get(base()).expect(401);
    await aGet().expect(200);
    await http()
      .get(`/api/v1/admin/users/${admin.id}/google-ads/campaigns/${campaignId}`)
      .set('Cookie', admin.cookie)
      .expect(404);
    const list = await http()
      .get(`/api/v1/admin/users/${user.id}/google-ads/campaigns`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(list.body[0].id).toBe(campaignId);
    expect(JSON.stringify(list.body)).not.toContain('refreshToken');
  });

  it('edits texts, keywords and status in Google, audited and announced, free', async () => {
    const ed = (await aGet('/editor').expect(200)).body;
    expect(ed.ad.headlines[0].text).toBe('Instalator Cluj');
    const r = await change('ad_texts', {
      headlines: { replace: [{ old: 'Suna acum', new: 'Cere o ofertă' }] },
    }).expect(201);
    expect(r.body.status).toBe('applied');
    expect(r.body.approvedByUserId).toBe(admin.id);
    expect(google.headlines).toContain('Cere o ofertă');
    await change('keywords', {
      add: [{ text: 'instalator non stop', match_type: 'PHRASE' }],
    }).expect(201);
    expect(google.keywords).toContain('instalator non stop');
    await change('status', { status: 'PAUSED' }).expect(201);
    expect(google.status).toBe('PAUSED');
    expect((await audits()).map((x) => x.action).sort()).toEqual([
      'google_ads.ad_texts',
      'google_ads.keywords',
      'google_ads.status',
    ]);
    expect(await notices()).toBe(3);
    expect(await balance()).toBe(5000);
  });

  it('refuses invalid edits and blocked environments without leaving anything behind', async () => {
    await change('ad_texts', { headlines: { add: ['x'.repeat(31)] } }).expect(400);
    await change('status', { status: 'PAUSED' }, 'x').expect(400);
    google.validateError = new Error('Google refuses');
    await change('status', { status: 'PAUSED' }).expect(400);
    google.validateError = null;
    google.writesAllowed = false;
    await change('status', { status: 'PAUSED' }).expect(400);
    expect(await prisma.googleAdsUserAction.count()).toBe(0);
    expect(await notices()).toBe(0);
  });

  it('only proposes the budget; the owner decides', async () => {
    const r = await change('budget', { dailyAmount: 30 }).expect(201);
    expect(r.body.status).toBe('pending_approval');
    expect(google.budget).toBe(20_000_000);
    await aPost(`/actions/${r.body.id}/approve`).expect(400);
    expect(google.budget).toBe(20_000_000);
    await post(`/actions/${r.body.id}/approve`).expect(201);
    expect(google.budget).toBe(30_000_000);
  });

  it('saves settings but can never raise what the owner pays', async () => {
    const patch = (body: object) =>
      http()
        .patch(base() + '/settings')
        .set('Cookie', admin.cookie)
        .send(body);
    await patch({ businessName: 'Instal SRL', images: true }).expect(200);
    expect((await get().expect(200)).body.settings.businessName).toBe('Instal SRL');
    await patch({ schedule: 'weekly' }).expect(400);
    await patch({ maxCreditsPerCycle: 1000 }).expect(400);
    await patch({ chatDailyLimitCredits: 0 }).expect(400);
    await patch({ chatDailyLimitCredits: 5 }).expect(200);
    expect(await audits()).toHaveLength(2);
  });

  it('runs the agent for the owner without charging', async () => {
    const r = await aPost('/cycles', { idempotencyKey: randomUUID() }).expect(201);
    expect(r.body.chargedMinor).toBe(0);
    const c = await waitFor(async () => {
      const x = await prisma.googleAdsOptimizationCycle.findUnique({
        where: { id: r.body.cycleId },
      });
      return x && x.status !== 'running' ? x : null;
    });
    expect(c.trigger).toBe('staff');
    expect(c.chargedMinor).toBe(0);
    expect(c.refundedMinor).toBe(0);
    expect(await balance()).toBe(5000);
    expect(await prisma.notification.count({ where: { type: 'google_ads_no_change' } })).toBe(0);
  });

  it('pauses, resumes, and shows it all in the user’s activity', async () => {
    await aPost('/pause').expect(201);
    expect((await get().expect(200)).body.campaign.status).toBe('paused');
    await aPost('/resume').expect(201);
    const r = await http()
      .get(`/api/v1/admin/users/${user.id}/activity`)
      .set('Cookie', admin.cookie)
      .expect(200);
    const actions = r.body.items.map((x: { action: string }) => x.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'google_ads.agent.pause',
        'google_ads.agent.resume',
        'session.create',
      ]),
    );
    await http()
      .get(`/api/v1/admin/users/${user.id}/activity`)
      .set('Cookie', user.cookie)
      .expect(403);
  });

  it('lists only that user’s invoices', async () => {
    const r = await http()
      .get(`/api/v1/admin/invoices?userId=${user.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(r.body).toMatchObject({ items: [], total: 0 });
    await http().get('/api/v1/admin/invoices?userId=x').set('Cookie', admin.cookie).expect(400);
  });
});
