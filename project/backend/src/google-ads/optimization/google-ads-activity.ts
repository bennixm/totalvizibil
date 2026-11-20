import { GoogleAdsAgentEventStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Writes the agent's activity feed (`GoogleAdsAgentEvent`). Every event is
 * a REAL step: `step()` inserts the row as `running` before the work starts
 * and updates it with the outcome when the work ends, so a slow step (a
 * Google query, a Claude call, a mutate) is visible as running in the admin
 * panel while it happens. Nothing here fabricates or animates activity.
 *
 * Event writes are best-effort: a failed insert/update is swallowed so the
 * feed can never break the optimization work it describes.
 */

export interface EventMeta {
  step: string;
  message: string;
  googleCampaignId?: string | null;
  campaignName?: string | null;
}

export interface StepOutcome {
  status?: GoogleAdsAgentEventStatus;
  result: string;
  details?: Prisma.InputJsonValue;
}

export const EVENT_RETENTION_DAYS = 30;

export class AgentActivity {
  constructor(
    private readonly prisma: PrismaService,
    readonly runId: string | null,
    /** Set when recording a customer campaign's cycle (GoogleAdsUserCampaign);
     *  null = the platform's own agent. */
    readonly userCampaignId: string | null = null,
  ) {}

  private async insert(meta: EventMeta, status: GoogleAdsAgentEventStatus): Promise<string | null> {
    try {
      const row = await this.prisma.googleAdsAgentEvent.create({
        data: {
          runId: this.runId,
          step: meta.step,
          message: meta.message,
          googleCampaignId: meta.googleCampaignId ?? null,
          campaignName: meta.campaignName ?? null,
          userCampaignId: this.userCampaignId,
          status,
        },
        select: { id: true },
      });
      return row.id;
    } catch {
      return null;
    }
  }

  private async finish(
    id: string | null,
    outcome: StepOutcome & { status: GoogleAdsAgentEventStatus },
  ) {
    if (!id) return;
    try {
      await this.prisma.googleAdsAgentEvent.update({
        where: { id },
        data: {
          status: outcome.status,
          result: outcome.result.slice(0, 2000),
          details: outcome.details,
          finishedAt: new Date(),
        },
      });
    } catch {
      /* best-effort */
    }
  }

  /**
   * Runs `work` inside a visible step. `work` returns the outcome to show
   * (default status `completed`); a throw marks the step `failed` with the
   * error message and is re-thrown to the caller.
   */
  async step<T>(
    meta: EventMeta,
    work: () => Promise<{ value: T; outcome: StepOutcome }>,
  ): Promise<T> {
    const id = await this.insert(meta, 'running');
    try {
      const { value, outcome } = await work();
      await this.finish(id, { ...outcome, status: outcome.status ?? 'completed' });
      return value;
    } catch (err) {
      await this.finish(id, {
        status: 'failed',
        result: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** An instantaneous step (pure analysis, a decision) recorded with its result. */
  async record(meta: EventMeta, outcome: StepOutcome): Promise<void> {
    const id = await this.insert(meta, outcome.status ?? 'completed');
    await this.finish(id, { ...outcome, status: outcome.status ?? 'completed' });
  }

  static async prune(prisma: PrismaService): Promise<number> {
    const cutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 86_400_000);
    const { count } = await prisma.googleAdsAgentEvent.deleteMany({
      where: { startedAt: { lt: cutoff } },
    });
    return count;
  }
}
