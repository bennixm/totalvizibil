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

/** In-memory stand-in for the `feedQueryCache` table. */
function fakePrisma() {
  const rows = new Map<string, { answer: unknown; createdAt: Date; hits: number }>();
  return {
    rows,
    daily,
    feedQueryCache: {
      findUnique: jest.fn(async ({ where }: any) => {
        const r = rows.get(where.key);
        return r ? { key: where.key, ...r } : null;
      }),
      update: jest.fn(async ({ where }: any) => rows.get(where.key)),
      upsert: jest.fn(async ({ where, create }: any) => {
        rows.set(where.key, { answer: create.answer, createdAt: create.createdAt, hits: 0 });
      }),
      count: jest.fn(
        async ({ where }: any) =>
          [...rows.values()].filter((r) => r.createdAt >= where.createdAt.gte).length,
      ),
    },
    feedSearchDaily: {
      upsert: jest.fn(async (args: any) => {
        daily.push(args);
      }),
    },
  };
}
const daily: any[] = [];

interface Opts {
  embed?: { slug: string; group: string; margin: number } | null;
  daily?: number;
  monthly?: number;
  configured?: boolean;
}

function makeService(aiReply: unknown, opts: Opts = {}) {
  const feed = { facets: jest.fn().mockResolvedValue(TREE) };
  const ai = {
    configured: opts.configured ?? true,
    interpretFeedQuery: jest.fn().mockResolvedValue(aiReply),
  };
  const prisma = fakePrisma();
  const embeddings = {
    match: jest
      .fn()
      .mockResolvedValue(
        opts.embed === undefined ? null : opts.embed && { ...opts.embed, score: 0.9 },
      ),
  };
  const limits: Record<string, number> = {
    feedAiDailyLimit: opts.daily ?? 100,
    feedAiMonthlyLimit: opts.monthly ?? 1000,
  };
  const config = { get: (k: string) => limits[k] };
  const svc = new FeedQueryService(
    feed as any,
    ai as any,
    prisma as any,
    embeddings as any,
    config as any,
  );
  return { svc, ai, prisma, embeddings };
}

