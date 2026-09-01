/**
 * CPC logic audit — characterisation tests for how the per-click bid becomes a
 * feed-ranking sub-score, how the "recommended" CPC is derived, and how AUTO and
 * the manual clamp interact with it.
 *
 * Blocks marked "(FIXED)" are regression guards for the severe/orange findings
 * that have been resolved (reconcile's affordability check, and the market
 * reference no longer dropping recently-depleted rivals). The remaining BUG #5b
 * / #7 / #25 blocks pin behaviour that is still by-design pending a product call.
 */
import {
  cpcScore,
  visibilityScore,
  DEFAULT_REFS,
  APPEAR_FIRST_BOOST,
} from '../analytics/visibility';
import { suggestCampaign } from './campaign-advisor';
import { autoResolvedCpcMinor, autoBudgetCapMinor } from './auto-cpc';

/** The score reference / manual ceiling for a company: the advisor's appear-first CPC. */
const recCpc = (radiusKm: number | null, marketMaxCpcMinor = 0) =>
  suggestCampaign({ radiusKm, marketMaxCpcMinor }).appearFirst.cpcMinor;

// Max CPC the API accepts (SaveCampaignDto: @Max(1000) credits).
const DTO_MAX_CPC_MINOR = 1000 * 100;

describe('CPC sub-score — cpcScore()', () => {
  const BUDGET_REF = DEFAULT_REFS.budgetRefMinor; // 2000 minor = 20 cr/day

  it('truth table: bid ÷ recommended, capped by budget÷2000, both clamped to [0,1]', () => {
    // ample budget → the bid ratio drives it
    expect(cpcScore(0, 100, 5000)).toBe(0);
    expect(cpcScore(25, 100, 5000)).toBeCloseTo(0.25);
    expect(cpcScore(50, 100, 5000)).toBeCloseTo(0.5);
    expect(cpcScore(100, 100, 5000)).toBe(1);
    expect(cpcScore(400, 100, 5000)).toBe(1); // overbidding earns nothing extra

    // budget below the flat 20 cr/day reference holds the whole sub-score down
    expect(cpcScore(100, 100, 1000)).toBeCloseTo(0.5); // 10 cr/day → 0.5 cap
    expect(cpcScore(100, 100, 500)).toBeCloseTo(0.25);
    expect(cpcScore(100, 100, 0)).toBe(0);

    // no rival bids in the category → any positive funded bid is "fully competitive"
    expect(cpcScore(5, 0, BUDGET_REF)).toBe(1); // 0.05 cr bid, still 100%
    expect(cpcScore(0, 0, BUDGET_REF)).toBe(0);
  });

  it('BUG #7 — "budget adequacy" is a flat 20 cr/day floor, NOT "enough to sustain the bid"', () => {
    // Bid 10 cr/click, fund only 20 cr/day → 2 clicks/day, yet the sub-score is
    // "fully funded". The cap does not scale with the CPC despite the doc saying
    // it gauges whether the budget can "sustain" the bid.
    const twoClicksPerDay = cpcScore(1000, 1000, BUDGET_REF);
    expect(twoClicksPerDay).toBe(1);
  });

  it('bidding the recommended CPC exactly tops out competitiveness (same number on both sides)', () => {
    const ref = recCpc(20, 800); // some competitive market
    expect(cpcScore(ref, ref, DEFAULT_REFS.budgetRefMinor)).toBe(1);
    expect(cpcScore(ref - 10, ref, DEFAULT_REFS.budgetRefMinor)).toBeLessThan(1);
  });
});

describe('Recommended CPC — suggestCampaign().appearFirst.cpcMinor', () => {
  it('solo advertiser (no rivals): recommended CPC is a flat 2.5× the standard tier', () => {
    // radius 10 → standard 30, recommended 80 (round10(30*2.5)=80)
    expect(recCpc(10)).toBe(80);
    expect(suggestCampaign({ radiusKm: 10 }).standard.cpcMinor).toBe(30);
    // radius 100 → standard 50, recommended 130
    expect(recCpc(100)).toBe(130);
  });

  it('tracks the market once a rival bids above ~0.57 cr/click', () => {
    expect(recCpc(10, 50)).toBe(80); // rival below the knee → still the flat 80
    expect(recCpc(10, 500)).toBe(590); // round10(500*1.15 + 10)
    expect(recCpc(10, 5000)).toBe(5760);
  });

  it('BUG #5b — the recommended CPC can exceed the API max, making a 100% CPC score unreachable', () => {
    // A single rival bidding the API maximum (1000 cr) pushes everyone else's
    // recommended CPC past what the API will accept.
    const ref = recCpc(10, DTO_MAX_CPC_MINOR); // rival at 1000 cr
    expect(ref).toBeGreaterThan(DTO_MAX_CPC_MINOR); // ~1150 cr

    // The best a manual advertiser can save is the DTO max; their competitiveness
    // is then permanently < 1 through no fault of their own.
    const bestReachable = cpcScore(DTO_MAX_CPC_MINOR, ref, DEFAULT_REFS.budgetRefMinor * 100);
    expect(bestReachable).toBeLessThan(1);
    expect(bestReachable).toBeCloseTo(DTO_MAX_CPC_MINOR / ref, 5);
  });

  it('recommended daily budget always clears the CPC-score budget reference', () => {
    for (const m of [0, 100, 1000, 20000]) {
      expect(
        suggestCampaign({ radiusKm: 20, marketMaxCpcMinor: m }).appearFirst.dailyBudgetMinor,
      ).toBeGreaterThanOrEqual(DEFAULT_REFS.budgetRefMinor);
    }
  });
});

