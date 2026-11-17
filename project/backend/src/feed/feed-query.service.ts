import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AiService, type AiLocale, type FeedQueryInterpretation } from '../ai/ai.service';
import type { AppConfig } from '../config/env';
import { RO_CITIES, RO_COUNTIES, resolveCounty } from '../geo/ro-cities';
import { PrismaService } from '../prisma/prisma.service';
import { FeedEmbeddingService, fingerprintOf, leavesOf } from './feed-embedding.service';
import { FeedService } from './feed.service';

/** Exactly what the Feed can express: one group, 0-3 leaves of that group,
 *  0-3 județe. `group: null` means "no category recognised" (Feed root). */
export interface FeedQueryResult {
  group: string | null;
  niches: string[];
  counties: string[];
}

type LocalizedName = Partial<Record<AiLocale, string>>;
interface CatalogLeaf {
  slug: string;
  name: LocalizedName;
}
interface CatalogGroup extends CatalogLeaf {
  children: CatalogLeaf[];
}

const MAX_PICKS = 3;
/** Stored Claude answers are reused for this long. */
const AI_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** A keyword hit below this is a stray word overlap, not a real match. */
const FALLBACK_MIN_SCORE = 50;
/** A keyword hit at/above this means a category NAME is literally in the
 *  request ("firmă de construcții", "instalații electrice"): trusted as is. */
const NAME_HIT_SCORE = 80;
/** Local embedding lead over the runner-up that counts as "sure". Tuned on
 *  realistic requests against the live taxonomy: above it ~97% were right;
 *  below it the request goes to the Claude backup. */
const EMBED_CONFIDENT_MARGIN = 0.012;
/** With no AI left to ask, a weaker local guess is still shown above this
 *  (the toast says what was picked); below it the Feed root is safer. */
const EMBED_GUESS_MARGIN = 0.005;

/** Filler words in search-style requests ("unde găsesc o firmă de …"),
 *  greetings and short function words. They carry no category meaning but
 *  can collide with words inside category names ("de" in "Sisteme de
 *  securitate"), and they dilute the word-overlap ratio. */
const STOPWORDS = new Set([
  // ro
  'unde',
  'gasesc',
  'gasim',
  'caut',
  'cauta',
  'vreau',
  'nevoie',
  'firma',
  'firme',
  'companie',
  'pentru',
  'care',
  'cine',
  'imi',
  'mie',
  'buna',
  'bun',
  'aproape',
  'langa',
  'zona',
  'oras',
  'salut',
  'ziua',
  'multumesc',
  'poate',
  'poti',
  'puteti',
  'cum',
  'ce',
  'de',
  'la',
  'in',
  'din',
  'pe',
  'cu',
  'si',
  'sa',
  'ca',
  'am',
  'ma',
  'mi',
  'un',
  'una',
  'unei',
  'unui',
  'al',
  'ale',
  'lui',
  'meu',
  'mea',
  'mele',
  'mei',
  'ceva',
  'cineva',
  // en
  'where',
  'find',
  'need',
  'looking',
  'company',
  'business',
  'near',
  'nearby',
  'good',
  'hello',
  'hi',
  'the',
  'of',
  'for',
  'to',
  'my',
  'me',
  'and',
  'an',
  'can',
  'who',
  'what',
  'someone',
  // de
  'suche',
  'brauche',
  'nahe',
  'eine',
  'einen',
  'hallo',
  'wo',
  'wer',
  'der',
  'die',
  'das',
  'und',
  'fur',
  'mein',
  'meine',
  'mich',
  'ich',
  'ein',
  'kann',
]);

