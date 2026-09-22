import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { utcDay } from '../campaigns/ad-click';
import { NotificationsService } from './notifications.service';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Don't re-notify the same low balance more than once a day. */
const LOW_BALANCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.sweep(), 120_000);
    setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  private async sweep(): Promise<void> {
    await this.sweepDepletedCampaigns().catch((err) => {
      this.logger.error('Depleted-campaign sweep failed', err instanceof Error ? err.stack : err);
    });
    await this.sweepLowBalances().catch((err) => {
      this.logger.error('Low-balance sweep failed', err instanceof Error ? err.stack : err);
    });
  }

  private async sweepDepletedCampaigns(): Promise<void> {
    const today = new Date(`${utcDay()}T00:00:00.000Z`);
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: CampaignStatus.depleted,
        spendDay: today,
        NOT: { depletedNotifiedForDay: today },
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
        const claimed = await this.prisma.campaign.updateMany({
          where: { id: c.id, NOT: { depletedNotifiedForDay: today } },
          data: { depletedNotifiedForDay: today },
        });
        if (claimed.count === 0) continue;

        await this.notifications.notify({
          userId: c.company.ownerUserId,
          type: 'campaign_depleted',
          title: `Bugetul zilnic pentru ${c.company.displayName} s-a epuizat`,
          body: `Anunțul nu mai apare în feed pentru "${c.company.displayName}" până mâine — bugetul zilnic a fost consumat integral.`,
          channels: { panel: true },
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
}
