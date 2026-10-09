import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RO_COUNTIES } from '../geo/ro-cities';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  APPEAR_FIRST_BOOST,
  DEFAULT_REFS,
  visibilityScore,
  type VisibilityInput,
} from '../analytics/visibility';
import { FeedQueryDto } from './feed.query';

const RANKING_NOTE =
  'A category (group or niche) must be selected — nothing is listed otherwise. ' +
  'Only businesses with a funded, active campaign appear. Order is strictly the ' +
  'Visibility Score: CPC (per-click bid vs the category-leading bid, capped by ' +
  'daily budget) x0.35 + Response rate/speed x0.30 + Plan (advanced > easy) x0.20 ' +
  '+ Campaign age x0.15; a funded "appear first" tier adds a fixed lift. Category, ' +
  'and județ (or "nationwide" businesses only), only filter — never reorder.';

/** Sentinel `county` value — "only businesses that serve the whole country". */
const NATIONWIDE = 'nationwide';

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

const NO_VISIBILITY: VisibilityInput = {
  cpcMinor: 0,
  cpcRefMinor: 0,
  dailyBudgetMinor: 0,
  leadsTotal: 0,
  leadsResponded: 0,
  avgResponseMinutes: null,
  planMode: null,
  activeSeconds: 0,
};

const feedInclude = {
  category: { include: { parent: { select: { slug: true, nameI18n: true } } } },
  categoryAssignments: {
    include: { category: { select: { slug: true, nameI18n: true, icon: true } } },
    orderBy: { isPrimary: 'desc' },
  },
  locations: { where: { isPrimary: true }, take: 1 },
  services: { orderBy: { position: 'asc' }, take: 6 },
  website: {
    select: { content: true, status: true, theme: true, generator: true, heroImageUrl: true },
  },
  campaign: { select: { appearFirst: true, status: true } },
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
   *    companies tagged with *any* of them (the feed's multi-select). A
   *    single leaf is also the one subcategory CPC ranking prices this
   *    search's competitiveness against (`effectiveLeafId`); two or more
   *    leaves have no single pool to price against, so each company's CPC
   *    sub-score falls back to its own best-case reference (`cpcRefsFor`);
   *  - a bare parent group ("Toate din X" — browse the whole category) —
   *    matches the union of companies tagged with *any* of its leaves; same
   *    CPC fallback as the multi-leaf case;
   *  - the `complete-{parentSlug}` sentinel ("Servicii complete X" — not a
   *    real category, never stored on a company) — matches only companies
   *    tagged with *every single* leaf under that parent; same CPC fallback.
   *
   * `null` when nothing in the value resolves to a known category.
   */
  private async resolveCategory(raw: string): Promise<{
    effectiveLeafId?: string;
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
      if (!leaves.length) return { companyWhere: { id: { in: [] } } };

      // "Has every leaf" = exactly N matching assignment rows, counting only
      // within this parent's N leaves (a company can't exceed N that way).
      const qualifying = await this.prisma.companyCategory.groupBy({
        by: ['companyId'],
        where: { categoryId: { in: leaves.map((l) => l.id) } },
        _count: { categoryId: true },
        having: { categoryId: { _count: { equals: leaves.length } } },
      });
      return { companyWhere: { id: { in: qualifying.map((r) => r.companyId) } } };
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
          companyWhere: {
            categoryAssignments: { some: { categoryId: { in: children.map((c) => c.id) } } },
          },
        };
      }

      return {
        effectiveLeafId: cat.id,
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

    const vinputs = await this.analytics.visibilityInputsFor(
      companies.map((c) => c.id),
      resolved?.effectiveLeafId,
    );
    const now = new Date();

    const scored = companies.map((c) => {
      const relevance = this.relevance(c, q);
      const vis = visibilityScore(vinputs.get(c.id) ?? NO_VISIBILITY, DEFAULT_REFS, now);
      const appearFirst = c.campaign?.appearFirst === true && c.campaign.status === 'active';
      // A search gates by relevance; browsing is pure Visibility Score.
      const score = vis.score * (q ? relevance : 1) + (appearFirst ? APPEAR_FIRST_BOOST : 0);
      return { c, relevance, vis, appearFirst, score };
    });

    // Strictly our ranking — highest Visibility Score (+ appear-first lift) first.
    scored.sort((a, b) => b.score - a.score);

    const total = scored.length;
    const start = (page - 1) * pageSize;
    const items = scored.slice(start, start + pageSize).map((row) => {
      const { c } = row;
      const loc = c.locations[0] ?? null;
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
