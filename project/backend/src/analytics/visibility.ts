/**
 * Feed ranking — the Visibility Score.
 *
 *   Visibility Score = CPC×0.35 + ResponseRate×0.30 + Plan×0.20 + Age×0.15
 *
 * Every sub-score is normalised to 0..1 and the weights are fixed (this is the
 * algorithm, not a tuning knob). The normalisation references below ARE knobs
 * and can move to `platform_settings` later.
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

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** CPC Score — the campaign's set daily budget, normalised against a reference. */
export function cpcScore(dailyBudgetMinor: number, refMinor = DEFAULT_REFS.budgetRefMinor): number {
  if (refMinor <= 0) return 0;
  return clamp01(dailyBudgetMinor / refMinor);
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
    avgResponseMinutes == null
      ? 0
      : clamp01(1 - avgResponseMinutes / refs.responseFloorMinutes);
  // Answering at all carries most of the weight; answering *fast* tops it up.
  return clamp01(rate * (0.4 + 0.6 * speed));
}

/** Plan Score — the advanced plan outranks the easy plan. */
export function planScore(mode: string | null | undefined): number {
  return mode === 'advanced' ? 1 : 0.5;
}

/** Campaign Age Score — a longer-running campaign ranks higher. */
export function campaignAgeScore(
  activatedAt: Date | string | null | undefined,
  now: Date = new Date(),
  fullDays = DEFAULT_REFS.ageFullDays,
): number {
  if (!activatedAt) return 0;
  const ms = now.getTime() - new Date(activatedAt).getTime();
  if (ms <= 0) return 0;
  return clamp01(ms / 86_400_000 / fullDays);
}

export interface VisibilityInput {
  dailyBudgetMinor: number;
  leadsTotal: number;
  leadsResponded: number;
  avgResponseMinutes: number | null;
  planMode: string | null;
  activatedAt: Date | string | null;
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
  now: Date = new Date(),
): VisibilityBreakdown {
  const cpc = cpcScore(input.dailyBudgetMinor, refs.budgetRefMinor);
  const response = responseRateScore(
    input.leadsTotal,
    input.leadsResponded,
    input.avgResponseMinutes,
    refs,
  );
  const plan = planScore(input.planMode);
  const age = campaignAgeScore(input.activatedAt, now, refs.ageFullDays);
  const score = 0.35 * cpc + 0.3 * response + 0.2 * plan + 0.15 * age;
  return { score: clamp01(score), cpc, response, plan, age };
}
