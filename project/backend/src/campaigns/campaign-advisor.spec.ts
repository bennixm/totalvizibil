import { suggestCampaign } from './campaign-advisor';

describe('campaign advisor', () => {
  it('returns a standard and an "appear first" tier', () => {
    const s = suggestCampaign({ radiusKm: 10 });
    expect(s.standard.cpcMinor).toBeGreaterThan(0);
    expect(s.appearFirst.cpcMinor).toBeGreaterThan(s.standard.cpcMinor);
    expect(s.standard.dailyBudgetMinor).toBeGreaterThanOrEqual(s.standard.cpcMinor);
  });

  it('daily budget is a multiple-ish of CPC', () => {
    const s = suggestCampaign({ radiusKm: 5 });
    expect(s.standard.dailyBudgetMinor).toBeGreaterThan(s.standard.cpcMinor * 5);
    expect(s.appearFirst.dailyBudgetMinor).toBeGreaterThan(s.appearFirst.cpcMinor * 5);
  });

  it('a wider radius suggests a higher CPC (up to +50%)', () => {
    const small = suggestCampaign({ radiusKm: 1 });
    const big = suggestCampaign({ radiusKm: 100 });
    expect(big.standard.cpcMinor).toBeGreaterThan(small.standard.cpcMinor);
    // capped
    const huge = suggestCampaign({ radiusKm: 100000 });
    expect(huge.standard.cpcMinor).toBe(big.standard.cpcMinor);
  });

  it('recommended CPC is set above the current market-leading CPC', () => {
    const s = suggestCampaign({ radiusKm: 10, marketMaxCpcMinor: 500 });
    expect(s.appearFirst.cpcMinor).toBeGreaterThan(500);
  });

  it('recommended daily budget clears the full-CPC-score reference (2000)', () => {
    const s = suggestCampaign({ radiusKm: 10, marketMaxCpcMinor: 20 });
    expect(s.appearFirst.dailyBudgetMinor).toBeGreaterThanOrEqual(2000);
  });

  it('handles a missing radius', () => {
    const s = suggestCampaign({});
    expect(s.standard.cpcMinor).toBeGreaterThan(0);
    expect(Number.isInteger(s.standard.cpcMinor)).toBe(true);
    expect(Number.isInteger(s.standard.dailyBudgetMinor)).toBe(true);
  });
});
