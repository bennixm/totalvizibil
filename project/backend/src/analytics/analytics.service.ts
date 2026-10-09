import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { money, creditsToMinor } from '../wallet/money';
import { utcDay } from '../campaigns/ad-click';
import { round10 } from '../campaigns/campaign-advisor';
import {
  DEFAULT_REFS,
  DEFAULT_WEIGHTS,
  effectiveActiveSeconds,
  type VisibilityInput,
  visibilityScore,
} from './visibility';
import { FeedMarginConfig, rankPeersByFeedScore, recommendedCpcForFeedMinor } from './feed-pricing';
import { FeedId, enumerateCompanyFeeds, feedEligiblePeers, primaryFeedOf } from './feed-resolver';

export interface FeedRank {
  /** 1-based slot in the company's category group. */
  position: number;
  /** Active listings competing in that group. */
  total: number;
}

export interface FeedRankEntry {
  /** Real județ, or the "nationwide" pseudo-county. */
  county: string;
  categorySlug: string;
  categoryName: Prisma.JsonValue;
  /** 1-based slot within this one Feed. */
  position: number;
  /** Eligible competitors in this Feed. */
  total: number;
}

export interface FeedContext {
  feedId: FeedId;
  /** Eligible competitors physically present in this Feed, incl. the company itself if eligible. */
  peers: Array<{ companyId: string; cpcMinor: number }>;
  /** Highest bid among `peers` — the CPC sub-score's reference inside this Feed. */
  maxBidMinor: number;
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

/** Expected clicks/day used to size the recommended tier's daily budget. */
const RECOMMENDED_CLICKS = 25;

/** `select` fragment with everything `feed-resolver.ts` needs to place a company into a Feed. */
const feedContextSelect = {
  categoryAssignments: { select: { categoryId: true, isPrimary: true, createdAt: true } },
  locations: { select: { county: true, nationwide: true, isPrimary: true, createdAt: true } },
} satisfies Prisma.CompanySelect;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  /** Current CPC-local margin configuration, in minor units. */
  async marginConfig(): Promise<FeedMarginConfig> {
    const [costPromovareCredits, marjaProfitCredits, marjaPozitionareCredits] = await Promise.all([
      this.platformSettings.feedCostPromovareCredits(),
      this.platformSettings.feedMarjaProfitCredits(),
      this.platformSettings.feedMarjaPozitionareCredits(),
    ]);
    return {
      costPromovareMinor: creditsToMinor(costPromovareCredits),
      marjaProfitMinor: creditsToMinor(marjaProfitCredits),
      marjaPozitionareMinor: creditsToMinor(marjaPozitionareCredits),
    };
  }

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

