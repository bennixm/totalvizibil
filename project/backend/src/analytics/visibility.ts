/**
 * Feed ranking — the Visibility Score.
 *
 *   Visibility Score = CPC×0.35 + ResponseRate×0.30 + Plan×0.20 + Age×0.15
 *
 * Every sub-score is normalised to 0..1 and the weights are fixed (this is the
 * algorithm, not a tuning knob). The normalisation references below ARE knobs
 * and can move to `platform_settings` later.
 *
 * The CPC sub-score reads the actual per-click bid against the CPC that would
 * lead the category (the "recommended" bid), then caps that by whether the
 * daily budget is funded enough to sustain it — so dropping the CPC below the
 * recommendation costs feed position straight away.
 */

export interface VisibilityRefs {
  /** Daily budget (minor units) that earns a full CPC score. */
  budgetRefMinor: number;
  /** Average response time (minutes) at which the speed factor hits 0. */
  responseFloorMinutes: number;
  /** Days a campaign must have run to earn a full age score. */
  ageFullDays: number;
}

export const DEFAULT_REFS: VisibilityRefs = {
  budgetRefMinor: 2000, // 20 credits / day
  responseFloorMinutes: 720, // 12 h
  ageFullDays: 30,
};

/**
 * A funded "appear first" campaign gets this added on top of its Visibility
 * Score when the feed (and the rank calculation) orders listings.
 */
export const APPEAR_FIRST_BOOST = 0.25;

/**
 * How long a stopped campaign keeps the run time it has banked. Stop for less
 * than this and the run-time (age) score is preserved; stop for longer and it
 * resets to zero — an idle campaign shouldn't coast on time it no longer earns.
 */
export const RUN_SCORE_GRACE_MS = 24 * 60 * 60 * 1000;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * CPC Score — how competitive the per-click bid is against the CPC that would
 * lead this company's category (`cpcRefMinor`, the "recommended" bid), capped
 * by budget adequacy (the daily budget still has to clear the funding
 * reference). Bidding at or above the recommendation tops it out; halving the
 * bid roughly halves this sub-score. A category with no rival bids has no
 * reference, so any funded positive bid is treated as fully competitive.
 */
export function cpcScore(
  cpcMinor: number,
  cpcRefMinor: number,
  dailyBudgetMinor: number,
  budgetRefMinor = DEFAULT_REFS.budgetRefMinor,
): number {
  const bid = cpcMinor > 0 ? cpcMinor : 0;
  const competitiveness = cpcRefMinor > 0 ? clamp01(bid / cpcRefMinor) : bid > 0 ? 1 : 0;
  const budgetAdequacy = budgetRefMinor > 0 ? clamp01(dailyBudgetMinor / budgetRefMinor) : 0;
  return Math.min(competitiveness, budgetAdequacy);
}

/**
 * Response Rate Score — how reliably *and* how fast the business replies to the
 * leads it gets. A business with no lead history yet scores a neutral 0.5 so it
 * isn't punished for silence it never had the chance to break.
 */
export function responseRateScore(
  leadsTotal: number,
  leadsResponded: number,
  avgResponseMinutes: number | null,
  refs: VisibilityRefs = DEFAULT_REFS,
): number {
  if (leadsTotal <= 0) return 0.5;
  const rate = clamp01(leadsResponded / leadsTotal);
  const speed =
    avgResponseMinutes == null ? 0 : clamp01(1 - avgResponseMinutes / refs.responseFloorMinutes);
  // Answering at all carries most of the weight; answering *fast* tops it up.
  return clamp01(rate * (0.4 + 0.6 * speed));
}

/** Plan Score — the advanced plan outranks the easy plan. */
export function planScore(mode: string | null | undefined): number {
  return mode === 'advanced' ? 1 : 0.5;
}

/**
 * Effective seconds a campaign has been *live* — the banked total of past runs
 * plus, if it is active right now, the time since the current run started. This
 * is what the run-time (age) score is built on: pausing a campaign freezes its
 * run time instead of letting wall-clock time keep counting.
 *
 * A stopped campaign keeps that banked run time only for a 24h grace window
 * (`RUN_SCORE_GRACE_MS`, measured from `pausedAt`). Past the window the run time
 * is treated as zero — reactivation then starts a fresh run.
 */
export function effectiveActiveSeconds(
  accruedSeconds: number,
  activatedAt: Date | string | null | undefined,
  isActive: boolean,
  now: Date = new Date(),
  pausedAt?: Date | string | null,
): number {
  const seconds = accruedSeconds > 0 ? accruedSeconds : 0;
  if (isActive && activatedAt) {
    const runMs = now.getTime() - new Date(activatedAt).getTime();
    return runMs > 0 ? seconds + Math.floor(runMs / 1000) : seconds;
  }
  if (pausedAt && now.getTime() - new Date(pausedAt).getTime() > RUN_SCORE_GRACE_MS) {
    return 0;
  }
  return seconds;
}

/** Run-time (age) score — a campaign that has been live longer ranks higher. */
export function campaignAgeScore(
  activeSeconds: number,
  fullDays = DEFAULT_REFS.ageFullDays,
): number {
  if (!activeSeconds || activeSeconds <= 0) return 0;
  return clamp01(activeSeconds / 86_400 / fullDays);
}

export interface VisibilityInput {
  /** The campaign's per-click bid (minor units). */
  cpcMinor: number;
  /** CPC that leads this category right now — the bid that tops out the score. */
  cpcRefMinor: number;
  dailyBudgetMinor: number;
  leadsTotal: number;
  leadsResponded: number;
  avgResponseMinutes: number | null;
  planMode: string | null;
  /** Banked live seconds (see `effectiveActiveSeconds`). */
  activeSeconds: number;
}

export interface VisibilityBreakdown {
  /** Blended score, 0..1. */
  score: number;
  cpc: number;
  response: number;
  plan: number;
  age: number;
}

export function visibilityScore(
  input: VisibilityInput,
  refs: VisibilityRefs = DEFAULT_REFS,
  // Age is now derived from banked live seconds on `input`, so wall-clock `now`
  // no longer feeds the score. Kept for call-site compatibility.
  _now: Date = new Date(),
): VisibilityBreakdown {
  const cpc = cpcScore(
    input.cpcMinor,
    input.cpcRefMinor,
    input.dailyBudgetMinor,
    refs.budgetRefMinor,
  );
  const response = responseRateScore(
    input.leadsTotal,
    input.leadsResponded,
    input.avgResponseMinutes,
    refs,
  );
  const plan = planScore(input.planMode);
  const age = campaignAgeScore(input.activeSeconds, refs.ageFullDays);
  const score = 0.35 * cpc + 0.3 * response + 0.2 * plan + 0.15 * age;
  return { score: clamp01(score), cpc, response, plan, age };
}
