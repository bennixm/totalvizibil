/**
 * Rule-based campaign suggestions (spec: "Platforma oferă sugestii automate
 * pentru buget și CPC" + "APARI PRIMUL").
 *
 * Deliberately NOT an auction/ML model — there is no real bid data yet. It
 * produces sane starting numbers the user can accept or override, plus a higher
 * "appear first" tier that bids more to rank near the top of the feed.
 */

/** Base CPC in minor units (hundredths of a credit) = 0.30 credits. */
const BASE_CPC_MINOR = 30;
/** "Appear first" bids roughly 2.5x the standard CPC. */
const APPEAR_FIRST_MULT = 2.5;
/** Daily budget = CPC x expected clicks. */
const STANDARD_CLICKS = 20;
const APPEAR_FIRST_CLICKS = 25;

export interface CampaignTier {
  cpcMinor: number;
  dailyBudgetMinor: number;
}

export interface CampaignSuggestions {
  standard: CampaignTier;
  appearFirst: CampaignTier;
}

export interface AdvisorInput {
  /** Service radius in km, if the location step was done. */
  radiusKm?: number | null;
}

const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10);

export function suggestCampaign(input: AdvisorInput = {}): CampaignSuggestions {
  // A wider service area implies more competing businesses -> up to +50% CPC.
  const radiusFactor = 1 + Math.min(Math.max(input.radiusKm ?? 10, 0) / 100, 0.5);

  const stdCpc = round10(BASE_CPC_MINOR * radiusFactor);
  const firstCpc = round10(stdCpc * APPEAR_FIRST_MULT);

  return {
    standard: {
      cpcMinor: stdCpc,
      dailyBudgetMinor: round10(stdCpc * STANDARD_CLICKS),
    },
    appearFirst: {
      cpcMinor: firstCpc,
      dailyBudgetMinor: round10(firstCpc * APPEAR_FIRST_CLICKS),
    },
  };
}