/** Lower-case, strip diacritics. Mirrors the frontend FeedControls matcher. */
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}
/** Same word, or a 5+ letter shared prefix: Romanian endings drift at the
 *  tail ("instalator" / "instalatii", "acoperis" / "acoperisuri"). Stricter
 *  than the Feed's own suggestion list (4 letters) on purpose: that one only
 *  SUGGESTS, this one auto-selects, and 4 letters let "faci" match
 *  "facilities". */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // A 4-letter word only counts with a short inflection on top ("roof" /
  // "roofing"), never as the stem of a much longer word ("faci" /
  // "facilities").
  if (short.length === 4) return long.startsWith(short) && long.length - short.length <= 3;
  if (short.length < 4) return false;
  let shared = 0;
  while (shared < short.length && short[shared] === long[shared]) shared++;
  return shared >= 5;
}
function matchScore(query: string, queryWords: string[], name: string): number {
  const n = normalize(name);
  if (n === query) return 100;
  if (query.length >= 3 && (n.startsWith(query) || n.includes(' ' + query) || query.includes(n))) {
    return 80;
  }
  const nameWords = tokenize(name);
  const matched = queryWords.filter((qw) => nameWords.some((nw) => wordsMatch(qw, nw)));
  if (!matched.length) return 0;
  return Math.round(40 + (matched.length / queryWords.length) * 30);
}
/** Foreign names visitors type for Romanian places the AI would know but the
 *  city list doesn't. */
const PLACE_EXONYMS: Record<string, string> = {
  bucharest: 'București',
  bukarest: 'București',
};

