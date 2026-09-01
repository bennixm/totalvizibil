import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { money } from '../wallet/money';
import { utcDay } from '../campaigns/ad-click';
import { suggestCampaign } from '../campaigns/campaign-advisor';
import {
  APPEAR_FIRST_BOOST,
  DEFAULT_REFS,
  effectiveActiveSeconds,
  type VisibilityInput,
  visibilityScore,
} from './visibility';

export interface FeedRank {
  /** 1-based slot in the company's category group. */
  position: number;
  /** Active listings competing in that group. */
  total: number;
}

const SERIES_DAYS = 14;

/**
 * How recently a `depleted` rival must have dropped out to still count as live
 * competition for the CPC reference. A campaign that hits today's budget cap (or
 * a brief wallet dip) is `depleted` but will be back within the day — excluding
 * it would make the recommended CPC (and everyone's CPC sub-score) oscillate
 * daily. A `paused` campaign — a deliberate stop — never counts.
 */
const MARKET_RIVAL_DEPLETED_GRACE_MS = 48 * 60 * 60 * 1000;

/** `where` fragment for a rival campaign that still counts toward the market CPC. */
function marketRivalWhere(): Prisma.CampaignWhereInput {
  return {
    OR: [
      { status: 'active' },
      {
        status: 'depleted',
        pausedAt: { gte: new Date(Date.now() - MARKET_RIVAL_DEPLETED_GRACE_MS) },
      },
    ],
  };
}

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
    const now = new Date();
    const [campaigns, websites, respAgg, cpcRefs] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { companyId: { in: companyIds } },
        select: {
          companyId: true,
          cpcMinor: true,
          dailyBudgetMinor: true,
          status: true,
          activatedAt: true,
          activeSecondsAccrued: true,
          pausedAt: true,
        },
      }),
      this.prisma.website.findMany({
        where: { companyId: { in: companyIds } },
        select: { companyId: true, mode: true },
      }),
      this.responseAggFor(companyIds),
      this.cpcRefsFor(companyIds),
    ]);

    const campBy = new Map(campaigns.map((c) => [c.companyId, c]));
    const modeBy = new Map(websites.map((w) => [w.companyId, w.mode]));

    const out = new Map<string, VisibilityInput>();
    for (const id of companyIds) {
      const camp = campBy.get(id);
      const r = respAgg.get(id) ?? { total: 0, responded: 0, avgResponseMinutes: null };
      out.set(id, {
        cpcMinor: camp?.cpcMinor ?? 0,
        cpcRefMinor: cpcRefs.get(id) ?? 0,
        dailyBudgetMinor: camp?.dailyBudgetMinor ?? 0,
        activeSeconds: camp
          ? effectiveActiveSeconds(
              camp.activeSecondsAccrued,
              camp.activatedAt,
              camp.status === 'active',
              now,
              camp.pausedAt,
            )
          : 0,
        planMode: modeBy.get(id) ?? null,
        leadsTotal: r.total,
        leadsResponded: r.responded,
        avgResponseMinutes: r.avgResponseMinutes,
      });
    }
    return out;
  }

  /**
   * The category-leading ("recommended") CPC for each company — the bid that
   * tops out its CPC sub-score. It is one notch above the highest CPC any
   * *other* rival campaign in the same category group is bidding (currently
   * serving, or `depleted` within the last 48h — see `marketRivalWhere`),
   * widened a little for a large service radius (same rule the advisor uses).
   */
  async cpcRefsFor(companyIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!companyIds.length) return out;

    const [meta, rivalBids] = await Promise.all([
      this.prisma.company.findMany({
        where: { id: { in: companyIds } },
        select: {
          id: true,
          category: { select: { slug: true, parent: { select: { slug: true } } } },
          locations: {
            where: { isPrimary: true },
            take: 1,
            select: { serviceRadiusKm: true },
          },
        },
      }),
      this.prisma.campaign.findMany({
        where: marketRivalWhere(),
        select: {
          companyId: true,
          cpcMinor: true,
          company: {
            select: { category: { select: { slug: true, parent: { select: { slug: true } } } } },
          },
        },
      }),
    ]);

    const rootOf = (cat: { slug: string; parent: { slug: string } | null } | null) =>
      cat?.parent?.slug ?? cat?.slug ?? null;

    const bidsByRoot = new Map<string, Array<{ companyId: string; cpcMinor: number }>>();
    for (const b of rivalBids) {
      const root = rootOf(b.company.category);
      if (!root) continue;
      const list = bidsByRoot.get(root) ?? [];
      list.push({ companyId: b.companyId, cpcMinor: b.cpcMinor });
      bidsByRoot.set(root, list);
    }

    for (const m of meta) {
      const root = rootOf(m.category);
      const rivals = root ? (bidsByRoot.get(root) ?? []) : [];
      const marketMax = rivals.reduce(
        (mx, r) => (r.companyId !== m.id && r.cpcMinor > mx ? r.cpcMinor : mx),
        0,
      );
      out.set(
        m.id,
        suggestCampaign({
          radiusKm: m.locations[0]?.serviceRadiusKm ?? null,
          marketMaxCpcMinor: marketMax,
        }).appearFirst.cpcMinor,
      );
    }
    return out;
  }

  // --- feed: where does one company rank -------------------------

  /**
   * The company's 1-based position among the active listings in its category
   * group (parent + siblings), ranked by the same Visibility Score + "appear
   * first" lift the feed uses. `null` when the campaign is not live (it is not
   * in the feed at all) or the company has no category.
   */
  async feedRankFor(companyId: string): Promise<FeedRank | null> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        status: true,
        category: { select: { slug: true, parentId: true, parent: { select: { slug: true } } } },
      },
    });
    if (!company || company.status !== 'active' || !company.category) return null;

    // The group root is the parent category (or the category itself if it is
    // already top-level); the competitive set is that root + all its children.
    const rootSlug = company.category.parent?.slug ?? company.category.slug;
    const root = await this.prisma.category.findUnique({
      where: { slug: rootSlug },
      select: { slug: true, children: { select: { slug: true } } },
    });
    const groupSlugs = root ? [root.slug, ...root.children.map((c) => c.slug)] : [];

    const peers = await this.prisma.company.findMany({
      where: {
        status: 'active',
        ...(groupSlugs.length ? { category: { slug: { in: groupSlugs } } } : {}),
      },
      select: { id: true },
    });
    if (peers.length <= 1) return peers.length === 1 ? { position: 1, total: 1 } : null;

    const ids = peers.map((p) => p.id);
    const [vinputs, boosted] = await Promise.all([
      this.visibilityInputsFor(ids),
      this.prisma.campaign.findMany({
        where: { companyId: { in: ids }, status: 'active', appearFirst: true },
        select: { companyId: true },
      }),
    ]);
    const boostSet = new Set(boosted.map((b) => b.companyId));

    const ranked = ids
      .map((id) => {
        const base = visibilityScore(
          vinputs.get(id) ?? {
            cpcMinor: 0,
            cpcRefMinor: 0,
            dailyBudgetMinor: 0,
            leadsTotal: 0,
            leadsResponded: 0,
            avgResponseMinutes: null,
            planMode: null,
            activeSeconds: 0,
          },
        ).score;
        return { id, score: base + (boostSet.has(id) ? APPEAR_FIRST_BOOST : 0) };
      })
      .sort((a, b) => b.score - a.score);

    const idx = ranked.findIndex((r) => r.id === companyId);
    if (idx < 0) return null;
    return { position: idx + 1, total: ranked.length };
  }

  /**
   * Highest CPC (minor units) bid by a rival in this company's category group —
   * the number AUTO mode has to beat for feed position #1. Counts campaigns that
   * are serving now or `depleted` within the last 48h (see `marketRivalWhere`),
   * so it does not swing when a big rival spends its daily cap. `0` when the
   * company has no live rival in its group.
   */
  async marketCpcFor(companyId: string): Promise<number> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        category: { select: { slug: true, parent: { select: { slug: true } } } },
      },
    });
    const rootSlug = company?.category?.parent?.slug ?? company?.category?.slug ?? null;
    const groupSlugs = rootSlug
      ? await this.prisma.category
          .findUnique({
            where: { slug: rootSlug },
            select: { slug: true, children: { select: { slug: true } } },
          })
          .then((r) => (r ? [r.slug, ...r.children.map((c) => c.slug)] : []))
      : [];

    const agg = await this.prisma.campaign.aggregate({
      _max: { cpcMinor: true },
      where: {
        ...marketRivalWhere(),
        companyId: { not: companyId },
        ...(groupSlugs.length ? { company: { category: { slug: { in: groupSlugs } } } } : {}),
      },
    });
    return agg._max.cpcMinor ?? 0;
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
      cpcRefs,
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
        select: {
          cpcMinor: true,
          dailyBudgetMinor: true,
          activatedAt: true,
          activeSecondsAccrued: true,
          pausedAt: true,
          status: true,
        },
      }),
      this.prisma.website.findUnique({ where: { companyId }, select: { mode: true } }),
      this.responseAggFor([companyId]),
      this.dailySeries('ad_clicks', companyId, since, 'billed = true'),
      this.dailySeries('leads', companyId, since, "channel = 'form'"),
      this.cpcRefsFor([companyId]),
    ]);

    const r = respAgg.get(companyId) ?? { total: 0, responded: 0, avgResponseMinutes: null };
    const activeSeconds = campaign
      ? effectiveActiveSeconds(
          campaign.activeSecondsAccrued,
          campaign.activatedAt,
          campaign.status === 'active',
          now,
          campaign.pausedAt,
        )
      : 0;
    const activeDays = Math.floor(activeSeconds / 86_400);

    const vin: VisibilityInput = {
      cpcMinor: campaign?.cpcMinor ?? 0,
      cpcRefMinor: cpcRefs.get(companyId) ?? 0,
      dailyBudgetMinor: campaign?.dailyBudgetMinor ?? 0,
      activeSeconds,
      planMode: website?.mode ?? null,
      leadsTotal: r.total,
      leadsResponded: r.responded,
      avgResponseMinutes: r.avgResponseMinutes,
    };
    const v = visibilityScore(vin, DEFAULT_REFS, now);
    const pct = (n: number) => Math.round(n * 100);

    const feedRank = campaign?.status === 'active' ? await this.feedRankFor(companyId) : null;

    return {
      planMode: website?.mode ?? null,
      feedRank,
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

  private denseCounts(rows: Array<{ day: Date; n: number }>, since: Date, days: number): number[] {
    const byDay = new Map(
      rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.n)]),
    );
    return this.denseDays(since, days).map((d) => byDay.get(d) ?? 0);
  }
}