  /**
   * Raw per-company inputs for the Visibility Score — everything except the
   * CPC sub-score's reference, which is Feed-specific (the highest bid among
   * that exact Feed's eligible competitors, see `feed-resolver.ts`) and must
   * be supplied by the caller per company after resolving each one's Feed.
   * `cpcRefMinor` is left at 0 here as a placeholder.
   */
  async visibilityInputsFor(companyIds: string[]): Promise<Map<string, VisibilityInput>> {
    if (!companyIds.length) return new Map();
    const now = new Date();
    const [campaigns, websites, respAgg] = await Promise.all([
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
    ]);

    const campBy = new Map(campaigns.map((c) => [c.companyId, c]));
    const modeBy = new Map(websites.map((w) => [w.companyId, w.mode]));

    const out = new Map<string, VisibilityInput>();
    for (const id of companyIds) {
      const camp = campBy.get(id);
      const r = respAgg.get(id) ?? { total: 0, responded: 0, avgResponseMinutes: null };
      out.set(id, {
        cpcMinor: camp?.cpcMinor ?? 0,
        cpcRefMinor: 0,
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

  // --- feed: atomic-Feed context (ranking + CPC-local pricing) -----

  /** The company's own primary Feed and who it actually competes against there right now. */
  async feedContextFor(companyId: string): Promise<FeedContext | null> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: feedContextSelect,
    });
    if (!company) return null;
    const feedId = primaryFeedOf(company);
    if (!feedId) return null;

    const cfg = await this.marginConfig();
    const peers = await feedEligiblePeers(this.prisma, feedId, cfg);
    const maxBidMinor = peers.reduce((mx, p) => Math.max(mx, p.cpcMinor), 0);
    return { feedId, peers, maxBidMinor };
  }

  // --- feed: where does one company rank -------------------------

  /**
   * The company's 1-based position among the other firms eligible in its own
   * primary Feed (județ + subcategorie primară), ranked by the Visibility
   * Score (CPC — against that Feed's top bid — at 50%, blended with
   * response/plan/age) + the "appear first" lift. A company competing in
   * several Feeds (several counties/subcategories) is reported here only for
   * its primary one — a per-Feed breakdown is a UI follow-up, not a backend
   * limitation. `null` when the campaign is not live, the company has no
   * resolvable Feed, or it isn't itself eligible there (CPC maxim < CPC minim).
   */
  async feedRankFor(companyId: string): Promise<FeedRank | null> {
    const ctx = await this.feedContextFor(companyId);
    if (!ctx || !ctx.peers.some((p) => p.companyId === companyId)) return null;
    if (ctx.peers.length === 1) return { position: 1, total: 1 };

    const ids = ctx.peers.map((p) => p.companyId);
    const [vinputs, boosted] = await Promise.all([
      this.visibilityInputsFor(ids),
      this.prisma.campaign.findMany({
        where: { companyId: { in: ids }, status: 'active', appearFirst: true },
        select: { companyId: true },
      }),
    ]);
    const boostSet = new Set(boosted.map((b) => b.companyId));
    const ranked = rankPeersByFeedScore(ids, vinputs, ctx.maxBidMinor, boostSet);

    const idx = ranked.findIndex((r) => r.companyId === companyId);
    if (idx < 0) return null;
    return { position: idx + 1, total: ranked.length };
  }

  /**
   * The company's 1-based position in EVERY atomic Feed it's eligible to
   * compete in — one entry per (județ, subcategorie) it's tagged with. The
   * multi-Feed-aware counterpart of `feedRankFor`'s single primary-Feed
   * number: a company competing on several counties/subcategories has a
   * genuinely different hierarchy in each, so no one number can represent
   * "its position" overall. A Feed where the company isn't itself eligible
   * (CPC maxim below that Feed's CPC minim) is skipped entirely — it isn't
   * ranked there, so there is nothing to report.
   */
  async feedRanksFor(companyId: string): Promise<FeedRankEntry[]> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: feedContextSelect,
    });
    if (!company) return [];
    const feeds = enumerateCompanyFeeds(company);
    if (!feeds.length) return [];

    const cfg = await this.marginConfig();
    const leafIds = Array.from(new Set(feeds.map((f) => f.leafId)));
    const categories = await this.prisma.category.findMany({
      where: { id: { in: leafIds } },
      select: { id: true, slug: true, nameI18n: true },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const out: FeedRankEntry[] = [];
    for (const feedId of feeds) {
      const peers = await feedEligiblePeers(this.prisma, feedId, cfg);
      if (!peers.some((p) => p.companyId === companyId)) continue;

      const ids = peers.map((p) => p.companyId);
      const maxBidMinor = peers.reduce((mx, p) => Math.max(mx, p.cpcMinor), 0);
      const [vinputs, boosted] = await Promise.all([
        this.visibilityInputsFor(ids),
        this.prisma.campaign.findMany({
          where: { companyId: { in: ids }, status: 'active', appearFirst: true },
          select: { companyId: true },
        }),
      ]);
      const boostSet = new Set(boosted.map((b) => b.companyId));
      const ranked = rankPeersByFeedScore(ids, vinputs, maxBidMinor, boostSet);
      const idx = ranked.findIndex((r) => r.companyId === companyId);
      if (idx < 0) continue;

      const cat = categoryById.get(feedId.leafId);
      out.push({
        county: feedId.county,
        categorySlug: cat?.slug ?? '',
        categoryName: cat?.nameI18n ?? null,
        position: idx + 1,
        total: ranked.length,
      });
    }
    return out;
  }

  /**
   * "CPC maxim recomandat", re-adapted per Feed: for every atomic Feed the
   * company is eligible to compete in (its own leaves × its own counties),
   * the CPC local a position-1 slot would ask for given that Feed's current
   * rival count — a flat schedule (CPC minim + rivalCount × marjă poziționare),
   * independent of what any rival actually bids. The recommendation is the
   * MAX across all of the company's Feeds. `null` when the company has no
   * resolvable Feed at all (no category/location set yet) — callers fall
   * back to `suggestCampaign()`'s flat heuristic in that case.
   */
  async recommendedCpcFor(
    companyId: string,
  ): Promise<{ cpcMinor: number; dailyBudgetMinor: number } | null> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: feedContextSelect,
    });
    if (!company) return null;
    const feeds = enumerateCompanyFeeds(company);
    if (!feeds.length) return null;

    const cfg = await this.marginConfig();
    let best = 0;
    for (const feedId of feeds) {
      const rivals = await feedEligiblePeers(this.prisma, feedId, cfg, {
        excludeCompanyId: companyId,
      });
      const recMinor = recommendedCpcForFeedMinor(rivals.length, cfg);
      if (recMinor > best) best = recMinor;
    }
    const dailyBudgetMinor = Math.max(
      round10(best * RECOMMENDED_CLICKS),
      DEFAULT_REFS.budgetRefMinor,
    );
    return { cpcMinor: best, dailyBudgetMinor };
  }

  /**
   * Highest CPC (minor units) bid by a rival across any of this company's own
   * subcategories — the number the "CPC maxim recomandat" has to beat.
   * Counts campaigns that are serving now or `depleted` within the last 48h
   * (see `marketRivalWhere`), so it does not swing when a big rival spends
   * its daily cap. `0` when the company has no live rival in any of its
   * subcategories (or is tagged with none at all).
   */
  async marketCpcFor(companyId: string): Promise<number> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { categoryAssignments: { select: { categoryId: true } } },
    });
    const leafIds = company?.categoryAssignments.map((a) => a.categoryId) ?? [];
    if (!leafIds.length) return 0;

    const agg = await this.prisma.campaign.aggregate({
      _max: { cpcMinor: true },
      where: {
        ...marketRivalWhere(),
        companyId: { not: companyId },
        company: { categoryAssignments: { some: { categoryId: { in: leafIds } } } },
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
      feedCtx,
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
      this.feedContextFor(companyId),
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
      cpcRefMinor: feedCtx?.maxBidMinor ?? 0,
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
        // Surfaced so the panel can label the bars — see DEFAULT_WEIGHTS.
        weights: {
          cpc: pct(DEFAULT_WEIGHTS.cpc),
          response: pct(DEFAULT_WEIGHTS.response),
          plan: pct(DEFAULT_WEIGHTS.plan),
          age: pct(DEFAULT_WEIGHTS.age),
        },
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
