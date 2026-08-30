import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { money } from '../wallet/money';
import { utcDay } from '../campaigns/ad-click';
import {
  DEFAULT_REFS,
  type VisibilityInput,
  visibilityScore,
} from './visibility';

const SERIES_DAYS = 14;

function startOfUtcDay(now = new Date()): Date {
  return new Date(`${utcDay(now)}T00:00:00.000Z`);
}

interface ResponseAgg {
  total: number;
  responded: number;
  avgResponseMinutes: number | null;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // --- shared: lead response aggregation -----------------------------

  private async responseAggFor(companyIds: string[]): Promise<Map<string, ResponseAgg>> {
    if (!companyIds.length) return new Map();
    const [totals, responded] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['companyId'],
        where: { companyId: { in: companyIds } },
        _count: { _all: true },
      }),
      this.prisma.lead.findMany({
        where: { companyId: { in: companyIds }, firstResponseAt: { not: null } },
        select: { companyId: true, createdAt: true, firstResponseAt: true },
      }),
    ]);

    const totalBy = new Map(totals.map((t) => [t.companyId, t._count._all]));
    const respBy = new Map<string, { count: number; sumMs: number }>();
    for (const r of responded) {
      const cur = respBy.get(r.companyId) ?? { count: 0, sumMs: 0 };
      cur.count += 1;
      cur.sumMs += r.firstResponseAt!.getTime() - r.createdAt.getTime();
      respBy.set(r.companyId, cur);
    }

    const out = new Map<string, ResponseAgg>();
    for (const id of companyIds) {
      const total = totalBy.get(id) ?? 0;
      const rc = respBy.get(id);
      out.set(id, {
        total,
        responded: rc?.count ?? 0,
        avgResponseMinutes: rc && rc.count ? Math.round(rc.sumMs / rc.count / 60000) : null,
      });
    }
    return out;
  }

  // --- feed: visibility inputs -------------------------------------

  /** Per-company inputs for the feed Visibility Score. */
  async visibilityInputsFor(companyIds: string[]): Promise<Map<string, VisibilityInput>> {
    if (!companyIds.length) return new Map();
    const [campaigns, websites, respAgg] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { companyId: { in: companyIds } },
        select: { companyId: true, dailyBudgetMinor: true, activatedAt: true },
      }),
      this.prisma.website.findMany({
        where: { companyId: { in: companyIds } },
        select: { companyId: true, mode: true },
      }),
      this.responseAggFor(companyIds),
    ]);

    const campBy = new Map(campaigns.map((c) => [c.companyId, c]));
    const modeBy = new Map(websites.map((w) => [w.companyId, w.mode]));

    const out = new Map<string, VisibilityInput>();
    for (const id of companyIds) {
      const camp = campBy.get(id);
      const r = respAgg.get(id) ?? { total: 0, responded: 0, avgResponseMinutes: null };
      out.set(id, {
        dailyBudgetMinor: camp?.dailyBudgetMinor ?? 0,
        activatedAt: camp?.activatedAt ?? null,
        planMode: modeBy.get(id) ?? null,
        leadsTotal: r.total,
        leadsResponded: r.responded,
        avgResponseMinutes: r.avgResponseMinutes,
      });
    }
    return out;
  }

  // --- panel: full analytics for one company ---------------------

  async companyAnalytics(companyId: string) {
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const since = new Date(now.getTime() - SERIES_DAYS * 86_400_000);

    const [
      clicksTotal,
      clicksToday,
      calls,
      messagesTotal,
      messagesNew,
      spendTotal,
      spendToday,
      campaign,
      website,
      respAgg,
      clickSeries,
      msgSeries,
    ] = await Promise.all([
      this.prisma.adClick.count({ where: { companyId, billed: true } }),
      this.prisma.adClick.count({
        where: { companyId, billed: true, createdAt: { gte: todayStart } },
      }),
      this.prisma.lead.count({ where: { companyId, channel: 'call' } }),
      this.prisma.lead.count({ where: { companyId, channel: 'form' } }),
      this.prisma.lead.count({ where: { companyId, channel: 'form', status: 'new' } }),
      this.prisma.walletTransaction.aggregate({
        where: { companyId, type: 'spend', status: 'completed' },
        _sum: { amountMinor: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: {
          companyId,
          type: 'spend',
          status: 'completed',
          createdAt: { gte: todayStart },
        },
        _sum: { amountMinor: true },
      }),
      this.prisma.campaign.findUnique({
        where: { companyId },
        select: { dailyBudgetMinor: true, activatedAt: true, status: true },
      }),
      this.prisma.website.findUnique({ where: { companyId }, select: { mode: true } }),
      this.responseAggFor([companyId]),
      this.dailySeries('ad_clicks', companyId, since, 'billed = true'),
      this.dailySeries('leads', companyId, since, "channel = 'form'"),
    ]);

    const r = respAgg.get(companyId) ?? { total: 0, responded: 0, avgResponseMinutes: null };
    const activeDays = campaign?.activatedAt
      ? Math.max(0, Math.floor((now.getTime() - campaign.activatedAt.getTime()) / 86_400_000))
      : 0;

    const vin: VisibilityInput = {
      dailyBudgetMinor: campaign?.dailyBudgetMinor ?? 0,
      activatedAt: campaign?.activatedAt ?? null,
      planMode: website?.mode ?? null,
      leadsTotal: r.total,
      leadsResponded: r.responded,
      avgResponseMinutes: r.avgResponseMinutes,
    };
    const v = visibilityScore(vin, DEFAULT_REFS, now);
    const pct = (n: number) => Math.round(n * 100);

    return {
      clicks: { total: clicksTotal, today: clicksToday },
      calls: { total: calls },
      messages: { total: messagesTotal, new: messagesNew },
      campaign: {
        consumedTotal: money(Math.abs(spendTotal._sum.amountMinor ?? 0)),
        consumedToday: money(Math.abs(spendToday._sum.amountMinor ?? 0)),
        activeDays,
      },
      response: {
        avgMinutes: r.avgResponseMinutes,
        ratePct: r.total ? Math.round((r.responded / r.total) * 100) : null,
        responded: r.responded,
        total: r.total,
      },
      visibility: {
        score: pct(v.score),
        parts: {
          cpc: pct(v.cpc),
          response: pct(v.response),
          plan: pct(v.plan),
          age: pct(v.age),
        },
        // Fixed formula weights, surfaced so the panel can label the bars.
        weights: { cpc: 35, response: 30, plan: 20, age: 15 },
      },
      series: {
        days: this.denseDays(since, SERIES_DAYS),
        clicks: this.denseCounts(clickSeries, since, SERIES_DAYS),
        messages: this.denseCounts(msgSeries, since, SERIES_DAYS),
      },
    };
  }

  // --- daily series helpers ------------------------------------

  private async dailySeries(
    table: 'ad_clicks' | 'leads',
    companyId: string,
    since: Date,
    extraWhere: string,
  ): Promise<Array<{ day: Date; n: number }>> {
    const sql = Prisma.sql`
      SELECT date_trunc('day', created_at) AS day, count(*)::int AS n
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE company_id = ${companyId}::uuid
        AND created_at >= ${since}
        AND ${Prisma.raw(extraWhere)}
      GROUP BY 1
      ORDER BY 1
    `;
    return this.prisma.$queryRaw<Array<{ day: Date; n: number }>>(sql);
  }

  private denseDays(since: Date, days: number): string[] {
    const base = startOfUtcDay(new Date(since.getTime() + 86_400_000));
    return Array.from({ length: days }, (_, i) =>
      new Date(base.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    );
  }

  private denseCounts(
    rows: Array<{ day: Date; n: number }>,
    since: Date,
    days: number,
  ): number[] {
    const byDay = new Map(
      rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.n)]),
    );
    return this.denseDays(since, days).map((d) => byDay.get(d) ?? 0);
  }
}
