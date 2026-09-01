import { analyzeCampaign, type OptimizeContext } from './campaign-optimizer';

const WEIGHTS = { cpc: 35, response: 30, plan: 20, age: 15 };

const base: OptimizeContext = {
  parts: { cpc: 100, response: 100, plan: 100, age: 100 },
  weights: WEIGHTS,
  planMode: 'advanced',
  activeDays: 40,
  ageFullDays: 30,
  leadsTotal: 10,
};

describe('analyzeCampaign', () => {
  it('returns nothing when every sub-score is maxed out', () => {
    expect(analyzeCampaign(base)).toEqual([]);
  });

  it('flags an easy plan as a high-severity fix', () => {
    const f = analyzeCampaign({
      ...base,
      planMode: 'easy',
      parts: { ...base.parts, plan: 50 },
    });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ area: 'plan', severity: 'high', gainPct: 10 });
  });

  it('flags a low budget, harder when the CPC score is very low', () => {
    expect(analyzeCampaign({ ...base, parts: { ...base.parts, cpc: 20 } })[0]).toMatchObject({
      area: 'cpc',
      severity: 'high',
    });
    expect(analyzeCampaign({ ...base, parts: { ...base.parts, cpc: 70 } })[0]).toMatchObject({
      area: 'cpc',
      severity: 'medium',
    });
  });

  it('only advises on response speed once there are leads', () => {
    const weak = { ...base.parts, response: 40 };
    expect(analyzeCampaign({ ...base, parts: weak, leadsTotal: 0 })).toEqual([]);
    expect(analyzeCampaign({ ...base, parts: weak, leadsTotal: 3 })[0]).toMatchObject({
      area: 'response',
      severity: 'high',
    });
  });

  it('advises letting a young campaign run, but not once it is nearly aged in', () => {
    expect(
      analyzeCampaign({ ...base, activeDays: 3, parts: { ...base.parts, age: 10 } })[0],
    ).toMatchObject({ area: 'age' });
    expect(analyzeCampaign({ ...base, activeDays: 26, parts: { ...base.parts, age: 87 } })).toEqual(
      [],
    );
  });

  it('orders findings by recoverable visibility points, heaviest first', () => {
    const f = analyzeCampaign({
      ...base,
      planMode: 'easy',
      activeDays: 5,
      parts: { cpc: 30, response: 50, plan: 50, age: 20 },
    });
    expect(f.map((x) => x.area)).toEqual(['cpc', 'response', 'age', 'plan']);
    // cpc: 35*0.7≈25, response: 30*0.5=15, age: 15*0.8=12, plan: 20*0.5=10
    expect(f.map((x) => x.gainPct)).toEqual([25, 15, 12, 10]);
  });
});
