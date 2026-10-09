import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RO_COUNTIES } from '../geo/ro-cities';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  APPEAR_FIRST_BOOST,
  DEFAULT_REFS,
  EMPTY_VISIBILITY_INPUT,
  visibilityScore,
} from '../analytics/visibility';
import { FeedQueryDto } from './feed.query';
import {
  FeedId,
  NATIONWIDE_FEED_COUNTY,
  SearchCountyMode,
  feedEligiblePeers,
  resolveCompanyFeed,
} from '../analytics/feed-resolver';

const RANKING_NOTE =
  'A category (group or niche) must be selected — nothing is listed otherwise. ' +
  'Only businesses with a funded, active campaign, eligible in their own atomic ' +
  'Feed (județ + subcategorie — CPC maxim ≥ CPC minim), appear. Order is the ' +
  "combined score: CPC (bid vs that Feed's top bid) x0.50 + Response rate/speed " +
  'x0.20 + Plan (advanced > easy) x0.15 + Campaign age x0.15; a funded "appear ' +
  'first" tier adds a fixed lift. Category and județ (or "nationwide" businesses ' +
  "only) filter and decide each item's atomic Feed — never reorder beyond that.";

/** Sentinel `county` value — "only businesses that serve the whole country". */
const NATIONWIDE = NATIONWIDE_FEED_COUNTY;

/**
 * `category` sentinel prefix — "Servicii complete {parent}" ("Servicii
 * complete X"): not a real category (never stored on a company), a feed
 * search-time construct meaning "every leaf under this parent, all at once".
 */
export const COMPLETE_PREFIX = 'complete-';

/** Named-palette → accent hex — mirrors WebsiteRenderer's PALETTE_ACCENT. */
const PALETTE_HEX: Record<string, string> = {
  indigo: '#4f46e5',
  violet: '#7c3aed',
  blue: '#2563eb',
  cyan: '#0891b2',
  teal: '#0d9488',
  emerald: '#059669',
  lime: '#65a30d',
  amber: '#d97706',
  orange: '#ea580c',
  rose: '#e11d48',
  fuchsia: '#c026d3',
  slate: '#475569',
};

interface Billboard {
  title: string | null;
  subtitle: string | null;
  image: string | null;
  builtWithBuilder: boolean;
  accent: string | null;
}

/**
 * The headline / sub / hero visual + theme accent from a generated site — reused
 * on the feed ad card. Advanced-builder sites (`generator` = `advanced-builder…`)
 * get the "own website" featured card. Reads the home page out of `content`.
 *
 * The Website Builder (PRO V2, `generator` = `pro-v2`) is different: it writes
 * a real Vue/Vite project + static bundle, and never touches `content`/`theme`
 * on publish — those columns are still whatever onboarding placeholder JSON
 * was there before the company ever opened the builder, completely
 * disconnected from the real site. Extracting a hero title/subtitle/accent
 * from that JSON would show stale, unrelated text, so PRO V2 sites skip
 * content extraction entirely and fall back to the company's own
 * displayName/description (see FeedAdCard.vue) — still `builtWithBuilder`
 * so they get the "own website" featured treatment. The image is the one
 * exception: `heroImageUrl` is the real image found in the published
 * bundle itself (see hero-image.ts), not derived from the stale JSON, so
 * it's used directly when present.
 */
export function heroBillboard(
  content: unknown,
  theme: unknown,
  generator: string | null,
  heroImageUrl: string | null = null,
): Billboard {
  const isBundleBuilt = generator === 'pro-v2';
  const builtWithBuilder =
    isBundleBuilt || (typeof generator === 'string' && generator.startsWith('advanced-builder'));
  if (isBundleBuilt) {
    return { title: null, subtitle: null, image: heroImageUrl, builtWithBuilder, accent: null };
  }
  const th = (theme ?? null) as { accent?: unknown; palette?: unknown } | null;
  const accent =
    typeof th?.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(th.accent)
      ? th.accent
      : typeof th?.palette === 'string' && PALETTE_HEX[th.palette]
        ? PALETTE_HEX[th.palette]
        : null;

  const empty: Billboard = { title: null, subtitle: null, image: null, builtWithBuilder, accent };
  const pages = (content as { pages?: unknown[] } | null)?.pages;
  if (!Array.isArray(pages)) return empty;
  const home =
    (pages as Record<string, unknown>[]).find((p) => p.isHome) ??
    (pages[0] as Record<string, unknown>);
  const sections = home?.sections;
  if (!Array.isArray(sections)) return empty;
  const secs = sections as Record<string, unknown>[];

  const hero = secs.find((s) => s.type === 'hero');
  const title = hero && typeof hero.headline === 'string' ? hero.headline.trim() || null : null;
  const subtitle =
    hero && typeof hero.subheadline === 'string'
      ? hero.subheadline.trim().slice(0, 160) || null
      : null;

  // Image: the hero background, else the first gallery / feature-split photo.
  const firstItemImage = (type: string): string | null => {
    const s = secs.find((x) => x.type === type);
    const items = Array.isArray(s?.items) ? (s!.items as Record<string, unknown>[]) : [];
    const url = items.map((i) => i.imageUrl).find((u) => typeof u === 'string' && u);
    return typeof url === 'string' ? url : null;
  };
  const image =
    (hero && typeof hero.backgroundImage === 'string' && hero.backgroundImage) ||
    firstItemImage('gallery') ||
    firstItemImage('featureSplit') ||
    null;

  return { title, subtitle, image, builtWithBuilder, accent };
}

