/**
 * Thin client for the Pexels photo search API (https://www.pexels.com/api/).
 *
 *   GET https://api.pexels.com/v1/search
 *   header  Authorization: <PEXELS_API_KEY>
 *   params  query, orientation(landscape|portrait|square), size(large|medium|small),
 *           per_page (1–80, default 15), page
 *
 * It NEVER throws into the pipeline: any failure (no key, non-200, network, a
 * rate-limit response, a malformed body) resolves to `[]` and the caller falls
 * back to the curated pool. Rate-limit headers are surfaced so the search
 * service can back off.
 */

const ENDPOINT = 'https://api.pexels.com/v1/search';
const DEFAULT_TIMEOUT_MS = 6000;

export type PexelsOrientation = 'landscape' | 'portrait' | 'square';
export type PexelsSize = 'large' | 'medium' | 'small';

export interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  /** Pexels page for the photo (attribution target). */
  url: string;
  photographer: string;
  photographerUrl: string;
  /** Dominant colour, `#rrggbb` — used for near-duplicate detection. */
  avgColor: string;
  /** Pexels' own alt text — the main relevance signal. */
  alt: string;
  /** Hot-linkable CDN sources (all `https://images.pexels.com/...`). */
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    landscape: string;
    portrait: string;
    tiny: string;
  };
}

export interface PexelsSearchOpts {
  orientation?: PexelsOrientation;
  size?: PexelsSize;
  /** 1–80. Default 15. */
  perPage?: number;
  page?: number;
  timeoutMs?: number;
}

export interface PexelsRateLimit {
  /** Monthly quota. */
  limit?: number;
  /** Requests left this window. */
  remaining?: number;
  /** Unix seconds when the window resets. */
  reset?: number;
}

export interface PexelsSearchResult {
  photos: PexelsPhoto[];
  rateLimit: PexelsRateLimit;
  /** `true` when the request itself failed (vs. a valid empty result set). */
  errored: boolean;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Map one raw API photo to our trimmed shape; drop anything without a usable src. */
function coercePhoto(raw: unknown): PexelsPhoto | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = num(o.id);
  const srcRaw = (o.src && typeof o.src === 'object' ? o.src : {}) as Record<string, unknown>;
  const okHost = (u: string): string => (/^https:\/\/images\.pexels\.com\//.test(u) ? u : '');
  const large =
    okHost(str(srcRaw.large)) || okHost(str(srcRaw.large2x)) || okHost(str(srcRaw.original));
  // no id, or no usable pexels-hosted source ⇒ unusable
  if (!id || !large) return null;
  return {
    id,
    width: num(o.width),
    height: num(o.height),
    url: str(o.url),
    photographer: str(o.photographer),
    photographerUrl: str(o.photographer_url),
    avgColor: /^#[0-9a-fA-F]{6}$/.test(str(o.avg_color)) ? str(o.avg_color).toLowerCase() : '',
    alt: str(o.alt),
    src: {
      original: okHost(str(srcRaw.original)),
      large2x: okHost(str(srcRaw.large2x)),
      large,
      medium: okHost(str(srcRaw.medium)),
      landscape: okHost(str(srcRaw.landscape)),
      portrait: okHost(str(srcRaw.portrait)),
      tiny: okHost(str(srcRaw.tiny)),
    },
  };
}

function parseRateLimit(h: Headers): PexelsRateLimit {
  const n = (k: string): number | undefined => {
    const v = h.get(k);
    if (v == null || v === '') return undefined;
    const p = Number(v);
    return Number.isFinite(p) ? p : undefined;
  };
  return {
    limit: n('X-Ratelimit-Limit'),
    remaining: n('X-Ratelimit-Remaining'),
    reset: n('X-Ratelimit-Reset'),
  };
}

export class PexelsProvider {
  constructor(private readonly apiKey: string) {}

  get configured(): boolean {
    return !!this.apiKey;
  }

  async search(query: string, opts: PexelsSearchOpts = {}): Promise<PexelsSearchResult> {
    const empty: PexelsSearchResult = { photos: [], rateLimit: {}, errored: true };
    const q = query.trim();
    if (!this.apiKey || !q) return empty;

    const params = new URLSearchParams({
      query: q,
      per_page: String(Math.min(80, Math.max(1, opts.perPage ?? 15))),
      page: String(Math.max(1, opts.page ?? 1)),
    });
    if (opts.orientation) params.set('orientation', opts.orientation);
    if (opts.size) params.set('size', opts.size);

    try {
      const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
        headers: { Authorization: this.apiKey },
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      const rateLimit = parseRateLimit(res.headers);
      if (!res.ok) return { photos: [], rateLimit, errored: true };
      const body = (await res.json().catch(() => null)) as { photos?: unknown[] } | null;
      const photos = Array.isArray(body?.photos)
        ? body!.photos.map(coercePhoto).filter((p): p is PexelsPhoto => p !== null)
        : [];
      return { photos, rateLimit, errored: false };
    } catch {
      return empty;
    }
  }
}
