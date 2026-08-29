import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86_400_000;

interface DayPoint {
  date: string;
  users: number;
  companies: number;
}

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const now = Date.now();
    const d7 = new Date(now - 7 * DAY);
    const d30 = new Date(now - 30 * DAY);
    const nowDate = new Date();

    const [
      usersTotal,
      usersActive,
      usersSuspended,
      users2fa,
      usersNew7,
      usersNew30,
      staffCount,
      companiesTotal,
      companiesDraft,
      companiesActive,
      companiesSuspended,
      companiesWithWebsite,
      websitesPublished,
      companiesNew7,
      companiesNew30,
      activeSessions,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { status: 'suspended' } }),
      this.prisma.user.count({ where: { totpEnabledAt: { not: null } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.user.count({ where: { platformRoles: { some: {} } } }),
      this.prisma.company.count(),
      this.prisma.company.count({ where: { status: 'draft' } }),
      this.prisma.company.count({ where: { status: 'active' } }),
      this.prisma.company.count({ where: { status: 'suspended' } }),
      this.prisma.company.count({ where: { website: { isNot: null } } }),
      this.prisma.website.count({ where: { status: 'published' } }),
      this.prisma.company.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.company.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: nowDate } } }),
    ]);

    const [byCountry, byRole, timeseries] = await Promise.all([
      this.prisma.company.groupBy({
        by: ['country'],
        _count: { _all: true },
        orderBy: { _count: { country: 'desc' } },
      }),
      this.prisma.platformRoleAssignment.groupBy({ by: ['role'], _count: { _all: true } }),
      this.signupTimeseries(14),
    ]);

    return {
      users: {
        total: usersTotal,
        active: usersActive,
        suspended: usersSuspended,
        withTwoFactor: users2fa,
        staff: staffCount,
        new7d: usersNew7,
        new30d: usersNew30,
      },
      companies: {
        total: companiesTotal,
        draft: companiesDraft,
        active: companiesActive,
        suspended: companiesSuspended,
        withWebsite: companiesWithWebsite,
        websitesPublished,
        new7d: companiesNew7,
        new30d: companiesNew30,
        byCountry: byCountry.map((r) => ({ country: r.country, count: r._count._all })),
      },
      staffByRole: byRole.map((r) => ({ role: r.role, count: r._count._all })),
      activeSessions,
      signups: timeseries,
      listings: {
        _status: 'not_defined' as const,
        note: 'The listing / ad model has not been decided yet. Company counts above are the closest proxy.',
      },
      generatedAt: nowDate.toISOString(),
    };
  }

  /** Per-day signup counts for the last `days` days (inclusive of today). */
  private async signupTimeseries(days: number): Promise<DayPoint[]> {
    const since = new Date(Date.now() - (days - 1) * DAY);
    since.setHours(0, 0, 0, 0);

    const [users, companies] = await Promise.all([
      this.prisma.$queryRaw<{ day: Date; n: bigint }[]>`
        SELECT date_trunc('day', "created_at") AS day, count(*)::bigint AS n
        FROM "users" WHERE "created_at" >= ${since}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ day: Date; n: bigint }[]>`
        SELECT date_trunc('day', "created_at") AS day, count(*)::bigint AS n
        FROM "companies" WHERE "created_at" >= ${since}
        GROUP BY 1`,
    ]);

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const uMap = new Map(users.map((r) => [key(new Date(r.day)), Number(r.n)]));
    const cMap = new Map(companies.map((r) => [key(new Date(r.day)), Number(r.n)]));

    const out: DayPoint[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * DAY);
      const k = key(d);
      out.push({ date: k, users: uMap.get(k) ?? 0, companies: cMap.get(k) ?? 0 });
    }
    return out;
  }
}
