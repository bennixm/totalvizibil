import { autoBudgetCapMinor, autoResolvedCpcMinor } from './auto-cpc';
import { suggestCampaign } from './campaign-advisor';

// Matches the default margin config (cost promovare 1cr + marjă profit 0.1cr).
const CPC_MIN_MINOR = 110;

/** The recommended (score-maxing) CPC for a given rival market. */
const recCpc = (marketMaxCpcMinor?: number) =>
  suggestCampaign({ marketMaxCpcMinor, cpcMinMinor: CPC_MIN_MINOR }).appearFirst.cpcMinor;

describe('auto-cpc: budget ceiling', () => {
  it('caps AUTO CPC at 10% of the daily budget', () => {
    expect(autoBudgetCapMinor(20_000, CPC_MIN_MINOR)).toBe(2_000); // 200 cr/day -> 20 cr ceiling
    expect(autoBudgetCapMinor(5_000, CPC_MIN_MINOR)).toBe(500);
  });

  it('never drops below the Feed CPC minim floor for a tiny budget', () => {
    expect(autoBudgetCapMinor(100, CPC_MIN_MINOR)).toBe(CPC_MIN_MINOR);
    expect(autoBudgetCapMinor(0, CPC_MIN_MINOR)).toBe(CPC_MIN_MINOR);
  });

  it('the floor tracks whatever CPC minim is passed in — not a hardcoded constant', () => {
    expect(autoBudgetCapMinor(100, 250)).toBe(250);
    expect(autoBudgetCapMinor(0, 500)).toBe(500);
  });
});

describe('auto-cpc: AUTO targets the score-maxing CPC', () => {
  it('bids exactly the recommended CPC when the budget can afford it — no overpaying', () => {
    const rec = recCpc(); // low competition
    expect(rec).toBeGreaterThan(CPC_MIN_MINOR); // above the bare-floor behaviour
    expect(autoResolvedCpcMinor(rec, 30_000, CPC_MIN_MINOR)).toBe(rec); // 300 cr/day easily covers it
  });

  it('clamps to 10% of the budget when the recommended CPC is higher', () => {
    const rec = recCpc(1_200); // ~13.9 cr recommendation
    const cap = autoBudgetCapMinor(10_000, CPC_MIN_MINOR); // 1 cr ceiling on a 10 cr/day budget
    expect(rec).toBeGreaterThan(cap);
    expect(autoResolvedCpcMinor(rec, 10_000, CPC_MIN_MINOR)).toBe(cap);
  });

  it('never below the Feed CPC minim floor', () => {
    expect(autoResolvedCpcMinor(10, 100, CPC_MIN_MINOR)).toBe(CPC_MIN_MINOR);
  });
});

describe('auto-cpc: two AUTO campaigns cannot bid each other up forever', () => {
  /** Alternating reconciles: each re-bids the recommended CPC off the other's current bid. */
  function settle(budgetA: number, budgetB: number, rounds = 200): [number, number] {
    let a = CPC_MIN_MINOR;
    let b = CPC_MIN_MINOR;
    for (let i = 0; i < rounds; i++) {
      a = autoResolvedCpcMinor(recCpc(b), budgetA, CPC_MIN_MINOR);
      b = autoResolvedCpcMinor(recCpc(a), budgetB, CPC_MIN_MINOR);
    }
    return [a, b];
  }

  it('equal budgets converge to the 10% ceiling and stop (fixed point)', () => {
    const budget = 20_000;
    const [a, b] = settle(budget, budget);
    expect(a).toBe(autoBudgetCapMinor(budget, CPC_MIN_MINOR));
    expect(b).toBe(autoBudgetCapMinor(budget, CPC_MIN_MINOR));
    expect(a).toBeLessThanOrEqual(budget * 0.1);
    expect(autoResolvedCpcMinor(recCpc(b), budget, CPC_MIN_MINOR)).toBe(a); // another round changes nothing
  });

  it('unequal budgets: the smaller pins at its own ceiling, the rival stays bounded', () => {
    const [big, small] = settle(40_000, 10_000);
    expect(small).toBe(autoBudgetCapMinor(10_000, CPC_MIN_MINOR));
    expect(big).toBeGreaterThanOrEqual(small);
    expect(big).toBeLessThanOrEqual(autoBudgetCapMinor(40_000, CPC_MIN_MINOR));
    expect(big).toBeLessThanOrEqual(40_000 * 0.1);
  });
});
