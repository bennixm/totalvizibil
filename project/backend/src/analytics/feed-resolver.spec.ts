import {
  FeedCompanyLike,
  NATIONWIDE_FEED_COUNTY,
  SearchCountyMode,
  enumerateCompanyFeeds,
  primaryFeedOf,
  resolveCompanyFeed,
} from './feed-resolver';

const t = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

function company(
  categories: Array<{ id: string; primary?: boolean; age?: number }>,
  locations: Array<{ county?: string; nationwide?: boolean; primary?: boolean; age?: number }>,
): FeedCompanyLike {
  return {
    categoryAssignments: categories.map((c) => ({
      categoryId: c.id,
      isPrimary: !!c.primary,
      createdAt: t(c.age ?? 10),
    })),
    locations: locations.map((l) => ({
      county: l.county ?? null,
      nationwide: !!l.nationwide,
      isPrimary: !!l.primary,
      createdAt: t(l.age ?? 10),
    })),
  };
}

const ANY: SearchCountyMode = { kind: 'any' };
const NATIONWIDE_ONLY: SearchCountyMode = { kind: 'nationwideOnly' };
const named = (counties: string[]): SearchCountyMode => ({ kind: 'named', counties });

describe('resolveCompanyFeed — single leaf, single county (the common case)', () => {
  it('resolves directly when the company has exactly one leaf and one county', () => {
    const c = company([{ id: 'curatenie' }], [{ county: 'Sibiu' }]);
    expect(resolveCompanyFeed(c, ['curatenie'], named(['Sibiu']))).toEqual({
      leafId: 'curatenie',
      county: 'Sibiu',
    });
  });

  it('returns null when the company does not compete on any searched leaf', () => {
    const c = company([{ id: 'curatenie' }], [{ county: 'Sibiu' }]);
    expect(resolveCompanyFeed(c, ['tractari-auto'], named(['Sibiu']))).toBeNull();
  });

  it('returns null when the company does not serve the searched county', () => {
    const c = company([{ id: 'curatenie' }], [{ county: 'Cluj' }]);
    expect(resolveCompanyFeed(c, ['curatenie'], named(['Sibiu']))).toBeNull();
  });
});

describe('resolveCompanyFeed — multi-leaf firm, own-order (isPrimary desc, createdAt asc) disambiguation', () => {
  it('picks the primary leaf when it intersects the search', () => {
    const c = company(
      [
        { id: 'curatenie', age: 5 },
        { id: 'tractari-auto', primary: true, age: 20 },
      ],
      [{ county: 'Sibiu' }],
    );
    const feed = resolveCompanyFeed(c, ['curatenie', 'tractari-auto'], named(['Sibiu']));
    expect(feed?.leafId).toBe('tractari-auto');
  });

  it('falls back to the oldest non-primary intersecting leaf when the primary one was not searched', () => {
    const c = company(
      [
        { id: 'curatenie', primary: true },
        { id: 'tractari-auto', age: 30 },
        { id: 'zugraveli', age: 5 },
      ],
      [{ county: 'Sibiu' }],
    );
    const feed = resolveCompanyFeed(c, ['tractari-auto', 'zugraveli'], named(['Sibiu']));
    expect(feed?.leafId).toBe('tractari-auto'); // older assignment wins among non-primary ties
  });
});

describe('resolveCompanyFeed — multi-county firm, own-order disambiguation', () => {
  it('picks its primary county when it intersects the search', () => {
    const c = company(
      [{ id: 'curatenie' }],
      [
        { county: 'Cluj', age: 5 },
        { county: 'Sibiu', primary: true, age: 20 },
      ],
    );
    const feed = resolveCompanyFeed(c, ['curatenie'], named(['Cluj', 'Sibiu']));
    expect(feed?.county).toBe('Sibiu');
  });
});

describe('resolveCompanyFeed — nationwide companies', () => {
  const nationwideCo = company([{ id: 'curatenie' }], [{ nationwide: true }]);

  it('under a named-county search, slots into the first requested county in canonical (RO_COUNTIES) order', () => {
    // Cluj precedes Sibiu in RO_COUNTIES.
    const feed = resolveCompanyFeed(nationwideCo, ['curatenie'], named(['Sibiu', 'Cluj']));
    expect(feed?.county).toBe('Cluj');
  });

  it('under "Orice locație" (no county filter), resolves to its own nationwide pseudo-Feed', () => {
    const feed = resolveCompanyFeed(nationwideCo, ['curatenie'], ANY);
    expect(feed?.county).toBe(NATIONWIDE_FEED_COUNTY);
  });

  it('under the strict "nationwideOnly" search mode, resolves to the nationwide pseudo-Feed', () => {
    const feed = resolveCompanyFeed(nationwideCo, ['curatenie'], NATIONWIDE_ONLY);
    expect(feed?.county).toBe(NATIONWIDE_FEED_COUNTY);
  });

  it('a non-nationwide company never matches the "nationwideOnly" mode', () => {
    const c = company([{ id: 'curatenie' }], [{ county: 'Sibiu' }]);
    expect(resolveCompanyFeed(c, ['curatenie'], NATIONWIDE_ONLY)).toBeNull();
  });
});

describe("primaryFeedOf — the company's own identity, no search context", () => {
  it('uses the primary category and primary county', () => {
    const c = company(
      [
        { id: 'curatenie', age: 5 },
        { id: 'tractari-auto', primary: true, age: 20 },
      ],
      [
        { county: 'Cluj', age: 5 },
        { county: 'Sibiu', primary: true, age: 20 },
      ],
    );
    expect(primaryFeedOf(c)).toEqual({ leafId: 'tractari-auto', county: 'Sibiu' });
  });

  it('a nationwide company resolves to its nationwide pseudo-Feed', () => {
    const c = company([{ id: 'curatenie' }], [{ nationwide: true }]);
    expect(primaryFeedOf(c)).toEqual({ leafId: 'curatenie', county: NATIONWIDE_FEED_COUNTY });
  });

  it('null when the company has no category assignment at all', () => {
    const c = company([], [{ county: 'Sibiu' }]);
    expect(primaryFeedOf(c)).toBeNull();
  });

  it('null when the company has no location at all', () => {
    const c = company([{ id: 'curatenie' }], []);
    expect(primaryFeedOf(c)).toBeNull();
  });
});

describe('enumerateCompanyFeeds — every Feed a company competes in', () => {
  it('is the cross product of its own leaves × its own counties', () => {
    const c = company(
      [{ id: 'curatenie' }, { id: 'tractari-auto' }],
      [{ county: 'Sibiu' }, { county: 'Cluj' }],
    );
    const feeds = enumerateCompanyFeeds(c);
    expect(feeds).toHaveLength(4);
    expect(feeds).toEqual(
      expect.arrayContaining([
        { leafId: 'curatenie', county: 'Sibiu' },
        { leafId: 'curatenie', county: 'Cluj' },
        { leafId: 'tractari-auto', county: 'Sibiu' },
        { leafId: 'tractari-auto', county: 'Cluj' },
      ]),
    );
  });

  it('a nationwide company collapses every county to its single nationwide pseudo-Feed per leaf', () => {
    const c = company([{ id: 'curatenie' }], [{ nationwide: true }]);
    expect(enumerateCompanyFeeds(c)).toEqual([
      { leafId: 'curatenie', county: NATIONWIDE_FEED_COUNTY },
    ]);
  });

  it('empty when the company has no category assignment', () => {
    const c = company([], [{ county: 'Sibiu' }]);
    expect(enumerateCompanyFeeds(c)).toEqual([]);
  });
});