/** Word-boundary-safe haystack: punctuation → spaces, padded both ends. */
function spaced(s: string): string {
  return ` ${normalize(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * Maps one free-text homepage request onto the Feed's own filters, as cheaply
 * as possible:
 *
 *   1. A request Claude already answered (stored for months): reused.
 *   2. A category name literally in the text: keyword match.
 *   3. The local embedding model is sure of its pick: that leaf ($0, ~5 ms).
 *   4. Still unsure: Claude (Haiku) as a backup, only while under the
 *      daily/monthly call caps; the answer is stored for step 1.
 *   5. Over the cap / AI down: best local guess, or the Feed root.
 *
 * Whatever Claude returns is whitelisted against the live taxonomy (stored
 * answers too, on every read), so a hallucination or prompt injection can at
 * worst pick a wrong-but-real category. Places (cities, județe, sectors) are
 * always found by the deterministic scanner; Claude's places are added on
 * top when it was asked.
 */
@Injectable()
export class FeedQueryService {
  private readonly logger = new Logger('FeedQueryService');
  private readonly dailyLimit: number;
  private readonly monthlyLimit: number;
  /** Attempts per UTC day, failed ones included (a failing call can still be
   *  billed, e.g. a timeout). Stored rows only count successes. */
  private attempts = { day: '', count: 0 };

  constructor(
    private readonly feed: FeedService,
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
    private readonly embeddings: FeedEmbeddingService,
    @Inject(ConfigService) config: ConfigService<AppConfig, true>,
  ) {
    this.dailyLimit = config.get('feedAiDailyLimit', { infer: true }) ?? 0;
    this.monthlyLimit = config.get('feedAiMonthlyLimit', { infer: true }) ?? 0;
  }

  async interpret(rawText: string, locale: AiLocale): Promise<FeedQueryResult> {
    const text = rawText.trim().slice(0, 300);
    const groups = (await this.feed.facets()).categories as unknown as CatalogGroup[];
    const key = `${locale}|${normalize(text)
      .replace(/\s+/g, ' ')
      .replace(/[?!.]+$/, '')}`;

    // 1. Claude already answered this exact request.
    const stored = await this.readStored(key);
    if (stored) return this.validate(stored, groups);

    // 2. A category name is in the text.
    const lexical = this.fallback(text, groups);
    if (lexical.score >= NAME_HIT_SCORE) return lexical.result;

    // 3. The local model is sure.
    const leaves = leavesOf(groups);
    const local = await this.embeddings.match(text, leaves, fingerprintOf(leaves));
    const localResult = (m: { group: string; slug: string }): FeedQueryResult => ({
      group: m.group,
      niches: [m.slug],
      counties: lexical.result.counties,
    });
    if (local && local.margin >= EMBED_CONFIDENT_MARGIN) return localResult(local);

    // 4. Claude backup, within budget.
    if (await this.claimAiCall()) {
      const ai = await this.ai.interpretFeedQuery({
        text,
        locale,
        catalog: this.catalogOf(groups),
        counties: [...RO_COUNTIES],
      });
      if (ai) {
        await this.store(key, locale, text, ai);
        const result = this.validate(ai, groups);
        // Places the scanner found but the model missed still count.
        result.counties = [...new Set([...result.counties, ...lexical.result.counties])].slice(
          0,
          MAX_PICKS,
        );
        return result;
      }
    }

    // 5. Best local guess. The model reads meaning; a sub-80 keyword hit is
    //    only a word-fragment overlap ("beau" ~ "beauty"), so it comes second.
    if (local && local.margin >= EMBED_GUESS_MARGIN) return localResult(local);
    return lexical.result;
  }

  // --- stored Claude answers + spending caps ------------------------------

  private async readStored(key: string): Promise<FeedQueryInterpretation | null> {
    try {
      const row = await this.prisma.feedQueryCache.findUnique({ where: { key } });
      if (!row || Date.now() - row.createdAt.getTime() > AI_CACHE_TTL_MS) return null;
      void this.prisma.feedQueryCache
        .update({ where: { key }, data: { hits: { increment: 1 }, lastHitAt: new Date() } })
        .catch(() => undefined);
      return asInterpretation(row.answer);
    } catch (err) {
      this.logger.warn(`Reading stored answers failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async store(
    key: string,
    locale: string,
    query: string,
    answer: FeedQueryInterpretation,
  ): Promise<void> {
    try {
      const data = { answer: answer as unknown as Prisma.InputJsonValue, createdAt: new Date() };
      await this.prisma.feedQueryCache.upsert({
        where: { key },
        create: { key, locale, query, ...data },
        update: { ...data, hits: 0 },
      });
      // Housekeeping, now and then: expired rows are never read again.
      if (Math.random() < 0.02) {
        await this.prisma.feedQueryCache.deleteMany({
          where: { createdAt: { lt: new Date(Date.now() - AI_CACHE_TTL_MS) } },
        });
      }
    } catch (err) {
      this.logger.warn(`Storing an AI answer failed: ${(err as Error).message}`);
    }
  }

  /** True (and counted) when one more Claude call fits under both caps. */
  private async claimAiCall(): Promise<boolean> {
    if (!this.ai.configured || this.dailyLimit <= 0 || this.monthlyLimit <= 0) return false;
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (this.attempts.day !== day) this.attempts = { day, count: 0 };
    if (this.attempts.count >= this.dailyLimit) return false;
    try {
      const dayStart = new Date(`${day}T00:00:00.000Z`);
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [today, month] = await Promise.all([
        this.prisma.feedQueryCache.count({ where: { createdAt: { gte: dayStart } } }),
        this.prisma.feedQueryCache.count({ where: { createdAt: { gte: monthStart } } }),
      ]);
      if (today >= this.dailyLimit || month >= this.monthlyLimit) return false;
    } catch {
      return false; // can't verify the budget, so don't spend
    }
    this.attempts.count++;
    return true;
  }

  /** `slug | ro | en`, one line per group, its leaves indented beneath. */
  private catalogOf(groups: CatalogGroup[]): string {
    const line = (c: CatalogLeaf) => `${c.slug} | ${c.name.ro ?? ''} | ${c.name.en ?? ''}`;
    return groups
      .map((g) => [line(g), ...g.children.map((c) => `  ${line(c)}`)].join('\n'))
      .join('\n');
  }

  private validate(ai: FeedQueryInterpretation, groups: CatalogGroup[]): FeedQueryResult {
    const groupSlugs = new Set(groups.map((g) => g.slug));
    const parentOf = new Map<string, string>();
    for (const g of groups) for (const c of g.children) parentOf.set(c.slug, g.slug);

    // A model that put a leaf in `group` still meant that leaf.
    const leafCandidates = [
      ...(ai.group && parentOf.has(ai.group) ? [ai.group] : []),
      ...ai.niches,
    ];
    const leaves = leafCandidates.filter((s) => parentOf.has(s));

    let group: string | null = null;
    let niches: string[] = [];
    if (leaves.length) {
      // The leaf's own parent wins over whatever group the model named, and
      // leaves from other groups are dropped (one URL = one group).
      group = parentOf.get(leaves[0]) ?? null;
      niches = [...new Set(leaves.filter((s) => parentOf.get(s) === group))].slice(0, MAX_PICKS);
    } else if (ai.group && groupSlugs.has(ai.group)) {
      group = ai.group;
    }

    const counties = new Set<string>();
    for (const c of ai.counties) {
      const hit = resolveCounty(c);
      if (hit) counties.add(hit);
    }
    for (const city of ai.cities) {
      const hit = this.countyOfCity(city);
      if (hit) counties.add(hit);
    }

    return { group, niches, counties: [...counties].slice(0, MAX_PICKS) };
  }

  private countyOfCity(name: string): string | null {
    const q = spaced(name);
    const city = RO_CITIES.find((c) => spaced(c.name) === q);
    return city?.county ?? PLACE_EXONYMS[q.trim()] ?? resolveCounty(name);
  }

  /** Deterministic keyword match on category names, plus the place scan. */
  private fallback(
    text: string,
    groups: CatalogGroup[],
  ): { result: FeedQueryResult; score: number } {
    const hay = spaced(text);

    const counties = new Set<string>();
    if (/\bsector(ul)?\s*[1-6]\b/.test(hay)) counties.add('București');
    for (const c of RO_CITIES) if (hay.includes(spaced(c.name))) counties.add(c.county);
    for (const c of RO_COUNTIES) if (hay.includes(spaced(c))) counties.add(c);
    for (const [exonym, county] of Object.entries(PLACE_EXONYMS)) {
      if (hay.includes(` ${exonym} `)) counties.add(county);
    }
    // Place words must not double as category evidence ("Alba" / "Olt").
    const placeWords = new Set([
      ...[
        ...counties,
        ...RO_CITIES.filter((c) => counties.has(c.county)).map((c) => c.name),
      ].flatMap((n) => tokenize(n)),
      ...Object.keys(PLACE_EXONYMS),
    ]);

    const query = normalize(text).trim();
    const words = tokenize(text).filter((w) => !STOPWORDS.has(w) && !placeWords.has(w));
    let best: { group: string; leaf: string | null; score: number } | null = null;
    if (words.length) {
      for (const g of groups) {
        const consider = (leaf: CatalogLeaf | null, names: LocalizedName) => {
          const score = Math.max(
            0,
            ...Object.values(names)
              .filter((n): n is string => !!n)
              .map((n) => matchScore(query, words, n)),
          );
          const beats =
            !best ||
            score > best.score ||
            (score === best.score && leaf !== null && best.leaf === null);
          if (score >= FALLBACK_MIN_SCORE && beats)
            best = { group: g.slug, leaf: leaf?.slug ?? null, score };
        };
        consider(null, g.name);
        for (const c of g.children) consider(c, c.name);
      }
    }

    const hit = best as { group: string; leaf: string | null; score: number } | null;
    return {
      result: {
        group: hit?.group ?? null,
        niches: hit?.leaf ? [hit.leaf] : [],
        counties: [...counties].slice(0, MAX_PICKS),
      },
      score: hit?.score ?? 0,
    };
  }
}

/** A stored `answer` JSON back into the interpretation shape (defensive: it
 *  is re-validated against the taxonomy anyway). */
function asInterpretation(v: unknown): FeedQueryInterpretation | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const list = (x: unknown) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
  return {
    group: typeof o.group === 'string' ? o.group : null,
    niches: list(o.niches),
    counties: list(o.counties),
    cities: list(o.cities),
  };
}
