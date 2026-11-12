import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { feedCpcMinMinor } from '../analytics/feed-pricing';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { notifyAdminsOfFailedGoogleAdsAgentRun } from './google-ads-agent-alerts';
import { GoogleAdsApiClient } from './google-ads-api-client.service';
import { creditsToAmountMicros } from './google-ads-money';
import { GoogleAdsReferenceDataService } from './google-ads-reference-data.service';

/** Fixed, short poll period — only "is it time yet" is admin-configurable
 *  (`googleAdsAgentIntelligenceIntervalMinutes`, read live on every tick via
 *  `isDue()`), not this — same shape as the structural/content passes.
 *  Replaces an earlier "once daily at a fixed UTC hour" design: simpler,
 *  consistent with the other two passes, and the fixed-hour "low-traffic
 *  window" was a soft nice-to-have, not a hard requirement. */
const POLL_INTERVAL_MS = 10 * 60 * 1000;
const STALE_LOCK_MS = 30 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Faza 3 (docs/ai/GOOGLE-ADS-AGENT-PLAN.md), budget-intelligence half: on
 * an admin-configurable interval (default once a day — see `isDue()`), one
 * batch Claude call across every `active` subcategory campaign, proposing a
 * new daily budget / max CPC per subcategory. A DECREASE (or no
 * change) on both dimensions applies immediately; an INCREASE on either
 * dimension is written as a `pending_approval` action and never sent to
 * Google Ads until a human approves it via `approveProposal()` (wired to an
 * admin endpoint in Faza 4). Every proposal is hard-clamped to the
 * admin-configured caps server-side — Claude's own adherence is never
 * trusted on its own.
 */
@Injectable()
export class GoogleAdsAgentIntelligenceService implements OnModuleInit {
  private readonly logger = new Logger(GoogleAdsAgentIntelligenceService.name);