const ai = (
  over: Partial<{ group: string | null; niches: string[]; counties: string[]; cities: string[] }>,
) => ({
  group: null,
  niches: [],
  counties: [],
  cities: [],
  usage: {
    model: 'claude-haiku-5-5',
    inputTokens: 2_000,
    outputTokens: 40,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
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

    it('stores AI answers and reuses them for the same normalised request', async () => {
      const { svc, ai: aiSvc, prisma } = makeService(ai({ niches: ['acoperisuri'] }));
      await svc.interpret('Cine repară o țiglă spartă?', 'ro');
      await expect(svc.interpret('cine repara o tigla sparta', 'ro')).resolves.toMatchObject({
        niches: ['acoperisuri'],
      });
      expect(aiSvc.interpretFeedQuery).toHaveBeenCalledTimes(1);
      expect(prisma.rows.size).toBe(1);
    });

    it('re-validates a stored answer on read (a removed category never leaks back)', async () => {
      const { svc, prisma, ai: aiSvc } = makeService(null);
      prisma.rows.set('ro|ceva vechi', {
        answer: { group: 'gone', niches: ['gone-leaf'], counties: ['Cluj'], cities: [] },
        createdAt: new Date(),
        hits: 0,
      });
      await expect(svc.interpret('ceva vechi', 'ro')).resolves.toEqual({
        group: null,
        niches: [],
        counties: ['Cluj'],
      });
      expect(aiSvc.interpretFeedQuery).not.toHaveBeenCalled();
    });
  });

  describe('cost order: cache, keywords, local model, then capped Claude', () => {
    it('a category name in the text answers without the model or Claude', async () => {
      const { svc, ai: aiSvc, embeddings } = makeService(null);
      await expect(svc.interpret('instalatii electrice in Cluj', 'ro')).resolves.toMatchObject({
        niches: ['instalatii-electrice'],
      });
      expect(embeddings.match).not.toHaveBeenCalled();
      expect(aiSvc.interpretFeedQuery).not.toHaveBeenCalled();
    });

    it('a confident local match answers without Claude, keeping the scanned place', async () => {
      const { svc, ai: aiSvc } = makeService(ai({ group: 'constructii' }), {
        embed: { slug: 'instalatii-sanitare', group: 'instalatii', margin: 0.03 },
      });
      await expect(svc.interpret('mi s-a spart o teava in Cluj-Napoca', 'ro')).resolves.toEqual({
        group: 'instalatii',
        niches: ['instalatii-sanitare'],
        counties: ['Cluj'],
      });
      expect(aiSvc.interpretFeedQuery).not.toHaveBeenCalled();
    });

    it('an unsure local match asks Claude', async () => {
      const { svc, ai: aiSvc } = makeService(ai({ niches: ['acoperisuri'] }), {
        embed: { slug: 'instalatii-sanitare', group: 'instalatii', margin: 0.004 },
      });
      await expect(svc.interpret('ceva neclar', 'ro')).resolves.toMatchObject({
        niches: ['acoperisuri'],
      });
      expect(aiSvc.interpretFeedQuery).toHaveBeenCalledTimes(1);
    });

    it('stops calling Claude at the daily cap and falls back to the local guess', async () => {
      const { svc, ai: aiSvc } = makeService(ai({ niches: ['acoperisuri'] }), {
        embed: { slug: 'instalatii-sanitare', group: 'instalatii', margin: 0.008 },
        daily: 2,
      });
      await svc.interpret('cerere unu', 'ro');
      await svc.interpret('cerere doi', 'ro');
      await expect(svc.interpret('cerere trei', 'ro')).resolves.toMatchObject({
        niches: ['instalatii-sanitare'],
      });
      expect(aiSvc.interpretFeedQuery).toHaveBeenCalledTimes(2);
    });

    it('counts failed Claude calls against the daily cap too', async () => {
      const { svc, ai: aiSvc } = makeService(null, { daily: 2 });
      for (const q of ['unu', 'doi', 'trei', 'patru']) await svc.interpret(`cerere ${q}`, 'ro');
      expect(aiSvc.interpretFeedQuery).toHaveBeenCalledTimes(2);
    });

    it('respects the monthly cap, and a 0 limit turns the backup off', async () => {
      const capped = makeService(ai({ niches: ['acoperisuri'] }), { monthly: 1 });
      await capped.svc.interpret('cerere unu', 'ro');
      await capped.svc.interpret('cerere doi', 'ro');
      expect(capped.ai.interpretFeedQuery).toHaveBeenCalledTimes(1);

      const off = makeService(ai({ niches: ['acoperisuri'] }), { daily: 0 });
      await off.svc.interpret('cerere unu', 'ro');
      expect(off.ai.interpretFeedQuery).not.toHaveBeenCalled();
    });

    it('a very weak local guess with no AI left gives the Feed root', async () => {
      const { svc } = makeService(null, {
        embed: { slug: 'instalatii-sanitare', group: 'instalatii', margin: 0.001 },
        configured: false,
      });
      await expect(svc.interpret('salut ce faci', 'ro')).resolves.toMatchObject({ group: null });
    });
  });

  describe('cost tracking', () => {
    beforeEach(() => {
      daily.length = 0;
    });

    it('stores the Claude call cost on the answer and in the daily tally', async () => {
      const { svc, prisma } = makeService(ai({ niches: ['acoperisuri'] }));
      await svc.interpret('cine repara o tigla', 'ro');
      await new Promise((r) => setImmediate(r));

      const row = [...prisma.rows.values()][0] as any;
      expect(row).toBeTruthy();
      const upsert = prisma.feedQueryCache.upsert.mock.calls[0][0];
      // Haiku 5.5: 2000 in x $0.10/M + 40 out x $0.50/M
      expect(upsert.create.estimatedCostUsd).toBeCloseTo(0.00022, 6);
      expect(upsert.create.model).toBe('claude-haiku-5-5');

      const tally = daily[0];
      expect(tally.create).toMatchObject({
        total: 1,
        ai: 1,
        aiInputTokens: 2_000,
        aiOutputTokens: 40,
      });
      expect(tally.update.ai).toEqual({ increment: 1 });
      expect(tally.update.aiCostUsd.increment).toBeCloseTo(0.00022, 6);
    });

    it('tallies free answers without any cost', async () => {
      const { svc } = makeService(null);
      await svc.interpret('instalatii electrice', 'ro');
      await new Promise((r) => setImmediate(r));
      expect(daily[0].create).toMatchObject({ total: 1, keyword: 1, aiCostUsd: 0 });
    });
  });

  describe('keyword fallback (no model, no AI)', () => {
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

    it('returns no category for an unrelated request, and never stores fallback answers', async () => {
      const { svc, ai: aiSvc, prisma } = makeService(null);
      await expect(svc.interpret('salut ce faci', 'ro')).resolves.toEqual({
        group: null,
        niches: [],
        counties: [],
      });
      await svc.interpret('salut ce faci', 'ro');
      expect(aiSvc.interpretFeedQuery).toHaveBeenCalledTimes(2);
      expect(prisma.rows.size).toBe(0);
    });
  });
});