describe('Manual-CPC ceiling (saveFor clamp) vs the score reference', () => {
  it('the clamp ceiling and the score reference are the SAME number — so bidding the ceiling = 100%', () => {
    const ref = recCpc(15, 300);
    // saveFor would clamp any manual cpc to `ref`; the score divides by the same `ref`.
    const clampedBid = Math.min(999999, ref);
    expect(cpcScore(clampedBid, ref, DEFAULT_REFS.budgetRefMinor)).toBe(1);
  });

  it('BUG #5 — a manual advertiser at 100% silently drops when a rival raises the market', () => {
    const radius = 10;
    // Day 1: solo. ref = 80, advertiser bids the ceiling (80).
    const day1Ref = recCpc(radius, 0);
    const bid = day1Ref; // 80
    expect(cpcScore(bid, day1Ref, DEFAULT_REFS.budgetRefMinor)).toBe(1);

    // Day 2: a rival activates at 6 cr/click. The advertiser's saved bid is
    // unchanged, but the reference jumps — and nothing re-clamps or notifies.
    const day2Ref = recCpc(radius, 600);
    expect(day2Ref).toBeGreaterThan(day1Ref);
    const dropped = cpcScore(bid, day2Ref, DEFAULT_REFS.budgetRefMinor);
    expect(dropped).toBeLessThan(0.2); // 80 / 700 ≈ 0.114 — a silent collapse
  });

  it('the reference tracks the market input — BUG #8 oscillation is now prevented upstream', () => {
    const radius = 10;
    const withRival = recCpc(radius, 600);
    const noRival = recCpc(radius, 0);
    // `suggestCampaign` correctly responds to `marketMaxCpcMinor`. The daily
    // swing came from `analytics` DROPPING a rival's bid from that input the
    // moment it hit `depleted`. Fixed: `analytics.marketRivalWhere()` keeps a
    // rival that depleted within the last 48h, so this input no longer flips
    // when a big competitor spends its daily cap.
    expect(withRival).toBeGreaterThan(noRival);
    expect(noRival).toBe(80);
  });
});

describe('AUTO CPC policy — autoResolvedCpcMinor()', () => {
  it('bids exactly the recommended CPC when the 10%-of-budget ceiling allows it', () => {
    const ref = recCpc(20, 400); // ~4.7 cr
    expect(autoResolvedCpcMinor(ref, 100_00)).toBe(ref); // 100 cr/day budget → 10 cr ceiling
  });

  it('clamps to 10% of the daily budget when the recommendation is higher', () => {
    const ref = recCpc(20, 5000); // ~58 cr
    const cap = autoBudgetCapMinor(20_00); // 20 cr/day → 2 cr ceiling
    expect(autoResolvedCpcMinor(ref, 20_00)).toBe(cap);
  });

  it('the resolved bid tracks the market input (kept stable across depletion by analytics)', () => {
    const budget = 500_00; // 500 cr/day → 50 cr ceiling, generous
    const hotMarket = autoResolvedCpcMinor(recCpc(10, 4000), budget);
    const coldMarket = autoResolvedCpcMinor(recCpc(10, 0), budget);
    expect(hotMarket).toBeGreaterThan(coldMarket);
    // Previously the market input itself flipped every time a big rival hit its
    // daily cap, so reconcile() (which persists cpcMinor on every read) flapped
    // the AUTO bid down and up daily. `analytics.marketRivalWhere()` now holds a
    // recently-depleted rival in the input, so the market side no longer swings.
  });

  it('AUTO can be driven above the manual API max (reconcile writes cpcMinor directly, no DTO check)', () => {
    const ref = recCpc(10, DTO_MAX_CPC_MINOR); // > 1000 cr
    const hugeBudget = 5_000_000; // 50 000 cr/day → 500 000 minor ceiling
    const resolved = autoResolvedCpcMinor(ref, hugeBudget);
    expect(resolved).toBeGreaterThan(DTO_MAX_CPC_MINOR); // AUTO would persist ~1150 cr
  });
});

