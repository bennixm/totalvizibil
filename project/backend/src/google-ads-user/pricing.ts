/**
 * Credit pricing of one optimization cycle on a customer's Google Ads
 * campaign. Priced on the WORK and its complexity, never on what the AI
 * call costs us: every task type has a credit weight per unit, plus a small
 * weight per campaign element analyzed; the raw sum picks a complexity
 * level whose multiplier is applied; the result is clamped between the
 * admin's minimum (10 credits by default) and a safety maximum.
 *
 * Everything here is configured from the admin panel
 * (`google_ads_optimizer_pricing`); the defaults below only apply until an
 * admin saves their own. Pure functions, no I/O, so quotes and settlements
 * are reproducible and testable.
 */

export const TASK_TYPES = [
  'analysis',
  'rsa_text',
  'keyword_headlines',
  'extensions',
  'images',
  'text_rewrite',
  'budget_proposal',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export interface ComplexityLevel {
  key: string;
  label: string;
  /** Raw credits (before multiplier) from which this level applies. */
  minPoints: number;
  multiplier: number;
}

export interface OptimizerPricing {
  minCredits: number;
  maxCredits: number;
  /** Credits per unit of each task type. */
  taskCredits: Record<TaskType, number>;
  /** Credits per campaign element analyzed (texts, assets, keywords). */
  perElementCredits: number;
  /** Sorted by minPoints ascending; the first level must start at 0. */
  levels: ComplexityLevel[];
}

export const DEFAULT_PRICING: OptimizerPricing = {
  minCredits: 10,
  maxCredits: 150,
  taskCredits: {
    analysis: 2,
    rsa_text: 0.5,
    keyword_headlines: 0.75,
    extensions: 0.4,
    images: 0.6,
    text_rewrite: 1,
    budget_proposal: 2,
  },
  perElementCredits: 0.02,
  levels: [
    { key: 'simple', label: 'Simplu', minPoints: 0, multiplier: 1 },
    { key: 'standard', label: 'Standard', minPoints: 8, multiplier: 1.15 },
    { key: 'complex', label: 'Complex', minPoints: 20, multiplier: 1.3 },
    { key: 'advanced', label: 'Avansat', minPoints: 40, multiplier: 1.5 },
  ],
};

/** Units of work per task type (e.g. 3 headlines written = rsa_text: 3). */
export type WorkUnits = Partial<Record<TaskType, number>>;

export interface PriceLine {
  task: TaskType;
  units: number;
  creditsPerUnit: number;
  credits: number;
}

export interface PriceBreakdown {
  lines: PriceLine[];
  elementsAnalyzed: number;
  elementsCredits: number;
  /** Raw credits before the complexity multiplier. */
  points: number;
  level: { key: string; label: string; multiplier: number };
  /** points × multiplier, before clamping. */
  computedCredits: number;
  minCredits: number;
  maxCredits: number;
  /** Final price in credits (2 decimals). */
  credits: number;
  /** Final price in wallet minor units (1 credit = 100). */
  minor: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function levelFor(pricing: OptimizerPricing, points: number): ComplexityLevel {
  const sorted = [...pricing.levels].sort((a, b) => a.minPoints - b.minPoints);
  let level = sorted[0];
  for (const l of sorted) if (points >= l.minPoints) level = l;
  return level;
}

export function priceWork(
  pricing: OptimizerPricing,
  work: WorkUnits,
  elementsAnalyzed: number,
): PriceBreakdown {
  const lines: PriceLine[] = TASK_TYPES.filter((t) => (work[t] ?? 0) > 0).map((task) => {
    const units = work[task]!;
    const creditsPerUnit = pricing.taskCredits[task] ?? 0;
    return { task, units, creditsPerUnit, credits: round2(units * creditsPerUnit) };
  });
  const elementsCredits = round2(Math.max(0, elementsAnalyzed) * pricing.perElementCredits);
  const points = round2(lines.reduce((s, l) => s + l.credits, 0) + elementsCredits);
  const level = levelFor(pricing, points);
  const computedCredits = round2(points * level.multiplier);
  const credits = round2(
    Math.min(pricing.maxCredits, Math.max(pricing.minCredits, computedCredits)),
  );
  return {
    lines,
    elementsAnalyzed,
    elementsCredits,
    points,
    level: { key: level.key, label: level.label, multiplier: level.multiplier },
    computedCredits,
    minCredits: pricing.minCredits,
    maxCredits: pricing.maxCredits,
    credits,
    minor: Math.round(credits * 100),
  };
}

/** Validates an admin-submitted config; returns the cleaned value or the
 *  first problem found. */
export function validatePricing(input: unknown): { value?: OptimizerPricing; error?: string } {
  const o = (input ?? {}) as Partial<OptimizerPricing>;
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!num(o.minCredits, 1, 10_000)) return { error: 'minCredits trebuie să fie între 1 și 10000' };
  if (!num(o.maxCredits, o.minCredits!, 100_000))
    return { error: 'maxCredits trebuie să fie cel puțin cât minCredits' };
  if (!num(o.perElementCredits, 0, 100)) return { error: 'perElementCredits invalid' };
  const taskCredits = {} as Record<TaskType, number>;
  for (const t of TASK_TYPES) {
    const v = o.taskCredits?.[t];
    if (!num(v, 0, 10_000)) return { error: `Prețul pentru „${t}” este invalid` };
    taskCredits[t] = round2(v as number);
  }
  if (!Array.isArray(o.levels) || !o.levels.length || o.levels.length > 10)
    return { error: 'Trebuie definit cel puțin un nivel de complexitate' };
  const levels: ComplexityLevel[] = [];
  for (const l of o.levels) {
    if (!l || typeof l.key !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(l.key))
      return { error: 'Cheie de nivel invalidă (litere mici, cifre, - sau _)' };
    if (typeof l.label !== 'string' || !l.label.trim() || l.label.length > 40)
      return { error: 'Fiecare nivel are nevoie de o etichetă' };
    if (!num(l.minPoints, 0, 100_000)) return { error: `Pragul nivelului „${l.label}” e invalid` };
    if (!num(l.multiplier, 0.1, 20))
      return { error: `Multiplicatorul nivelului „${l.label}” trebuie să fie între 0.1 și 20` };
    levels.push({
      key: l.key,
      label: l.label.trim(),
      minPoints: round2(l.minPoints),
      multiplier: round2(l.multiplier),
    });
  }
  levels.sort((a, b) => a.minPoints - b.minPoints);
  if (levels[0].minPoints !== 0) return { error: 'Primul nivel trebuie să înceapă de la 0 puncte' };
  if (new Set(levels.map((l) => l.key)).size !== levels.length)
    return { error: 'Cheile nivelurilor trebuie să fie unice' };
  return {
    value: {
      minCredits: round2(o.minCredits as number),
      maxCredits: round2(o.maxCredits as number),
      taskCredits,
      perElementCredits: round2(o.perElementCredits as number),
      levels,
    },
  };
}

/** Parses a stored config, falling back to defaults field by field. */
export function parseStoredPricing(raw: string | null): OptimizerPricing {
  if (!raw) return DEFAULT_PRICING;
  try {
    const merged = { ...DEFAULT_PRICING, ...(JSON.parse(raw) as Partial<OptimizerPricing>) };
    merged.taskCredits = { ...DEFAULT_PRICING.taskCredits, ...(merged.taskCredits ?? {}) };
    return validatePricing(merged).value ?? DEFAULT_PRICING;
  } catch {
    return DEFAULT_PRICING;
  }
}
