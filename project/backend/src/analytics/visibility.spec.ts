import {
  DEFAULT_REFS,
  RUN_SCORE_GRACE_MS,
  campaignAgeScore,
  cpcScore,
  effectiveActiveSeconds,
  planScore,
  responseRateScore,
  visibilityScore,
} from './visibility';

const DAY = 86_400;
const HOUR_MS = 3_600_000;

describe('cpcScore', () => {
  it('is the per-click bid over the category-leading bid, clamped to 0..1', () => {
    // budget is ample (>= 2000 ref) in all of these, so the bid drives it
    expect(cpcScore(0, 100, 5000)).toBe(0);
    expect(cpcScore(50, 100, 5000)).toBeCloseTo(0.5); // half the leading bid
    expect(cpcScore(100, 100, 5000)).toBe(1);
    expect(cpcScore(250, 100, 5000)).toBe(1); // over the leader -> capped
  });

  it('is capped by budget adequacy — an underfunded budget holds it down', () => {
    // competitive bid (100/100 = 1) but only 10 cr/day vs the 20 cr ref
    expect(cpcScore(100, 100, 1000)).toBeCloseTo(0.5);
    expect(cpcScore(100, 100, 0)).toBe(0);
  });

  it('treats any funded positive bid as competitive when the category has no rivals', () => {
    expect(cpcScore(30, 0, 5000)).toBe(1);
    expect(cpcScore(0, 0, 5000)).toBe(0);
  });
});

describe('responseRateScore', () => {
  it('is a neutral 0.5 with no lead history', () => {
    expect(responseRateScore(0, 0, null)).toBe(0.5);
  });

  it('rewards answering, and answering fast', () => {
    const slow = responseRateScore(10, 10, 700); // ~12h avg
    const fast = responseRateScore(10, 10, 5); // near-instant
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeCloseTo(1, 1);
  });

  it('drops when many leads go unanswered', () => {
    expect(responseRateScore(10, 2, 5)).toBeLessThan(responseRateScore(10, 10, 5));
  });

  it('never exceeds 1 or drops below 0', () => {
    expect(responseRateScore(5, 5, -100)).toBeLessThanOrEqual(1);
    expect(responseRateScore(5, 0, null)).toBeGreaterThanOrEqual(0);
  });
});

describe('planScore', () => {
  it('gives advanced the edge over easy', () => {
    expect(planScore('advanced')).toBe(1);
    expect(planScore('easy')).toBe(0.5);
    expect(planScore(null)).toBe(0.5);
  });
});

describe('campaignAgeScore', () => {
  it('is 0 for a campaign that never ran', () => {
    expect(campaignAgeScore(0)).toBe(0);
  });
  it('grows with live time, full at the reference', () => {
    expect(campaignAgeScore(5 * DAY)).toBeCloseTo(5 / 30, 4);
    expect(campaignAgeScore(20 * DAY)).toBeCloseTo(20 / 30, 4);
    expect(campaignAgeScore(60 * DAY)).toBe(1);
  });
});

describe('effectiveActiveSeconds', () => {
  const now = new Date('2026-08-31T00:00:00.000Z');
  it('is just the banked total while stopped (no pause timestamp tracked)', () => {
    expect(effectiveActiveSeconds(3 * DAY, null, false, now)).toBe(3 * DAY);
    expect(effectiveActiveSeconds(3 * DAY, new Date('2026-08-01T00:00:00.000Z'), false, now)).toBe(
      3 * DAY,
    );
  });
  it('adds the current run while active', () => {
    // banked 3d + 2d into the live run = 5d
    const since = new Date('2026-08-29T00:00:00.000Z');
    expect(effectiveActiveSeconds(3 * DAY, since, true, now)).toBe(5 * DAY);
  });

  it('keeps the banked run time when stopped within the 24h grace window', () => {
    const pausedAt = new Date(now.getTime() - (RUN_SCORE_GRACE_MS - HOUR_MS)); // 23h ago
    const secs = effectiveActiveSeconds(4 * DAY, new Date('2026-06-01'), false, now, pausedAt);
    expect(secs).toBe(4 * DAY);
    expect(campaignAgeScore(secs)).toBeCloseTo(4 / 30, 4);
  });

  it('drops the banked run time once stopped for over 24h', () => {
    const pausedAt = new Date(now.getTime() - (RUN_SCORE_GRACE_MS + HOUR_MS)); // 25h ago
    const secs = effectiveActiveSeconds(4 * DAY, new Date('2026-06-01'), false, now, pausedAt);
    expect(secs).toBe(0);
    expect(campaignAgeScore(secs)).toBe(0);
  });

  it('the grace only applies while stopped — an active campaign ignores pausedAt', () => {
    const since = new Date(now.getTime() - 5 * DAY * 1000);
    const stalePausedAt = new Date(now.getTime() - 10 * RUN_SCORE_GRACE_MS);
    expect(effectiveActiveSeconds(0, since, true, now, stalePausedAt)).toBe(5 * DAY);
  });
});

describe('visibilityScore', () => {
  const now = new Date('2026-08-31T00:00:00.000Z');

  it('applies the fixed 0.35 / 0.30 / 0.20 / 0.15 weights', () => {
    const v = visibilityScore(
      {
        cpcMinor: 100, // bid at the category-leading bid -> cpc = 1
        cpcRefMinor: 100,
        dailyBudgetMinor: 2000, // funded past the 20 cr ref
        leadsTotal: 0, // response = 0.5
        leadsResponded: 0,
        avgResponseMinutes: null,
        planMode: 'advanced', // plan = 1
        activeSeconds: 60 * DAY, // age = 1
      },
      DEFAULT_REFS,
      now,
    );
    expect(v.cpc).toBe(1);
    expect(v.response).toBe(0.5);
    expect(v.plan).toBe(1);
    expect(v.age).toBe(1);
    // 0.35*1 + 0.30*0.5 + 0.20*1 + 0.15*1 = 0.85
    expect(v.score).toBeCloseTo(0.85, 5);
  });

  it('a fast-responding advanced veteran outranks a fresh low-budget easy listing', () => {
    const strong = visibilityScore(
      {
        cpcMinor: 120, // bidding over the leader
        cpcRefMinor: 100,
        dailyBudgetMinor: 1800,
        leadsTotal: 12,
        leadsResponded: 12,
        avgResponseMinutes: 6,
        planMode: 'advanced',
        activeSeconds: 16 * DAY,
      },
      DEFAULT_REFS,
      now,
    );
    const weak = visibilityScore(
      {
        cpcMinor: 20, // a tenth of the leading bid
        cpcRefMinor: 200,
        dailyBudgetMinor: 300,
        leadsTotal: 4,
        leadsResponded: 0,
        avgResponseMinutes: null,
        planMode: 'easy',
        activeSeconds: 1 * DAY,
      },
      DEFAULT_REFS,
      now,
    );
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.score).toBeLessThanOrEqual(1);
  });
});
