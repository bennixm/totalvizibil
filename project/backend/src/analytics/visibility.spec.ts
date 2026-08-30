import {
  DEFAULT_REFS,
  campaignAgeScore,
  cpcScore,
  planScore,
  responseRateScore,
  visibilityScore,
} from './visibility';

describe('cpcScore', () => {
  it('is the daily budget over the reference, clamped to 0..1', () => {
    expect(cpcScore(0)).toBe(0);
    expect(cpcScore(1000)).toBeCloseTo(0.5); // 10 cr vs 20 cr ref
    expect(cpcScore(2000)).toBe(1);
    expect(cpcScore(9999)).toBe(1);
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
  const now = new Date('2026-08-31T00:00:00.000Z');
  it('is 0 for a campaign that never activated', () => {
    expect(campaignAgeScore(null, now)).toBe(0);
  });
  it('grows with days running, full at the reference', () => {
    const d5 = campaignAgeScore(new Date('2026-08-26T00:00:00.000Z'), now); // 5 days
    const d20 = campaignAgeScore(new Date('2026-08-11T00:00:00.000Z'), now); // 20 days
    expect(d5).toBeCloseTo(5 / 30, 4);
    expect(d20).toBeCloseTo(20 / 30, 4);
    expect(campaignAgeScore(new Date('2026-07-01T00:00:00.000Z'), now)).toBe(1);
  });
});

describe('visibilityScore', () => {
  const now = new Date('2026-08-31T00:00:00.000Z');

  it('applies the fixed 0.35 / 0.30 / 0.20 / 0.15 weights', () => {
    const v = visibilityScore(
      {
        dailyBudgetMinor: 2000, // cpc = 1
        leadsTotal: 0, // response = 0.5
        leadsResponded: 0,
        avgResponseMinutes: null,
        planMode: 'advanced', // plan = 1
        activatedAt: new Date('2026-07-01T00:00:00.000Z'), // age = 1
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
        dailyBudgetMinor: 1800,
        leadsTotal: 12,
        leadsResponded: 12,
        avgResponseMinutes: 6,
        planMode: 'advanced',
        activatedAt: new Date('2026-07-15T00:00:00.000Z'),
      },
      DEFAULT_REFS,
      now,
    );
    const weak = visibilityScore(
      {
        dailyBudgetMinor: 300,
        leadsTotal: 4,
        leadsResponded: 0,
        avgResponseMinutes: null,
        planMode: 'easy',
        activatedAt: new Date('2026-08-30T00:00:00.000Z'),
      },
      DEFAULT_REFS,
      now,
    );
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.score).toBeLessThanOrEqual(1);
  });
});
