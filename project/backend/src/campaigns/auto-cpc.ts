/**
 * AUTO mode's CPC policy — kept pure so it is easy to reason about and test.
 *
 * AUTO sets the CPC that tops out the CPC visibility sub-score — the
 * "recommended" bid for the category (computed by the advisor from the
 * category-leading rival CPC and the service radius) — but never above 10% of
 * the daily budget per click. That ceiling both keeps two AUTO campaigns from
 * bidding each other up without limit and guarantees the budget still buys
 * ~10 clicks a day.
 */

/** Floor CPC in minor units (0.30 credits) — AUTO never bids below this. */
export const AUTO_MIN_CPC_MINOR = 30;
/** AUTO never spends more than this share of the daily budget on a single click. */
export const AUTO_MAX_CPC_BUDGET_FRACTION = 0.1;

/** The most AUTO may bid for a given daily budget — 10% of it, never below the floor. */
export function autoBudgetCapMinor(dailyBudgetMinor: number): number {
  return Math.max(AUTO_MIN_CPC_MINOR, Math.floor(dailyBudgetMinor * AUTO_MAX_CPC_BUDGET_FRACTION));
}

/**
 * The CPC AUTO actually sets: the score-maxing (recommended) bid for the
 * category, clamped up to the floor and down to the 10%-of-budget ceiling. When
 * the recommended CPC fits under the ceiling, AUTO bids exactly it (no
 * overpaying); when it doesn't, AUTO bids the ceiling and the caller flags
 * `autoBudgetLimited`.
 */
export function autoResolvedCpcMinor(
  recommendedCpcMinor: number,
  dailyBudgetMinor: number,
): number {
  const target = Math.max(recommendedCpcMinor, AUTO_MIN_CPC_MINOR);
  return Math.min(target, autoBudgetCapMinor(dailyBudgetMinor));
}
