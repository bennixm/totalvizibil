/**
 * Rule-based campaign suggestions (spec: "Platforma oferă sugestii automate
 * pentru buget și CPC").
 *
 * Deliberately NOT an auction/ML model — there is no real bid data yet. It
 * produces sane starting numbers the user can accept or override, plus a
 * "recommended" tier tuned to top out the Visibility Score: its daily budget
 * earns a full CPC sub-score and its CPC is set just above the highest CPC any
 * active campaign on the platform is currently bidding.
 */

import { DEFAULT_REFS } from '../analytics/visibility';

/** Base CPC in minor units (hundredths of a credit) = 0.30 credits. */
const BASE_CPC_MINOR = 30;
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
  /** Service radius in km, if the location step was done. */
  radiusKm?: number | null;
  /** Highest CPC (minor units) among other active campaigns right now. */
  marketMaxCpcMinor?: number | null;
}

const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10);

export function suggestCampaign(input: AdvisorInput = {}): CampaignSuggestions {
  // A wider service area implies more competing businesses -> up to +50% CPC.
  const radiusFactor = 1 + Math.min(Math.max(input.radiusKm ?? 10, 0) / 100, 0.5);
  const stdCpc = round10(BASE_CPC_MINOR * radiusFactor);

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
