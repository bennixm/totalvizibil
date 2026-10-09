/**
 * Rule-based campaign suggestions (spec: "Platforma oferă sugestii automate
 * pentru buget și CPC Maxim").
 *
 * `standard` is the CPC minim (costPromovare + marjă profit) for a Feed under
 * the current admin margins — the lowest CPC Maxim that still clears the
 * eligibility floor everywhere, same "entry" price regardless of company,
 * since the margins are platform-wide. `appearFirst` is a *fallback* for when
 * a company has no resolvable Feed yet (no category/location set) — "beat
 * the market by 15%". Once a company has at least one Feed,
 * `AnalyticsService.recommendedCpcFor` supersedes this with the real
 * CPC-minim + Taxă-poziție schedule; this function stays only as that
 * fallback and as the `standard` tier source.
 */

import { DEFAULT_REFS } from '../analytics/visibility';

/** Fallback multiplier for the recommended CPC when there is no market data. */
const RECOMMENDED_MULT = 2.5;
/** Headroom over the current market-leading CPC, so "recommended" actually wins. */
const MARKET_LEAD = 1.15;
/** Daily budget = CPC x expected clicks. */
const STANDARD_CLICKS = 20;
const RECOMMENDED_CLICKS = 25;

export interface CampaignTier {
  cpcMinor: number;
  dailyBudgetMinor: number;
}

export interface CampaignSuggestions {
  standard: CampaignTier;
  /** Tops out the Visibility Score: full CPC sub-score + market-leading CPC. */
  appearFirst: CampaignTier;
}

export interface AdvisorInput {
  /** Highest CPC (minor units) among other active campaigns right now. */
  marketMaxCpcMinor?: number | null;
  /** CPC minim (minor units) for a Feed under the current admin margins — grounds `standard`. */
  cpcMinMinor: number;
}

export const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10);

export function suggestCampaign(input: AdvisorInput): CampaignSuggestions {
  const stdCpc = round10(input.cpcMinMinor);

  // Beat the field: one notch above the current highest active CPC (with a
  // sane floor when the platform has no competing campaigns yet).
  const market = Math.max(input.marketMaxCpcMinor ?? 0, 0);
  const recCpc = round10(
    Math.max(market * MARKET_LEAD + 10, stdCpc * RECOMMENDED_MULT, stdCpc + 10),
  );

  // Daily budget must clear the reference that earns a full CPC sub-score.
  const recBudget = Math.max(round10(recCpc * RECOMMENDED_CLICKS), DEFAULT_REFS.budgetRefMinor);

  return {
    standard: {
      cpcMinor: stdCpc,
      dailyBudgetMinor: round10(stdCpc * STANDARD_CLICKS),
    },
    appearFirst: {
      cpcMinor: recCpc,
      dailyBudgetMinor: recBudget,
    },
  };
}
