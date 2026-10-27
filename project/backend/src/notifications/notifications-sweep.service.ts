import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CampaignStatus, LeadStatus, SupportTicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { utcDay } from '../campaigns/ad-click';
import { AnalyticsService } from '../analytics/analytics.service';
import { minorToCredits } from '../wallet/money';
import { NotificationsService } from './notifications.service';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Don't re-notify the same low balance more than once a day. */
const LOW_BALANCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Don't re-notify the same "you could reach #1" condition more than once a day. */
const POSITION_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** A lead sitting unanswered this long gets one stale-lead digest a day. */
const STALE_LEAD_AFTER_MS = 48 * 60 * 60 * 1000;
/** A support ticket with no movement this long gets one nudge a day. */
const STALE_TICKET_AFTER_MS = 24 * 60 * 60 * 1000;

/** Max elements in any `{ in: [...] }` list this service builds. Prisma turns
 *  an `in` list into one bind parameter per element and does no chunking of
 *  its own; Postgres hard-caps a statement at 65,535 bind parameters. Past
 *  that the query doesn't degrade, it fails — and since each sub-sweep's
 *  failure is swallowed into a log line by `sweep()`, a platform-wide outage
 *  of these notifications would be completely silent. Everything that builds
 *  an id list here goes through `chunked()` below. */
const IN_CHUNK = 1_000;

/** Campaigns examined by the feed-position sub-sweep per tick. That sub-sweep
 *  runs two full analytics queries PER campaign (each of which fans out over
 *  every peer in every Feed the company competes in), so it is by far the most
 *  expensive thing in this file — it has to be a bounded slice with a cursor
 *  carried across ticks, not the full active set. */
const FEED_POSITION_BATCH = 500;

