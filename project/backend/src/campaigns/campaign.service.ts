import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Campaign, CampaignStatus, CompanyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { DEFAULT_REFS, RUN_SCORE_GRACE_MS, effectiveActiveSeconds } from '../analytics/visibility';
import { creditsToMinor, minorToCredits, money } from '../wallet/money';
import { CampaignSuggestions, CampaignTier, suggestCampaign } from './campaign-advisor';
import { analyzeCampaign } from './campaign-optimizer';
import { autoBudgetCapMinor, autoResolvedCpcMinor } from './auto-cpc';
import { isLikelyBot, utcDay, visitorFingerprint } from './ad-click';
import { SaveCampaignDto } from './dto/save-campaign.dto';

const CAN_EDIT: CompanyRole[] = [CompanyRole.owner, CompanyRole.manager, CompanyRole.billing];

/** Midnight UTC of the given day — matches the `spend_day` DATE column. */
function startOfUtcDay(now = new Date()): Date {
  return new Date(`${utcDay(now)}T00:00:00.000Z`);
}

export type ClickResult = { billed: boolean; reason?: string };

@Injectable()
export class CampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly analytics: AnalyticsService,
  ) {}

  // --- membership -------------------------------------------------------

  private async memberRole(companyId: string, userId: string): Promise<CompanyRole> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') throw new NotFoundException('Company not found');
    return member.role;
  }

  private async assertCanEdit(companyId: string, userId: string): Promise<void> {
    const role = await this.memberRole(companyId, userId);
    if (!CAN_EDIT.includes(role)) {
      throw new ForbiddenException('Your role cannot manage the campaign');
    }
  }

  /** The company owner whose single wallet funds this campaign. */
  private async walletOwner(companyId: string): Promise<string> {
    return this.wallet.ownerIdForCompany(companyId);
  }

  // --- lifecycle -------------------------------------------------------

  /**
   * Flip campaign + company + website together. `active` publishes the company
   * into the feed; any other status pulls it back out. (There is no "sponsored"
   * tier — a funded, active campaign simply appears; an unfunded one does not.)
   */
  private async setLive(companyId: string, campaign: Campaign, status: CampaignStatus) {
    const live = status === CampaignStatus.active;
    const wasLive = campaign.status === CampaignStatus.active;
    const now = new Date();

    // The run-time (age) score counts only time actually spent live. On every
    // exit from the active state we bank the finished run; on every entry we
    // restamp the run clock. A campaign stopped for under 24h keeps the run
    // time it had earned; stopped for longer, the banked run time is dropped so
    // reactivation starts a fresh run.
    let activatedAt = campaign.activatedAt;
    let activeSecondsAccrued = campaign.activeSecondsAccrued;
    if (live && !wasLive) {
      activatedAt = now;
      if (campaign.pausedAt && now.getTime() - campaign.pausedAt.getTime() > RUN_SCORE_GRACE_MS) {
        activeSecondsAccrued = 0;
      }
    } else if (!live && wasLive && campaign.activatedAt) {
      const runMs = now.getTime() - campaign.activatedAt.getTime();
      if (runMs > 0) activeSecondsAccrued += Math.floor(runMs / 1000);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status,
          activatedAt,
          activeSecondsAccrued,
          pausedAt: live ? null : now,
        },
      }),
      this.prisma.company.update({
        where: { id: companyId },
        data: {
          status: live ? 'active' : 'draft',
          featured: live,
          claimedAt: live ? new Date() : undefined,
        },
      }),
      this.prisma.website.updateMany({
        where: { companyId },
        data: { status: live ? 'published' : 'unpublished' },
      }),
    ]);
    return updated;
  }

  /** Pull a campaign out of the feed mid-serve (budget hit / wallet empty). */
  private async setDepletedWithin(
    tx: Prisma.TransactionClient,
    companyId: string,
    campaign: Campaign,
  ): Promise<void> {
    if (campaign.status === CampaignStatus.depleted) return;
    const now = new Date();
    // Bank the run that just ended so its time isn't lost (this path does not go
    // through `setLive`).
    let activeSecondsAccrued = campaign.activeSecondsAccrued;
    if (campaign.status === CampaignStatus.active && campaign.activatedAt) {
      const runMs = now.getTime() - campaign.activatedAt.getTime();
      if (runMs > 0) activeSecondsAccrued += Math.floor(runMs / 1000);
    }
    await tx.campaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.depleted, activeSecondsAccrued, pausedAt: now },
    });
    await tx.company.update({
      where: { id: companyId },
      data: { status: 'draft', featured: false },
    });
    await tx.website.updateMany({ where: { companyId }, data: { status: 'unpublished' } });
  }

  /**
   * Reconcile the campaign against the wallet balance + today's spend: an
   * `active` campaign that can no longer pay for its next click — because the
   * wallet is empty or today's budget is spent — becomes `depleted` (and leaves
   * the feed); a `depleted` campaign that can afford a click again auto-revives.
   * `spentTodayMinor` resets lazily when the UTC day rolls over.
   *
   * The "can it pay for the next click" test is deliberately `cpcMinor`, not a
   * whole day's budget — the same guard `registerClick` bills against. Requiring
   * a full day of balance at all times would delete a healthy campaign the
   * moment normal spend dropped the wallet below one day's budget.
   */
  private async reconcile(companyId: string): Promise<Campaign | null> {
    let campaign = await this.prisma.campaign.findUnique({ where: { companyId } });
    if (!campaign) return null;
    const owner = await this.walletOwner(companyId);

    const today = startOfUtcDay();
    const dayRolled = !campaign.spendDay || campaign.spendDay.getTime() !== today.getTime();
    const spentToday = dayRolled ? 0 : campaign.spentTodayMinor;
    if (dayRolled && campaign.spentTodayMinor !== 0) {
      campaign = await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: { spentTodayMinor: 0, spendDay: today },
      });
    }

    // AUTO mode: set the CPC that tops out the visibility score — the
    // recommended bid for the category — but never above 10% of the daily
    // budget per click. That ceiling also keeps two AUTO campaigns from bidding
    // each other up without limit. There is no cron, so this rides along with
    // every read.
    if (campaign.autoOptimize && campaign.status !== CampaignStatus.draft) {
      const s = await this.suggestFor(companyId);
      const target = autoResolvedCpcMinor(s.appearFirst.cpcMinor, campaign.dailyBudgetMinor);
      if (target >= 1 && target !== campaign.cpcMinor) {
        campaign = await this.prisma.campaign.update({
          where: { id: campaign.id },
          data: { cpcMinor: target },
        });
      }
    }

    // Can the wallet cover the next click? (Not a whole day — see the method doc.)
    const funded = await this.wallet.canAfford(owner, campaign.cpcMinor);
    const budgetLeft = campaign.dailyBudgetMinor - spentToday >= campaign.cpcMinor;

    if (campaign.status === CampaignStatus.active && (!funded || !budgetLeft)) {
      // AUTO gives up only when the wallet is actually out of credits — it can't
      // fund even one click. Spending today's cap is normal and expected every
      // day — the campaign drops out for the rest of the day and AUTO revives it
      // when the cap resets, so it does not have to be re-enabled daily.
      if (campaign.autoOptimize && !funded) {
        campaign = await this.prisma.campaign.update({
          where: { id: campaign.id },
          data: { autoOptimize: false },
        });
      }
      const d = await this.setLive(companyId, campaign, CampaignStatus.depleted);
      return { ...d, spentTodayMinor: spentToday };
    }

    // Revive when funded again. A normal campaign only comes back from
    // `depleted`; an AUTO campaign is also pulled out of `paused` (24/7).
    const revivable =
      campaign.status === CampaignStatus.depleted ||
      (campaign.autoOptimize && campaign.status === CampaignStatus.paused);
    if (revivable && funded && budgetLeft) {
      const d = await this.setLive(companyId, campaign, CampaignStatus.active);
      return { ...d, spentTodayMinor: spentToday };
    }
    return { ...campaign, spentTodayMinor: spentToday };
  }

  /**
   * A visitor accessed the listing. Bills one `cpcMinor` from the owner's wallet
   * — at most once per (visitor, listing, UTC day) — while the campaign is
   * `active`. Everything is one transaction: the click row, the wallet debit and
   * the daily counter move together. Obvious bots and repeat visitors are
   * recorded but never charged; hitting the daily budget or an empty wallet
   * depletes the campaign (out of the feed) until it recovers.
   */
  async registerClick(
    companyId: string,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<ClickResult> {
    const day = utcDay();
    const visitorHash = visitorFingerprint(ip, userAgent, companyId, day);

    return this.prisma.$transaction(async (tx): Promise<ClickResult> => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { ownerUserId: true },
      });
      if (!company) return { billed: false, reason: 'no_campaign' };

      // First touch this day → create the row; a repeat collides on the unique
      // (company, visitor_hash) and is silently free.
      let clickId: string;
      try {
        const row = await tx.adClick.create({ data: { companyId, visitorHash } });
        clickId = row.id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return { billed: false, reason: 'repeat' };
        }
        throw e;
      }

      const free = async (reason: string): Promise<ClickResult> => {
        await tx.adClick.update({ where: { id: clickId }, data: { reason } });
        return { billed: false, reason };
      };

      if (isLikelyBot(userAgent)) return free('bot');

      const campaign = await tx.campaign.findUnique({ where: { companyId } });
      if (!campaign || campaign.status !== CampaignStatus.active) {
        return free('no_campaign');
      }

      const today = startOfUtcDay();
      const dayRolled = !campaign.spendDay || campaign.spendDay.getTime() !== today.getTime();
      const spentToday = dayRolled ? 0 : campaign.spentTodayMinor;

      if (spentToday + campaign.cpcMinor > campaign.dailyBudgetMinor) {
        await this.setDepletedWithin(tx, companyId, campaign);
        return free('budget');
      }

      const paid = await this.wallet.chargeClickWithin(
        tx,
        company.ownerUserId,
        campaign.cpcMinor,
        companyId,
        today,
      );
      if (!paid) {
        await this.setDepletedWithin(tx, companyId, campaign);
        return free('insufficient');
      }

      const newSpent = spentToday + campaign.cpcMinor;
      await tx.campaign.update({
        where: { id: campaign.id },
        data: { spentTodayMinor: newSpent, spendDay: today },
      });
      await tx.adClick.update({
        where: { id: clickId },
        data: { billed: true, costMinor: campaign.cpcMinor },
      });

      // This click may have used up the budget or the wallet — drop out now.
      if (
        newSpent + campaign.cpcMinor > campaign.dailyBudgetMinor ||
        paid.balanceMinor < campaign.cpcMinor
      ) {
        await this.setDepletedWithin(tx, companyId, campaign);
      }
      return { billed: true };
    });
  }

  /** Lifetime billed-click count for a listing. */
  private clickCount(companyId: string): Promise<number> {
    return this.prisma.adClick.count({ where: { companyId, billed: true } });
  }

  // --- API -----------------------------------------------------------

  /**
   * Rule-based tier suggestions for one company. The recommended CPC is set
   * above the highest CPC any *other* active campaign in the same category
   * group is bidding — the same market the Visibility Score's CPC reference
   * uses, so the recommendation and the score agree.
   */
  private async suggestFor(companyId: string): Promise<CampaignSuggestions> {
    const [location, marketMaxCpcMinor] = await Promise.all([
      this.prisma.companyLocation.findFirst({
        where: { companyId, isPrimary: true },
        select: { serviceRadiusKm: true },
      }),
      this.analytics.marketCpcFor(companyId),
    ]);
    return suggestCampaign({
      radiusKm: location?.serviceRadiusKm ?? null,
      marketMaxCpcMinor,
    });
  }

  async get(userId: string, companyId: string) {
    await this.memberRole(companyId, userId);
    return this.getFor(companyId);
  }

  /** The campaign editor payload, no membership check (platform-admin callers). */
  async getFor(companyId: string) {
    const campaign = await this.reconcile(companyId);
    const owner = await this.walletOwner(companyId);

    const [walletSummary, consumedMinor, clicks, s, marketCpcMinor, website] = await Promise.all([
      this.wallet.getSummary(owner),
      this.wallet.consumedByCompany(companyId),
      this.clickCount(companyId),
      this.suggestFor(companyId),
      this.analytics.marketCpcFor(companyId),
      this.prisma.website.findUnique({
        where: { companyId },
        select: { mode: true, builderSpec: true },
      }),
    ]);

    // An advanced-plan campaign can't go live until its builder is finished —
    // the UI disables Activate and points the owner to the builder.
    const requiresWebsiteBuilder =
      website?.mode === 'advanced' &&
      (website.builderSpec as { step?: string } | null)?.step !== 'done';

    const neededMinor = campaign?.dailyBudgetMinor ?? s.standard.dailyBudgetMinor;

    // AUTO can't reach a full CPC score with this budget — either the
    // score-maxing (recommended) CPC is over the 10% ceiling, or the daily
    // budget is below the score's adequacy reference. The UI nudges the owner
    // to raise it.
    const autoBudgetLimited =
      !!campaign?.autoOptimize &&
      (s.appearFirst.cpcMinor > autoBudgetCapMinor(campaign.dailyBudgetMinor) ||
        campaign.dailyBudgetMinor < DEFAULT_REFS.budgetRefMinor);

    return {
      campaign: campaign
        ? { ...this.view(campaign), consumed: money(consumedMinor), clicks }
        : null,
      suggestions: {
        standard: this.tierView(s.standard),
        appearFirst: this.tierView(s.appearFirst),
      },
      // Highest CPC a live rival in this category is bidding — what AUTO beats.
      marketCpc: money(marketCpcMinor),
      autoBudgetLimited,
      // The wallet is shared across every business the user owns. `currency` +
      // `eurRonRate` let the editor show credit amounts in the owner's chosen
      // currency (the admin panel shows the *owner's* currency, not the staff's).
      wallet: {
        balance: walletSummary.balance,
        currency: walletSummary.currency,
        eurRonRate: walletSummary.eurRonRate,
      },
      consumed: money(consumedMinor),
      required: money(neededMinor),
      canActivate: !!campaign && walletSummary.balance.minor >= campaign.dailyBudgetMinor,
      requiresWebsiteBuilder,
      runnable: campaign?.status === CampaignStatus.active,
    };
  }

  /**
   * "Optimise the campaign": read the live Visibility Score breakdown and turn
   * the weak sub-scores into an ordered list of concrete fixes (upgrade the
   * plan, answer leads faster, let it run longer, raise the budget/CPC), plus
   * the company's current feed position.
   */
  async optimization(userId: string, companyId: string) {
    await this.memberRole(companyId, userId);
    return this.optimizationFor(companyId);
  }

  /** The optimisation payload, no membership check (platform-admin callers). */
  async optimizationFor(companyId: string) {
    const campaign = await this.reconcile(companyId);

    const [analytics, s] = await Promise.all([
      this.analytics.companyAnalytics(companyId),
      this.suggestFor(companyId),
    ]);

    const findings = analyzeCampaign({
      parts: analytics.visibility.parts,
      weights: analytics.visibility.weights,
      planMode: analytics.planMode,
      activeDays: analytics.campaign.activeDays,
      ageFullDays: DEFAULT_REFS.ageFullDays,
      leadsTotal: analytics.response.total,
    });

    return {
      status: campaign?.status ?? null,
      rank: analytics.feedRank,
      visibility: analytics.visibility,
      response: analytics.response,
      activeDays: analytics.campaign.activeDays,
      ageFullDays: DEFAULT_REFS.ageFullDays,
      planMode: analytics.planMode,
      currentCpc: campaign ? money(campaign.cpcMinor) : null,
      currentDailyBudget: campaign ? money(campaign.dailyBudgetMinor) : null,
      recommended: {
        cpc: money(s.appearFirst.cpcMinor),
        dailyBudget: money(s.appearFirst.dailyBudgetMinor),
      },
      findings,
    };
  }

  /**
   * "Campaign spend": where the daily budget goes — today's burn and projected
   * exhaustion, the effective vs set CPC, wallet runway, the last two weeks of
   * daily spend/clicks, and how many clicks the dedupe / budget cap filtered
   * out. Rule-based insights on top.
   */
  async spendReport(userId: string, companyId: string) {
    await this.memberRole(companyId, userId);
    return this.spendReportFor(companyId);
  }

  /** The spend report, no membership check (platform-admin callers). */
  async spendReportFor(companyId: string) {
    const campaign = await this.reconcile(companyId);
    const owner = await this.walletOwner(companyId);
    const now = new Date();
    const dayStart = startOfUtcDay(now);
    const DAY_MS = 86_400_000;
    const SERIES_DAYS = 14;

    const [walletSummary, lifetimeConsumedMinor, lifetimeClicks, websiteReady, feedRank] =
      await Promise.all([
        this.wallet.getSummary(owner),
        this.wallet.consumedByCompany(companyId),
        this.prisma.adClick.count({ where: { companyId, billed: true } }),
        this.isListingWebsiteReady(companyId),
        this.analytics.feedRankFor(companyId),
      ]);
    const requiresWebsiteBuilder = !websiteReady;

    if (!campaign) {
      return {
        hasCampaign: false as const,
        status: null,
        autoOptimize: false,
        requiresWebsiteBuilder,
        canActivate: false,
        feedRank: null,
        now: now.toISOString(),
        cpcSet: money(0),
        dailyBudget: money(0),
        today: {
          spent: money(0),
          remaining: money(0),
          pct: 0,
          clicks: 0,
          cpcEffective: null,
          burnPerHour: money(0),
          hoursElapsed: 0,
          projectedExhaustAt: null,
          capHitAt: null,
          depleted: false,
        },
        lifetime: {
          consumed: money(lifetimeConsumedMinor),
          clicks: lifetimeClicks,
          cpcEffective: null,
          activeDays: 0,
          activeSeconds: 0,
          costPerActiveDay: null,
          clicksPerActiveDay: null,
        },
        runway: {
          walletBalance: walletSummary.balance,
          avgDailySpend: money(0),
          daysAtBudget: null,
          daysAtRecentPace: null,
        },
        clickQuality: {
          billed: 0,
          unbilled: 0,
          byReason: [] as Array<{ reason: string; count: number }>,
        },
        series: [] as Array<{ date: string; spent: number; clicks: number; capped: boolean }>,
        insights: [] as Array<{ key: string; value: number }>,
      };
    }

    const since = new Date(dayStart.getTime() - (SERIES_DAYS - 1) * DAY_MS);
    const q30Start = new Date(dayStart.getTime() - 29 * DAY_MS);

    // One per-day roll-up over 30 days — the 14-day series is a slice of it, the
    // 30-day click-quality aggregate folds the whole thing. `off` = clicks that
    // hit a non-running campaign (budget cap already spent, or paused/draft);
    // splitting those by "did the day also have billed clicks" tells cap-loss
    // apart from a campaign that was simply switched off.
    const [dailyRows, todayBilled] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          day: Date;
          billed: number;
          spent_minor: number;
          bot: number;
          off: number;
          broke: number;
        }>
      >(Prisma.sql`
        SELECT date_trunc('day', "created_at") AS day,
               count(*) FILTER (WHERE "billed")::int AS billed,
               COALESCE(SUM("cost_minor") FILTER (WHERE "billed"), 0)::int AS spent_minor,
               count(*) FILTER (WHERE NOT "billed" AND "reason" = 'bot')::int AS bot,
               count(*) FILTER (WHERE NOT "billed" AND "reason" IN ('no_campaign', 'budget'))::int AS off,
               count(*) FILTER (WHERE NOT "billed" AND "reason" = 'insufficient')::int AS broke
        FROM "ad_clicks"
        WHERE "company_id" = ${companyId}::uuid AND "created_at" >= ${q30Start}
        GROUP BY 1
      `),
      this.prisma.adClick.findMany({
        where: { companyId, billed: true, createdAt: { gte: dayStart } },
        select: { costMinor: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const rowByDay = new Map(dailyRows.map((r) => [new Date(r.day).toISOString().slice(0, 10), r]));

    // Dense 14-day series (a "capped" day ran and then got locked out on budget).
    const series: Array<{ date: string; spent: number; clicks: number; capped: boolean }> = [];
    const seriesMinor: number[] = [];
    for (let i = 0; i < SERIES_DAYS; i++) {
      const date = new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10);
      const row = rowByDay.get(date);
      const m = row?.spent_minor ?? 0;
      seriesMinor.push(m);
      series.push({
        date,
        spent: minorToCredits(m),
        clicks: row?.billed ?? 0,
        capped: !!row && row.billed > 0 && row.off > 0,
      });
    }

    // 30-day click quality.
    let qBilled = 0;
    let qBots = 0;
    let qBroke = 0;
    let qCapLost = 0;
    let qOffLost = 0;
    for (const r of rowByDay.values()) {
      qBilled += r.billed;
      qBots += r.bot;
      qBroke += r.broke;
      if (r.billed > 0) qCapLost += r.off;
      else qOffLost += r.off;
    }
    const byReason = [
      { reason: 'budget', count: qCapLost },
      { reason: 'off', count: qOffLost },
      { reason: 'bot', count: qBots },
      { reason: 'insufficient', count: qBroke },
    ]
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
    const unbilledQ = qBots + qBroke + qCapLost + qOffLost;

    // Today.
    const spentToday = campaign.spentTodayMinor;
    const budget = campaign.dailyBudgetMinor;
    const remaining = Math.max(0, budget - spentToday);
    const pct = budget > 0 ? Math.min(100, Math.round((spentToday / budget) * 100)) : 0;
    const clicksToday = todayBilled.length;
    const cpcEffTodayMinor = clicksToday > 0 ? Math.round(spentToday / clicksToday) : null;
    const hoursElapsed = Math.min(
      24,
      Math.max(0, (now.getTime() - dayStart.getTime()) / 3_600_000),
    );
    const burnPerHourMinor = hoursElapsed > 0.05 ? spentToday / hoursElapsed : 0;
    const depletedToday =
      campaign.status === CampaignStatus.depleted || remaining < campaign.cpcMinor;

    let capHitAt: string | null = null;
    let projectedExhaustAt: string | null = null;
    if (depletedToday && spentToday > 0) {
      let cum = 0;
      for (const c of todayBilled) {
        cum += c.costMinor;
        if (cum + campaign.cpcMinor > budget) {
          capHitAt = c.createdAt.toISOString();
          break;
        }
      }
      if (!capHitAt && todayBilled.length) {
        capHitAt = todayBilled[todayBilled.length - 1].createdAt.toISOString();
      }
    } else if (burnPerHourMinor > 0 && remaining > 0) {
      const hoursToExhaust = remaining / burnPerHourMinor;
      if (hoursElapsed + hoursToExhaust < 24) {
        projectedExhaustAt = new Date(now.getTime() + hoursToExhaust * 3_600_000).toISOString();
      }
    }

    // Lifetime economics.
    const activeSeconds = effectiveActiveSeconds(
      campaign.activeSecondsAccrued,
      campaign.activatedAt,
      campaign.status === CampaignStatus.active,
      now,
      campaign.pausedAt,
    );
    const activeDays = Math.floor(activeSeconds / 86_400);
    const cpcEffLifeMinor =
      lifetimeClicks > 0 ? Math.round(lifetimeConsumedMinor / lifetimeClicks) : null;
    const costPerActiveDayMinor =
      activeDays > 0 ? Math.round(lifetimeConsumedMinor / activeDays) : null;
    const clicksPerActiveDay =
      activeDays > 0 ? Math.round((lifetimeClicks / activeDays) * 10) / 10 : null;

    // Wallet runway. The "recent pace" averages over the days you actually
    // spent in the last week, not calendar days — a 2-day-old campaign
    // otherwise looks like it spends a seventh of what it really does.
    const last7 = seriesMinor.slice(-7);
    const daysWithSpend = last7.filter((m) => m > 0).length;
    const avgDailyMinor =
      daysWithSpend > 0 ? Math.round(last7.reduce((a, b) => a + b, 0) / daysWithSpend) : 0;
    const balMinor = walletSummary.balance.minor;
    const daysAtBudget = budget > 0 ? Math.round((balMinor / budget) * 10) / 10 : null;
    const daysAtRecentPace =
      avgDailyMinor > 0 ? Math.round((balMinor / avgDailyMinor) * 10) / 10 : null;

    // Insights.
    const insights: Array<{ key: string; value: number }> = [];
    if (qCapLost > 0) insights.push({ key: 'raise_budget', value: qCapLost });
    const runwayDays = daysAtRecentPace ?? daysAtBudget;
    if (campaign.status === CampaignStatus.active && runwayDays != null && runwayDays < 5) {
      insights.push({ key: 'low_runway', value: Math.max(0, Math.floor(runwayDays)) });
    }
    if (
      campaign.status === CampaignStatus.active &&
      activeDays >= 3 &&
      qCapLost === 0 &&
      avgDailyMinor > 0 &&
      budget > 0 &&
      avgDailyMinor < budget * 0.5
    ) {
      insights.push({ key: 'underspending', value: Math.round((avgDailyMinor / budget) * 100) });
    }

    return {
      hasCampaign: true as const,
      status: campaign.status,
      autoOptimize: campaign.autoOptimize,
      requiresWebsiteBuilder,
      // Matches the campaign editor's activation gate: a full day funded and,
      // for an advanced site, the builder finished.
      canActivate: walletSummary.balance.minor >= budget && !requiresWebsiteBuilder,
      feedRank,
      now: now.toISOString(),
      cpcSet: money(campaign.cpcMinor),
      dailyBudget: money(budget),
      today: {
        spent: money(spentToday),
        remaining: money(remaining),
        pct,
        clicks: clicksToday,
        cpcEffective: cpcEffTodayMinor != null ? money(cpcEffTodayMinor) : null,
        burnPerHour: money(Math.round(burnPerHourMinor)),
        hoursElapsed: Math.round(hoursElapsed * 10) / 10,
        projectedExhaustAt,
        capHitAt,
        depleted: depletedToday,
      },
      lifetime: {
        consumed: money(lifetimeConsumedMinor),
        clicks: lifetimeClicks,
        cpcEffective: cpcEffLifeMinor != null ? money(cpcEffLifeMinor) : null,
        activeDays,
        activeSeconds,
        costPerActiveDay: costPerActiveDayMinor != null ? money(costPerActiveDayMinor) : null,
        clicksPerActiveDay,
      },
      runway: {
        walletBalance: walletSummary.balance,
        avgDailySpend: money(avgDailyMinor),
        daysAtBudget,
        daysAtRecentPace,
      },
      clickQuality: { billed: qBilled, unbilled: unbilledQ, byReason },
      series,
      insights,
    };
  }

  async save(userId: string, companyId: string, dto: SaveCampaignDto) {
    await this.assertCanEdit(companyId, userId);
    return this.saveFor(companyId, dto);
  }

  /**
   * Delete the campaign outright. It first leaves the feed (company back to
   * draft, website unpublished) so nothing keeps serving, then the row is
   * removed. Clicks/spend history stay — they reference the company, not the
   * campaign.
   */
  async remove(userId: string, companyId: string): Promise<void> {
    await this.assertCanEdit(companyId, userId);
    const campaign = await this.prisma.campaign.findUnique({ where: { companyId } });
    if (!campaign) throw new NotFoundException('No campaign');

    await this.prisma.$transaction([
      this.prisma.company.update({
        where: { id: companyId },
        data: { status: 'draft', featured: false },
      }),
      this.prisma.website.updateMany({
        where: { companyId },
        data: { status: 'unpublished' },
      }),
      this.prisma.campaign.delete({ where: { id: campaign.id } }),
    ]);
  }

  /** Save the campaign numbers, no membership check (platform-admin callers). */
  async saveFor(companyId: string, dto: SaveCampaignDto) {
    const existing = await this.prisma.campaign.findUnique({ where: { companyId } });
    const auto = dto.autoOptimize ?? existing?.autoOptimize ?? false;

    const dailyBudgetMinor = creditsToMinor(dto.dailyBudget);
    let cpcMinor = creditsToMinor(dto.cpc);
    if (cpcMinor < 1) throw new BadRequestException('cpc must be at least 0.01 credits');
    if (cpcMinor > dailyBudgetMinor) {
      // In AUTO mode the CPC is managed by the platform — clamp instead of
      // rejecting; the owner only really controls the daily budget cap.
      if (auto) cpcMinor = dailyBudgetMinor;
      else throw new BadRequestException('cpc cannot exceed the daily budget');
    }
    if (!auto) {
      // Bidding above the recommended CPC buys no extra ranking — the CPC
      // sub-score is already maxed there and the feed sort ignores raw CPC
      // beyond the score. Trim it so the owner can't overpay for nothing.
      const recommendedCpcMinor = (await this.suggestFor(companyId)).appearFirst.cpcMinor;
      if (cpcMinor > recommendedCpcMinor) cpcMinor = recommendedCpcMinor;
    }

    const saved = await this.prisma.campaign.upsert({
      where: { companyId },
      create: {
        companyId,
        dailyBudgetMinor,
        cpcMinor,
        // AUTO always competes for the top slot.
        appearFirst: auto || (dto.appearFirst ?? false),
        autoOptimize: auto,
        status: CampaignStatus.draft,
      },
      update: {
        dailyBudgetMinor,
        cpcMinor,
        appearFirst: auto || (dto.appearFirst ?? existing?.appearFirst ?? false),
        autoOptimize: auto,
      },
    });

    // Any edit to a configured campaign takes it out of the feed until the owner
    // re-activates it — except an AUTO campaign, which is meant to keep running.
    if (existing && existing.status !== CampaignStatus.draft && !auto) {
      await this.setLive(companyId, saved, CampaignStatus.paused);
    }

    return this.getFor(companyId);
  }

  /**
   * A campaign may only be listed once the business has a real website. Easy-plan
   * sites are fully generated during onboarding, so they always pass; an
   * advanced-plan site is only ready once its paid builder has been run to
   * completion (`builderSpec.step === 'done'`) — otherwise the campaign would
   * publish an unbuilt starter page and pay for clicks to it.
   */
  async isListingWebsiteReady(companyId: string): Promise<boolean> {
    const website = await this.prisma.website.findUnique({
      where: { companyId },
      select: { mode: true, builderSpec: true },
    });
    if (!website || website.mode !== 'advanced') return true;
    const step = (website.builderSpec as { step?: string } | null)?.step;
    return step === 'done';
  }

  async activate(userId: string, companyId: string) {
    await this.assertCanEdit(companyId, userId);

    const [campaign, company] = await Promise.all([
      this.prisma.campaign.findUnique({ where: { companyId } }),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { status: true } }),
    ]);
    if (!campaign) throw new BadRequestException('set_budget_first');
    if (company?.status === 'suspended') throw new ForbiddenException('company_suspended');
    if (!(await this.isListingWebsiteReady(companyId))) {
      throw new BadRequestException('website_builder_incomplete');
    }
    const owner = await this.walletOwner(companyId);
    await this.wallet.assertSpendable(owner);
    if (!(await this.wallet.canAfford(owner, campaign.dailyBudgetMinor))) {
      throw new BadRequestException('insufficient_credits');
    }

    await this.setLive(companyId, campaign, CampaignStatus.active);
    return this.get(userId, companyId);
  }

  async pause(userId: string, companyId: string) {
    await this.assertCanEdit(companyId, userId);
    const campaign = await this.prisma.campaign.findUnique({ where: { companyId } });
    if (!campaign) throw new NotFoundException('No campaign');
    // Pausing turns AUTO off — otherwise reconcile would revive it immediately.
    if (campaign.autoOptimize) {
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: { autoOptimize: false },
      });
    }
    if (campaign.status === CampaignStatus.active || campaign.status === CampaignStatus.depleted) {
      await this.setLive(companyId, campaign, CampaignStatus.paused);
    }
    return this.get(userId, companyId);
  }

  /** Dashboard summary — caller has already checked membership. */
  async summaryFor(companyId: string) {
    const campaign = await this.reconcile(companyId);
    if (!campaign) return null;
    const [consumedMinor, clicks] = await Promise.all([
      this.wallet.consumedByCompany(companyId),
      this.clickCount(companyId),
    ]);
    return { ...this.view(campaign), consumed: money(consumedMinor), clicks };
  }

  // --- views --------------------------------------------------------

  private view(c: Campaign) {
    return {
      status: c.status,
      dailyBudget: money(c.dailyBudgetMinor),
      cpc: money(c.cpcMinor),
      appearFirst: c.appearFirst,
      autoOptimize: c.autoOptimize,
      spentToday: money(c.spentTodayMinor),
      activatedAt: c.activatedAt,
    };
  }

  private tierView(t: CampaignTier) {
    return { cpc: money(t.cpcMinor), dailyBudget: money(t.dailyBudgetMinor) };
  }
}
