/**
 * Campaign optimisation advisor.
 *
 * Reads the four Visibility Score sub-scores for one campaign and points out
 * where the business is leaving feed position on the table — upgrading the plan,
 * replying to leads faster, letting the campaign age, or raising the budget/CPC.
 * Pure and deterministic; the endpoint just feeds it the current numbers.
 */

export type OptimizationArea = 'plan' | 'response' | 'age' | 'cpc';

export interface OptimizationFinding {
  area: OptimizationArea;
  severity: 'high' | 'medium';
  /** Current sub-score, 0..100. */
  scorePct: number;
  /** This sub-score's fixed weight in the blend, 0..100. */
  weightPct: number;
  /** Visibility points still recoverable here = weight × (1 − score). */
  gainPct: number;
}

export interface OptimizeContext {
  parts: { cpc: number; response: number; plan: number; age: number };
  weights: { cpc: number; response: number; plan: number; age: number };
  /** 'advanced' earns the full plan score. */
  planMode: string | null;
  activeDays: number;
  ageFullDays: number;
  /** Leads received so far — response advice only makes sense once there are some. */
  leadsTotal: number;
}

const ORDER: Record<OptimizationArea, number> = { cpc: 0, response: 1, plan: 2, age: 3 };

const gain = (weightPct: number, scorePct: number): number =>
  Math.round((weightPct * (100 - scorePct)) / 100);

export function analyzeCampaign(ctx: OptimizeContext): OptimizationFinding[] {
  const { parts, weights } = ctx;
  const out: OptimizationFinding[] = [];

  // Plan — a one-click upgrade worth the full plan weight.
  if (ctx.planMode !== 'advanced' && parts.plan < 100) {
    out.push({
      area: 'plan',
      severity: 'high',
      scorePct: parts.plan,
      weightPct: weights.plan,
      gainPct: gain(weights.plan, parts.plan),
    });
  }

  // Budget / CPC — the heaviest lever.
  if (parts.cpc < 100) {
    out.push({
      area: 'cpc',
      severity: parts.cpc < 50 ? 'high' : 'medium',
      scorePct: parts.cpc,
      weightPct: weights.cpc,
      gainPct: gain(weights.cpc, parts.cpc),
    });
  }

  // Response rate & speed — only once the business has actually had leads.
  if (ctx.leadsTotal > 0 && parts.response < 85) {
    out.push({
      area: 'response',
      severity: parts.response < 55 ? 'high' : 'medium',
      scorePct: parts.response,
      weightPct: weights.response,
      gainPct: gain(weights.response, parts.response),
    });
  }

  // Age — pure time; flag it only while it is still meaningfully short.
  if (parts.age < 80 && ctx.activeDays < ctx.ageFullDays) {
    out.push({
      area: 'age',
      severity: parts.age < 40 ? 'high' : 'medium',
      scorePct: parts.age,
      weightPct: weights.age,
      gainPct: gain(weights.age, parts.age),
    });
  }

  return out.sort((a, b) => b.gainPct - a.gainPct || ORDER[a.area] - ORDER[b.area]);
}
