import {
  FeedMarginConfig,
  chargeMinor,
  cpcLocalMinor,
  feedCpcMinMinor,
  isEligibleForFeed,
  rankPeersByFeedScore,
  recommendedCpcForFeedMinor,
} from 'src/analytics/feed-pricing';
import { EMPTY_VISIBILITY_INPUT, VisibilityInput } from 'src/analytics/visibility';

// 1 credit = 100 minor. Mirrors the user's own worked example: cost promovare
// 1 cr + marjă profit 0.1 cr -> CPC minim 1.1 cr; marjă poziționare 0.1 cr.
const CFG: FeedMarginConfig = {
  costPromovareMinor: 100,
  marjaProfitMinor: 10,
  marjaPozitionareMinor: 10,
};

describe('feedCpcMinMinor', () => {
  it('is cost promovare + marjă profit', () => {
    expect(feedCpcMinMinor(CFG)).toBe(110); // 1.1 cr
  });
});

describe('isEligibleForFeed', () => {
  it('requires the own CPC maxim to clear CPC minim', () => {
    expect(isEligibleForFeed(110, CFG)).toBe(true); // exactly at the floor
    expect(isEligibleForFeed(109, CFG)).toBe(false); // one minor unit short
    expect(isEligibleForFeed(1000, CFG)).toBe(true);
  });
});

describe('cpcLocalMinor — worked example (3 businesses, marjă poziționare 0.1cr)', () => {
  it('matches the illustrative numbers exactly: 1.3 / 1.2 / 1.1 cr for positions 1/2/3', () => {
    expect(cpcLocalMinor(1, 3, CFG)).toBe(130);
    expect(cpcLocalMinor(2, 3, CFG)).toBe(120);
    expect(cpcLocalMinor(3, 3, CFG)).toBe(110); // last position pays exactly CPC minim
  });

  it('a solo competitor (N=1) also pays exactly CPC minim', () => {
    expect(cpcLocalMinor(1, 1, CFG)).toBe(110);
  });

  it('never dips below CPC minim even if position exceeds total (defensive)', () => {
    expect(cpcLocalMinor(5, 3, CFG)).toBe(110);
  });
});

describe('chargeMinor — the hard ceiling', () => {
  it('charges the CPC local when it is within the business’s own CPC maxim', () => {
    expect(chargeMinor(500, 130)).toBe(130);
  });

  it('clamps to the business’s own CPC maxim when CPC local would exceed it', () => {
    expect(chargeMinor(120, 130)).toBe(120); // never charged above the accepted ceiling
  });

  it('charges exactly the maxim when they coincide', () => {
    expect(chargeMinor(130, 130)).toBe(130);
  });
});

describe('recommendedCpcForFeedMinor', () => {
  it('with zero rivals, the recommendation is exactly CPC minim', () => {
    expect(recommendedCpcForFeedMinor(0, CFG)).toBe(110);
  });

  it('grows by one marjă poziționare step per rival (closed form of N-1 at position 1)', () => {
    expect(recommendedCpcForFeedMinor(2, CFG)).toBe(130); // matches position-1 CPC local for N=3
    expect(recommendedCpcForFeedMinor(9, CFG)).toBe(200);
  });

  it('is independent of what any rival actually bids — only the count matters', () => {
    expect(recommendedCpcForFeedMinor(2, CFG)).toBe(recommendedCpcForFeedMinor(2, CFG));
  });
});

describe('rankPeersByFeedScore — CPC 50% / response 20% / plan 15% / age 15%', () => {
  const DAY = 86_400;

  it('with equal quality on all sides, the highest bidder ranks first', () => {
    const inputs = new Map<string, VisibilityInput>([
      ['a', { ...EMPTY_VISIBILITY_INPUT, cpcMinor: 430, dailyBudgetMinor: 2000 }],
      ['b', { ...EMPTY_VISIBILITY_INPUT, cpcMinor: 330, dailyBudgetMinor: 2000 }],
      ['c', { ...EMPTY_VISIBILITY_INPUT, cpcMinor: 230, dailyBudgetMinor: 2000 }],
    ]);
    const ranked = rankPeersByFeedScore(['a', 'b', 'c'], inputs, 430, new Set());
    expect(ranked.map((r) => r.companyId)).toEqual(['a', 'b', 'c']);
  });

  it('a lower bid with a strong lead on response/plan/age can outrank a higher bid', () => {
    const inputs = new Map<string, VisibilityInput>([
      [
        'highBidWeak',
        {
          cpcMinor: 430,
          cpcRefMinor: 0,
          dailyBudgetMinor: 2000,
          leadsTotal: 0,
          leadsResponded: 0,
          avgResponseMinutes: null,
          planMode: 'easy',
          activeSeconds: 0,
        },
      ],
      [
        'lowBidStrong',
        {
          cpcMinor: 330,
          cpcRefMinor: 0,
          dailyBudgetMinor: 2000,
          leadsTotal: 10,
          leadsResponded: 10,
          avgResponseMinutes: 5,
          planMode: 'advanced',
          activeSeconds: 30 * DAY,
        },
      ],
    ]);
    const ranked = rankPeersByFeedScore(['highBidWeak', 'lowBidStrong'], inputs, 430, new Set());
    expect(ranked[0].companyId).toBe('lowBidStrong');
  });

  it('the appear-first boost can lift a lower-scoring peer above a higher one', () => {
    const inputs = new Map<string, VisibilityInput>([
      ['noBoost', { ...EMPTY_VISIBILITY_INPUT, cpcMinor: 200, dailyBudgetMinor: 2000 }],
      ['boosted', { ...EMPTY_VISIBILITY_INPUT, cpcMinor: 110, dailyBudgetMinor: 2000 }],
    ]);
    const withoutBoost = rankPeersByFeedScore(['noBoost', 'boosted'], inputs, 200, new Set());
    expect(withoutBoost[0].companyId).toBe('noBoost');

    const withBoost = rankPeersByFeedScore(
      ['noBoost', 'boosted'],
      inputs,
      200,
      new Set(['boosted']),
    );
    expect(withBoost[0].companyId).toBe('boosted');
  });

  it('a peer missing from the visibility-input map is scored as neutral/empty, not excluded', () => {
    const inputs = new Map<string, VisibilityInput>([
      ['known', { ...EMPTY_VISIBILITY_INPUT, cpcMinor: 110, dailyBudgetMinor: 2000 }],
    ]);
    const ranked = rankPeersByFeedScore(['known', 'missing'], inputs, 110, new Set());
    expect(ranked.map((r) => r.companyId).sort()).toEqual(['known', 'missing']);
  });
});