function chunked<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** UTC midnight of "today" — the same day-bucket key `spendDay` already uses
 *  elsewhere (ad-click.ts's `utcDay()`), reused here for every sweep's
 *  once-a-day dedup cooldown so they all key off one consistent day boundary. */
function utcMidnight(): Date {
  return new Date(`${utcDay()}T00:00:00.000Z`);
}

/**
 * Turns the campaign-health conditions already surfaced on the dashboard
 * (see DashboardView.vue's `campaignAlerts`) into real notifications. Scoped
 * to the two that are genuinely operational, state-machine-driven events —
 * the daily budget running out, and the wallet no longer able to cover the
 * next day's spend across a user's active campaigns. The softer "coaching"
 * alerts (visibility score, CPC competitiveness, response time) stay
 * dashboard-only: turning those into notifications too would mean
 * replicating the full analytics engine in a background job, a separate
 * undertaking from the notification system itself.
 *
 * No cron dependency — same plain-timer pattern as
 * CompaniesService.sweepStaleDrafts and WalletService.sweepDueRefunds.
 */
@Injectable()
export class NotificationsSweepService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsSweepService.name);
  /** Re-entrancy guard — see the comment on `sweep()` below. */
  private sweeping = false;
  /** Independent guard for the depleted-campaign sweep — see `onModuleInit`. */
  private sweepingDepleted = false;
  /** Independent guard for the support-ticket sweep — see `onModuleInit`. */
  private sweepingTickets = false;
  /** Cursor for the feed-position sub-sweep's bounded slice (campaign id of
   *  the last row processed last tick; null = start from the beginning). */
  private feedPositionCursor: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * THREE independent timers, not one.
   *
   * All four original sub-sweeps used to run sequentially behind a single
   * re-entrancy guard. The depleted-campaign one awaits a real SMTP send per
   * row; at a realistic few-thousand-depletions-a-day it can run for tens of
   * minutes, and for that entire time the guard — working exactly as designed
   * — kept low-balance, feed-position and stale-lead from running at all.
   * Silent starvation, not a crash, and invisible in the logs. So the
   * SMTP-bound sweep gets its own timer and its own guard: a slow run of it
   * can no longer block anything else, and vice versa.
   *
   * The new support-ticket sweep is split out for the same reason (its
   * escalation leg emails every admin), and the remaining three — all
   * DB-bound, none of them slow — keep sharing `sweep()`.
   *
   * Start delays are staggered so a cold boot doesn't fire all three at once.
   */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.sweep(), 120_000);
    setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    setTimeout(() => void this.runDepletedCampaignsSweep(), 150_000);
    setInterval(() => void this.runDepletedCampaignsSweep(), SWEEP_INTERVAL_MS);
    setTimeout(() => void this.runStaleTicketsSweep(), 180_000);
    setInterval(() => void this.runStaleTicketsSweep(), SWEEP_INTERVAL_MS);
  }

  private async sweep(): Promise<void> {
    // The feed-position sweep runs two analytics queries per active
    // campaign — at scale a single tick can run long enough to still be
    // going when the next one is due. Without this guard, ticks would stack
    // without bound instead of the next one just waiting its turn.
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.sweepLowBalances().catch((err) => {
        this.logger.error('Low-balance sweep failed', err instanceof Error ? err.stack : err);
      });
      await this.sweepFeedPositionUpgrades().catch((err) => {
        this.logger.error('Feed-position sweep failed', err instanceof Error ? err.stack : err);
      });
      await this.sweepStaleLeads().catch((err) => {
        this.logger.error('Stale-lead sweep failed', err instanceof Error ? err.stack : err);
      });
    } finally {
      this.sweeping = false;
    }
  }

  /** The SMTP-bound sweep on its own timer + guard — see `onModuleInit`. */
  private async runDepletedCampaignsSweep(): Promise<void> {
    if (this.sweepingDepleted) return;
    this.sweepingDepleted = true;
    try {
      await this.sweepDepletedCampaigns();
    } catch (err) {
      this.logger.error('Depleted-campaign sweep failed', err instanceof Error ? err.stack : err);
    } finally {
      this.sweepingDepleted = false;
    }
  }

  /** The support-ticket sweep on its own timer + guard — see `onModuleInit`. */
  private async runStaleTicketsSweep(): Promise<void> {
    if (this.sweepingTickets) return;
    this.sweepingTickets = true;
    try {
      await this.sweepStaleTickets();
    } catch (err) {
      this.logger.error('Stale-ticket sweep failed', err instanceof Error ? err.stack : err);
    } finally {
      this.sweepingTickets = false;
    }
  }

  private async sweepDepletedCampaigns(): Promise<void> {
    // Keyed on the `depleted` STATUS itself, not on `spendDay` — that column
    // only updates when a click actually bills today, so a campaign that
    // depleted because a DIFFERENT business drained the shared wallet (its
    // own `spendDay` never touched today), or one that crossed into
    // `depleted` in the last stretch of the UTC day just before this sweep's
    // next tick rolls `today` over, used to be skipped forever — `spendDay`
    // simply never matched `today` for either case.
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.depleted,
        OR: [{ depletedNotifiedForDay: null }, { depletedNotifiedForDay: { lt: utcMidnight() } }],
      },
      include: { company: { select: { id: true, displayName: true, ownerUserId: true } } },
    });

    let notified = 0;
    for (const c of campaigns) {
      // One campaign's failure (a bad notify call, a transient DB hiccup)
      // must not stop the rest of this batch from being notified — each
      // gets its own error boundary rather than aborting the whole loop.
      try {
        // Claim the day's notification slot FIRST, with an atomic conditional
        // UPDATE — not a plain read-then-write — before calling notify(). If
        // this were ordered the other way (notify, then flag), a process
        // restart landing between the two (a deploy, for instance — this app
        // redeploys often) would leave the flag unset despite the email/panel
        // row already being sent, and the NEXT sweep tick would notify the
        // same campaign again. Claiming first means the worst case is the
        // opposite — a silent skip on a rare mid-flight DB hiccup — which is
        // the safe direction to fail in for a user-visible notification.
        // `updateMany`'s WHERE re-checks the same condition the outer SELECT
        // used, so two overlapping sweeps can't both claim the same campaign.
        //
        // IMPORTANT: this used to be `NOT: { depletedNotifiedForDay: today } }`
        // — under SQL's three-valued logic, `NOT (NULL = x)` is NULL, not
        // TRUE, so every campaign (the column starts NULL for all of them,
        // and this method was the only writer) was silently excluded. This
        // notification had never fired for anyone. The null-inclusive `OR`
        // form below is the fix — the other two sweeps in this file already
        // used it correctly, which is how the bug was spotted.
        const today = utcMidnight();
        const claimed = await this.prisma.campaign.updateMany({
          where: {
            id: c.id,
            OR: [{ depletedNotifiedForDay: null }, { depletedNotifiedForDay: { lt: today } }],
          },
          data: { depletedNotifiedForDay: today },
        });
        if (claimed.count === 0) continue;

        await this.notifications.notify({
          userId: c.company.ownerUserId,
          type: 'campaign_depleted',
          title: `Bugetul zilnic pentru ${c.company.displayName} s-a epuizat`,
          body: `Anunțul nu mai apare în feed pentru "${c.company.displayName}" până mâine — bugetul zilnic a fost consumat integral.`,
          channels: { panel: true, email: true },
          data: { companyId: c.company.id },
        });
        notified++;
      } catch (err) {
        this.logger.error(
          `Depleted-campaign notification failed for campaign ${c.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    if (notified > 0) {
      this.logger.log(`Notified ${notified} depleted campaign(s)`);
    }
  }

  /**
   * A lead left unanswered is lost revenue, and the arrival email is easy to
   * miss — this is a once-a-day DIGEST per company (never per-lead, which
   * would be noisy), only for leads still `new` after a full day.
   */
  private async sweepStaleLeads(): Promise<void> {
    const staleSince = new Date(Date.now() - STALE_LEAD_AFTER_MS);
    const where = {
      status: LeadStatus.new,
      createdAt: { lt: staleSince },
      OR: [{ staleNotifiedAt: null }, { staleNotifiedAt: { lt: utcMidnight() } }],
    };
    // `groupBy`, not `findMany` + a hand-rolled JS counter: the digest only
    // ever needs a per-company COUNT, and the old shape loaded every matching
    // row of the highest-growth table in the schema into this process's
    // memory once an hour just to throw all but the count away. The matching
    // `@@index([status, createdAt])` on Lead was added for this filter — every
    // other index on that table leads with `companyId`, which this
    // cross-company query can't use, so it was a seq scan.
    const grouped = await this.prisma.lead.groupBy({
      by: ['companyId'],
      where,
      _count: true,
    });
    if (!grouped.length) return;

    // Company display data for just the companies that actually have stale
    // leads, chunked so the `in` list can never hit the bind-param ceiling.
    const companies = new Map<string, { displayName: string; ownerUserId: string }>();
    for (const ids of chunked(grouped.map((g) => g.companyId))) {
      const rows = await this.prisma.company.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, ownerUserId: true },
      });
      for (const r of rows) {
        companies.set(r.id, { displayName: r.displayName, ownerUserId: r.ownerUserId });
      }
    }

    const byCompany = new Map<
      string,
      { displayName: string; ownerUserId: string; count: number }
    >();
    for (const g of grouped) {
      const company = companies.get(g.companyId);
      // A company deleted between the groupBy and this read has nothing left
      // to notify about (its leads cascade away with it).
      if (!company) continue;
      byCompany.set(g.companyId, { ...company, count: g._count });
    }

    let notified = 0;
    for (const [companyId, info] of byCompany) {
      try {
        // Claim the whole company's batch for today before notifying — same
        // atomic-claim-then-notify ordering as every other sweep in this file.
        const today = utcMidnight();
        const claimed = await this.prisma.lead.updateMany({
          where: {
            companyId,
            status: LeadStatus.new,
            createdAt: { lt: staleSince },
            OR: [{ staleNotifiedAt: null }, { staleNotifiedAt: { lt: today } }],
          },
          data: { staleNotifiedAt: today },
        });
        if (claimed.count === 0) continue;

        await this.notifications.notify({
          userId: info.ownerUserId,
          type: 'leads_stale',
          title:
            info.count === 1
              ? `O cerere pentru „${info.displayName}" așteaptă încă un răspuns`
              : `${info.count} cereri pentru „${info.displayName}" așteaptă încă un răspuns`,
          body:
            info.count === 1
              ? `O cerere de la un client nu are niciun răspuns de peste 48 de ore.`
              : `${info.count} cereri de la clienți nu au niciun răspuns de peste 48 de ore.`,
          channels: { panel: true, email: true },
          data: { companyId },
        });
        notified++;
      } catch (err) {
        this.logger.error(
          `Stale-lead notification failed for company ${companyId}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    if (notified > 0) this.logger.log(`Notified ${notified} company/ies of stale leads`);
  }

  private async sweepLowBalances(): Promise<void> {
    const activeCampaigns = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.active },
      select: { dailyBudgetMinor: true, company: { select: { ownerUserId: true } } },
    });
    if (!activeCampaigns.length) return;

    const neededByOwner = new Map<string, number>();
    for (const c of activeCampaigns) {
      const owner = c.company.ownerUserId;
      neededByOwner.set(owner, (neededByOwner.get(owner) ?? 0) + c.dailyBudgetMinor);
    }

    // Chunked `in` list + an explicit `select`. Unchunked, this was a hard
    // failure cliff rather than a slowdown: one bind parameter per owner id
    // against Postgres's 65,535-parameter statement limit, so past ~65k
    // distinct campaign owners the query throws — and the throw is swallowed
    // into a single log line by `sweep()`, meaning low-balance warnings would
    // simply stop firing platform-wide with nothing raising an alarm. The
    // `select` is the cheaper half of the same fix: nothing below reads the
    // other dozen wallet columns.
    const wallets: {
      id: string;
      userId: string;
      balanceMinor: number;
      lowBalanceNotifiedAt: Date | null;
    }[] = [];
    for (const ids of chunked([...neededByOwner.keys()])) {
      const rows = await this.prisma.wallet.findMany({
        where: { userId: { in: ids }, blockedAt: null },
        select: { id: true, userId: true, balanceMinor: true, lowBalanceNotifiedAt: true },
      });
      wallets.push(...rows);
    }

    let notified = 0;
    const now = Date.now();
    for (const w of wallets) {
      const needed = neededByOwner.get(w.userId) ?? 0;
      if (needed <= 0 || w.balanceMinor >= needed) continue;
      if (
        w.lowBalanceNotifiedAt &&
        now - w.lowBalanceNotifiedAt.getTime() < LOW_BALANCE_COOLDOWN_MS
      ) {
        continue;
      }

      try {
        // Same claim-before-notify ordering as sweepDepletedCampaigns above,
        // and for the same reason — see that method's comment.
        const claimed = await this.prisma.wallet.updateMany({
          where: {
            id: w.id,
            OR: [
              { lowBalanceNotifiedAt: null },
              { lowBalanceNotifiedAt: { lt: new Date(now - LOW_BALANCE_COOLDOWN_MS) } },
            ],
          },
          data: { lowBalanceNotifiedAt: new Date() },
        });
        if (claimed.count === 0) continue;

        await this.notifications.notify({
          userId: w.userId,
          type: 'wallet_low_balance',
          title: 'Soldul din portofel este aproape epuizat',
          body: 'Soldul nu mai acoperă bugetul zilnic al campaniilor tale active. Adaugă credite ca acestea să nu se oprească.',
          channels: { panel: true, email: true },
        });
        notified++;
      } catch (err) {
        this.logger.error(
          `Low-balance notification failed for wallet ${w.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    if (notified > 0) this.logger.log(`Notified ${notified} low-balance wallet(s)`);
  }

  /**
   * The campaign panel no longer lists per-Feed positions (see
   * CampaignSpendView/CampaignOptimizeView) — instead, a real notification
   * fires when a live campaign isn't #1 in at least one Feed (județ +
   * subcategorie) it's eligible in, naming the CPC Maxim needed to fix it.
   */
  private async sweepFeedPositionUpgrades(): Promise<void> {
    // Bounded slice + a cursor carried across ticks. This sub-sweep is two
    // analytics fan-outs per campaign (each enumerating every peer in every
    // Feed the company competes in), so the full active set is not something
    // one tick can afford to walk. `feedPositionCursor` advances a page per
    // hour and wraps to the start once a short page says we reached the end,
    // so every active campaign is still visited — just across several ticks
    // instead of one. The alert itself is on a 24h cooldown anyway, so a
    // campaign being looked at some hours later than it could have been makes
    // no difference to what the owner actually receives.
    const campaigns = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.active },
      select: {
        id: true,
        positionAlertNotifiedAt: true,
        company: { select: { id: true, displayName: true, ownerUserId: true } },
      },
      orderBy: { id: 'asc' },
      take: FEED_POSITION_BATCH,
      ...(this.feedPositionCursor ? { cursor: { id: this.feedPositionCursor }, skip: 1 } : {}),
    });
    // A short (or empty) page means the end of the set — wrap for next tick.
    // Wrapping on a short page rather than only an empty one saves a whole
    // extra tick per cycle, and re-reading the tail is free (everything on it
    // is inside its own 24h cooldown by then). This also self-heals a cursor
    // whose campaign was deleted meanwhile: that page comes back empty, which
    // is a short page, which wraps.
    this.feedPositionCursor =
      campaigns.length < FEED_POSITION_BATCH ? null : campaigns[campaigns.length - 1].id;
    if (!campaigns.length) return;

    let notified = 0;
    const now = Date.now();
    for (const c of campaigns) {
      if (
        c.positionAlertNotifiedAt &&
        now - c.positionAlertNotifiedAt.getTime() < POSITION_ALERT_COOLDOWN_MS
      ) {
        continue;
      }
      try {
        const ranks = await this.analytics.feedRanksFor(c.company.id);
        if (!ranks.some((r) => r.position !== 1)) continue;

        const recommended = await this.analytics.recommendedCpcFor(c.company.id);
        if (!recommended) continue;

        // Same claim-before-notify ordering as the other sweeps above.
        const claimed = await this.prisma.campaign.updateMany({
          where: {
            id: c.id,
            OR: [
              { positionAlertNotifiedAt: null },
              { positionAlertNotifiedAt: { lt: new Date(now - POSITION_ALERT_COOLDOWN_MS) } },
            ],
          },
          data: { positionAlertNotifiedAt: new Date() },
        });
        if (claimed.count === 0) continue;

        const cpcCredits = minorToCredits(recommended.cpcMinor).toFixed(2);
        await this.notifications.notify({
          userId: c.company.ownerUserId,
          type: 'campaign_position_upgrade',
          title: `Poți ajunge pe locul 1 pentru „${c.company.displayName}"`,
          body: `Nu ești pe locul 1 în cel puțin un Feed (județ + subcategorie). CPC Maxim recomandat ca să ajungi pe locul 1 peste tot: ${cpcCredits} cr.`,
          channels: { panel: true },
          data: { companyId: c.company.id },
        });
        notified++;
      } catch (err) {
        this.logger.error(
          `Feed-position notification failed for campaign ${c.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    if (notified > 0) this.logger.log(`Notified ${notified} feed-position upgrade(s)`);
  }

  /**
   * Support tickets nobody is moving. Two separate legs, because they are two
   * genuinely different failures:
   *
   *  - **stale** (panel-only, to the assignee): a ticket that IS assigned and
   *    HAS been answered, but has had no activity for 24h. A nudge, not an
   *    alarm — so it never leaves the panel.
   *  - **unanswered** (panel + email, to every admin): a ticket older than
   *    24h with `firstResponseAt` still null. Nobody has replied to a paying
   *    customer in a day. `firstResponseAt` has existed and been written on
   *    the first staff reply all along — nothing had ever read it. This is
   *    the leg that is supposed to interrupt someone.
   *
   * Same claim-before-notify ordering as every other sweep in this file, via
   * `SupportTicket.staleNotifiedAt` (the exact mirror of
   * `Lead.staleNotifiedAt`): the atomic conditional UPDATE lands first, so a
   * restart mid-flight loses a nudge rather than sending it twice, and two
   * overlapping sweeps (or two app instances) can't both claim one ticket.
   */
  private async sweepStaleTickets(): Promise<void> {
    const staleSince = new Date(Date.now() - STALE_TICKET_AFTER_MS);
    const today = utcMidnight();
    // Same open-status set the support queue's own counters use
    // (support.constants.ts `OPEN_STATUSES`) — inlined as the Prisma enum
    // rather than imported so this sweep doesn't take a dependency on the
    // support module.
    const openStatuses = [
      SupportTicketStatus.open,
      SupportTicketStatus.in_progress,
      SupportTicketStatus.waiting,
    ];
    const notYetNudgedToday = [{ staleNotifiedAt: null }, { staleNotifiedAt: { lt: today } }];

    // --- leg 1: assigned, answered, but sitting still --------------------
    const stale = await this.prisma.supportTicket.findMany({
      where: {
        status: { in: openStatuses },
        assigneeId: { not: null },
        firstResponseAt: { not: null },
        lastActivityAt: { lt: staleSince },
        OR: notYetNudgedToday,
      },
      select: { id: true, number: true, subject: true, assigneeId: true },
    });

    let nudged = 0;
    for (const t of stale) {
      try {
        const claimed = await this.prisma.supportTicket.updateMany({
          where: { id: t.id, OR: notYetNudgedToday },
          data: { staleNotifiedAt: today },
        });
        if (claimed.count === 0) continue;

        await this.notifications.notify({
          userId: t.assigneeId!,
          type: 'ticket_stale_assignee',
          title: `Tichetul #${t.number} nu a mai avansat de 24 de ore`,
          body: `Tichetul #${t.number} („${t.subject}") este alocat ție și nu a mai avut nicio activitate de peste 24 de ore.`,
          channels: { panel: true },
          data: { ticketId: t.id },
        });
        nudged++;
      } catch (err) {
        this.logger.error(
          `Stale-ticket nudge failed for ticket ${t.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    if (nudged > 0) this.logger.log(`Nudged ${nudged} assignee(s) about a stale ticket`);

    // --- leg 2: never answered at all ------------------------------------
    const unanswered = await this.prisma.supportTicket.findMany({
      where: {
        status: { in: openStatuses },
        firstResponseAt: null,
        createdAt: { lt: staleSince },
        OR: notYetNudgedToday,
      },
      select: { id: true, number: true, subject: true },
    });
    if (!unanswered.length) return;

    // Resolved once for the whole batch, not per ticket. `notifyAll()` is
    // deliberately NOT used here: it broadcasts to every active user on the
    // platform, with no way to target a role — so the admin set is resolved
    // the same way support.service.ts's own staff fan-out resolves it, and
    // each admin gets a normal per-user `notify()`.
    const adminRows = await this.prisma.platformRoleAssignment.findMany({
      where: { role: 'admin' },
      select: { userId: true },
      distinct: ['userId'],
    });
    const adminIds = adminRows.map((r) => r.userId);

    let escalated = 0;
    for (const t of unanswered) {
      try {
        const claimed = await this.prisma.supportTicket.updateMany({
          where: { id: t.id, OR: notYetNudgedToday },
          data: { staleNotifiedAt: today },
        });
        if (claimed.count === 0) continue;

        for (const userId of adminIds) {
          await this.notifications.notify({
            userId,
            type: 'ticket_unanswered_escalation',
            title: `Tichetul #${t.number} nu a primit niciun răspuns în 24 de ore`,
            body: `Tichetul #${t.number} („${t.subject}") a fost deschis acum peste 24 de ore și nu a primit încă niciun răspuns de la echipă.`,
            channels: { panel: true, email: true },
            data: { ticketId: t.id },
          });
        }
        escalated++;
      } catch (err) {
        this.logger.error(
          `Unanswered-ticket escalation failed for ticket ${t.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    if (escalated > 0) this.logger.log(`Escalated ${escalated} unanswered ticket(s) to admins`);
  }
}
