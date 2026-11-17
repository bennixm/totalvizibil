import type { FeedQueryUsage } from '../ai/ai.service';

/** USD per million tokens, Anthropic list prices (input / output). Cache reads
 *  bill at 10% of input, cache writes at 125%. An estimate for the admin's
 *  cost tracking only, never for billing anyone. */
const PRICES: { match: string; input: number; output: number }[] = [
  { match: 'haiku-5-5', input: 0.1, output: 0.5 },
  { match: 'haiku-4-5', input: 1, output: 5 },
  { match: 'sonnet-4-6', input: 3, output: 15 },
  { match: 'sonnet', input: 2, output: 10 },
  { match: 'opus-5-5', input: 4, output: 20 },
  { match: 'opus', input: 5, output: 25 },
];
const FALLBACK = { input: 2, output: 10 };

export function feedSearchCostUsd(u: FeedQueryUsage): number {
  const p = PRICES.find((x) => u.model.includes(x.match)) ?? FALLBACK;
  return (
    (u.inputTokens * p.input +
      u.cacheReadTokens * p.input * 0.1 +
      u.cacheWriteTokens * p.input * 1.25 +
      u.outputTokens * p.output) /
    1_000_000
  );
}
