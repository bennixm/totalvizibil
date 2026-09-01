import { AUTO_MIN_CPC_MINOR, autoBudgetCapMinor, autoResolvedCpcMinor } from './auto-cpc';
import { suggestCampaign } from './campaign-advisor';

/** The recommended (score-maxing) CPC for a given rival market. */
const recCpc = (marketMaxCpcMinor?: number) =>
  suggestCampaign({ radiusKm: 20, marketMaxCpcMinor }).appearFirst.cpcMinor;

describe('auto-cpc: budget ceiling', () => {
  it('caps AUTO CPC at 10% of the daily budget', () => {
    expect(autoBudgetCapMinor(20_000)).toBe(2_000); // 200 cr/day -> 20 cr ceiling
    expect(autoBudgetCapMinor(5_000)).toBe(500);
  });

  it('never drops below the CPC floor for a tiny budget', () => {
    expect(autoBudgetCapMinor(100)).toBe(AUTO_MIN_CPC_MINOR);
    expect(autoBudgetCapMinor(0)).toBe(AUTO_MIN_CPC_MINOR);
  });
});

describe('auto-cpc: AUTO targets the score-maxing CPC', () => {
  it('bids exactly the recommended CPC when the budget can afford it — no overpaying', () => {
    const rec = recCpc(); // low competition
    expect(rec).toBeGreaterThan(AUTO_MIN_CPC_MINOR); // above the old bare-floor behaviour
    expect(autoResolvedCpcMinor(rec, 30_000)).toBe(rec); // 30 cr/day easily covers it
  });

  it('clamps to 10% of the budget when the recommended CPC is higher', () => {
    const rec = recCpc(1_200); // ~13.9 cr recommendation
    const cap = autoBudgetCapMinor(10_000); // 1 cr ceiling on a 10 cr/day budget
    expect(rec).toBeGreaterThan(cap);
    expect(autoResolvedCpcMinor(rec, 10_000)).toBe(cap);
  });

  it('never below the floor', () => {
    expect(autoResolvedCpcMinor(10, 100)).toBe(AUTO_MIN_CPC_MINOR);
  });
});

describe('auto-cpc: two AUTO campaigns cannot bid each other up forever', () => {
  /** Alternating reconciles: each re-bids the recommended CPC off the other's current bid. */
  function settle(budgetA: number, budgetB: number, rounds = 200): [number, number] {
    let a = AUTO_MIN_CPC_MINOR;
    let b = AUTO_MIN_CPC_MINOR;
    for (let i = 0; i < rounds; i++) {
      a = autoResolvedCpcMinor(recCpc(b), budgetA);
      b = autoResolvedCpcMinor(recCpc(a), budgetB);
    }
    return [a, b];
  }

  it('equal budgets converge to the 10% ceiling and stop (fixed point)', () => {
    const budget = 20_000;
    const [a, b] = settle(budget, budget);
    expect(a).toBe(autoBudgetCapMinor(budget));
    expect(b).toBe(autoBudgetCapMinor(budget));
    expect(a).toBeLessThanOrEqual(budget * 0.1);
    expect(autoResolvedCpcMinor(recCpc(b), budget)).toBe(a); // another round changes nothing
  });

  it('unequal budgets: the smaller pins at its own ceiling, the rival stays bounded', () => {
    const [big, small] = settle(40_000, 10_000);
    expect(small).toBe(autoBudgetCapMinor(10_000));
    expect(big).toBeGreaterThanOrEqual(small);
    expect(big).toBeLessThanOrEqual(autoBudgetCapMinor(40_000));
    expect(big).toBeLessThanOrEqual(40_000 * 0.1);
  });
});
