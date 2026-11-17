import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AiService, type AiLocale } from '../ai/ai.service';
import { RO_CITIES, RO_COUNTIES, resolveCounty } from '../geo/ro-cities';
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
const CACHE_MAX = 500;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** A fallback hit below this is a stray word overlap, not a real match. */
const FALLBACK_MIN_SCORE = 50;

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
 * Maps one free-text homepage request onto the Feed's own filters. Claude
 * interprets the need (it can tell "mi s-a spart o țeavă" means plumbing,
 * which no keyword match can), but only ever CHOOSES: every slug and județ it
 * returns is whitelisted against the live taxonomy here, so a hallucination or
 * a prompt-injection attempt can at worst pick a wrong-but-real category. If
 * the AI is unavailable or fails, a deterministic matcher (a port of the
 * Feed's own in-page category search) answers instead, so this never
 * dead-ends.
 */
@Injectable()
export class FeedQueryService {
  /** AI answers only — a fallback answer is never cached, so it can't keep
   *  shadowing the better AI answer once the AI is reachable again. */
  private readonly cache = new Map<string, { result: FeedQueryResult; expiresAt: number }>();

  constructor(
    private readonly feed: FeedService,
    private readonly ai: AiService,
  ) {}

  async interpret(rawText: string, locale: AiLocale): Promise<FeedQueryResult> {
    const text = rawText.trim().slice(0, 300);
    const groups = (await this.feed.facets()).categories as unknown as CatalogGroup[];
    const catalog = this.catalogOf(groups);
    const key = `${locale}|${createHash('sha1').update(catalog).digest('hex').slice(0, 12)}|${normalize(
      text,
    )
      .replace(/\s+/g, ' ')
      .replace(/[?!.]+$/, '')}`;

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.result;
    }

    const ai = await this.ai.interpretFeedQuery({
      text,
      locale,
      catalog,
      counties: [...RO_COUNTIES],
    });
    if (!ai) return this.fallback(text, groups);

    const result = this.validate(ai, groups);
    this.cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return result;
  }

  /** `slug | ro | en`, one line per group, its leaves indented beneath. */
  private catalogOf(groups: CatalogGroup[]): string {
    const line = (c: CatalogLeaf) => `${c.slug} | ${c.name.ro ?? ''} | ${c.name.en ?? ''}`;
    return groups
      .map((g) => [line(g), ...g.children.map((c) => `  ${line(c)}`)].join('\n'))
      .join('\n');
  }

  private validate(
    ai: { group: string | null; niches: string[]; counties: string[]; cities: string[] },
    groups: CatalogGroup[],
  ): FeedQueryResult {
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

  /** Deterministic answer for when the AI isn't available. */
  private fallback(text: string, groups: CatalogGroup[]): FeedQueryResult {
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

    const hit = best as { group: string; leaf: string | null } | null;
    return {
      group: hit?.group ?? null,
      niches: hit?.leaf ? [hit.leaf] : [],
      counties: [...counties].slice(0, MAX_PICKS),
    };
  }
}
