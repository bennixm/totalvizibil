import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  'and city (matched against each business’s own coverage radius), only filter — ' +
  'never reorder.';

const EARTH_KM = 6371;

/** Great-circle distance between two lat/lng points, in kilometres. */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_KM * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
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
    const { q, category, city, lat, lng, page = 1, pageSize = 12 } = query;

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
        appliedFilters: { q: q ?? null, category: null, city: city ?? null, area: null },
        _ranking: RANKING_NOTE,
      };
    }

    const catSlugs = await this.categorySlugs(category);
    const geo = typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;

    const where: Prisma.CompanyWhereInput = {
      status: 'active',
      ...(catSlugs ? { category: { slug: { in: catSlugs } } } : {}),
      // A coarse city-name match only when there are no coordinates to work with.
      // A whole-country business matches any named city too.
      ...(!geo && city
        ? {
            locations: {
              some: {
                OR: [{ city: { contains: city, mode: 'insensitive' } }, { nationwide: true }],
              },
            },
          }
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

    let companies = await this.prisma.company.findMany({ where, include: feedInclude });

    // Coverage filter: the searcher picks a city; a business shows when that
    // city falls inside the coverage radius it set for its own location
    // (e.g. "Sibiu + 100 km" reaches Vâlcea, 100 km away).
    if (geo) {
      companies = companies.filter((c) => {
        const loc = c.locations[0];
        if (!loc) return false;
        // Whole-country coverage matches every searched area, no radius involved.
        if (loc.nationwide) return true;
        if (loc.lat == null || loc.lng == null || !loc.serviceRadiusKm) return false;
        return haversineKm(geo.lat, geo.lng, loc.lat, loc.lng) <= loc.serviceRadiusKm;
      });
    }

    const vinputs = await this.analytics.visibilityInputsFor(companies.map((c) => c.id));
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
        location: loc
          ? {
              city: loc.city,
              region: loc.region,
              radiusKm: loc.serviceRadiusKm ?? null,
              nationwide: loc.nationwide,
            }
          : null,
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
      requiresCategory: false as const,
      appliedFilters: {
        q: q ?? null,
        category: category ?? null,
        city: city ?? null,
        area: geo ? { lat: geo.lat, lng: geo.lng } : null,
      },
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
        // Whole-country locations have no city — keep them out of the city facet.
        where: { company: { status: 'active' }, city: { not: null } },
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
      cities: cities.map((c) => c.city).filter((c): c is string => c != null),
    };
  }
}
