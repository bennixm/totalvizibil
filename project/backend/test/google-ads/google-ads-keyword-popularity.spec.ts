import {
  parsePlannerMetrics,
  rankKeywordsByPopularity,
  resetPlannerBlock,
} from 'src/google-ads/optimization/google-ads-keyword-popularity';

describe('keyword popularity', () => {
  beforeEach(() => resetPlannerBlock());

  it('ranks by Keyword Planner searches when available', async () => {
    const client = {
      search: jest.fn().mockResolvedValue([]),
      keywordHistoricalMetrics: jest
        .fn()
        .mockResolvedValue({ 'montaj acoperis': 1300, 'acoperis case': 90 }),
    };
    const r = await rankKeywordsByPopularity(client, '1', ['acoperis case', 'montaj acoperis']);
    expect(r.source).toBe('planner');
    expect(r.ranked.map((x) => x.keyword)).toEqual(['montaj acoperis', 'acoperis case']);
  });

  it('falls back to real impressions and remembers a planner refusal', async () => {
    const refusal = new Error(
      '(HTTP 403): not allowed for use with explorer access (DEVELOPER_TOKEN_NOT_APPROVED)',
    );
    const client = {
      search: jest.fn(async (q: string) =>
        q.includes('keyword_view')
          ? [
              {
                adGroupCriterion: { keyword: { text: 'acoperiș case' } },
                metrics: { impressions: '90' },
              },
              {
                adGroupCriterion: { keyword: { text: 'montaj acoperiș' } },
                metrics: { impressions: '42' },
              },
            ]
          : [
              {
                searchTermView: { searchTerm: 'montaj acoperis pret' },
                metrics: { impressions: '60' },
              },
            ],
      ),
      keywordHistoricalMetrics: jest.fn().mockRejectedValue(refusal),
    };
    const r = await rankKeywordsByPopularity(client, '1', ['acoperiș case', 'montaj acoperiș']);
    expect(r.source).toBe('impressions');
    // 42 + 60 (search term containing it) beats 90.
    expect(r.ranked.map((x) => x.keyword)).toEqual(['montaj acoperiș', 'acoperiș case']);
    await rankKeywordsByPopularity(client, '1', ['acoperiș case']);
    expect(client.keywordHistoricalMetrics).toHaveBeenCalledTimes(1);
  });

  it('keeps the ad group order when there is no data yet', async () => {
    const client = { search: jest.fn().mockResolvedValue([]) };
    const r = await rankKeywordsByPopularity(client, '1', ['b', 'a']);
    expect(r.source).toBe('none');
    expect(r.ranked.map((x) => x.keyword)).toEqual(['b', 'a']);
  });

  it('parses planner results including close variants', () => {
    const m = parsePlannerMetrics({
      results: [
        {
          text: 'Instalator',
          closeVariants: ['instalatori'],
          keywordMetrics: { avgMonthlySearches: '880' },
        },
      ],
    });
    expect(m).toEqual({ instalator: 880, instalatori: 880 });
  });
});
