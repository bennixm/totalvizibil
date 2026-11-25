/**
 * Credit pricing of ONE message in the Google Ads agent chat. Deliberately
 * separate from the cycle pricing (pricing.ts), which prices planned work: a
 * chat message's work is not known upfront, so it is METERED:
 *
 *   price = base + (real AI cost × markup) + Σ changes prepared × fee
 *   clamped between the minimum per message and the amount held upfront
 *   (itself at most the maximum per message).
 *
 * Every message that reaches the AI costs at least the minimum; a message the
 * agent could not answer costs nothing. Admin-configured
 * (`google_ads_chat_pricing`). Pure functions, no I/O.
 */

export const CHANGE_TYPES = ['text', 'keyword', 'extension', 'budget', 'status'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];
export type ChangeUnits = Partial<Record<ChangeType, number>>;

export interface ChatPricing {
  /** Least a delivered message costs. */
  minCredits: number;
  /** Most a message can cost; also what is reserved when it is sent. */
  maxCredits: number;
  /** Fixed part of every message (platform + Google Ads reads). */
  baseCredits: number;
  /** Multiplier over the real AI cost (1 USD counted as 1 credit). */
  aiMarkup: number;
  /** Fee per unit of each change prepared and validated by Google. */
  changeCredits: Record<ChangeType, number>;
  /** AI calls one message may use (each tool round is one call). */
  maxAiCalls: number;
}

export const DEFAULT_CHAT_PRICING: ChatPricing = {
  minCredits: 0.2,
  maxCredits: 5,
  baseCredits: 0.1,
  aiMarkup: 4,
  changeCredits: { text: 0.3, keyword: 0.05, extension: 0.2, budget: 0.5, status: 0.2 },
  maxAiCalls: 6,
};

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** USD per million tokens (input, output); longest matching prefix wins. */
const RATES: [string, number, number][] = [
  ['claude-opus-5-5', 4, 20],
  ['claude-opus', 5, 25],
  ['claude-sonnet-5', 2, 10],
  ['claude-sonnet', 3, 15],
  ['claude-haiku-5-5', 0.1, 0.5],
  ['claude-haiku', 1, 5],
];
/** Unknown model: the most expensive tier, so a call is never sold at a loss. */
const FALLBACK_RATE: [number, number] = [10, 50];

export function aiCostUsd(model: string, u: TokenUsage): number {
  const r = RATES.filter(([p]) => model.startsWith(p)).sort((a, b) => b[0].length - a[0].length)[0];
  const [inp, out] = r ? [r[1], r[2]] : FALLBACK_RATE;
  // 5-minute cache writes cost 1.25x and reads 0.1x of the input price.
  return (
    (u.input * inp + u.cacheWrite * inp * 1.25 + u.cacheRead * inp * 0.1 + u.output * out) / 1e6
  );
}

export interface ChatPriceLine {
  type: ChangeType;
  units: number;
  creditsPerUnit: number;
  credits: number;
}
export interface ChatPrice {
  baseCredits: number;
  /** AI part, markup included. */
  aiCredits: number;
  lines: ChatPriceLine[];
  /** Before the minimum and the ceiling. */
  computedCredits: number;
  credits: number;
  minor: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `heldMinor` is a hard ceiling: never charge more than was reserved. */
export function priceChatTurn(
  p: ChatPricing,
  costUsd: number,
  changes: ChangeUnits,
  heldMinor: number,
): ChatPrice {
  const lines = CHANGE_TYPES.filter((t) => (changes[t] ?? 0) > 0).map((type) => ({
    type,
    units: changes[type]!,
    creditsPerUnit: p.changeCredits[type],
    credits: round2(changes[type]! * p.changeCredits[type]),
  }));
  const aiCredits = round2(Math.max(0, costUsd) * p.aiMarkup);
  const computed = round2(p.baseCredits + aiCredits + lines.reduce((s, l) => s + l.credits, 0));
  const minor = Math.min(
    heldMinor,
    Math.round(p.maxCredits * 100),
    Math.max(Math.round(p.minCredits * 100), Math.round(computed * 100)),
  );
  return {
    baseCredits: p.baseCredits,
    aiCredits,
    lines,
    computedCredits: computed,
    credits: minor / 100,
    minor,
  };
}

/** What to reserve for a message: the maximum, or less when the wallet or the
 *  owner's daily limit leave less (but never under the minimum). */
export function holdFor(
  p: ChatPricing,
  balanceMinor: number,
  dailyRemainingMinor: number | null,
): { minor: number } | { error: 'insufficient_credits' | 'chat_daily_limit' } {
  const min = Math.round(p.minCredits * 100);
  if (dailyRemainingMinor != null && dailyRemainingMinor < min)
    return { error: 'chat_daily_limit' };
  if (balanceMinor < min) return { error: 'insufficient_credits' };
  return {
    minor: Math.min(Math.round(p.maxCredits * 100), balanceMinor, dailyRemainingMinor ?? Infinity),
  };
}

export function validateChatPricing(input: unknown): { value?: ChatPricing; error?: string } {
  const o = (input ?? {}) as Partial<ChatPricing>;
  const num = (v: unknown, min: number, max: number): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!num(o.minCredits, 0.01, 1000))
    return { error: 'Minimul pe mesaj trebuie să fie între 0.01 și 1000' };
  if (!num(o.maxCredits, o.minCredits, 1000))
    return { error: 'Maximul pe mesaj trebuie să fie cel puțin cât minimul' };
  if (!num(o.baseCredits, 0, 1000)) return { error: 'Prețul de bază este invalid' };
  if (!num(o.aiMarkup, 1, 100))
    return { error: 'Multiplicatorul AI trebuie să fie între 1 și 100' };
  if (!num(o.maxAiCalls, 1, 12)) return { error: 'Apelurile AI pe mesaj: între 1 și 12' };
  const changeCredits = {} as Record<ChangeType, number>;
  for (const t of CHANGE_TYPES) {
    const v = o.changeCredits?.[t];
    if (!num(v, 0, 1000)) return { error: `Prețul pentru „${t}” este invalid` };
    changeCredits[t] = round2(v);
  }
  return {
    value: {
      minCredits: round2(o.minCredits),
      maxCredits: round2(o.maxCredits),
      baseCredits: round2(o.baseCredits),
      aiMarkup: round2(o.aiMarkup),
      changeCredits,
      maxAiCalls: Math.round(o.maxAiCalls),
    },
  };
}

export function parseStoredChatPricing(raw: string | null): ChatPricing {
  if (!raw) return DEFAULT_CHAT_PRICING;
  try {
    const m = { ...DEFAULT_CHAT_PRICING, ...(JSON.parse(raw) as Partial<ChatPricing>) };
    m.changeCredits = { ...DEFAULT_CHAT_PRICING.changeCredits, ...(m.changeCredits ?? {}) };
    return validateChatPricing(m).value ?? DEFAULT_CHAT_PRICING;
  } catch {
    return DEFAULT_CHAT_PRICING;
  }
}
