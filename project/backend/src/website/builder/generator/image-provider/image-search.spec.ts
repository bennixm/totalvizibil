import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../../prisma/prisma.service';
import { ARCHETYPE_PROFILE_DEFAULTS } from '../business-analysis';
import { deriveDesignDNA } from '../design-dna';
import type { BusinessProfile, DesignDNA, ImageIntent } from '../types';
import { imageQuery } from './image-query';
import { colorBucket, scorePhoto } from './image-score';
import { ImageSearchService } from './image-search.service';
import type { PexelsPhoto } from './pexels.provider';

const profile: BusinessProfile = {
  ...ARCHETYPE_PROFILE_DEFAULTS.hospitality.profile,
  archetype: 'hospitality',
};
const dna: DesignDNA = deriveDesignDNA(
  profile,
  ARCHETYPE_PROFILE_DEFAULTS.hospitality.directions[0],
  7,
);

const intent = (over: Partial<ImageIntent> = {}): ImageIntent => ({
  sectionId: 's1',
  field: 'backgroundImage',
  role: 'hero',
  subject: 'artisan bakery fresh sourdough bread',
  scene: 'bakery interior, Cluj',
  mood: 'warm, sensory',
  composition: 'imageBg',
  style: 'warm natural light, candid',
  orientation: 'landscape',
  avoid: ['logo', 'illustration'],
  ...over,
});

function photo(id: number, over: Partial<PexelsPhoto> = {}): PexelsPhoto {
  return {
    id,
    width: 4000,
    height: 2600,
    url: `https://www.pexels.com/photo/${id}/`,
    photographer: 'P',
    photographerUrl: 'https://pexels.com/@p',
    avgColor: '#402910',
    alt: 'fresh sourdough bread on a bakery counter',
    src: {
      original: `https://images.pexels.com/photos/${id}/o.jpg`,
      large2x: `https://images.pexels.com/photos/${id}/l2.jpg`,
      large: `https://images.pexels.com/photos/${id}/l.jpg`,
      medium: `https://images.pexels.com/photos/${id}/m.jpg`,
      landscape: `https://images.pexels.com/photos/${id}/land.jpg`,
      portrait: `https://images.pexels.com/photos/${id}/port.jpg`,
      tiny: `https://images.pexels.com/photos/${id}/t.jpg`,
    },
    ...over,
  };
}

describe('imageQuery', () => {
  it('strips generic filler words', () => {
    const q = imageQuery(
      intent({ subject: 'professional business team in an office', scene: 'corporate meeting' }),
      dna,
      profile,
    );
    expect(q).not.toMatch(/business|team|office|corporate|meeting/i);
    expect(q.length).toBeGreaterThan(0);
  });

  it('keeps the concrete subject + appends a wide cue for a hero', () => {
    const q = imageQuery(intent(), dna, profile);
    expect(q).toMatch(/bread|bakery|sourdough/);
    expect(q).toContain('wide');
  });

  it('adds a vertical cue for portrait slots', () => {
    const q = imageQuery(intent({ role: 'team', orientation: 'portrait' }), dna, profile);
    expect(q).toContain('vertical');
  });
});

describe('scorePhoto', () => {
  const ctx = () => ({ usedIds: new Set<number>(), usedColorBuckets: new Set<string>() });

  it('rewards alt/subject overlap and the right orientation', () => {
    const good = scorePhoto(photo(1), intent(), ctx());
    const offTopic = scorePhoto(photo(2, { alt: 'a mountain lake at sunrise' }), intent(), ctx());
    expect(good).toBeGreaterThan(offTopic);
  });

  it('penalises the generic-stock look', () => {
    const plain = scorePhoto(photo(3, { alt: 'sourdough bread loaf close up' }), intent(), ctx());
    const stock = scorePhoto(
      photo(4, { alt: 'business people shaking hands in a meeting room' }),
      intent(),
      ctx(),
    );
    expect(stock).toBeLessThan(plain);
  });

  it('penalises an already-used id and a used colour bucket', () => {
    const base = scorePhoto(photo(5), intent(), ctx());
    const c = ctx();
    c.usedIds.add(5);
    expect(scorePhoto(photo(5), intent(), c)).toBeLessThan(base);
    const c2 = ctx();
    c2.usedColorBuckets.add(colorBucket('#402910'));
    expect(scorePhoto(photo(6), intent(), c2)).toBeLessThan(base);
  });

  it('penalises a wrong orientation', () => {
    const land = scorePhoto(photo(7, { width: 4000, height: 2000 }), intent(), ctx());
    const port = scorePhoto(photo(8, { width: 2000, height: 4000 }), intent(), ctx());
    expect(port).toBeLessThan(land);
  });
});

// --- ImageSearchService (fake config + prisma + fetch) ---

