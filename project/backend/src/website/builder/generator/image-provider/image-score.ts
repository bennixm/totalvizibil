/**
 * Pure ranking for a Pexels photo against one `ImageIntent`. Higher = better.
 *
 * Signals, in rough order of weight:
 *  - semantic overlap between the photo's alt text and the intent subject/scene
 *  - orientation match (the photo's real aspect ratio vs. what the slot wants)
 *  - resolution (enough pixels for a full-bleed hero), lightly
 *  - generic-stock penalty — the "handshake / smiling team / laptop on desk" look
 *  - avoid-list penalty — words the intent explicitly does not want
 *  - de-dup penalty — this id, or a near-identical average colour, already placed
 */
import type { ImageIntent } from '../types';
import type { PexelsPhoto } from './pexels.provider';

export interface ScoreContext {
  usedIds: Set<number>;
  /** 12-bit colour buckets already used in this site (near-dup guard). */
  usedColorBuckets: Set<string>;
}

const GENERIC_STOCK =
  /\b(handshake|shaking hands|meeting room|conference room|smiling (employee|team|woman|man|people)|team of|laptop on (a )?desk|corporate|business people|office building|whiteboard|coworking|thumbs up|stock photo|real estate agent|property developer|real estate developer|house for sale|for sale sign|realtor)\b/i;

const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'or',
  'in',
  'on',
  'at',
  'to',
  'with',
  'for',
  'is',
  'are',
  'by',
  'from',
  'as',
  'photo',
  'image',
  'picture',
  'view',
  'shot',
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Quantise `#rrggbb` to a coarse bucket so two visually similar photos collide. */
export function colorBucket(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '';
  const q = (h: string): number => Math.round(parseInt(h, 16) / 64); // 0..4
  return `${q(m[1])}-${q(m[2])}-${q(m[3])}`;
}

function aspect(p: PexelsPhoto): 'landscape' | 'portrait' | 'square' {
  if (!p.width || !p.height) return 'landscape';
  const r = p.width / p.height;
  if (r > 1.15) return 'landscape';
  if (r < 0.87) return 'portrait';
  return 'square';
}

export function scorePhoto(photo: PexelsPhoto, intent: ImageIntent, ctx: ScoreContext): number {
  let score = 0;

  // --- semantic relevance (0..6) — the AI-refined phrasing sharpens ranking
  //     even though the SEARCH query stays deterministic. ---
  const want = new Set([
    ...tokens(intent.refinedSubject || intent.subject),
    ...tokens(intent.refinedScene || intent.scene),
    ...tokens(intent.subject),
    ...tokens(intent.role),
  ]);
  const have = new Set(tokens(photo.alt));
  let overlap = 0;
  for (const w of want) if (have.has(w)) overlap++;
  score += Math.min(6, overlap * 1.5);
  // a photo with no alt text at all is a mild risk
  if (!photo.alt.trim()) score -= 1;

  // --- orientation (−3..+2) ---
  if (aspect(photo) === intent.orientation) score += 2;
  else if (
    (aspect(photo) === 'landscape' && intent.orientation === 'square') ||
    (aspect(photo) === 'square' && intent.orientation === 'landscape')
  )
    score -= 0.5;
  else score -= 3;

  // --- resolution (0..1.5) ---
  const px = photo.width * photo.height;
  if (px >= 3_000_000) score += 1.5;
  else if (px >= 1_200_000) score += 0.75;
  else if (px > 0 && px < 500_000) score -= 1;

  // --- generic-stock penalty ---
  if (GENERIC_STOCK.test(photo.alt)) score -= 5;

  // --- avoid list ---
  for (const a of intent.avoid) {
    const at = tokens(a);
    if (at.length && at.every((w) => have.has(w))) score -= 2;
  }

  // --- de-dup ---
  if (ctx.usedIds.has(photo.id)) score -= 8;
  const bucket = colorBucket(photo.avgColor);
  if (bucket && ctx.usedColorBuckets.has(bucket)) score -= 2.5;

  return score;
}
