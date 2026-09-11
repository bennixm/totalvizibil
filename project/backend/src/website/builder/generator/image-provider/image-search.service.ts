/**
 * Stage 8 — resolve typed `ImageIntent`s to real Pexels photos.
 *
 *   intent → query → (cache | live search) → filter → score → seeded pick
 *          → ResolvedImage    (fallback: no entry → caller keeps the pool photo)
 *
 * Everything is best-effort: a miss, an error or a rate-limit for one slot just
 * means that slot isn't in the returned map. The DB cache (`pexels_cache`) keeps
 * re-generation and batch runs well under the free-tier limit.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../../config/env';
import { PrismaService } from '../../../../prisma/prisma.service';
import type {
  ImageIntent,
  ImageSearchResolver,
  ImageResolveRequest,
  ResolvedImage,
} from '../types';
import { intentKey } from './image-apply';
import { imageQuery } from './image-query';
import { colorBucket, scorePhoto } from './image-score';
import {
  PexelsProvider,
  type PexelsOrientation,
  type PexelsPhoto,
  type PexelsSize,
} from './pexels.provider';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SIZE: PexelsSize = 'large';
const PER_PAGE = 15;
/** Below this many requests left, stop making live calls for the rest of the run. */
const RATE_FLOOR = 8;
/** Minimum acceptable score — below this we'd rather keep the curated pool photo. */
const MIN_SCORE = 1.5;

@Injectable()
export class ImageSearchService implements ImageSearchResolver {
  private readonly logger = new Logger('ImageSearchService');
  private readonly provider: PexelsProvider;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    this.provider = new PexelsProvider(config.get('pexelsApiKey', { infer: true }) ?? '');
    if (!this.provider.configured) {
      this.logger.log('PEXELS_API_KEY not set — the generator uses the curated photo pool');
    }
  }

  get configured(): boolean {
    return this.provider.configured;
  }

  async resolve(req: ImageResolveRequest): Promise<Map<string, ResolvedImage>> {
    const out = new Map<string, ResolvedImage>();
    if (!this.provider.configured || !req.intents.length) return out;

    const usedIds = new Set<number>();
    const usedColorBuckets = new Set<string>();
    let rateExhausted = false;

    // Resolve in small sequential batches — a site rarely needs > 6 photos and
    // we want the used-id/colour guards to see each other's picks.
    const intents = req.intents.slice(0, 12);
    for (let b = 0; b < intents.length; b += 3) {
      const batch = intents.slice(b, b + 3);
      const results = await Promise.all(
        batch.map(async (intent, j) => {
          const query = imageQuery(intent, req.dna, req.profile);
          if (!query) return null;
          const orientation = intent.orientation;
          const { photos, live } = await this.photosFor(query, orientation, rateExhausted);
          if (live?.rateLow) rateExhausted = true;
          if (!photos.length) return null;
          const picked = this.pick(photos, intent, req.seed + b + j, {
            usedIds,
            usedColorBuckets,
          });
          if (!picked) return null;
          usedIds.add(picked.id);
          const cb = colorBucket(picked.avgColor);
          if (cb) usedColorBuckets.add(cb);
          return { intent, picked, query, orientation };
        }),
      );
      for (const r of results) {
        if (!r) continue;
        out.set(intentKey(r.intent), toResolved(r.picked, r.intent, r.query, r.orientation));
      }
    }
    if (out.size) this.logger.log(`Pexels: resolved ${out.size}/${intents.length} image slot(s)`);
    return out;
  }

  // --- cache + provider -------------------------------------------------

  private async photosFor(
    query: string,
    orientation: PexelsOrientation,
    rateExhausted: boolean,
  ): Promise<{ photos: PexelsPhoto[]; live?: { rateLow: boolean } }> {
    const key = `${query}|${orientation}|${SIZE}`.toLowerCase();

    const cached = await this.prisma.pexelsCacheEntry
      .findUnique({ where: { key } })
      .catch(() => null);
    if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
      return { photos: (cached.photos as unknown as PexelsPhoto[]) ?? [] };
    }
    if (rateExhausted) return { photos: (cached?.photos as unknown as PexelsPhoto[]) ?? [] };

    const res = await this.provider.search(query, { orientation, size: SIZE, perPage: PER_PAGE });
    if (res.errored) {
      // fall back to a stale cache row if we have one
      return { photos: (cached?.photos as unknown as PexelsPhoto[]) ?? [] };
    }
    // upsert the fresh result
    await this.prisma.pexelsCacheEntry
      .upsert({
        where: { key },
        create: {
          key,
          query,
          orientation,
          size: SIZE,
          photos: res.photos as unknown as object[],
        },
        update: { photos: res.photos as unknown as object[], fetchedAt: new Date() },
      })
      .catch(() => undefined);

    const rateLow =
      typeof res.rateLimit.remaining === 'number' && res.rateLimit.remaining <= RATE_FLOOR;
    return { photos: res.photos, live: { rateLow } };
  }

  private pick(
    photos: PexelsPhoto[],
    intent: ImageIntent,
    seed: number,
    ctx: { usedIds: Set<number>; usedColorBuckets: Set<string> },
  ): PexelsPhoto | null {
    const ranked = photos
      .map((p) => ({ p, s: scorePhoto(p, intent, ctx) }))
      .filter((r) => !ctx.usedIds.has(r.p.id))
      .sort((a, b) => b.s - a.s);
    if (!ranked.length || ranked[0].s < MIN_SCORE) return null;
    // seeded choice among the top few so two seeds give different sets
    const topN = Math.min(ranked.length, ranked[0].s >= 4 ? 4 : 2);
    const idx = Math.abs(seed) % topN;
    return ranked[idx].p;
  }
}

function toResolved(
  photo: PexelsPhoto,
  intent: ImageIntent,
  query: string,
  orientation: PexelsOrientation,
): ResolvedImage {
  const url =
    orientation === 'portrait' && photo.src.portrait
      ? photo.src.portrait
      : orientation === 'landscape' && photo.src.landscape
        ? photo.src.landscape
        : photo.src.large || photo.src.large2x || photo.src.original;
  const alt =
    (intent.refinedSubject || intent.subject).trim() || photo.alt.trim() || `${intent.role} photo`;
  return {
    url,
    provider: 'pexels',
    photoId: String(photo.id),
    photographer: photo.photographer || undefined,
    photographerUrl: photo.photographerUrl || undefined,
    sourceUrl: photo.url || undefined,
    width: photo.width || undefined,
    height: photo.height || undefined,
    alt: alt.slice(0, 160),
    query,
  };
}

/** Re-export so the pipeline can build a no-op resolver in tests. */
export type { ImageSearchResolver, ImageResolveRequest };
