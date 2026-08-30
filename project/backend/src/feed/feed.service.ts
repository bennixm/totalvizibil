import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { DEFAULT_REFS, visibilityScore, type VisibilityInput } from '../analytics/visibility';
import { FeedQueryDto } from './feed.query';

const RANKING_NOTE =
  'Only businesses with a funded, active campaign appear. Order among them is the ' +
  'Visibility Score: CPC (daily budget) x0.35 + Response rate/speed x0.30 + Plan ' +
  '(advanced > easy) x0.20 + Campaign age x0.15. A search query further gates by ' +
  'relevance; a funded "appear first" tier adds a fixed lift. No reserved slots.';

// A funded "appear first" campaign gets this added on top of the Visibility Score.
const APPEAR_FIRST_BOOST = 0.25;

const NO_VISIBILITY: VisibilityInput = {
  dailyBudgetMinor: 0,
  leadsTotal: 0,
  leadsResponded: 0,
  avgResponseMinutes: null,
  planMode: null,
  activatedAt: null,
};

const feedInclude = {
  category: { include: { parent: { select: { slug: true, nameI18n: true } } } },
  locations: { where: { isPrimary: true }, take: 1 },
  services: { orderBy: { position: 'asc' }, take: 4 },
  website: { select: { content: true, status: true } },
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

  private quality(c: FeedCompany): number {
    if (c.qualityScore > 0) return Math.min(1, c.qualityScore);
    // Fallback: derive from profile completeness.
    let score = 0.2;
    if (c.description) score += 0.15;
    if (c.category) score += 0.1;
    if (c.locations.length) score += 0.15;
    if (c._count.services > 0) score += 0.2;
    if (c.website && c.website.status !== 'draft') score += 0.2;
    return Math.min(1, score);
  }

  /** Resolve a category slug to itself + its child slugs (so a parent group matches its niches). */
  private async categorySlugs(slug?: string): Promise<string[] | undefined> {
    if (!slug) return undefined;
    const cat = await this.prisma.category.findUnique({
      where: { slug },
      include: { children: { select: { slug: true } } },
    });
    if (!cat) return [slug]; // unknown slug -> matches nothing
    return [cat.slug, ...cat.children.map((c) => c.slug)];
  }

  async list(query: FeedQueryDto) {
    const { q, category, city, sort = 'recommended', page = 1, pageSize = 12 } = query;
    const catSlugs = await this.categorySlugs(category);

    const where: Prisma.CompanyWhereInput = {
      status: 'active',
      ...(catSlugs ? { category: { slug: { in: catSlugs } } } : {}),
      ...(city ? { locations: { some: { city: { contains: city, mode: 'insensitive' } } } } : {}),
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

    const vinputs = await this.analytics.visibilityInputsFor(companies.map((c) => c.id));
    const now = new Date();

    const scored = companies.map((c) => {
      const relevance = this.relevance(c, q);
      const quality = this.quality(c);
      const vis = visibilityScore(vinputs.get(c.id) ?? NO_VISIBILITY, DEFAULT_REFS, now);
      const appearFirst = c.campaign?.appearFirst === true && c.campaign.status === 'active';
      // A search gates by relevance; browsing is pure Visibility Score.
      const score =
        vis.score * (q ? relevance : 1) + (appearFirst ? APPEAR_FIRST_BOOST : 0);
      return { c, relevance, quality, vis, appearFirst, score };
    });

    if (sort === 'newest') {
      scored.sort((a, b) => b.c.createdAt.getTime() - a.c.createdAt.getTime());
    } else if (sort === 'rating') {
      scored.sort((a, b) => b.quality - a.quality);
    } else {
      scored.sort((a, b) => b.score - a.score);
    }

    const total = scored.length;
    const start = (page - 1) * pageSize;
    const items = scored.slice(start, start + pageSize).map((row) => {
      const { c } = row;
      const loc = c.locations[0] ?? null;
      return {
        id: c.id,
        slug: c.slug,
        displayName: c.displayName,
        description: c.description,
        logoUrl: c.logoUrl,
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
        location: loc ? { city: loc.city, region: loc.region } : null,
        services: c.services.map((s) => s.name),
        hasWebsite: !!c.website && c.website.status !== 'draft',
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
      appliedFilters: { q: q ?? null, category: category ?? null, city: city ?? null, sort },
      _ranking: RANKING_NOTE,
    };
  }

  async facets() {
    const [categories, cities] = await Promise.all([
      this.prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ position: 'asc' }],
      }),
      this.prisma.companyLocation.findMany({
        where: { company: { status: 'active' } },
        distinct: ['city'],
        select: { city: true },
        orderBy: { city: 'asc' },
      }),
    ]);

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
      cities: cities.map((c) => c.city),
    };
  }
}
