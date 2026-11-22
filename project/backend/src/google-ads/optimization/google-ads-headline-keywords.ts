import { TextAsset } from './google-ads-account-data';
import { RSA } from './google-ads-specs';

/**
 * Headline keyword coverage for a Responsive Search Ad (pure, no Google).
 *
 * Google's Ad Strength checks whether the ad group's keywords appear in the
 * headlines; its own action item for this is "Include popular keywords in
 * your headlines". A keyword counts as included when the WHOLE phrase
 * appears in a single headline, word for word (case and Romanian
 * diacritics ignored), which is also how the AI prompts describe it.
 * Keywords longer than a headline (30 chars) can never be included, so they
 * are ignored instead of being reported as a gap nobody can close.
 */

export interface KeywordCoverage {
  /** Distinct, includable keywords of the ad group (original spelling). */
  keywords: string[];
  covered: string[];
  missing: string[];
  /** Headlines that contain at least one keyword. */
  headlinesWithKeyword: number;
  /** Google's own action items mention keywords (a direct Ad Strength signal). */
  googleFlagged: boolean;
}

export function foldText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Strips Google match-type syntax (`"…"`, `[…]`, `+word`). */
function cleanKeyword(k: string): string {
  return k
    .replace(/["[\]+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function headlineHasKeyword(headline: string, keyword: string): boolean {
  const k = foldText(cleanKeyword(keyword));
  if (!k) return false;
  return ` ${foldText(headline)} `.includes(` ${k} `);
}

/** Google action items are free text (in the account's language). */
export function actionItemsMentionKeywords(items: string[]): boolean {
  return items.some((i) => /keyword|cuv[aâ]nt|cuvinte|cheie/i.test(i));
}

export function keywordCoverage(
  headlines: string[],
  rawKeywords: string[],
  actionItems: string[] = [],
): KeywordCoverage {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of rawKeywords) {
    const k = cleanKeyword(raw);
    const f = foldText(k);
    if (!f || seen.has(f) || [...k].length > RSA.headlines.maxChars) continue;
    seen.add(f);
    keywords.push(k);
  }
  const covered = keywords.filter((k) => headlines.some((h) => headlineHasKeyword(h, k)));
  return {
    keywords,
    covered,
    missing: keywords.filter((k) => !covered.includes(k)),
    headlinesWithKeyword: headlines.filter((h) => keywords.some((k) => headlineHasKeyword(h, k)))
      .length,
    googleFlagged: actionItemsMentionKeywords(actionItems),
  };
}

/** How many of the most popular keywords must each appear in a headline. */
export const TOP_POPULAR_KEYWORDS = 4;

/** The most popular keywords (the first ones of `cov.keywords`, which the
 *  caller orders by popularity) that no headline carries yet. */
export function popularMissing(cov: KeywordCoverage, top = TOP_POPULAR_KEYWORDS): string[] {
  return cov.keywords.slice(0, top).filter((k) => cov.missing.includes(k));
}

/**
 * Whether missing keywords are holding back Ad Strength ("Include popular
 * keywords in your headlines"): the ad is not EXCELLENT yet (a new ad that
 * Google has not rated, PENDING, counts too: it gets popular keywords from
 * the start), keywords are missing from the headlines, and either Google
 * itself says so, one of the most popular keywords is missing, or most
 * keywords are absent.
 */
export function keywordsHurtAdStrength(
  adStrength: string | undefined,
  cov: KeywordCoverage,
): boolean {
  if (!cov.missing.length) return false;
  if (adStrength === 'EXCELLENT') return false;
  return (
    cov.googleFlagged ||
    popularMissing(cov).length > 0 ||
    cov.covered.length < Math.ceil(cov.keywords.length / 2)
  );
}

const LABEL_RANK: Record<string, number> = { LOW: 0, UNRATED: 1, PENDING: 1, LEARNING: 2 };

/**
 * Headlines that may be swapped for keyword headlines when the ad is
 * already full: never pinned ones, never ones that already carry a keyword,
 * never ones Google rates BEST/GOOD. Weakest first.
 */
export function replaceableHeadlines(headlines: TextAsset[], keywords: string[]): TextAsset[] {
  return headlines
    .filter(
      (h) =>
        !h.pinnedField &&
        h.performanceLabel !== 'BEST' &&
        h.performanceLabel !== 'GOOD' &&
        !keywords.some((k) => headlineHasKeyword(h.text, k)),
    )
    .sort(
      (a, b) =>
        (LABEL_RANK[a.performanceLabel ?? 'UNRATED'] ?? 1) -
        (LABEL_RANK[b.performanceLabel ?? 'UNRATED'] ?? 1),
    );
}