const feedInclude = {
  category: { include: { parent: { select: { slug: true, nameI18n: true } } } },
  categoryAssignments: {
    include: { category: { select: { slug: true, nameI18n: true, icon: true } } },
    orderBy: { isPrimary: 'desc' },
  },
  // All of them, not just the primary — Feed resolution (multi-county firms)
  // needs the full list; the display mapping below still only shows one.
  locations: true,
  services: { orderBy: { position: 'asc' }, take: 6 },
  website: {
    select: { content: true, status: true, theme: true, generator: true, heroImageUrl: true },
  },
  campaign: { select: { appearFirst: true, status: true, cpcMinor: true } },
  _count: { select: { services: true } },
} satisfies Prisma.CompanyInclude;

type FeedCompany = Prisma.CompanyGetPayload<{ include: typeof feedInclude }>;

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  private relevance(c: FeedCompany, q?: string): number {
    if (!q) return 1;
    const needle = q.toLowerCase();
    const hay = [
      c.displayName,
      c.description ?? '',
      c.category ? JSON.stringify(c.category.nameI18n) : '',
      c.services.map((s) => s.name).join(' '),
    ]
      .join(' ')
      .toLowerCase();
    if (!hay.includes(needle)) return 0.15;
    const exactName = c.displayName.toLowerCase().includes(needle) ? 0.4 : 0;
    return Math.min(1, 0.5 + exactName + Math.min(0.3, needle.length / 40));
  }

  /**
   * A requested `category` value is one of four things:
   *
   *  - one or several real leaves (exact niches), comma-separated — matches
   *    companies tagged with *any* of them (the feed's multi-select);
   *  - a bare parent group ("Toate din X" — browse the whole category) —
   *    matches the union of companies tagged with *any* of its leaves;
   *  - the `complete-{parentSlug}` sentinel ("Servicii complete X" — not a
   *    real category, never stored on a company) — matches only companies
   *    tagged with *every single* leaf under that parent.
   *
   * `leafIds` is always the full resolved leaf set (one or many) — it's what
   * `resolveCompanyFeed` intersects against each candidate's own leaves to
   * pick its one atomic Feed. `null` when nothing in the value resolves to a
   * known category.
   */
  private async resolveCategory(raw: string): Promise<{
    /** Every leaf this resolves to — the set a company's own Feed must intersect. */
    leafIds: string[];
    companyWhere: Prisma.CompanyWhereInput;
  } | null> {
    if (raw.startsWith(COMPLETE_PREFIX)) {
      const parentSlug = raw.slice(COMPLETE_PREFIX.length);
      const parent = await this.prisma.category.findFirst({
        where: { slug: parentSlug, parentId: null },
        select: { id: true },
      });
      if (!parent) return null;

      const leaves = await this.prisma.category.findMany({
        where: { parentId: parent.id },
        select: { id: true },
      });
      if (!leaves.length) return { leafIds: [], companyWhere: { id: { in: [] } } };

      // "Has every leaf" = exactly N matching assignment rows, counting only
      // within this parent's N leaves (a company can't exceed N that way).
      const qualifying = await this.prisma.companyCategory.groupBy({
        by: ['companyId'],
        where: { categoryId: { in: leaves.map((l) => l.id) } },
        _count: { categoryId: true },
        having: { categoryId: { _count: { equals: leaves.length } } },
      });
      return {
        leafIds: leaves.map((l) => l.id),
        companyWhere: { id: { in: qualifying.map((r) => r.companyId) } },
      };
    }

    const slugs = Array.from(
      new Set(
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
    if (!slugs.length) return null;

    // A single bare parent group ("Toate din X") is the one case that isn't
    // a set of leaves — resolved on its own, never combined with others.
    if (slugs.length === 1) {
      const cat = await this.prisma.category.findUnique({
        where: { slug: slugs[0] },
        select: { id: true, parentId: true },
      });
      if (!cat) return null;

      if (!cat.parentId) {
        const children = await this.prisma.category.findMany({
          where: { parentId: cat.id },
          select: { id: true },
        });
        return {
          leafIds: children.map((c) => c.id),
          companyWhere: {
            categoryAssignments: { some: { categoryId: { in: children.map((c) => c.id) } } },
          },
        };
      }

      return {
        leafIds: [cat.id],
        companyWhere: { categoryAssignments: { some: { categoryId: cat.id } } },
      };
    }

    // Multi-select: every value must be a real leaf (a bare group mixed in
    // makes no sense here) — unknown or non-leaf slugs are silently dropped.
    const cats = await this.prisma.category.findMany({
      where: { slug: { in: slugs } },
      select: { id: true, parentId: true },
    });
    const leafIds = cats.filter((c) => c.parentId).map((c) => c.id);
    if (!leafIds.length) return null;
    return {
      leafIds,
      companyWhere: { categoryAssignments: { some: { categoryId: { in: leafIds } } } },
    };
  }

  async list(query: FeedQueryDto) {
    const { q, category, county, page = 1, pageSize = 12 } = query;

    // Discovery is category-first: nothing is listed until a category (group or
    // niche) is chosen. Browsing "everything at once" isn't a useful entry
    // point for a local-services directory.
    if (!category) {
      return {
        items: [] as never[],
        page: 1,
        pageSize,
        total: 0,
        requiresCategory: true as const,
        appliedFilters: { q: q ?? null, category: null, county: null },
        _ranking: RANKING_NOTE,
      };
    }

    const resolved = await this.resolveCategory(category);
    const counties = county
      ? Array.from(
          new Set(
            county
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        )
      : [];

    const where: Prisma.CompanyWhereInput = {
      status: 'active',
      ...(resolved?.companyWhere ?? { id: { in: [] } }),
      // Empty ("Orice locație") → every județ; the "nationwide" sentinel
      // ("Toată țara") → nationwide businesses only, strictly; one or
      // several named județe → an OR-match across them, plus any nationwide
      // business (it reaches everywhere).
      ...(counties.includes(NATIONWIDE)
        ? { locations: { some: { nationwide: true } } }
        : counties.length
          ? { locations: { some: { OR: [{ county: { in: counties } }, { nationwide: true }] } } }
          : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { services: { some: { name: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const companies = await this.prisma.company.findMany({ where, include: feedInclude });

    const cfg = await this.analytics.marginConfig();
    const leafIds = resolved?.leafIds ?? [];
    const countyMode: SearchCountyMode = counties.includes(NATIONWIDE)
      ? { kind: 'nationwideOnly' }
      : counties.length
        ? { kind: 'named', counties }
        : { kind: 'any' };

    // Every candidate's exact atomic Feed for *this* search — never the one
    // that would score it highest, see `resolveCompanyFeed`. A company with
    // no resolvable Feed (shouldn't happen, the `where` above already
    // required a match) is dropped.
    const placed = companies
      .map((c) => ({ c, feedId: resolveCompanyFeed(c, leafIds, countyMode) }))
      .filter((p): p is { c: FeedCompany; feedId: FeedId } => p.feedId !== null);

    // Each distinct Feed's TRUE eligible population (not just this page's
    // candidates) — fetched once per distinct Feed, reused by every company
    // placed in it.
    const feedKey = (f: FeedId) => `${f.leafId}|${f.county}`;
    const feedCache = new Map<
      string,
      { peers: { companyId: string; cpcMinor: number }[]; maxBidMinor: number }
    >();
    for (const { feedId } of placed) {
      const key = feedKey(feedId);
      if (feedCache.has(key)) continue;
      const peers = await feedEligiblePeers(this.prisma, feedId, cfg);
      feedCache.set(key, {
        peers,
        maxBidMinor: peers.reduce((mx, p) => Math.max(mx, p.cpcMinor), 0),
      });
    }

    // Eligibility: a company must itself clear its own Feed's CPC minim —
    // never shown, never billed below the floor.
    const eligible = placed.filter(({ c, feedId }) =>
      feedCache.get(feedKey(feedId))!.peers.some((p) => p.companyId === c.id),
    );

    const vinputs = await this.analytics.visibilityInputsFor(eligible.map(({ c }) => c.id));
    const now = new Date();

    const scored = eligible.map(({ c, feedId }) => {
      const relevance = this.relevance(c, q);
      const maxBidMinor = feedCache.get(feedKey(feedId))!.maxBidMinor;
      const vis = visibilityScore(
        { ...(vinputs.get(c.id) ?? EMPTY_VISIBILITY_INPUT), cpcRefMinor: maxBidMinor },
        DEFAULT_REFS,
        now,
      );
      const appearFirst = c.campaign?.appearFirst === true && c.campaign.status === 'active';
      // A search gates by relevance; browsing is pure combined score.
      const score = vis.score * (q ? relevance : 1) + (appearFirst ? APPEAR_FIRST_BOOST : 0);
      const feedCategorySlug =
        c.categoryAssignments.find((a) => a.categoryId === feedId.leafId)?.category.slug ?? null;
      return { c, feedId, feedCategorySlug, relevance, vis, appearFirst, score };
    });

    // Strictly our ranking — highest combined score (+ appear-first lift) first.
    scored.sort((a, b) => b.score - a.score);

    const total = scored.length;
    const start = (page - 1) * pageSize;
    const items = scored.slice(start, start + pageSize).map((row) => {
      const { c } = row;
      const loc = c.locations.find((l) => l.isPrimary) ?? c.locations[0] ?? null;
      const hasWebsite = !!c.website && c.website.status !== 'draft';
      const billboard: Billboard = hasWebsite
        ? heroBillboard(
            c.website?.content,
            c.website?.theme,
            c.website?.generator ?? null,
            c.website?.heroImageUrl ?? null,
          )
        : { title: null, subtitle: null, image: null, builtWithBuilder: false, accent: null };
      return {
        id: c.id,
        slug: c.slug,
        displayName: c.displayName,
        description: c.description,
        logoUrl: c.logoUrl,
        // Landing title / sub / visual + theme accent, reused for the ad card.
        heroTitle: billboard.title,
        heroSubtitle: billboard.subtitle,
        heroImage: billboard.image,
        builtWithBuilder: billboard.builtWithBuilder,
        accent: billboard.accent,
        category: c.category
          ? {
              slug: c.category.slug,
              name: c.category.nameI18n,
              icon: c.category.icon,
              parent: c.category.parent
                ? { slug: c.category.parent.slug, name: c.category.parent.nameI18n }
                : null,
            }
          : null,
        // Every subcategory tag this business carries — shown on the card.
        categories: c.categoryAssignments.map((a) => ({
          slug: a.category.slug,
          name: a.category.nameI18n,
          icon: a.category.icon,
          isPrimary: a.isPrimary,
        })),
        location: loc
          ? {
              city: loc.city,
              county: loc.county,
              nationwide: loc.nationwide,
            }
          : null,
        services: c.services.map((s) => s.name),
        servicesTotal: c._count.services,
        hasWebsite,
        // Echo back verbatim on `/feed/click` — pins the click to the exact
        // atomic Feed this listing was ranked in, so billing matches display.
        clickHint: { category: row.feedCategorySlug, county: row.feedId.county },
        score: Number(row.score.toFixed(4)),
        scoreBreakdown: {
          visibility: Number(row.vis.score.toFixed(3)),
          cpc: Number(row.vis.cpc.toFixed(3)),
          response: Number(row.vis.response.toFixed(3)),
          plan: Number(row.vis.plan.toFixed(3)),
          age: Number(row.vis.age.toFixed(3)),
          relevance: Number(row.relevance.toFixed(3)),
          appearFirst: row.appearFirst,
        },
      };
    });

    return {
      items,
      page,
      pageSize,
      total,
      requiresCategory: false as const,
      appliedFilters: {
        q: q ?? null,
        category: category ?? null,
        county: county ?? null,
      },
      _ranking: RANKING_NOTE,
    };
  }

  async facets() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ position: 'asc' }],
    });

    const childrenByParent = new Map<string, typeof categories>();
    for (const c of categories) {
      if (!c.parentId) continue;
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }

    return {
      categories: categories
        .filter((c) => !c.parentId)
        .map((p) => ({
          slug: p.slug,
          name: p.nameI18n,
          icon: p.icon,
          children: (childrenByParent.get(p.id) ?? []).map((c) => ({
            slug: c.slug,
            name: c.nameI18n,
            icon: c.icon,
          })),
        })),
      counties: RO_COUNTIES,
    };
  }
}