  constructor(
    private readonly client: GoogleAdsApiClient,
    private readonly refData: GoogleAdsReferenceDataService,
    private readonly ai: AiService,
    private readonly analytics: AnalyticsService,
    private readonly settings: PlatformSettingsService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    void this.tick();
    setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (!this.client.configured || !this.ai.configured) return;
    if (!(await this.settings.googleAdsAgentEnabled())) return;
    if (!(await this.isDue())) return;

    try {
      await this.run();
    } catch (err) {
      this.logger.error(
        'Google Ads budget-intelligence pass crashed outside the per-proposal error handling.',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /** Has at least `googleAdsAgentIntelligenceIntervalMinutes()` elapsed
   *  since the last intelligence run (of any outcome)? A run with no prior
   *  history is always due. */
  private async isDue(): Promise<boolean> {
    const [intervalMinutes, lastRun] = await Promise.all([
      this.settings.googleAdsAgentIntelligenceIntervalMinutes(),
      this.prisma.googleAdsAgentRun.findFirst({
        where: { kind: 'intelligence' },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    if (!lastRun) return true;
    return Date.now() - lastRun.startedAt.getTime() >= intervalMinutes * 60_000;
  }

  /** Exposed for an admin "Run now" trigger (Faza 4). */
  async run(): Promise<void> {
    const existing = await this.prisma.googleAdsAgentRun.findFirst({
      where: { kind: 'intelligence', status: 'in_progress' },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) {
      const ageMs = Date.now() - existing.startedAt.getTime();
      if (ageMs < STALE_LOCK_MS) {
        this.logger.warn('Budget-intelligence pass already in progress — skipping.');
        return;
      }
      await this.prisma.googleAdsAgentRun.update({
        where: { id: existing.id },
        data: { status: 'failed', finishedAt: new Date(), errorSummary: 'stale lock — superseded' },
      });
    }

    const run = await this.prisma.googleAdsAgentRun.create({ data: { kind: 'intelligence' } });
    let categoriesScanned = 0;
    let actionsTaken = 0;
    let actionsPendingApproval = 0;

    try {
      const mappings = await this.prisma.googleAdsSubcategoryCampaign.findMany({
        where: { status: 'active' },
        include: { category: true },
      });
      categoriesScanned = mappings.length;

      if (!mappings.length) {
        await this.prisma.googleAdsAgentRun.update({
          where: { id: run.id },
          data: { status: 'success', finishedAt: new Date(), categoriesScanned, actionsTaken },
        });
        return;
      }

      const counts = await Promise.all(
        mappings.map((m) =>
          this.prisma.companyCategory.count({
            where: { categoryId: m.categoryId, company: { status: 'active' } },
          }),
        ),
      );

      const signals = mappings.map((m, i) => ({
        categorySlug: m.category.slug,
        categoryName: this.plainName(m.category.nameI18n),
        activeCompanyCount: counts[i],
        currentDailyBudgetCredits: m.dailyBudgetMinor / 100,
        currentMaxCpcCredits: m.maxCpcMinor / 100,
      }));

      const [feedCpcFloorMinor, maxDailyBudgetCapCredits, maxCpcCapCredits] = await Promise.all([
        this.analytics.marginConfig().then(feedCpcMinMinor),
        this.settings.googleAdsAgentMaxDailyBudgetCapCredits(),
        this.settings.googleAdsAgentMaxCpcCapCredits(),
      ]);

      const result = await this.ai.googleAdsBudgetIntelligence({
        signals,
        feedCpcFloorCredits: feedCpcFloorMinor / 100,
        maxDailyBudgetCapCredits,
        maxCpcCapCredits,
      });

      if (result == null) {
        const errorSummary = 'Claude unavailable or returned no usable proposals';
        await this.prisma.googleAdsAgentRun.update({
          where: { id: run.id },
          data: { status: 'failed', finishedAt: new Date(), categoriesScanned, actionsTaken, errorSummary },
        });
        await notifyAdminsOfFailedGoogleAdsAgentRun(
          this.notifications,
          this.prisma,
          'intelligence',
          errorSummary,
        );
        return;
      }
      const {
        proposals,
        costEstimateMinor: claudeCostEstimateMinor,
        inputTokens: claudeInputTokens,
        outputTokens: claudeOutputTokens,
        model: claudeModel,
      } = result;

      const bySlug = new Map(mappings.map((m) => [m.category.slug, m]));
      let hadError = false;

      for (const proposal of proposals) {
        const mapping = bySlug.get(proposal.categorySlug);
        if (!mapping) continue;
        try {
          const applied = await this.applyOrQueueProposal(
            mapping,
            proposal,
            maxDailyBudgetCapCredits,
            maxCpcCapCredits,
          );
          if (applied === 'applied') actionsTaken++;
          if (applied === 'pending') actionsPendingApproval++;
        } catch (err) {
          hadError = true;
          this.logger.error(
            `Failed to apply/queue budget proposal for '${proposal.categorySlug}'.`,
            err instanceof Error ? err.stack : err,
          );
        }
      }

      // Touch every scanned mapping's lastIntelligenceRunAt, including ones
      // Claude didn't propose anything for.
      await this.prisma.googleAdsSubcategoryCampaign.updateMany({
        where: { id: { in: mappings.map((m) => m.id) } },
        data: { lastIntelligenceRunAt: new Date() },
      });

      await this.prisma.googleAdsAgentRun.update({
        where: { id: run.id },
        data: {
          status: hadError ? 'partial' : 'success',
          finishedAt: new Date(),
          categoriesScanned,
          actionsTaken,
          actionsPendingApproval,
          claudeCostEstimateMinor,
          claudeModel,
          claudeInputTokens,
          claudeOutputTokens,
          claudeCallCount: 1,
        },
      });
    } catch (err) {
      const errorSummary = err instanceof Error ? err.message : String(err);
      await this.prisma.googleAdsAgentRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          categoriesScanned,
          actionsTaken,
          actionsPendingApproval,
          errorSummary,
        },
      });
      await notifyAdminsOfFailedGoogleAdsAgentRun(
        this.notifications,
        this.prisma,
        'intelligence',
        errorSummary,
      );
      throw err;
    }
  }

  /** Returns 'applied' | 'pending' | 'skipped'. */
  private async applyOrQueueProposal(
    mapping: { id: string; categoryId: string; dailyBudgetMinor: number; maxCpcMinor: number },
    proposal: { proposedDailyBudgetCredits: number; proposedMaxCpcCredits: number; reasoning: string },
    maxDailyBudgetCapCredits: number,
    maxCpcCapCredits: number,
  ): Promise<'applied' | 'pending' | 'skipped'> {
    const currentDailyBudgetCredits = mapping.dailyBudgetMinor / 100;
    const currentMaxCpcCredits = mapping.maxCpcMinor / 100;

    // Hard server-side clamp — never trust Claude's own adherence to the caps
    // it was told about.
    const proposedDailyBudgetCredits = round2(
      Math.min(Math.max(proposal.proposedDailyBudgetCredits, 0.01), maxDailyBudgetCapCredits),
    );
    const proposedMaxCpcCredits = round2(
      Math.min(Math.max(proposal.proposedMaxCpcCredits, 0.01), maxCpcCapCredits),
    );

    if (
      proposedDailyBudgetCredits === currentDailyBudgetCredits &&
      proposedMaxCpcCredits === currentMaxCpcCredits
    ) {
      return 'skipped';
    }

    const isIncrease =
      proposedDailyBudgetCredits > currentDailyBudgetCredits ||
      proposedMaxCpcCredits > currentMaxCpcCredits;

    if (!isIncrease) {
      await this.applyBudgetChange(mapping.id, proposedDailyBudgetCredits, proposedMaxCpcCredits);
      await this.prisma.googleAdsAgentAction.create({
        data: {
          categoryId: mapping.categoryId,
          action: 'cpc.adjusted',
          status: 'applied',
          before: { dailyBudgetCredits: currentDailyBudgetCredits, maxCpcCredits: currentMaxCpcCredits },
          after: { dailyBudgetCredits: proposedDailyBudgetCredits, maxCpcCredits: proposedMaxCpcCredits },
          reasoning: proposal.reasoning,
        },
      });
      return 'applied';
    }

    await this.prisma.googleAdsAgentAction.create({
      data: {
        categoryId: mapping.categoryId,
        action: 'budget.increase.proposed',
        status: 'pending_approval',
        before: { dailyBudgetCredits: currentDailyBudgetCredits, maxCpcCredits: currentMaxCpcCredits },
        after: {
          proposedDailyBudgetCredits: proposedDailyBudgetCredits,
          proposedMaxCpcCredits: proposedMaxCpcCredits,
        },
        reasoning: proposal.reasoning,
      },
    });
    return 'pending';
  }

  /** Sends the actual Google Ads mutate + updates the local mapping row.
   *  Shared by the auto-apply (decrease) path and `approveProposal()`. */
  private async applyBudgetChange(
    mappingId: string,
    dailyBudgetCredits: number,
    maxCpcCredits: number,
  ): Promise<void> {
    const mapping = await this.prisma.googleAdsSubcategoryCampaign.findUniqueOrThrow({
      where: { id: mappingId },
    });
    if (!mapping.googleBudgetResourceId || !mapping.googleAdGroupId) {
      throw new Error(`Mapping ${mappingId} is missing budget/ad-group resource ids.`);
    }

    const [currencyCode, eurRonRate] = await Promise.all([
      this.refData.getAccountCurrencyCode(),
      this.settings.eurRonRate(),
    ]);
    const budgetMicros = creditsToAmountMicros(dailyBudgetCredits, currencyCode, eurRonRate);
    const cpcMicros = creditsToAmountMicros(maxCpcCredits, currencyCode, eurRonRate);
    const customerId = this.client.customerId;

    await this.client.mutate([
      {
        campaignBudgetOperation: {
          update: {
            resourceName: `customers/${customerId}/campaignBudgets/${mapping.googleBudgetResourceId}`,
            amountMicros: budgetMicros,
          },
          updateMask: 'amount_micros',
        },
      },
      {
        adGroupOperation: {
          update: {
            resourceName: `customers/${customerId}/adGroups/${mapping.googleAdGroupId}`,
            cpcBidMicros: cpcMicros,
          },
          updateMask: 'cpc_bid_micros',
        },
      },
    ]);

    await this.prisma.googleAdsSubcategoryCampaign.update({
      where: { id: mappingId },
      data: {
        dailyBudgetMinor: Math.round(dailyBudgetCredits * 100),
        maxCpcMinor: Math.round(maxCpcCredits * 100),
      },
    });
  }

  /** Admin approves a pending budget/CPC increase (Faza 4 endpoint). Sends
   *  the real Google Ads mutate only now. */
  async approveProposal(actionId: string, approvedByUserId: string): Promise<void> {
    const action = await this.prisma.googleAdsAgentAction.findUnique({ where: { id: actionId } });
    if (!action || action.status !== 'pending_approval' || action.action !== 'budget.increase.proposed') {
      throw new BadRequestException('No pending budget proposal with that id');
    }
    const after = action.after as { proposedDailyBudgetCredits?: number; proposedMaxCpcCredits?: number } | null;
    const dailyBudgetCredits = Number(after?.proposedDailyBudgetCredits);
    const maxCpcCredits = Number(after?.proposedMaxCpcCredits);
    if (!Number.isFinite(dailyBudgetCredits) || !Number.isFinite(maxCpcCredits)) {
      throw new Error(`Action ${actionId} has a malformed 'after' payload.`);
    }

    const mapping = await this.prisma.googleAdsSubcategoryCampaign.findUnique({
      where: { categoryId: action.categoryId },
    });
    if (!mapping) throw new Error(`No campaign mapping for category ${action.categoryId}.`);

    await this.applyBudgetChange(mapping.id, dailyBudgetCredits, maxCpcCredits);
    await this.prisma.googleAdsAgentAction.update({
      where: { id: actionId },
      data: { status: 'applied', approvedByUserId, approvedAt: new Date() },
    });
  }

  /** Admin rejects a pending budget/CPC increase — no mutate, no local change. */
  async rejectProposal(actionId: string, approvedByUserId: string): Promise<void> {
    const action = await this.prisma.googleAdsAgentAction.findUnique({ where: { id: actionId } });
    if (!action || action.status !== 'pending_approval') {
      throw new BadRequestException('No pending proposal with that id');
    }
    await this.prisma.googleAdsAgentAction.update({
      where: { id: actionId },
      data: { status: 'rejected', approvedByUserId, approvedAt: new Date() },
    });
  }

  private plainName(nameI18n: unknown): string {
    if (nameI18n && typeof nameI18n === 'object' && !Array.isArray(nameI18n)) {
      const obj = nameI18n as Record<string, unknown>;
      if (typeof obj.ro === 'string' && obj.ro) return obj.ro;
      const first = Object.values(obj).find((v) => typeof v === 'string' && v);
      if (typeof first === 'string') return first;
    }
    return '';
  }
}
