import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FeedQueryDto } from './feed.query';

type Placement = 'sponsored' | 'organic' | 'exploration';

const RANKING_NOTE =
  'Ordering blends relevance, quality, popularity and freshness; sponsored slots are capped ' +
  'and one exploration slot is reserved for new businesses. Full auction + fairness engine: PRD §8–§9.';

const feedInclude = {
  category: true,
  locations: { where: { isPrimary: true }, take: 1 },
  services: { orderBy: { position: 'asc' }, take: 4 },
  website: { select: { content: true, status: true } },
  _count: { select: { services: true } },
} satisfies Prisma.CompanyInclude;

type FeedCompany = Prisma.CompanyGetPayload<{ include: typeof feedInclude }>;

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

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

  private freshness(createdAt: Date): number {
    const days = (Date.now() - createdAt.getTime()) / 86_400_000;
    return Math.max(0, 1 - days / 365);
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

  async list(query: FeedQueryDto) {
    const { q, category, city, sort = 'recommended', page = 1, pageSize = 12 } = query;

    const where: Prisma.CompanyWhereInput = {
      status: 'active',
      ...(category ? { category: { slug: category } } : {}),
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

    const scored = companies.map((c) => {
      const relevance = this.relevance(c, q);
      const quality = this.quality(c);
      const popularity = 0; // wired when engagement events land (PRD §19)
      const freshness = this.freshness(c.createdAt);
      const score = 0.4 * relevance + 0.25 * quality + 0.2 * popularity + 0.15 * freshness;
      return { c, relevance, quality, popularity, freshness, score };
    });

    if (sort === 'newest') {
      scored.sort((a, b) => b.c.createdAt.getTime() - a.c.createdAt.getTime());
    } else if (sort === 'rating') {
      scored.sort((a, b) => b.quality - a.quality);
    } else {
      scored.sort((a, b) => b.score - a.score);
    }

    // Placement: <=2 sponsored slots (featured companies), 1 exploration slot
    // (newest, low-signal company), everything else organic.
    const sponsored = scored.filter((x) => x.c.featured).slice(0, 2);
    const sponsoredIds = new Set(sponsored.map((x) => x.c.id));
    const rest = scored.filter((x) => !sponsoredIds.has(x.c.id));

    const explorationPick = [...rest]
      .filter((x) => this.freshness(x.c.createdAt) > 0.95)
      .sort((a, b) => b.c.createdAt.getTime() - a.c.createdAt.getTime())[0];

    const ordered: { row: (typeof scored)[number]; placement: Placement }[] = [];
    sponsored.forEach((row) => ordered.push({ row, placement: 'sponsored' }));
    if (explorationPick) ordered.push({ row: explorationPick, placement: 'exploration' });
    rest
      .filter((x) => x !== explorationPick)
      .forEach((row) => ordered.push({ row, placement: 'organic' }));

    const total = ordered.length;
    const start = (page - 1) * pageSize;
    const items = ordered.slice(start, start + pageSize).map(({ row, placement }) => {
      const { c } = row;
      const loc = c.locations[0] ?? null;
      return {
        id: c.id,
        slug: c.slug,
        displayName: c.displayName,
        description: c.description,
        logoUrl: c.logoUrl,
        placement,
        category: c.category
          ? { slug: c.category.slug, name: c.category.nameI18n, icon: c.category.icon }
          : null,
        location: loc ? { city: loc.city, region: loc.region } : null,
        services: c.services.map((s) => s.name),
        hasWebsite: !!c.website && c.website.status !== 'draft',
        score: Number(row.score.toFixed(4)),
        scoreBreakdown: {
          relevance: Number(row.relevance.toFixed(3)),
          quality: Number(row.quality.toFixed(3)),
          popularity: row.popularity,
          freshness: Number(row.freshness.toFixed(3)),
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
        where: { isActive: true, companies: { some: { status: 'active' } } },
        orderBy: { position: 'asc' },
      }),
      this.prisma.companyLocation.findMany({
        where: { company: { status: 'active' } },
        distinct: ['city'],
        select: { city: true },
        orderBy: { city: 'asc' },
      }),
    ]);
    return {
      categories: categories.map((c) => ({ slug: c.slug, name: c.nameI18n, icon: c.icon })),
      cities: cities.map((c) => c.city),
    };
  }
}
