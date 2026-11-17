import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/env';
import { CATEGORY_KEYWORDS } from './category-keywords';
import { FeedService } from './feed.service';

/** Small multilingual sentence-embedding model (ONNX, int8, ~120 MB), run
 *  in-process on the CPU. Downloaded once from the Hugging Face hub into
 *  `.cache/transformers` and reused from disk after that. */
const MODEL_ID = 'Xenova/multilingual-e5-small';
const CACHE_DIR = join(process.cwd(), '.cache', 'transformers');
/** A request arriving while the model is still loading doesn't wait for it
 *  (first boot downloads it): it's answered by the other matchers instead. */
const READY_WAIT_MS = 1_500;
const BATCH = 64;

type Vec = Float32Array;
interface Tensor {
  tolist(): number[][];
}
type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<Tensor>;

export interface EmbeddingLeaf {
  slug: string;
  group: string;
  names: string[];
}
interface IndexedLeaf {
  slug: string;
  group: string;
  /** The whole description (names + every phrase) as one passage. */
  full: Vec;
  /** Each name / phrase on its own — sharp on an exact phrase hit. */
  phrases: Vec[];
}
export interface EmbeddingMatch {
  slug: string;
  group: string;
  /** Blended similarity of the best leaf. */
  score: number;
  /** Lead over the runner-up leaf: the confidence signal (absolute scores
   *  from e5 sit in a narrow band, the gap between the top two doesn't). */
  margin: number;
}

function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Local semantic matcher for the homepage "ask" search: embeds the visitor's
 * sentence and finds the closest sub-category, at zero cost per request and
 * ~5 ms of CPU. Each leaf is represented by its ro/en/de names plus the
 * everyday phrases in `CATEGORY_KEYWORDS`, so "mi s-a spart o țeavă" lands on
 * plumbing without any API call.
 *
 * Fully optional: if the model can't load (no network on first boot, a
 * platform without onnxruntime, `FEED_EMBEDDINGS=off`), `match()` returns
 * null and the caller falls back to keyword matching + the Claude backup.
 */
@Injectable()
export class FeedEmbeddingService implements OnApplicationBootstrap {
  private readonly logger = new Logger('FeedEmbeddingService');
  private readonly enabled: boolean;
  private extractor: Promise<Extractor | null> | null = null;
  private index: { fingerprint: string; leaves: IndexedLeaf[] } | null = null;
  private building: { fingerprint: string; done: Promise<IndexedLeaf[] | null> } | null = null;

  constructor(
    @Inject(ConfigService) config: ConfigService<AppConfig, true>,
    private readonly feed: FeedService,
  ) {
    this.enabled =
      config.get('feedEmbeddings', { infer: true }) !== false &&
      config.get('nodeEnv', { infer: true }) !== 'test';
  }

