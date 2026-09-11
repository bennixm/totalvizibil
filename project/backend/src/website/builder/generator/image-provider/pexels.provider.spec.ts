import { PexelsProvider } from './pexels.provider';

function photoJson(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    width: 4000,
    height: 3000,
    url: `https://www.pexels.com/photo/${id}/`,
    photographer: 'Jane Doe',
    photographer_url: 'https://www.pexels.com/@janedoe',
    avg_color: '#3a4a5a',
    alt: 'a bakery interior with fresh bread',
    src: {
      original: `https://images.pexels.com/photos/${id}/o.jpg`,
      large2x: `https://images.pexels.com/photos/${id}/l2x.jpg`,
      large: `https://images.pexels.com/photos/${id}/l.jpg`,
      medium: `https://images.pexels.com/photos/${id}/m.jpg`,
      landscape: `https://images.pexels.com/photos/${id}/land.jpg`,
      portrait: `https://images.pexels.com/photos/${id}/port.jpg`,
      tiny: `https://images.pexels.com/photos/${id}/t.jpg`,
    },
    ...over,
  };
}

function mockFetch(
  impl: (url: string, init?: RequestInit) => Partial<Response> | Promise<Partial<Response>>,
) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : String(input);
    return (await impl(url, init)) as Response;
  });
}

const okResponse = (body: unknown, headers: Record<string, string> = {}): Partial<Response> => ({
  ok: true,
  status: 200,
  headers: new Headers(headers),
  json: async () => body,
});

describe('PexelsProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns [] and does not call fetch without a key', async () => {
    const spy = mockFetch(() => okResponse({ photos: [] }));
    const res = await new PexelsProvider('').search('bakery');
    expect(res.photos).toEqual([]);
    expect(res.errored).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('encodes query + params and sends the auth header', async () => {
    let seenUrl = '';
    let seenAuth: string | null = null;
    mockFetch((url, init) => {
      seenUrl = url;
      seenAuth = new Headers(init?.headers).get('Authorization');
      return okResponse({ photos: [photoJson(1)] });
    });
    await new PexelsProvider('KEY123').search('artisan bakery bread', {
      orientation: 'landscape',
      perPage: 12,
      page: 2,
    });
    expect(seenUrl).toContain('query=artisan+bakery+bread');
    expect(seenUrl).toContain('orientation=landscape');
    expect(seenUrl).toContain('per_page=12');
    expect(seenUrl).toContain('page=2');
    expect(seenAuth).toBe('KEY123');
  });

  it('clamps per_page to 1..80', async () => {
    let seenUrl = '';
    mockFetch((url) => {
      seenUrl = url;
      return okResponse({ photos: [] });
    });
    await new PexelsProvider('K').search('x', { perPage: 999 });
    expect(seenUrl).toContain('per_page=80');
  });

  it('parses photos + rate-limit headers', async () => {
    mockFetch(() =>
      okResponse(
        { photos: [photoJson(10), photoJson(11)] },
        {
          'X-Ratelimit-Limit': '20000',
          'X-Ratelimit-Remaining': '19950',
          'X-Ratelimit-Reset': '1700000000',
        },
      ),
    );
    const res = await new PexelsProvider('K').search('bakery');
    expect(res.photos.map((p) => p.id)).toEqual([10, 11]);
    expect(res.photos[0].src.large).toMatch(/^https:\/\/images\.pexels\.com\//);
    expect(res.rateLimit).toEqual({ limit: 20000, remaining: 19950, reset: 1700000000 });
    expect(res.errored).toBe(false);
  });

  it('drops photos with a non-pexels src host or no id', async () => {
    mockFetch(() =>
      okResponse({
        photos: [
          photoJson(1, { src: { large: 'https://evil.example.com/x.jpg' } }),
          photoJson(0),
          photoJson(2),
        ],
      }),
    );
    const res = await new PexelsProvider('K').search('bakery');
    expect(res.photos.map((p) => p.id)).toEqual([2]);
  });

  it('non-200 → errored, no throw', async () => {
    mockFetch(() => ({ ok: false, status: 429, headers: new Headers(), json: async () => ({}) }));
    const res = await new PexelsProvider('K').search('bakery');
    expect(res).toMatchObject({ photos: [], errored: true });
  });

  it('a thrown fetch (timeout) → [] errored', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('AbortError'));
    const res = await new PexelsProvider('K').search('bakery');
    expect(res).toMatchObject({ photos: [], errored: true });
  });

  it('empty photos array → not errored', async () => {
    mockFetch(() => okResponse({ photos: [] }));
    const res = await new PexelsProvider('K').search('bakery');
    expect(res.errored).toBe(false);
    expect(res.photos).toEqual([]);
  });
});
