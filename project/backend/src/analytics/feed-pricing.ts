/**
 * Feed CPC-local pricing — pure functions, no DB access.
 *
 * A "Feed" is one atomic (județ, subcategorie) pair. Within it:
 *
 *   CPC minim   = costPromovare + marjaProfit                      (floor, same at every position)
 *   Taxă poziție = (N − poziție) × marjaPozitionare                 (N = eligible competitors)
 *   CPC local   = CPC minim + Taxă poziție                          ("asking price" for that position)
 *   Taxat       = min(CPC maxim propriu, CPC local)                 (the firm's own bid is a hard ceiling)
 *
 * A firm whose own CPC maxim is below CPC minim cannot compete in that Feed at
 * all (`isEligibleForFeed` returns false) — it is never shown there and never
 * billed below the floor.
 *
 * All amounts are minor units (hundredths of a credit), the same convention as
 * everywhere else in the ledger.
 */

import {
  APPEAR_FIRST_BOOST,
  EMPTY_VISIBILITY_INPUT,
  VisibilityInput,
  visibilityScore,
} from './visibility';

export interface FeedMarginConfig {
  costPromovareMinor: number;
  marjaProfitMinor: number;
  marjaPozitionareMinor: number;
}

/** CPC minim — the floor price of any position in a Feed under this config. */
export function feedCpcMinMinor(cfg: FeedMarginConfig): number {
  return cfg.costPromovareMinor + cfg.marjaProfitMinor;
}

/** Whether a firm's own CPC maxim clears the Feed's floor price. */
export function isEligibleForFeed(ownCpcMaxMinor: number, cfg: FeedMarginConfig): boolean {
  return ownCpcMaxMinor >= feedCpcMinMinor(cfg);
}

/**
 * CPC local for a 1-based `position` among `totalEligible` competitors.
 * Position 1 (the top of the hierarchy) carries the largest Taxă poziție;
 * the last position pays exactly CPC minim.
 */
export function cpcLocalMinor(
  position: number,
  totalEligible: number,
  cfg: FeedMarginConfig,
): number {
  const taxaPozitie = Math.max(0, (totalEligible - position) * cfg.marjaPozitionareMinor);
  return feedCpcMinMinor(cfg) + taxaPozitie;
}

/** What a click actually costs: the position's asking price, never above the firm's own ceiling. */
export function chargeMinor(ownCpcMaxMinor: number, cpcLocal: number): number {
  return Math.min(ownCpcMaxMinor, cpcLocal);
}

/**
 * "CPC maxim recomandat" for one Feed — the CPC local a firm would be asked
 * for position 1 if it joined this Feed alongside `rivalCount` other already-
 * eligible competitors (excluding itself). Deliberately independent of what
 * any rival actually bids — a flat, explainable schedule, not a "beat the
 * market" target.
 */
export function recommendedCpcForFeedMinor(rivalCount: number, cfg: FeedMarginConfig): number {
  return feedCpcMinMinor(cfg) + Math.max(0, rivalCount) * cfg.marjaPozitionareMinor;
}

/**
 * Rank a Feed's eligible companies by the combined score (CPC 50% — against
 * `maxBidMinor`, this Feed's top bid — blended with response/plan/age 50%)
 * plus the flat "appear first" lift. The single ranking shared by display
 * (feed listing, dashboard rank) and billing (CPC-local position) — they
 * must never disagree about who holds which position.
 */
export function rankPeersByFeedScore(
  companyIds: string[],
  visibilityInputs: Map<string, VisibilityInput>,
  maxBidMinor: number,
  appearFirstIds: ReadonlySet<string>,
): Array<{ companyId: string; score: number }> {
  return companyIds
    .map((companyId) => {
      const base = visibilityScore({
        ...(visibilityInputs.get(companyId) ?? EMPTY_VISIBILITY_INPUT),
        cpcRefMinor: maxBidMinor,
      }).score;
      return { companyId, score: base + (appearFirstIds.has(companyId) ? APPEAR_FIRST_BOOST : 0) };
    })
    .sort((a, b) => b.score - a.score);
}
