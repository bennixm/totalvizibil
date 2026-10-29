import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Campaign, CampaignStatus, CompanyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppConfig } from '../config/env';
import { DEFAULT_REFS, RUN_SCORE_GRACE_MS, effectiveActiveSeconds } from '../analytics/visibility';
import {
  chargeMinor,
  cpcLocalMinor,
  FeedMarginConfig,
  feedCpcMinMinor,
  isEligibleForFeed,
  rankPeersByFeedScore,
} from '../analytics/feed-pricing';
import {
  FeedCompanyLike,
  FeedId,
  NATIONWIDE_FEED_COUNTY,
  SearchCountyMode,
  feedEligiblePeers,
  primaryFeedOf,
  resolveCompanyFeed,
} from '../analytics/feed-resolver';
import { creditsToMinor, minorToCredits, money } from '../wallet/money';
import { CampaignSuggestions, CampaignTier, suggestCampaign } from './campaign-advisor';
import { analyzeCampaign } from './campaign-optimizer';
import { autoBudgetCapMinor, autoResolvedCpcMinor } from './auto-cpc';
import { isLikelyBot, utcDay, visitorFingerprint } from './ad-click';
import { SaveCampaignDto } from './dto/save-campaign.dto';

/** Hint from the search that produced the impression — which Feed to price this click against. */
export interface ClickFeedHint {
  categorySlug?: string;
  county?: string;
}

const CAN_EDIT: CompanyRole[] = [CompanyRole.owner, CompanyRole.manager, CompanyRole.billing];

/** How often the day-rollover job runs — see `sweepDayRollover`. Hourly rather
 *  than once at UTC midnight: a single daily tick that happens to land during
 *  a deploy or a DB blip would cost every depleted campaign a full day in the
 *  feed, and the job is idempotent, so retrying it every hour costs nothing. */
const DAY_ROLLOVER_INTERVAL_MS = 60 * 60 * 1000;

/** Campaigns the revival job considers per tick. The WRITES are set-based
 *  regardless of this (see `sweepDayRollover`); this only bounds the candidate
 *  read and the wallet lookups behind it. */
const DAY_ROLLOVER_BATCH = 5_000;

/** Max elements in any `{ in: [...] }` list this job builds — Prisma emits one
 *  bind parameter per element and Postgres hard-caps a statement at 65,535. */
const IN_CHUNK = 1_000;

/** Midnight UTC of the given day — matches the `spend_day` DATE column. */
function startOfUtcDay(now = new Date()): Date {
  return new Date(`${utcDay(now)}T00:00:00.000Z`);
}

function chunked<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type ClickResult = { billed: boolean; reason?: string };