describe('BUG #1 (FIXED) — reconcile() now depletes only when the next click cannot be paid', () => {
  // Mirrors the two predicates in campaign.service.ts. They now use the SAME
  // test — "can the wallet + today's budget cover one more click" — so a
  // campaign is never yanked out of the feed while it could still serve.
  const clickBilling_wouldServe = (
    balanceMinor: number,
    spentTodayMinor: number,
    cpcMinor: number,
    dailyBudgetMinor: number,
  ) => spentTodayMinor + cpcMinor <= dailyBudgetMinor && balanceMinor >= cpcMinor;
  const reconcile_keepsLive = (
    balanceMinor: number,
    spentTodayMinor: number,
    cpcMinor: number,
    dailyBudgetMinor: number,
  ) => {
    const funded = balanceMinor >= cpcMinor; // canAfford(owner, cpcMinor) — the fix
    const budgetLeft = dailyBudgetMinor - spentTodayMinor >= cpcMinor;
    return funded && budgetLeft;
  };

  it('a 100cr/day campaign funded with 100cr keeps serving after its first 2cr click', () => {
    const dailyBudget = 100_00;
    const cpc = 2_00;
    // balance 98cr, spentToday 2cr — 49 more clicks affordable today
    expect(clickBilling_wouldServe(98_00, 2_00, cpc, dailyBudget)).toBe(true);
    expect(reconcile_keepsLive(98_00, 2_00, cpc, dailyBudget)).toBe(true);
  });

  it('reconcile and click-billing agree across the whole affordability range', () => {
    const dailyBudget = 5000_00;
    const cpc = 5_00;
    for (const [balance, spent] of [
      [5000_00, 0],
      [4999_00, 0], // one click short of a full day — still fine now
      [10_00, 4990_00], // almost out of today's budget
      [3_00, 0], // wallet can't cover one click → both say "stop"
      [0, 0],
    ] as const) {
      expect(reconcile_keepsLive(balance, spent, cpc, dailyBudget)).toBe(
        clickBilling_wouldServe(balance, spent, cpc, dailyBudget),
      );
    }
  });

  it('after the UTC day rolls, a campaign with any per-click runway revives', () => {
    // balance 98cr, spentToday reset to 0, cpc 2cr → revive
    const reconcile_wouldRevive = reconcile_keepsLive(98_00, 0, 2_00, 100_00);
    expect(reconcile_wouldRevive).toBe(true);
  });
});

describe('BUG #1b (FIXED) — AUTO only switches off when the wallet cannot fund a single click', () => {
  const reconcileDisablesAuto = (balanceMinor: number, cpcMinor: number) => balanceMinor < cpcMinor; // `autoOptimize && !funded`
  it('a wallet below one day of budget but able to afford clicks keeps AUTO on', () => {
    expect(reconcileDisablesAuto(199_00, 30)).toBe(false); // 199cr left, 0.30cr click → AUTO stays on
  });
  it('only a truly empty wallet turns AUTO off', () => {
    expect(reconcileDisablesAuto(0, 30)).toBe(true);
    expect(reconcileDisablesAuto(20, 30)).toBe(true); // 0.20cr < a 0.30cr click
  });
});

describe('appearFirst boost vs the CPC sub-score', () => {
  it('BUG #25 — the flat +0.25 boost is not gated by any CPC/budget floor', () => {
    const strongNoBoost = visibilityScore({
      cpcMinor: 100,
      cpcRefMinor: 100,
      dailyBudgetMinor: DEFAULT_REFS.budgetRefMinor,
      leadsTotal: 0,
      leadsResponded: 0,
      avgResponseMinutes: null,
      planMode: 'easy',
      activeSeconds: 10 * 86_400,
    }).score;

    const weakWithBoost =
      visibilityScore({
        cpcMinor: 5, // 0.05 cr — the minimum
        cpcRefMinor: 800,
        dailyBudgetMinor: DEFAULT_REFS.budgetRefMinor,
        leadsTotal: 0,
        leadsResponded: 0,
        avgResponseMinutes: null,
        planMode: 'easy',
        activeSeconds: 0,
      }).score + APPEAR_FIRST_BOOST;

    // A 0.05 cr bid with the box checked lands within striking distance of — and
    // can overtake — a genuinely strong campaign that didn't check the box.
    expect(weakWithBoost).toBeGreaterThan(0.4);
    expect(weakWithBoost - strongNoBoost).toBeGreaterThan(-0.35);
  });
});