type CacheRow = { key: string; photos: unknown; fetchedAt: Date };

function makeService(key: string, seedRows: CacheRow[] = []) {
  const rows = new Map(seedRows.map((r) => [r.key, r]));
  const upsert = jest.fn(async ({ where, create, update }: any) => {
    const existing = rows.get(where.key);
    rows.set(where.key, {
      key: where.key,
      photos: (existing ? update.photos : create.photos) as unknown,
      fetchedAt: new Date(),
    });
  });
  const findUnique = jest.fn(async ({ where }: any) => rows.get(where.key) ?? null);
  const prisma = { pexelsCacheEntry: { findUnique, upsert } } as unknown as PrismaService;
  const config = { get: () => key } as unknown as ConfigService<never, true>;
  const svc = new ImageSearchService(config as never, prisma);
  return { svc, findUnique, upsert, rows };
}

function mockSearchFetch(photosById: (q: string) => PexelsPhoto[], remaining = 19000) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = new URL(typeof input === 'string' ? input : String(input));
    const q = url.searchParams.get('query') ?? '';
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'X-Ratelimit-Remaining': String(remaining) }),
      json: async () => ({ photos: photosById(q).map(rawify) }),
    } as Response;
  });
}
/** turn our trimmed PexelsPhoto back into the raw API shape the provider parses */
function rawify(p: PexelsPhoto): Record<string, unknown> {
  return {
    id: p.id,
    width: p.width,
    height: p.height,
    url: p.url,
    photographer: p.photographer,
    photographer_url: p.photographerUrl,
    avg_color: p.avgColor,
    alt: p.alt,
    src: p.src,
  };
}

describe('ImageSearchService.resolve', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is a no-op (empty map) without a key', async () => {
    const { svc } = makeService('');
    expect(svc.configured).toBe(false);
    const out = await svc.resolve({ intents: [intent()], seed: 1, dna, profile });
    expect(out.size).toBe(0);
  });

  it('resolves an intent to a pexels photo and records provenance', async () => {
    const { svc } = makeService('KEY');
    mockSearchFetch(() => [photo(100), photo(101), photo(102)]);
    const out = await svc.resolve({ intents: [intent()], seed: 1, dna, profile });
    expect(out.size).toBe(1);
    const r = out.get('s1|backgroundImage|-')!;
    expect(r.provider).toBe('pexels');
    expect(r.url).toMatch(/^https:\/\/images\.pexels\.com\//);
    expect(r.photoId).toMatch(/^10[012]$/);
    expect(r.photographer).toBe('P');
  });

  it('does not place the same photo id twice in one site', async () => {
    const { svc } = makeService('KEY');
    mockSearchFetch(() => [photo(200), photo(201)]);
    const out = await svc.resolve({
      intents: [
        intent({ sectionId: 'a', field: 'backgroundImage' }),
        intent({ sectionId: 'b', field: 'imageUrl', role: 'gallery' }),
      ],
      seed: 3,
      dna,
      profile,
    });
    const ids = [...out.values()].map((r) => r.photoId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('seed A and seed B pick different photos from the same pool', async () => {
    const pool = [photo(1), photo(2), photo(3), photo(4), photo(5)];
    const a = makeService('KEY');
    mockSearchFetch(() => pool);
    const ra = await a.svc.resolve({ intents: [intent()], seed: 0, dna, profile });
    jest.restoreAllMocks();
    const b = makeService('KEY');
    mockSearchFetch(() => pool);
    const rb = await b.svc.resolve({ intents: [intent()], seed: 3, dna, profile });
    // not a hard guarantee for every seed pair, but these two differ
    expect(ra.get('s1|backgroundImage|-')?.photoId).not.toBe(
      rb.get('s1|backgroundImage|-')?.photoId,
    );
  });

  it('a fresh cache row is used instead of calling the API', async () => {
    const key = `${imageQuery(intent(), dna, profile)}|landscape|large`.toLowerCase();
    const { svc } = makeService('KEY', [
      { key, photos: [photo(900), photo(901)].map(rawifyTrim), fetchedAt: new Date() },
    ]);
    const fetchSpy = mockSearchFetch(() => [photo(1)]);
    const out = await svc.resolve({ intents: [intent()], seed: 1, dna, profile });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.get('s1|backgroundImage|-')?.photoId).toMatch(/^90[01]$/);
  });

  it('provider error with no cache → that slot is simply absent', async () => {
    const { svc } = makeService('KEY');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({}),
    } as Response);
    const out = await svc.resolve({ intents: [intent()], seed: 1, dna, profile });
    expect(out.size).toBe(0);
  });
});

/** cache rows store the already-trimmed PexelsPhoto shape (not the raw API one) */
function rawifyTrim(p: PexelsPhoto): PexelsPhoto {
  return p;
}
