/**
 * PRO V2's `search_images` tool. Reuses the EXISTING `PexelsProvider` (same
 * key, same HTTP client — no duplicate integration) and the EXISTING
 * `pexels_cache` table the deterministic Advanced-builder generator already
 * writes to, so a query PRO V2 asks for can be a free cache hit if the
 * generator (or a previous PRO V2 turn) already searched it, and vice versa.
 * The 3-searches-per-request cap is enforced by the caller (the agent loop
 * already tracks per-turn tool-call counts); this module just does the
 * search + cache lookup and returns a small, normalized result set.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/env';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PexelsProvider,
  type PexelsOrientation,
  type PexelsPhoto,
} from '../generator/image-provider/pexels.provider';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — matches the generator's own cache
const SIZE = 'large' as const;
const PER_PAGE = 6;
const MAX_RESULTS = 5;

export interface ImageSearchResult {
  url: string;
  thumbnail: string;
  photographer: string;
  photographerUrl: string;
  pexelsUrl: string;
}

function toResult(p: PexelsPhoto): ImageSearchResult {
  return {
    url: p.src.large,
    thumbnail: p.src.tiny,
    photographer: p.photographer,
    photographerUrl: p.photographerUrl,
    pexelsUrl: p.url,
  };
}

@Injectable()
export class PexelsSearchTool {
  private readonly provider: PexelsProvider;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    this.provider = new PexelsProvider(config.get('pexelsApiKey', { infer: true }) ?? '');
  }

  get configured(): boolean {
    return this.provider.configured;
  }

  async search(query: string, orientation?: PexelsOrientation): Promise<ImageSearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    const key = `${q}|${orientation ?? ''}|${SIZE}`.toLowerCase();

    const cached = await this.prisma.pexelsCacheEntry
      .findUnique({ where: { key } })
      .catch(() => null);
    if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
      return ((cached.photos as unknown as PexelsPhoto[]) ?? [])
        .slice(0, MAX_RESULTS)
        .map(toResult);
    }

    if (!this.provider.configured) {
      return ((cached?.photos as unknown as PexelsPhoto[]) ?? [])
        .slice(0, MAX_RESULTS)
        .map(toResult);
    }

    const res = await this.provider.search(q, { orientation, size: SIZE, perPage: PER_PAGE });
    if (res.errored) {
      return ((cached?.photos as unknown as PexelsPhoto[]) ?? [])
        .slice(0, MAX_RESULTS)
        .map(toResult);
    }

    await this.prisma.pexelsCacheEntry
      .upsert({
        where: { key },
        create: {
          key,
          query: q,
          orientation: orientation ?? '',
          size: SIZE,
          photos: res.photos as unknown as object[],
        },
        update: { photos: res.photos as unknown as object[], fetchedAt: new Date() },
      })
      .catch(() => undefined);

    return res.photos.slice(0, MAX_RESULTS).map(toResult);
  }
}