  /** Load the model and build the index in the background so the first
   *  visitor doesn't pay for it. Never blocks or fails boot. */
  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    void (async () => {
      try {
        const leaves = leavesOf((await this.feed.facets()).categories as unknown as TreeGroup[]);
        await this.ensureIndex(leaves, fingerprintOf(leaves));
      } catch (err) {
        this.logger.warn(`Warm-up failed: ${(err as Error).message}`);
      }
    })();
  }

  /**
   * Closest leaf for `text`, or null when the matcher isn't available (yet).
   * `fingerprint` identifies the taxonomy the leaves came from; a new one
   * (category added/renamed) rebuilds the index.
   */
  async match(
    text: string,
    leaves: EmbeddingLeaf[],
    fingerprint: string,
  ): Promise<EmbeddingMatch | null> {
    if (!this.enabled || leaves.length < 2) return null;
    const ready = this.ensureIndex(leaves, fingerprint);
    const indexed = await Promise.race([
      ready,
      new Promise<null>((r) => setTimeout(() => r(null), READY_WAIT_MS).unref?.()),
    ]);
    const extractor = indexed && (await this.loadExtractor());
    if (!indexed || !extractor) return null;

    try {
      const [q] = await this.embed(extractor, [`query: ${text}`]);
      let best: EmbeddingMatch | null = null;
      let second = -Infinity;
      for (const leaf of indexed) {
        let phraseMax = -Infinity;
        for (const p of leaf.phrases) phraseMax = Math.max(phraseMax, dot(q, p));
        const score = (dot(q, leaf.full) + phraseMax) / 2;
        if (!best || score > best.score) {
          if (best) second = best.score;
          best = { slug: leaf.slug, group: leaf.group, score, margin: 0 };
        } else if (score > second) {
          second = score;
        }
      }
      if (best) best.margin = best.score - second;
      return best;
    } catch (err) {
      this.logger.warn(`Embedding a request failed: ${(err as Error).message}`);
      return null;
    }
  }

  private ensureIndex(leaves: EmbeddingLeaf[], fingerprint: string): Promise<IndexedLeaf[] | null> {
    if (this.index?.fingerprint === fingerprint) return Promise.resolve(this.index.leaves);
    if (this.building?.fingerprint === fingerprint) return this.building.done;

    const done = (async () => {
      const extractor = await this.loadExtractor();
      if (!extractor) return null;
      try {
        const started = Date.now();
        const built: IndexedLeaf[] = [];
        for (const leaf of leaves) {
          const phrases = [
            ...leaf.names,
            ...(CATEGORY_KEYWORDS[leaf.slug] ?? '')
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean),
          ];
          const [full] = await this.embed(extractor, [`passage: ${phrases.join(', ')}`]);
          const vecs = await this.embed(
            extractor,
            phrases.map((p) => `query: ${p}`),
          );
          built.push({ slug: leaf.slug, group: leaf.group, full, phrases: vecs });
        }
        this.index = { fingerprint, leaves: built };
        this.logger.log(`Indexed ${built.length} categories in ${Date.now() - started} ms`);
        return built;
      } catch (err) {
        this.logger.warn(`Building the category index failed: ${(err as Error).message}`);
        return null;
      } finally {
        if (this.building?.fingerprint === fingerprint) this.building = null;
      }
    })();
    this.building = { fingerprint, done };
    return done;
  }

  private loadExtractor(): Promise<Extractor | null> {
    this.extractor ??= (async () => {
      try {
        const started = Date.now();
        const tf = await import('@huggingface/transformers');
        tf.env.cacheDir = CACHE_DIR;
        const pipe = await tf.pipeline('feature-extraction', MODEL_ID, {
          dtype: 'q8',
          // One thread: a request is ~5 ms anyway, and this must never
          // compete with the API for the VPS's cores.
          session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
        });
        this.logger.log(`Loaded ${MODEL_ID} in ${Date.now() - started} ms`);
        return pipe as unknown as Extractor;
      } catch (err) {
        this.logger.warn(
          `Local embedding model unavailable (${(err as Error).message}); the homepage search uses keyword matching + the Claude backup`,
        );
        return null;
      }
    })();
    return this.extractor;
  }

  private async embed(extractor: Extractor, texts: string[]): Promise<Vec[]> {
    const out: Vec[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const t = await extractor(texts.slice(i, i + BATCH), { pooling: 'mean', normalize: true });
      for (const row of t.tolist()) out.push(Float32Array.from(row));
    }
    return out;
  }
}

interface TreeNode {
  slug: string;
  name: Partial<Record<'ro' | 'en' | 'de', string>>;
}
export interface TreeGroup extends TreeNode {
  children: TreeNode[];
}

/** The leaves of the Feed's category tree, as the matcher indexes them. */
export function leavesOf(groups: TreeGroup[]): EmbeddingLeaf[] {
  return groups.flatMap((g) =>
    g.children.map((c) => ({
      slug: c.slug,
      group: g.slug,
      names: [c.name.ro, c.name.en, c.name.de].filter((n): n is string => !!n),
    })),
  );
}

/** Stable id of a leaf list: changes when a category is added, removed or
 *  renamed, or when its keyword line changes. */
export function fingerprintOf(leaves: EmbeddingLeaf[]): string {
  return createHash('sha1')
    .update(
      leaves
        .map((l) => `${l.group}/${l.slug}:${l.names.join('|')}:${CATEGORY_KEYWORDS[l.slug] ?? ''}`)
        .join('\n'),
    )
    .digest('hex');
}
