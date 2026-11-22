import { foldText } from './google-ads-headline-keywords';

/**
 * Which of an ad group's keywords are POPULAR, the signal behind Google's
 * Ad Strength item "Include popular keywords in your headlines".
 *
 * Signals, all from Google:
 *  1. Keyword Planner (`generateKeywordHistoricalMetrics`): average monthly
 *     searches in Romania, in Romanian. Needs Basic/Standard API access; an
 *     account on Explorer access gets DEVELOPER_TOKEN_NOT_APPROVED, which is
 *     remembered for a day so cycles don't keep asking.
 *  2. The campaign's real searches, last 30 days: impressions of each
 *     keyword (`keyword_view`) plus impressions of the actual search terms
 *     people typed that contain the keyword (`search_term_view`).
 *  3. No data yet (a new campaign): the ad group's own order.
 * Every failure falls through to the next signal; nothing here throws.
 */

let plannerBlockedUntil = 0;
const PLANNER_RETRY_MS = 24 * 3_600_000;

/** Romania (geo target) and Romanian (language), Google's constant ids. */
export const PLANNER_GEO = 'geoTargetConstants/2642';
export const PLANNER_LANGUAGE = 'languageConstants/1032';

export interface KeywordPopularityClient {
  search(query: string): Promise<Record<string, unknown>[]>;
  /** Folded keyword → average monthly searches. Optional: absent on
   *  clients without Keyword Planner access. */
  keywordHistoricalMetrics?(keywords: string[]): Promise<Record<string, number>>;
}

export interface RankedKeyword {
  keyword: string;
  /** Average monthly searches (Keyword Planner), when known. */
  searches: number | null;
  /** Impressions in the last 30 days, when known. */
  impressions: number | null;
}

export interface KeywordPopularity {
  ranked: RankedKeyword[];
  source: 'planner' | 'impressions' | 'none';
}

/** Test hook: forget a remembered Keyword Planner refusal. */
export function resetPlannerBlock(): void {
  plannerBlockedUntil = 0;
}

/** Request body for `customers/{id}:generateKeywordHistoricalMetrics`. */
export function plannerBody(keywords: string[]): Record<string, unknown> {
  return {
    keywords: keywords.slice(0, 200),
    language: PLANNER_LANGUAGE,
    geoTargetConstants: [PLANNER_GEO],
    keywordPlanNetwork: 'GOOGLE_SEARCH',
    includeAdultKeywords: false,
  };
}

/** Planner response → folded keyword (and its close variants) → searches. */
export function parsePlannerMetrics(data: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const results = (data as { results?: unknown[] } | null)?.results ?? [];
  for (const r of results as {
    text?: string;
    closeVariants?: string[];
    keywordMetrics?: { avgMonthlySearches?: string | number };
  }[]) {
    const n = Number(r.keywordMetrics?.avgMonthlySearches ?? 0);
    if (!Number.isFinite(n)) continue;
    for (const k of [r.text, ...(r.closeVariants ?? [])]) {
      const f = k ? foldText(k) : '';
      if (f) out[f] = Math.max(out[f] ?? 0, n);
    }
  }
  return out;
}

export async function rankKeywordsByPopularity(
  client: KeywordPopularityClient,
  googleCampaignId: string,
  keywords: string[],
): Promise<KeywordPopularity> {
  const base = keywords.map((keyword) => ({ keyword, searches: null, impressions: null }));
  if (!keywords.length) return { ranked: base, source: 'none' };

  let searches: Record<string, number> | null = null;
  if (client.keywordHistoricalMetrics && Date.now() >= plannerBlockedUntil) {
    searches = await client.keywordHistoricalMetrics(keywords).catch((err: unknown) => {
      if (
        /DEVELOPER_TOKEN_NOT_APPROVED|explorer access/i.test(String((err as Error)?.message ?? err))
      )
        plannerBlockedUntil = Date.now() + PLANNER_RETRY_MS;
      return null;
    });
    if (searches && !Object.values(searches).some((n) => n > 0)) searches = null;
  }

  let impressions: Record<string, number> | null = null;
  try {
    const rows = await client.search(
      'SELECT ad_group_criterion.keyword.text, metrics.impressions FROM keyword_view ' +
        `WHERE campaign.id = ${googleCampaignId} AND segments.date DURING LAST_30_DAYS`,
    );
    impressions = {};
    for (const row of rows) {
      const text = (row.adGroupCriterion as { keyword?: { text?: string } } | undefined)?.keyword
        ?.text;
      const imp = Number(
        (row.metrics as { impressions?: string | number } | undefined)?.impressions ?? 0,
      );
      const f = text ? foldText(text) : '';
      if (f) impressions[f] = (impressions[f] ?? 0) + (Number.isFinite(imp) ? imp : 0);
    }
    // Real search terms: each one counts for every keyword it contains
    // whole (word for word), the same test the headlines use.
    const terms = await client
      .search(
        'SELECT search_term_view.search_term, metrics.impressions FROM search_term_view ' +
          `WHERE campaign.id = ${googleCampaignId} AND segments.date DURING LAST_30_DAYS`,
      )
      .catch(() => []);
    const folded = keywords.map((k) => foldText(k));
    for (const row of terms) {
      const term = (row.searchTermView as { searchTerm?: string } | undefined)?.searchTerm;
      const imp = Number(
        (row.metrics as { impressions?: string | number } | undefined)?.impressions ?? 0,
      );
      if (!term || !Number.isFinite(imp) || imp <= 0) continue;
      const ft = ` ${foldText(term)} `;
      for (const f of folded)
        if (f && ft.includes(` ${f} `)) impressions[f] = (impressions[f] ?? 0) + imp;
    }
    if (!Object.values(impressions).some((n) => n > 0)) impressions = null;
  } catch {
    impressions = null;
  }

  const ranked: RankedKeyword[] = keywords.map((keyword) => {
    const f = foldText(keyword);
    return {
      keyword,
      searches: searches ? (searches[f] ?? 0) : null,
      impressions: impressions ? (impressions[f] ?? 0) : null,
    };
  });
  const source: KeywordPopularity['source'] = searches
    ? 'planner'
    : impressions
      ? 'impressions'
      : 'none';
  if (source === 'none') return { ranked, source };
  // Stable sort: planner searches first, impressions as the tie-break (or
  // the only signal), the ad group's own order last.
  const order = new Map(keywords.map((k, i) => [k, i]));
  ranked.sort(
    (a, b) =>
      (b.searches ?? 0) - (a.searches ?? 0) ||
      (b.impressions ?? 0) - (a.impressions ?? 0) ||
      order.get(a.keyword)! - order.get(b.keyword)!,
  );
  return { ranked, source };
}
