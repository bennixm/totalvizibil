import { readSettings } from 'src/google-ads-user/agent-settings';
import { assessReadiness, mergeBrief, readinessNow } from 'src/google-ads-user/campaign-brief';
import {
  aiCostUsd,
  DEFAULT_CHAT_PRICING as P,
  holdFor,
  parseStoredChatPricing,
  priceChatTurn,
  validateChatPricing,
} from 'src/google-ads-user/chat-pricing';
import { changeOps, planAdTexts } from 'src/google-ads-user/chat-changes';
import { htmlToText, isPublicIp } from 'src/google-ads-user/site-pages';

describe('chat pricing', () => {
  it('adds base, AI cost with markup and change fees', () => {
    const p = priceChatTurn(P, 0.05, { text: 4, keyword: 10 }, 500);
    // 0.10 + 0.20 + 1.20 + 0.50
    expect(p.minor).toBe(200);
    expect(p.lines).toHaveLength(2);
  });
  it('never below the minimum, never above the maximum or the reservation', () => {
    expect(priceChatTurn(P, 0, {}, 500).minor).toBe(20);
    expect(priceChatTurn(P, 100, {}, 10_000).minor).toBe(500);
    expect(priceChatTurn(P, 100, {}, 33).minor).toBe(33);
  });
  it('prices cache writes and reads, and unknown models at the top rate', () => {
    const u = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 };
    expect(aiCostUsd('claude-sonnet-5', u)).toBeCloseTo(2 + 10 + 0.2 + 2.5);
    expect(aiCostUsd('claude-opus-5-5', { ...u, cacheRead: 0, cacheWrite: 0 })).toBe(24);
    expect(aiCostUsd('something-else', u)).toBeGreaterThan(aiCostUsd('claude-opus-5', u));
  });
  it('sizes the reservation', () => {
    expect(holdFor(P, 10_000, null)).toEqual({ minor: 500 });
    expect(holdFor(P, 120, null)).toEqual({ minor: 120 });
    expect(holdFor(P, 10_000, 70)).toEqual({ minor: 70 });
    expect(holdFor(P, 19, null)).toEqual({ error: 'insufficient_credits' });
    expect(holdFor(P, 10_000, 19)).toEqual({ error: 'chat_daily_limit' });
  });
  it('validates admin input and survives a bad stored value', () => {
    expect(validateChatPricing(P).value).toEqual(P);
    expect(validateChatPricing({ ...P, maxCredits: 0.1 }).error).toBeTruthy();
    expect(validateChatPricing({ ...P, aiMarkup: 0.5 }).error).toBeTruthy();
    expect(parseStoredChatPricing('{bad')).toEqual(P);
    expect(parseStoredChatPricing('{"minCredits":0.5}').minCredits).toBe(0.5);
  });
});

const ad = {
  adResourceName: 'customers/1/ads/3',
  adGroupAdResourceName: 'customers/1/adGroupAds/9~3',
  status: 'ENABLED',
  primaryStatusReasons: [],
  finalUrls: ['https://x.ro'],
  headlines: [{ text: 'A', pinnedField: 'HEADLINE_1' }, { text: 'B' }, { text: 'C' }],
  descriptions: [{ text: 'D' }, { text: 'E' }],
  actionItems: [],
  keywords: ['a', 'b', 'c', 'd', 'e'],
};
const campaign = (over = {}) =>
  ({ ads: [ad], assets: [], current: { impressions: 5000 }, ...over }) as never;
const page = 'x'.repeat(500);

describe('does the agent know enough', () => {
  const s = readSettings({});
  it('insufficient when it would have to guess what the business does', () => {
    const r = assessReadiness(campaign(), s, {}, '');
    expect(r.level).toBe('insufficient');
    expect(r.gaps[0]).toMatchObject({ key: 'business', severity: 'required' });
    expect(readinessNow(r, { services: 'Instalații' })!.level).not.toBe('insufficient');
  });
  it('insufficient without an ad or without keywords', () => {
    expect(assessReadiness(campaign({ ads: [] }), s, {}, page).level).toBe('insufficient');
    const r = assessReadiness(campaign({ ads: [{ ...ad, keywords: [] }] }), s, {}, page);
    expect(r.gaps.find((g) => g.key === 'keywords')!.severity).toBe('required');
  });
  it('a described campaign is ready; low traffic alone asks nothing', () => {
    const brief = { services: 's', areas: 'a', goal: 'g', audience: 'c', differentiators: 'd' };
    const r = assessReadiness(campaign({ current: { impressions: 3 } }), s, brief, page);
    expect(r.level).toBe('ready');
    expect(r.gaps).toEqual([{ key: 'traffic', severity: 'useful', askable: false }]);
  });
  it('keeps only known facts', () => {
    expect(mergeBrief({ goal: 'a' }, { goal: '', areas: ' Cluj ', x: 1, offer: 5 })).toEqual({
      areas: 'Cluj',
    });
  });
});

describe('ad text changes', () => {
  it('keeps pinning and untouched texts', () => {
    const { change, units } = planAdTexts(campaign(), {
      headlines: { replace: [{ old: 'A', new: 'Z' }] },
      descriptions: { add: ['F'] },
    });
    expect(units).toEqual({ text: 2 });
    expect(change.after).toEqual({
      headlines: [{ text: 'Z', pinnedField: 'HEADLINE_1' }, { text: 'B' }, { text: 'C' }],
      descriptions: [{ text: 'D' }, { text: 'E' }, { text: 'F' }],
    });
    expect(JSON.stringify(changeOps('1', change))).toContain('customers/1/ads/3');
  });
  it.each([
    [{ headlines: { remove: ['C'] } }, /între 3 și 15/],
    [{ headlines: { add: ['b'] } }, /duplicate/i],
    [{ headlines: { replace: [{ old: 'nope', new: 'Z' }] } }, /nu există/],
    [{ headlines: { add: ['Sună la 0722 123 456'] } }, /telefon/],
    [{}, /Nicio modificare/],
  ])('refuses %j', (input, why) => {
    expect(() => planAdTexts(campaign(), input)).toThrow(why);
  });
});

describe('reading customer pages', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    '::ffff:10.0.0.1',
    'fd00::1',
    'x',
  ])('never reads %s', (ip) => expect(isPublicIp(ip)).toBe(false));
  it.each(['8.8.8.8', '2a00:1450:4001::200e'])('reads %s', (ip) =>
    expect(isPublicIp(ip)).toBe(true),
  );
  it('extracts text without scripts', () => {
    expect(
      htmlToText('<head><title>t</title></head><p>Salut &amp; bun</p><script>x()</script> venit'),
    ).toBe('Salut & bun venit');
  });
});
