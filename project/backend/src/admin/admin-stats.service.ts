import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { money } from '../wallet/money';

const DAY = 86_400_000;

interface DayPoint {
  date: string;
  users: number;
  companies: number;
}

interface EconomyPoint {
  date: string;
  /** Credits bought that day (completed purchases). */
  sold: number;
  /** Credits burned on clicks that day. */
  consumed: number;
}

@Injectable()
export class AdminStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

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

    const [
      byCountry,
      byRole,
      timeseries,
      economyTimeseries,
      campaignsByStatus,
      campaignsAuto,
      committedBudget,
      clicks30,
      leads30,
      walletsBlocked,
      pendingPurchases,
      soldAllTime,
      sold30,
      consumedAllTime,
      consumed30,
      refundedAllTime,
      eurRonRate,
    ] = await Promise.all([
      this.prisma.company.groupBy({
        by: ['country'],
        _count: { _all: true },
        orderBy: { _count: { country: 'desc' } },
      }),
      this.prisma.platformRoleAssignment.groupBy({ by: ['role'], _count: { _all: true } }),
      this.signupTimeseries(14),
      this.economyTimeseries(14),
      this.prisma.campaign.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.campaign.count({ where: { autoOptimize: true } }),
      this.prisma.campaign.aggregate({
        _sum: { dailyBudgetMinor: true },
        where: { status: 'active' },
      }),
      this.prisma.adClick.count({ where: { billed: true, createdAt: { gte: d30 } } }),
      this.prisma.lead.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.wallet.count({ where: { blockedAt: { not: null } } }),
      this.prisma.walletTransaction.count({ where: { type: 'purchase', status: 'pending' } }),
      this.prisma.walletTransaction.aggregate({
        _sum: { amountMinor: true, ronBani: true },
        where: { type: 'purchase', status: 'completed' },
      }),
      this.prisma.walletTransaction.aggregate({
        _sum: { amountMinor: true, ronBani: true },
        where: { type: 'purchase', status: 'completed', createdAt: { gte: d30 } },
      }),
      this.prisma.walletTransaction.aggregate({
        _sum: { amountMinor: true },
        where: { type: 'spend', status: 'completed' },
      }),
      this.prisma.walletTransaction.aggregate({
        _sum: { amountMinor: true },
        where: { type: 'spend', status: 'completed', createdAt: { gte: d30 } },
      }),
      this.prisma.walletTransaction.aggregate({
        _sum: { amountMinor: true },
        where: { type: 'refund', status: 'completed' },
      }),
      this.settings.eurRonRate(),
    ]);

    const campStatus = (s: 'draft' | 'active' | 'paused' | 'depleted') =>
      campaignsByStatus.find((r) => r.status === s)?._count._all ?? 0;
    const abs = (n: number | null | undefined) => Math.abs(n ?? 0);

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
      economySeries: economyTimeseries,
      // Live EUR->RON rate so the panel can show a RON equivalent next to credits.
      eurRonRate,
      economy: {
        creditsSold: money(soldAllTime._sum.amountMinor ?? 0),
        creditsSold30d: money(sold30._sum.amountMinor ?? 0),
        ronCollected: (soldAllTime._sum.ronBani ?? 0) / 100,
        ronCollected30d: (sold30._sum.ronBani ?? 0) / 100,
        cpcConsumed: money(abs(consumedAllTime._sum.amountMinor)),
        cpcConsumed30d: money(abs(consumed30._sum.amountMinor)),
        refunded: money(abs(refundedAllTime._sum.amountMinor)),
        pendingPurchases,
        walletsBlocked,
      },
      campaigns: {
        active: campStatus('active'),
        paused: campStatus('paused'),
        depleted: campStatus('depleted'),
        draft: campStatus('draft'),
        autoOptimize: campaignsAuto,
        committedDailyBudget: money(committedBudget._sum.dailyBudgetMinor ?? 0),
        clicks30d: clicks30,
        leads30d: leads30,
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

  /** Per-day credits bought vs burned for the last `days` days (credits, not minor). */
  private async economyTimeseries(days: number): Promise<EconomyPoint[]> {
    const since = new Date(Date.now() - (days - 1) * DAY);
    since.setHours(0, 0, 0, 0);

    const rows = await this.prisma.$queryRaw<{ day: Date; sold: bigint; consumed: bigint }[]>`
      SELECT date_trunc('day', "created_at") AS day,
             COALESCE(SUM("amount_minor") FILTER (WHERE "type" = 'purchase'), 0)::bigint AS sold,
             COALESCE(-SUM("amount_minor") FILTER (WHERE "type" = 'spend'), 0)::bigint AS consumed
      FROM "wallet_transactions"
      WHERE "created_at" >= ${since} AND "status" = 'completed'
        AND "type" IN ('purchase', 'spend')
      GROUP BY 1`;

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const map = new Map(
      rows.map((r) => [
        key(new Date(r.day)),
        { sold: Number(r.sold), consumed: Number(r.consumed) },
      ]),
    );

    const out: EconomyPoint[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * DAY);
      const hit = map.get(key(d));
      out.push({
        date: key(d),
        sold: (hit?.sold ?? 0) / 100,
        consumed: (hit?.consumed ?? 0) / 100,
      });
    }
    return out;
  }
}
