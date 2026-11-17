import { FeedQueryService } from 'src/feed/feed-query.service';

const TREE = {
  categories: [
    {
      slug: 'constructii',
      name: { ro: 'Construcții', en: 'Construction', de: 'Bau' },
      children: [
        { slug: 'acoperisuri', name: { ro: 'Acoperișuri', en: 'Roofing', de: 'Dachdecker' } },
      ],
    },
    {
      slug: 'instalatii',
      name: { ro: 'Instalații', en: 'Installations', de: 'Installationen' },
      children: [
        {
          slug: 'instalatii-sanitare',
          name: { ro: 'Instalații sanitare', en: 'Plumbing', de: 'Sanitärinstallation' },
        },
        {
          slug: 'instalatii-electrice',
          name: { ro: 'Instalații electrice', en: 'Electrical', de: 'Elektroinstallation' },
        },
        {
          slug: 'sisteme-securitate',
          name: {
            ro: 'Sisteme de securitate & supraveghere',
            en: 'Security & CCTV systems',
            de: 'Sicherheits- & Videoüberwachung',
          },
        },
      ],
    },
    {
      slug: 'sport-fitness',
      name: { ro: 'Sport & fitness', en: 'Sport & fitness', de: 'Sport & Fitness' },
      children: [
        {
          slug: 'piscine-stranduri',
          name: {
            ro: 'Piscine & ștranduri',
            en: 'Pools & swimming facilities',
            de: 'Schwimmbäder',
          },
        },
      ],
    },
  ],
  counties: [],
};

function makeService(aiReply: unknown) {
  const feed = { facets: jest.fn().mockResolvedValue(TREE) };
  const ai = { interpretFeedQuery: jest.fn().mockResolvedValue(aiReply) };
  const svc = new FeedQueryService(feed as any, ai as any);
  return { svc, ai };
}

const ai = (
  over: Partial<{ group: string | null; niches: string[]; counties: string[]; cities: string[] }>,
) => ({
  group: null,
  niches: [],
  counties: [],
  cities: [],
  ...over,
});

describe('FeedQueryService', () => {
  describe('AI path — whitelisting', () => {
    it("derives the group from the leaf's own parent, ignoring a wrong group from the model", async () => {
      const { svc } = makeService(ai({ group: 'constructii', niches: ['instalatii-sanitare'] }));
      await expect(svc.interpret('mi s-a spart o teava', 'ro')).resolves.toEqual({
        group: 'instalatii',
        niches: ['instalatii-sanitare'],
        counties: [],
      });
    });

    it('drops leaves from other groups and unknown slugs', async () => {
      const { svc } = makeService(
        ai({ niches: ['instalatii-electrice', 'acoperisuri', 'made-up', 'instalatii-sanitare'] }),
      );
      const out = await svc.interpret('electrician si instalator', 'ro');
      expect(out.group).toBe('instalatii');
      expect(out.niches).toEqual(['instalatii-electrice', 'instalatii-sanitare']);
    });

    it('accepts a broad group-only answer, and rejects an invented group', async () => {
      await expect(
        makeService(ai({ group: 'constructii' })).svc.interpret('firma constructii', 'ro'),
      ).resolves.toMatchObject({ group: 'constructii', niches: [] });
      await expect(
        makeService(ai({ group: 'not-a-group' })).svc.interpret('ceva', 'ro'),
      ).resolves.toMatchObject({ group: null, niches: [] });
    });

    it('treats a leaf the model put in `group` as that leaf', async () => {
      const { svc } = makeService(ai({ group: 'acoperisuri' }));
      await expect(svc.interpret('acoperis', 'ro')).resolves.toMatchObject({
        group: 'constructii',
        niches: ['acoperisuri'],
      });
    });

    it('canonicalises counties and maps cities to their county, dropping unknowns', async () => {
      const { svc } = makeService(
        ai({ counties: ['cluj', 'Atlantida'], cities: ['Timisoara', 'Gotham'] }),
      );
      const out = await svc.interpret('instalator cluj timisoara', 'ro');
      expect(out.counties).toEqual(['Cluj', 'Timiș']);
    });

    it('caches AI answers per normalised request', async () => {
      const { svc, ai: aiSvc } = makeService(ai({ group: 'constructii' }));
      await svc.interpret('Firmă de construcții?', 'ro');
      await svc.interpret('firma de constructii', 'ro');
      expect(aiSvc.interpretFeedQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('fallback (AI unavailable)', () => {
    it('still finds the category and county deterministically', async () => {
      const { svc } = makeService(null);
      await expect(svc.interpret('instalatii electrice in Cluj-Napoca', 'ro')).resolves.toEqual({
        group: 'instalatii',
        niches: ['instalatii-electrice'],
        counties: ['Cluj'],
      });
    });

    it('matches a group named inside a natural question', async () => {
      const { svc } = makeService(null);
      await expect(
        svc.interpret('Unde găsesc o firmă de construcții?', 'ro'),
      ).resolves.toMatchObject({
        group: 'constructii',
      });
    });

    it('is strict enough to auto-select: no false hits from stopwords or loose stems', async () => {
      const { svc } = makeService(null);
      // "de" is inside "Sisteme de securitate", "faci" is a prefix of
      // "facilities" (Pools & swimming facilities) — neither may win.
      await expect(svc.interpret('salut ce faci', 'ro')).resolves.toMatchObject({ group: null });
      await expect(svc.interpret('firma de constructii', 'ro')).resolves.toMatchObject({
        group: 'constructii',
        niches: [],
      });
    });

    it('still matches a short word with a short inflection, and foreign city names', async () => {
      const { svc } = makeService(null);
      await expect(svc.interpret('Who can fix my roof in Bucharest?', 'en')).resolves.toEqual({
        group: 'constructii',
        niches: ['acoperisuri'],
        counties: ['București'],
      });
    });

    it('maps a București sector', async () => {
      const { svc } = makeService(null);
      const out = await svc.interpret('acoperis sector 3', 'ro');
      expect(out.counties).toEqual(['București']);
      expect(out.niches).toEqual(['acoperisuri']);
    });

    it('returns no category for an unrelated request, and never caches fallback answers', async () => {
      const { svc, ai: aiSvc } = makeService(null);
      await expect(svc.interpret('salut ce faci', 'ro')).resolves.toEqual({
        group: null,
        niches: [],
        counties: [],
      });
      await svc.interpret('salut ce faci', 'ro');
      expect(aiSvc.interpretFeedQuery).toHaveBeenCalledTimes(2);
    });
  });
});