@Injectable()
export class CampaignService implements OnModuleInit {
  private readonly logger = new Logger(CampaignService.name);
  /** Re-entrancy guard for `sweepDayRollover` — same pattern as
   *  NotificationsSweepService's `sweeping`. */
  private rollingOver = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly analytics: AnalyticsService,
    private readonly affiliate: AffiliateService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Same plain-timer pattern as CompaniesService / NotificationsSweepService
   *  — no `@nestjs/schedule` anywhere in this app. Skipped under Jest so test
   *  runs don't pick up a background interval. */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.runDayRollover(), 90_000);
    setInterval(() => void this.runDayRollover(), DAY_ROLLOVER_INTERVAL_MS);
  }

  private async runDayRollover(): Promise<void> {
    if (this.rollingOver) return;
    this.rollingOver = true;
    try {
      await this.sweepDayRollover();
    } catch (err) {
      this.logger.error('Day-rollover sweep failed', err instanceof Error ? err.stack : err);
    } finally {
      this.rollingOver = false;
    }
  }

  /**
   * The scheduled counterpart of `reconcile`'s day-rollover branch — real
   * revenue was being lost without it.
   *
   * `reconcile()` resets `spentTodayMinor`/`spendDay` and revives a `depleted`
   * campaign at UTC day-rollover, but it is only ever called from OWNER-FACING
   * DASHBOARD READS. The public feed never calls it, and a depleted campaign
   * gets zero clicks by definition, so `registerClick` can't revive it either.
   * Net effect: a business owner who simply didn't open their dashboard the
   * next day stayed silently excluded from the feed indefinitely — funded,
   * believing they were running, invisible.
   *
   * Deliberately SET-BASED: a bounded candidate read, then a fixed handful of
   * `updateMany`s, never a per-row loop. The one thing that can't be expressed
   * as a pure `updateMany` is `reconcile`'s funded test, which compares the
   * campaign's `cpcMinor` against the OWNER'S WALLET balance — a cross-table
   * comparison Prisma's `updateMany` WHERE can't do. So the candidates are
   * read first (one query), their owners' wallets are read in chunks, the
   * funded/budget filter runs in memory, and every write after that is a
   * single set-based statement over an id list.
   *
   * Revival conditions mirror `reconcile()` exactly: `depleted`, wallet not
   * blocked and able to cover one click, today's budget able to cover one
   * click, and the company not pending deletion (`reconcile`'s own
   * defense-in-depth guard — a business mid-deletion must never come back to
   * life). `reconcile` does NOT re-check the Feed CPC minimum when reviving
   * from `depleted` (that branch only matches `active`), so neither does this.
   */
  private async sweepDayRollover(): Promise<void> {
    const today = startOfUtcDay();

    // 1. Day-counter reset, fully set-based. Only rows that actually carry
    //    spend from a previous day need touching; the `spentTodayMinor: 0`
    //    default state is already correct for everything else.
    const reset = await this.prisma.campaign.updateMany({
      where: {
        spentTodayMinor: { not: 0 },
        OR: [{ spendDay: null }, { spendDay: { lt: today } }],
      },
      data: { spentTodayMinor: 0, spendDay: today },
    });

    // 2. Revival candidates. `spentTodayMinor` is read AFTER the reset above,
    //    so `dailyBudgetMinor - spentTodayMinor` is already today's real
    //    remaining budget — the same number `reconcile` computes as
    //    `dayRolled ? 0 : campaign.spentTodayMinor`.
    const candidates = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.depleted,
        company: { deletionScheduledAt: null },
      },
      select: {
        id: true,
        companyId: true,
        cpcMinor: true,
        dailyBudgetMinor: true,
        spentTodayMinor: true,
        pausedAt: true,
        company: { select: { ownerUserId: true } },
      },
      orderBy: { id: 'asc' },
      take: DAY_ROLLOVER_BATCH,
    });
    if (!candidates.length) {
      if (reset.count > 0) this.logger.log(`Reset today's spend on ${reset.count} campaign(s)`);
      return;
    }

    // 3. Owners' wallets, chunked. Same funded test as `WalletService.canAfford`
    //    (not blocked, balance covers the amount) — inlined here because this
    //    needs it for thousands of owners as one set of reads, not one call
    //    per campaign.
    const ownerIds = [...new Set(candidates.map((c) => c.company.ownerUserId))];
    const balanceByOwner = new Map<string, number>();
    for (const ids of chunked(ownerIds)) {
      const wallets = await this.prisma.wallet.findMany({
        where: { userId: { in: ids }, blockedAt: null },
        select: { userId: true, balanceMinor: true },
      });
      for (const w of wallets) balanceByOwner.set(w.userId, w.balanceMinor);
    }

    const revivable = candidates.filter((c) => {
      const balance = balanceByOwner.get(c.company.ownerUserId);
      // No wallet row, or a blocked one (filtered out above) ⇒ not funded.
      if (balance === undefined) return false;
      if (balance < c.cpcMinor) return false;
      return c.dailyBudgetMinor - c.spentTodayMinor >= c.cpcMinor;
    });
    if (!revivable.length) {
      if (reset.count > 0) this.logger.log(`Reset today's spend on ${reset.count} campaign(s)`);
      return;
    }

    // 4. The revival writes — `setLive`'s effects, expressed set-based.
    //    `setLive` is per-row (it has a single Campaign in hand) and does one
    //    thing conditionally: a campaign stopped for longer than
    //    RUN_SCORE_GRACE_MS loses its banked run time so reactivation starts a
    //    fresh run, while one stopped for less keeps it. That single condition
    //    is the only reason this needs two campaign updates instead of one —
    //    split the ids by it, then one `updateMany` per side.
    const now = new Date();
    const graceCutoff = new Date(now.getTime() - RUN_SCORE_GRACE_MS);
    const freshRun = revivable.filter((c) => c.pausedAt && c.pausedAt < graceCutoff);
    const keepRun = revivable.filter((c) => !(c.pausedAt && c.pausedAt < graceCutoff));
    const companyIds = revivable.map((c) => c.companyId);

    for (const ids of chunked(freshRun.map((c) => c.id))) {
      await this.prisma.campaign.updateMany({
        where: { id: { in: ids } },
        data: {
          status: CampaignStatus.active,
          activatedAt: now,
          pausedAt: null,
          activeSecondsAccrued: 0,
        },
      });
    }
    for (const ids of chunked(keepRun.map((c) => c.id))) {
      await this.prisma.campaign.updateMany({
        where: { id: { in: ids } },
        data: { status: CampaignStatus.active, activatedAt: now, pausedAt: null },
      });
    }
    // The company + website halves of `setLive`'s "publish into the feed".
    // `claimedAt` is left alone: these companies were already claimed when
    // they first went live, and `setLive` only ever re-stamps it as a
    // side-effect of the same write.
    for (const ids of chunked(companyIds)) {
      await this.prisma.company.updateMany({
        where: { id: { in: ids } },
        data: { status: 'active', featured: true },
      });
      await this.prisma.website.updateMany({
        where: { companyId: { in: ids } },
        data: { status: 'published' },
      });
    }

    this.logger.log(
      `Day rollover: reset ${reset.count} campaign(s), revived ${revivable.length} depleted campaign(s)`,
    );
  }

  // --- membership -------------------------------------------------------

  private async memberRole(companyId: string, userId: string): Promise<CompanyRole> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') throw new NotFoundException('Company not found');
    return member.role;
  }

  /**
   * Shared entry gate for every campaign mutation (save/remove/activate/pause).
   * A business pending deletion is fully frozen — the owner must cancel the
   * deletion first before touching campaign/budget again, no partial actions
   * (even pausing) allowed in that state.
   */
  private async assertCanEdit(companyId: string, userId: string): Promise<void> {
    const role = await this.memberRole(companyId, userId);
    if (!CAN_EDIT.includes(role)) {
      throw new ForbiddenException('Your role cannot manage the campaign');
    }
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { deletionScheduledAt: true },
    });
    if (company?.deletionScheduledAt) throw new ForbiddenException('company_pending_deletion');
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
      const [s, cfg] = await Promise.all([
        this.suggestFor(companyId),
        this.analytics.marginConfig(),
      ]);
      const target = autoResolvedCpcMinor(
        s.appearFirst.cpcMinor,
        campaign.dailyBudgetMinor,
        feedCpcMinMinor(cfg),
      );
      if (target >= 1 && target !== campaign.cpcMinor) {
        campaign = await this.prisma.campaign.update({
          where: { id: campaign.id },
          data: { cpcMinor: target },
        });
      }
    }

    // A manual campaign whose CPC Maxim sits under the Feed's own CPC minim
    // can never be eligible for any Feed — never billed, never shown. This
    // self-heals any campaign that reached `active` before `activate()`/
    // `save()` started rejecting this (or whose floor rose later, via an
    // admin margin change) instead of leaving it stuck showing "Active" while
    // genuinely invisible. AUTO can't land here (see auto-cpc.ts).
    if (
      campaign.status === CampaignStatus.active &&
      !campaign.autoOptimize &&
      !isEligibleForFeed(campaign.cpcMinor, await this.analytics.marginConfig())
    ) {
      const d = await this.setLive(companyId, campaign, CampaignStatus.paused);
      // Already committed — a notification hiccup must never mask this. Only
      // fires on the active→paused transition itself (this branch can't
      // match again once `status` is no longer `active`), so a persistently
      // low CPC floor doesn't re-notify on every later reconcile() call.
      // Without this the owner had no way to learn WHY their campaign
      // stopped — e.g. after an admin raised the Feed's own CPC minim — short
      // of noticing `cpcBelowFeedMinimum` in the dashboard payload.
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { displayName: true },
      });
      if (company) {
        void this.notifications
          .notify({
            userId: owner,
            type: 'campaign_cpc_below_minimum',
            title: `Campania „${company.displayName}" s-a oprit — CPC Maxim e sub pragul minim`,
            body: `CPC Maxim al campaniei „${company.displayName}" a ajuns sub pragul minim al Feed-ului, așa că nu mai poate rula. Ridică CPC Maxim din panou ca să repornească.`,
            channels: { panel: true, email: true },
            data: { companyId },
          })
          .catch((err) =>
            this.logger.error(
              'Campaign-cpc-below-minimum notification failed',
              err instanceof Error ? err.stack : err,
            ),
          );
      }
      return { ...d, spentTodayMinor: spentToday };
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
      // Defense in depth: a company mid-deletion must never come back to
      // life from a background reconcile triggered by a mere read (e.g. an
      // admin opening its detail page, or the owner's own dashboard load).
      // `scheduleDeletion` already pauses the campaign and clears
      // `autoOptimize`, which is what normally keeps this branch from firing
      // — this is a second, independent guard in case that state is ever
      // reached some other way.
      const pending = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { deletionScheduledAt: true },
      });
      if (!pending?.deletionScheduledAt) {
        const d = await this.setLive(companyId, campaign, CampaignStatus.active);
        return { ...d, spentTodayMinor: spentToday };
      }
    }
    return { ...campaign, spentTodayMinor: spentToday };
  }

  /**
   * Resolve which atomic Feed (județ, subcategorie) a click is priced
   * against: the hinted leaf/county from the search that produced the
   * impression, validated against what the company actually competes in —
   * falling back to the company's own primary Feed when there's no hint, the
   * hint doesn't resolve to a real leaf, or the company doesn't compete there.
   */
  private async resolveClickFeed(
    tx: Prisma.TransactionClient,
    company: FeedCompanyLike,
    hint?: ClickFeedHint,
  ): Promise<FeedId | null> {
    if (hint?.categorySlug) {
      const leaf = await tx.category.findUnique({
        where: { slug: hint.categorySlug },
        select: { id: true, parentId: true },
      });
      if (leaf?.parentId) {
        const countyMode: SearchCountyMode = !hint.county
          ? { kind: 'any' }
          : hint.county === NATIONWIDE_FEED_COUNTY
            ? { kind: 'nationwideOnly' }
            : { kind: 'named', counties: [hint.county] };
        const resolved = resolveCompanyFeed(company, [leaf.id], countyMode);
        if (resolved) return resolved;
      }
    }
    return primaryFeedOf(company);
  }

  /**
   * A visitor accessed the listing. Bills one click from the owner's wallet —
   * at most once per (visitor, listing, UTC day) — while the campaign is
   * `active`. The amount charged is this click's CPC local in its atomic Feed
   * (CPC minim + Taxă poziție for the company's current position there),
   * never above the company's own CPC maxim (`chargeMinor`'s hard ceiling).
   * Everything is one transaction: the click row, the wallet debit and the
   * daily counter move together. Obvious bots and repeat visitors are
   * recorded but never charged; hitting the daily budget, an empty wallet, or
   * the Feed's CPC minim floor depletes/excludes the campaign until it
   * recovers.
   */
  async registerClick(
    companyId: string,
    ip: string | undefined,
    userAgent: string | undefined,
    feedHint?: ClickFeedHint,
  ): Promise<ClickResult> {
    const day = utcDay();
    const visitorHash = visitorFingerprint(ip, userAgent, companyId, day);
    const cfg = await this.analytics.marginConfig();

    return this.prisma.$transaction(async (tx): Promise<ClickResult> => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: {
          ownerUserId: true,
          categoryAssignments: { select: { categoryId: true, isPrimary: true, createdAt: true } },
          locations: {
            select: { county: true, nationwide: true, isPrimary: true, createdAt: true },
          },
        },
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

      if (!isEligibleForFeed(campaign.cpcMinor, cfg)) {
        return free('below_minimum');
      }
      const feedId = await this.resolveClickFeed(tx, company, feedHint);
      if (!feedId) return free('no_feed');

      const peers = await feedEligiblePeers(tx, feedId, cfg);
      if (!peers.some((p) => p.companyId === companyId)) {
        return free('below_minimum');
      }
      const maxBidMinor = peers.reduce((mx, p) => Math.max(mx, p.cpcMinor), 0);
      const peerIds = peers.map((p) => p.companyId);
      const [vinputs, boosted] = await Promise.all([
        this.analytics.visibilityInputsFor(peerIds),
        tx.campaign.findMany({
          where: { companyId: { in: peerIds }, status: CampaignStatus.active, appearFirst: true },
          select: { companyId: true },
        }),
      ]);
      const boostSet = new Set(boosted.map((b) => b.companyId));
      const ranked = rankPeersByFeedScore(peerIds, vinputs, maxBidMinor, boostSet);
      const position = ranked.findIndex((r) => r.companyId === companyId) + 1;
      const cpcLocal = cpcLocalMinor(position, peers.length, cfg);
      const cpc = chargeMinor(campaign.cpcMinor, cpcLocal);

      const today = startOfUtcDay();

      // Reserve today's budget for this click with a single atomic UPDATE —
      // the day-roll check, the "is there still room" check and the spend
      // increment all happen in the same statement Postgres evaluates under
      // the row's write lock. Two clicks landing on the same company at the
      // same instant used to each read the same `spentTodayMinor`, both pass
      // the budget check in JS, then overwrite (not add to) each other's
      // write — silently losing one click's contribution and letting the
      // campaign bill past its daily cap. This can't happen here: whichever
      // transaction commits second re-evaluates the WHERE clause against the
      // already-updated row, so it correctly sees less (or no) room left.
      const reserved = await tx.$queryRaw<{ spentTodayMinor: number }[]>`
        UPDATE campaigns
        SET spent_today_minor = CASE WHEN spend_day = ${today}::date
              THEN spent_today_minor + ${cpc}
              ELSE ${cpc}
            END,
            spend_day = ${today}::date
        WHERE id = ${campaign.id}::uuid
          AND (CASE WHEN spend_day = ${today}::date THEN spent_today_minor ELSE 0 END) + ${cpc}
              <= daily_budget_minor
        RETURNING spent_today_minor AS "spentTodayMinor"
      `;
      if (reserved.length === 0) {
        await this.setDepletedWithin(tx, companyId, campaign);
        return free('budget');
      }

      const paid = await this.wallet.chargeClickWithin(
        tx,
        company.ownerUserId,
        cpc,
        companyId,
        today,
      );
      if (!paid) {
        // The wallet couldn't cover it — release the budget slot reserved
        // above so it isn't silently lost from the day's remaining room.
        await tx.campaign.update({
          where: { id: campaign.id },
          data: { spentTodayMinor: { decrement: cpc } },
        });
        await this.setDepletedWithin(tx, companyId, campaign);
        return free('insufficient');
      }

      await tx.adClick.update({
        where: { id: clickId },
        data: {
          billed: true,
          costMinor: cpc,
          feedCounty: feedId.county,
          feedCategoryId: feedId.leafId,
        },
      });

      // This click may have used up the budget or the wallet — drop out now.
      const newSpent = reserved[0].spentTodayMinor;
      if (newSpent + cpc > campaign.dailyBudgetMinor || paid.balanceMinor < cpc) {
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
   * Rule-based tier suggestions for one company. `standard` is the CPC minim
   * (costPromovare + marjă profit) — the lowest CPC Maxim that still clears
   * every Feed's eligibility floor. `appearFirst` is the re-adapted "CPC
   * maxim recomandat": the max, across every Feed the company is eligible in,
   * of the CPC local a position-1 slot there would ask for — falling back to
   * `suggestCampaign()`'s flat market heuristic only when the company has no
   * resolvable Feed yet (no category/location set).
   */
  private async suggestFor(companyId: string): Promise<CampaignSuggestions> {
    const [marketMaxCpcMinor, recommended, cfg] = await Promise.all([
      this.analytics.marketCpcFor(companyId),
      this.analytics.recommendedCpcFor(companyId),
      this.analytics.marginConfig(),
    ]);
    const fallback = suggestCampaign({ marketMaxCpcMinor, cpcMinMinor: feedCpcMinMinor(cfg) });
    return { standard: fallback.standard, appearFirst: recommended ?? fallback.appearFirst };
  }

  async get(userId: string, companyId: string) {
    await this.memberRole(companyId, userId);
    return this.getFor(companyId);
  }

  /** The campaign editor payload, no membership check (platform-admin callers). */
  async getFor(companyId: string) {
    const campaign = await this.reconcile(companyId);
    const owner = await this.walletOwner(companyId);

    const [walletSummary, consumedMinor, clicks, s, marketCpcMinor, websiteReady, cfg] =
      await Promise.all([
        this.wallet.getSummary(owner),
        this.wallet.consumedByCompany(companyId),
        this.clickCount(companyId),
        this.suggestFor(companyId),
        this.analytics.marketCpcFor(companyId),
        this.isListingWebsiteReady(companyId),
        this.analytics.marginConfig(),
      ]);

    // An advanced-plan campaign can't go live until its builder is finished —
    // the UI disables Activate and points the owner to the builder.
    const requiresWebsiteBuilder = !websiteReady;

    const neededMinor = campaign?.dailyBudgetMinor ?? s.standard.dailyBudgetMinor;

    // AUTO can't reach a full CPC score with this budget — either the
    // score-maxing (recommended) CPC is over the 10% ceiling, or the daily
    // budget is below the score's adequacy reference. The UI nudges the owner
    // to raise it.
    const autoBudgetLimited =
      !!campaign?.autoOptimize &&
      (s.appearFirst.cpcMinor >
        autoBudgetCapMinor(campaign.dailyBudgetMinor, feedCpcMinMinor(cfg)) ||
        campaign.dailyBudgetMinor < DEFAULT_REFS.budgetRefMinor);

    return {
      campaign: campaign
        ? { ...this.view(campaign, cfg), consumed: money(consumedMinor), clicks }
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
      canActivate:
        !!campaign &&
        walletSummary.balance.minor >= campaign.dailyBudgetMinor &&
        !requiresWebsiteBuilder,
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
   * Lifetime spend broken down by atomic Feed (județ + subcategorie) — which
   * search each billed click actually came from. A company competing on
   * several Feeds simultaneously gets one row per Feed instead of one opaque
   * lump sum, each with its own real average CPC (`cpcEffective`), which can
   * legitimately differ Feed to Feed since the position/CPC-local schedule is
   * local to each one.
   */
  private async spendByFeedFor(companyId: string): Promise<
    Array<{
      county: string;
      categorySlug: string;
      categoryName: Prisma.JsonValue;
      clicks: number;
      spent: ReturnType<typeof money>;
      cpcEffective: ReturnType<typeof money> | null;
    }>
  > {
    const rows = await this.prisma.adClick.groupBy({
      by: ['feedCounty', 'feedCategoryId'],
      where: { companyId, billed: true, feedCounty: { not: null }, feedCategoryId: { not: null } },
      _sum: { costMinor: true },
      _count: { _all: true },
    });
    if (!rows.length) return [];

    const catIds = Array.from(
      new Set(rows.map((r) => r.feedCategoryId).filter((id): id is string => !!id)),
    );
    const categories = await this.prisma.category.findMany({
      where: { id: { in: catIds } },
      select: { id: true, slug: true, nameI18n: true },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    return rows
      .map((r) => {
        const spentMinor = r._sum.costMinor ?? 0;
        const clicks = r._count._all;
        const cat = r.feedCategoryId ? categoryById.get(r.feedCategoryId) : undefined;
        return {
          county: r.feedCounty!,
          categorySlug: cat?.slug ?? '',
          categoryName: cat?.nameI18n ?? null,
          clicks,
          spent: money(spentMinor),
          cpcEffective: clicks > 0 ? money(Math.round(spentMinor / clicks)) : null,
        };
      })
      .sort((a, b) => b.spent.minor - a.spent.minor);
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

    const [
      walletSummary,
      lifetimeConsumedMinor,
      lifetimeClicks,
      websiteReady,
      feedRanks,
      byFeed,
      s,
      cfg,
    ] = await Promise.all([
      this.wallet.getSummary(owner),
      this.wallet.consumedByCompany(companyId),
      this.prisma.adClick.count({ where: { companyId, billed: true } }),
      this.isListingWebsiteReady(companyId),
      this.analytics.feedRanksFor(companyId),
      this.spendByFeedFor(companyId),
      this.suggestFor(companyId),
      this.analytics.marginConfig(),
    ]);
    const requiresWebsiteBuilder = !websiteReady;
    // Not #1 in at least one Feed the company competes in, AND raising CPC
    // Maxim to the recommended number would actually still change that —
    // the campaign panel surfaces this as a single alert (no per-Feed list)
    // suggesting exactly that raise. Real rank also weighs budget adequacy,
    // response/plan/age score and rivals' own "appear first" boost, none of
    // which this CPC-only recommendation can fix — so once the saved CPC
    // already meets or exceeds it (or AUTO already manages CPC on its own),
    // the gap isn't a CPC problem any more and the alert would just be
    // suggesting the owner "raise" CPC to the number it's already at.
    const needsPositionUpgrade =
      !!campaign &&
      !campaign.autoOptimize &&
      campaign.cpcMinor < s.appearFirst.cpcMinor &&
      feedRanks.some((r) => r.position !== 1);
    const recommendedCpc = money(s.appearFirst.cpcMinor);
    // A manual CPC Maxim under the Feed's own CPC minim — reconcile() above
    // already demotes an active campaign like this to `paused`, but the panel
    // still needs to say WHY it's paused, distinctly from a manual stop.
    const cpcBelowFeedMinimum =
      !!campaign && !campaign.autoOptimize && !isEligibleForFeed(campaign.cpcMinor, cfg);

    if (!campaign) {
      return {
        hasCampaign: false as const,
        status: null,
        autoOptimize: false,
        requiresWebsiteBuilder,
        canActivate: false,
        feedRanks,
        byFeed,
        needsPositionUpgrade,
        recommendedCpc,
        cpcBelowFeedMinimum,
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
               count(*) FILTER (WHERE NOT "billed" AND "reason" IN
                 ('no_campaign', 'budget', 'no_feed', 'below_minimum'))::int AS off,
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
      feedRanks,
      byFeed,
      needsPositionUpgrade,
      recommendedCpc,
      cpcBelowFeedMinimum,
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
    return this.saveFor(companyId, dto, 'owner');
  }

  /**
   * Delete the campaign outright. It first leaves the feed (company back to
   * draft, website unpublished) so nothing keeps serving, then the row is
   * removed. Clicks/spend history stay — they reference the company, not the
   * campaign.
   */
  async remove(userId: string, companyId: string): Promise<void> {
    await this.assertCanEdit(companyId, userId);
    const [campaign, company] = await Promise.all([
      this.prisma.campaign.findUnique({ where: { companyId } }),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { status: true } }),
    ]);
    if (!campaign) throw new NotFoundException('No campaign');

    await this.prisma.$transaction([
      this.prisma.company.update({
        where: { id: companyId },
        // Never silently lift a `suspended` status by routing it back to
        // `draft` — deleting the campaign just means there's nothing left
        // to activate, not that the business is cleared to republish.
        data:
          company?.status === 'suspended'
            ? { featured: false }
            : { status: 'draft', featured: false },
      }),
      this.prisma.website.updateMany({
        where: { companyId },
        data: { status: 'unpublished' },
      }),
      this.prisma.campaign.delete({ where: { id: campaign.id } }),
    ]);
  }

  /** Save the campaign numbers. `actor` is 'owner' for the owner's own
   *  membership-checked `save()` above, or 'admin' for the platform-admin
   *  panel (no membership check there) — only affects the pause-on-edit
   *  notification's wording/channel below. */
  async saveFor(companyId: string, dto: SaveCampaignDto, actor: 'owner' | 'admin' = 'owner') {
    const existing = await this.prisma.campaign.findUnique({ where: { companyId } });
    // Optimistic concurrency: the admin panel hydrates once on page load,
    // so a concurrent edit by the owner (or another admin) would otherwise
    // be silently overwritten with no warning. The owner's own `save()`
    // never sends this — only they ever edit their own campaign.
    if (dto.expectedUpdatedAt && existing) {
      const expected = new Date(dto.expectedUpdatedAt).getTime();
      if (expected !== existing.updatedAt.getTime()) {
        throw new BadRequestException('campaign_changed_since_loaded');
      }
    }
    const auto = dto.autoOptimize ?? existing?.autoOptimize ?? false;

    const dailyBudgetMinor = creditsToMinor(dto.dailyBudget);
    let cpcMinor = creditsToMinor(dto.cpc);
    if (cpcMinor < 1) throw new BadRequestException('cpc must be at least 0.01 credits');
    // Below the Feed's own CPC minim, the campaign is ineligible for every
    // Feed it would otherwise compete in — never billed, never shown — no
    // matter how "active" it looks in the panel. Reject it outright for a
    // manual CPC (the owner picked this number on purpose); AUTO already
    // clamps its own CPC above this floor (see auto-cpc.ts), so it can only
    // ever land here via the daily-budget clamp below, which is fine.
    const floorMinor = feedCpcMinMinor(await this.analytics.marginConfig());
    if (cpcMinor < floorMinor && !auto) {
      throw new BadRequestException('cpc_below_feed_minimum');
    }
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
      const wasLive =
        existing.status === CampaignStatus.active || existing.status === CampaignStatus.depleted;
      await this.setLive(companyId, saved, CampaignStatus.paused);
      if (wasLive) {
        // Already committed — a notification hiccup must never mask this.
        // The owner editing their OWN campaign gets a quiet panel entry —
        // not an alarming email for something they just did themselves.
        // An ADMIN editing it is a surprise to the owner (they didn't touch
        // anything), so that case gets the clearer, emailed variant —
        // matching how admin suspend/reactivate already notify.
        const company = await this.prisma.company.findUnique({
          where: { id: companyId },
          select: { displayName: true, ownerUserId: true },
        });
        if (company) {
          const adminInitiated = actor === 'admin';
          void this.notifications
            .notify({
              userId: company.ownerUserId,
              type: adminInitiated ? 'campaign_paused_by_admin' : 'campaign_paused_on_edit',
              title: `Campania „${company.displayName}" a fost pusă pe pauză`,
              body: adminInitiated
                ? `„${company.displayName}" nu mai apare în feed. Un administrator a modificat bugetul/CPC-ul campaniei — nu consumă buget cât e pe pauză. O poți reactiva din panou.`
                : 'Editarea bugetului/CPC-ului a scos campania din feed — nu consumă buget cât e pe pauză. Reactiveaz-o din panou când ești gata.',
              channels: adminInitiated ? { panel: true, email: true } : { panel: true },
              data: { companyId },
              ...(adminInitiated
                ? {
                    email: {
                      details: [{ label: 'Afacere', value: company.displayName }],
                      cta: {
                        label: 'Contactează suportul',
                        url: `${this.config.get('frontendOrigin', { infer: true })}/support`,
                      },
                    },
                  }
                : {}),
            })
            .catch((err) =>
              this.logger.error(
                'Campaign-paused-on-edit notification failed',
                err instanceof Error ? err.stack : err,
              ),
            );
        }
      }
    }

    return this.getFor(companyId);
  }

  /**
   * A campaign may only be listed once the business has a real website.
   * Easy-plan sites are fully generated during onboarding, so they always pass.
   *
   * A Website Builder site (PRO V2, still stored as `mode: 'advanced'`
   * internally) is ready only once it has actually been PUBLISHED from the
   * builder — i.e. `Website.publishedAt` is set, which only
   * `ProV2Service.publishBundle` ever does.
   *
   * This used to test `content.pages.length > 0` instead, which was dead on
   * arrival: `CompaniesService.createFromDraft` seeds EVERY new website —
   * advanced ones included — with the onboarding draft's placeholder page
   * content, so that was true from the moment the company row existed and the
   * "finish your builder first" nudge could never fire. The only way it
   * returned false was a company with no website row at all, which no
   * frontend path creates. An advanced business could therefore activate a
   * campaign and go live in the feed showing nothing but onboarding
   * placeholder text — and `PublicCompanyService.bundleFile` would 404 for
   * the real page, because a bundle is exactly what it never published.
   */
  async isListingWebsiteReady(companyId: string): Promise<boolean> {
    const website = await this.prisma.website.findUnique({
      where: { companyId },
      select: { mode: true, publishedAt: true },
    });
    // No website at all → not ready (a company must have a site to be listed).
    if (!website) return false;
    if (website.mode !== 'advanced') return true;

    return website.publishedAt != null;
  }

  async activate(userId: string, companyId: string) {
    await this.assertCanEdit(companyId, userId);

    const [campaign, company] = await Promise.all([
      this.prisma.campaign.findUnique({ where: { companyId } }),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { status: true, displayName: true },
      }),
    ]);
    if (!campaign) throw new BadRequestException('set_budget_first');
    if (company?.status === 'suspended') throw new ForbiddenException('company_suspended');
    if (!(await this.isListingWebsiteReady(companyId))) {
      throw new BadRequestException('website_builder_incomplete');
    }
    // A manual CPC Maxim under the Feed's own CPC minim is ineligible for
    // every Feed — activating it would show "Active" while the business never
    // actually appears anywhere. AUTO can't land here (see auto-cpc.ts).
    if (
      !campaign.autoOptimize &&
      !isEligibleForFeed(campaign.cpcMinor, await this.analytics.marginConfig())
    ) {
      throw new BadRequestException('cpc_below_feed_minimum');
    }
    const owner = await this.walletOwner(companyId);
    await this.wallet.assertSpendable(owner);
    if (!(await this.wallet.canAfford(owner, campaign.dailyBudgetMinor))) {
      throw new BadRequestException('insufficient_credits');
    }

    const firstEverActivation = !campaign.activatedAt;
    await this.setLive(companyId, campaign, CampaignStatus.active);

    // If this owner was brought in through the affiliate program and has funded
    // their account, their referrer earns the reward now. Fire-and-forget — a
    // reward failure must never block the activation.
    void this.affiliate.maybeReward(owner);

    if (firstEverActivation && company) {
      // Already committed — a notification hiccup must never mask this.
      // A one-time "you're live" moment, not repeated on later re-activations.
      void this.notifications
        .notify({
          userId: owner,
          type: 'campaign_activated',
          title: `Campania „${company.displayName}" este acum live`,
          body: `Afacerea „${company.displayName}" a apărut în feed — campania ta rulează acum.`,
          channels: { panel: true },
          data: { companyId },
        })
        .catch((err) =>
          this.logger.error(
            'Campaign-activated notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );
    }

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
    const [consumedMinor, clicks, cfg] = await Promise.all([
      this.wallet.consumedByCompany(companyId),
      this.clickCount(companyId),
      this.analytics.marginConfig(),
    ]);
    return { ...this.view(campaign, cfg), consumed: money(consumedMinor), clicks };
  }

  // --- views --------------------------------------------------------

  private view(c: Campaign, cfg: FeedMarginConfig) {
    return {
      status: c.status,
      dailyBudget: money(c.dailyBudgetMinor),
      cpc: money(c.cpcMinor),
      appearFirst: c.appearFirst,
      autoOptimize: c.autoOptimize,
      spentToday: money(c.spentTodayMinor),
      activatedAt: c.activatedAt,
      // Round-tripped by the admin panel's save as `expectedUpdatedAt` — lets
      // `saveFor` detect a concurrent edit (by the owner, or another admin)
      // since this was hydrated, instead of silently overwriting it.
      updatedAt: c.updatedAt,
      // Lets the panel tell "paused because the owner stopped it" apart from
      // "paused because CPC Maxim fell under a Feed's own minimum" (reconcile
      // demotes the latter automatically — see its own comment) — a manual
      // pause with no fix needed vs. one specific, actionable problem.
      cpcBelowFeedMinimum: !c.autoOptimize && !isEligibleForFeed(c.cpcMinor, cfg),
    };
  }

  private tierView(t: CampaignTier) {
    return { cpc: money(t.cpcMinor), dailyBudget: money(t.dailyBudgetMinor) };
  }
}
