/**
 * AUTO mode's CPC policy — kept pure so it is easy to reason about and test.
 *
 * AUTO sets the CPC Maxim that tops out the CPC visibility sub-score — the
 * "recommended" bid (computed by the advisor from the Feed's CPC-local
 * schedule) — but never above 10% of the daily budget per click, and never
 * below the Feed's own CPC minim (`floorMinor`, the current admin margins —
 * bidding under it would make the campaign ineligible everywhere). That
 * ceiling both keeps two AUTO campaigns from bidding each other up without
 * limit and guarantees the budget still buys ~10 clicks a day.
 */

/** AUTO never spends more than this share of the daily budget on a single click. */
export const AUTO_MAX_CPC_BUDGET_FRACTION = 0.1;

/** The most AUTO may bid for a given daily budget — 10% of it, never below the Feed's CPC minim. */
export function autoBudgetCapMinor(dailyBudgetMinor: number, floorMinor: number): number {
  return Math.max(floorMinor, Math.floor(dailyBudgetMinor * AUTO_MAX_CPC_BUDGET_FRACTION));
}

/**
 * The CPC AUTO actually sets: the score-maxing (recommended) bid for the
 * Feed, clamped up to the CPC minim floor and down to the 10%-of-budget
 * ceiling. When the recommended CPC fits under the ceiling, AUTO bids exactly
 * it (no overpaying); when it doesn't, AUTO bids the ceiling and the caller
 * flags `autoBudgetLimited`.
 */
export function autoResolvedCpcMinor(
  recommendedCpcMinor: number,
  dailyBudgetMinor: number,
  floorMinor: number,
): number {
  const target = Math.max(recommendedCpcMinor, floorMinor);
  return Math.min(target, autoBudgetCapMinor(dailyBudgetMinor, floorMinor));
}
