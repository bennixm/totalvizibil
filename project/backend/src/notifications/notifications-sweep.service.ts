import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CampaignStatus, LeadStatus } from '@prisma/client';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.sweep(), 120_000);
    setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  private async sweep(): Promise<void> {
    // The feed-position sweep runs two analytics queries per active
    // campaign — at scale a single tick can run long enough to still be
    // going when the next one is due. Without this guard, ticks would stack
    // without bound instead of the next one just waiting its turn.
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.sweepDepletedCampaigns().catch((err) => {
        this.logger.error('Depleted-campaign sweep failed', err instanceof Error ? err.stack : err);
      });
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
    const stale = await this.prisma.lead.findMany({
      where: {
        status: LeadStatus.new,
        createdAt: { lt: staleSince },
        OR: [{ staleNotifiedAt: null }, { staleNotifiedAt: { lt: utcMidnight() } }],
      },
      select: {
        id: true,
        companyId: true,
        company: { select: { displayName: true, ownerUserId: true } },
      },
    });
    if (!stale.length) return;

    const byCompany = new Map<
      string,
      { displayName: string; ownerUserId: string; count: number }
    >();
    for (const l of stale) {
      const entry = byCompany.get(l.companyId);
      if (entry) entry.count++;
      else {
        byCompany.set(l.companyId, {
          displayName: l.company.displayName,
          ownerUserId: l.company.ownerUserId,
          count: 1,
        });
      }
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

    const wallets = await this.prisma.wallet.findMany({
      where: { userId: { in: [...neededByOwner.keys()] }, blockedAt: null },
    });

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
    const campaigns = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.active },
      select: {
        id: true,
        positionAlertNotifiedAt: true,
        company: { select: { id: true, displayName: true, ownerUserId: true } },
      },
    });
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
}
