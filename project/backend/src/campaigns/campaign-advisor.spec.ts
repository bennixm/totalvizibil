import { suggestCampaign } from './campaign-advisor';

describe('campaign advisor', () => {
  it('returns a standard and an "appear first" tier', () => {
    const s = suggestCampaign({});
    expect(s.standard.cpcMinor).toBeGreaterThan(0);
    expect(s.appearFirst.cpcMinor).toBeGreaterThan(s.standard.cpcMinor);
    expect(s.standard.dailyBudgetMinor).toBeGreaterThanOrEqual(s.standard.cpcMinor);
  });

  it('daily budget is a multiple-ish of CPC', () => {
    const s = suggestCampaign({});
    expect(s.standard.dailyBudgetMinor).toBeGreaterThan(s.standard.cpcMinor * 5);
    expect(s.appearFirst.dailyBudgetMinor).toBeGreaterThan(s.appearFirst.cpcMinor * 5);
  });

  it('recommended CPC is set above the current market-leading CPC', () => {
    const s = suggestCampaign({ marketMaxCpcMinor: 500 });
    expect(s.appearFirst.cpcMinor).toBeGreaterThan(500);
  });

  it('recommended daily budget clears the full-CPC-score reference (2000)', () => {
    const s = suggestCampaign({ marketMaxCpcMinor: 20 });
    expect(s.appearFirst.dailyBudgetMinor).toBeGreaterThanOrEqual(2000);
  });

  it('handles no market data at all', () => {
    const s = suggestCampaign({});
    expect(s.standard.cpcMinor).toBeGreaterThan(0);
    expect(Number.isInteger(s.standard.cpcMinor)).toBe(true);
    expect(Number.isInteger(s.standard.dailyBudgetMinor)).toBe(true);
  });
});
