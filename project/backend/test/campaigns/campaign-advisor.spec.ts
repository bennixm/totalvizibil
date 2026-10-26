import { suggestCampaign } from 'src/campaigns/campaign-advisor';

// Matches the default margin config (cost promovare 1cr + marjă profit 0.1cr).
const CPC_MIN_MINOR = 110;

describe('campaign advisor', () => {
  it('returns a standard and an "appear first" tier', () => {
    const s = suggestCampaign({ cpcMinMinor: CPC_MIN_MINOR });
    expect(s.standard.cpcMinor).toBeGreaterThan(0);
    expect(s.appearFirst.cpcMinor).toBeGreaterThan(s.standard.cpcMinor);
    expect(s.standard.dailyBudgetMinor).toBeGreaterThanOrEqual(s.standard.cpcMinor);
  });

  it('daily budget is a multiple-ish of CPC', () => {
    const s = suggestCampaign({ cpcMinMinor: CPC_MIN_MINOR });
    expect(s.standard.dailyBudgetMinor).toBeGreaterThan(s.standard.cpcMinor * 5);
    expect(s.appearFirst.dailyBudgetMinor).toBeGreaterThan(s.appearFirst.cpcMinor * 5);
  });

  it('recommended CPC is set above the current market-leading CPC', () => {
    const s = suggestCampaign({ marketMaxCpcMinor: 500, cpcMinMinor: CPC_MIN_MINOR });
    expect(s.appearFirst.cpcMinor).toBeGreaterThan(500);
  });

  it('recommended daily budget clears the full-CPC-score reference (2000)', () => {
    const s = suggestCampaign({ marketMaxCpcMinor: 20, cpcMinMinor: CPC_MIN_MINOR });
    expect(s.appearFirst.dailyBudgetMinor).toBeGreaterThanOrEqual(2000);
  });

  it('handles no market data at all', () => {
    const s = suggestCampaign({ cpcMinMinor: CPC_MIN_MINOR });
    expect(s.standard.cpcMinor).toBeGreaterThan(0);
    expect(Number.isInteger(s.standard.cpcMinor)).toBe(true);
    expect(Number.isInteger(s.standard.dailyBudgetMinor)).toBe(true);
  });

  it('standard tier tracks the real CPC minim, not a hardcoded constant', () => {
    expect(suggestCampaign({ cpcMinMinor: 110 }).standard.cpcMinor).toBe(110);
    expect(suggestCampaign({ cpcMinMinor: 250 }).standard.cpcMinor).toBe(250);
  });
});
