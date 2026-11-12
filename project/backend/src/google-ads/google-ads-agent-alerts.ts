import { Logger } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('GoogleAdsAgentAlerts');

const RUN_KIND_LABEL: Record<'structural' | 'content' | 'intelligence', string> = {
  structural: 'structural',
  content: 'de conținut',
  intelligence: 'de buget',
};

/**
 * Faza 5 (docs/ai/GOOGLE-ADS-AGENT-PLAN.md) — observability: every admin
 * gets an in-panel notification when a Google Ads agent pass ends
 * `failed`. This agent can create/pause/mutate real ad spend unattended,
 * so a failed run must surface loudly rather than wait for someone to
 * happen to open `/admin/google-ads-agent`. Deliberately never throws — a
 * notification failure must never mask (or interrupt unwinding of) the
 * real run failure the caller already recorded.
 */
export async function notifyAdminsOfFailedGoogleAdsAgentRun(
  notifications: NotificationsService,
  prisma: PrismaService,
  kind: 'structural' | 'content' | 'intelligence',
  errorSummary: string,
): Promise<void> {
  try {
    const admins = await prisma.platformRoleAssignment.findMany({
      where: { role: 'admin' },
      select: { userId: true },
      distinct: ['userId'],
    });
    for (const { userId } of admins) {
      await notifications.notify({
        userId,
        type: 'google_ads_agent_run_failed',
        title: `Agent Google Ads — pass ${RUN_KIND_LABEL[kind]} a eșuat`,
        body: errorSummary.slice(0, 500),
        channels: { panel: true },
      });
    }
  } catch (err) {
    logger.error(
      'Failed to notify admins of a failed Google Ads agent run.',
      err instanceof Error ? err.stack : err,
    );
  }
}
