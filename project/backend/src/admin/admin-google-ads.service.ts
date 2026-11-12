import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GoogleAdsAgentContentService } from '../google-ads/google-ads-agent-content.service';
import { GoogleAdsApiClient } from '../google-ads/google-ads-api-client.service';
import { GoogleAdsAgentIntelligenceService } from '../google-ads/google-ads-agent-intelligence.service';
import { GoogleAdsAgentStructuralService } from '../google-ads/google-ads-agent-structural.service';
import {
  GOOGLE_ADS_CPC_STALE_AFTER_MS,
  PlatformSettingsService,
} from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';

export type GoogleAdsAgentRunKindParam = 'structural' | 'content' | 'intelligence';

export interface ListGoogleAdsAgentActionsParams {
  categoryId?: string;
  action?: string;
  status?: 'applied' | 'pending_approval' | 'rejected';
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
}

export interface GoogleAdsCredentialsInput {
  customerId?: string;
  loginCustomerId?: string;
  campaignId?: string;
  /** Omit to leave the stored secret untouched — never required on every
   *  save, unlike the other fields, so a settings-page save can never
   *  accidentally blank or placeholder-overwrite the real key. */
  serviceAccountKeyBase64?: string;
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Backend for the admin "Google Ads Agent" page (docs/ai/GOOGLE-ADS-AGENT-PLAN.md,
 * Faza 4). Thin on purpose — the three agent passes (structural/content/
 * intelligence) and the approve/reject decision logic already live in their
 * own services (Faza 2/3); this only aggregates data for the UI and forwards
 * admin actions to them, same shape as `AdminStatsService`/`AdminCategoriesService`.
 */
@Injectable()
export class AdminGoogleAdsService {
  private readonly logger = new Logger(AdminGoogleAdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly client: GoogleAdsApiClient,
    private readonly structural: GoogleAdsAgentStructuralService,
    private readonly content: GoogleAdsAgentContentService,
    private readonly intelligence: GoogleAdsAgentIntelligenceService,
  ) {}

  /** Masked — `serviceAccountKeyConfigured`/`serviceAccountEmail` only, the
   *  raw key is NEVER echoed back once saved. `configured`/`customerId`
   *  reflect the live `GoogleAdsApiClient` state (post credential-refresh),
   *  not just what's stored, so the admin sees whether it actually took. */
  async googleAdsCredentials() {
    const [customerId, loginCustomerId, campaignId, keyBase64] = await Promise.all([
      this.settings.googleAdsCustomerId(),
      this.settings.googleAdsLoginCustomerId(),
      this.settings.googleAdsCampaignId(),
      this.settings.googleAdsServiceAccountKeyBase64(),
    ]);
    return {
      customerId,
      loginCustomerId,
      campaignId,
      serviceAccountKeyConfigured: !!keyBase64,
      serviceAccountEmail: this.client.serviceAccountEmail,
      configured: this.client.configured,
    };
  }

  async setGoogleAdsCredentials(input: GoogleAdsCredentialsInput) {
    if (input.customerId !== undefined)
      await this.settings.setGoogleAdsCustomerId(input.customerId);
    if (input.loginCustomerId !== undefined) {
      await this.settings.setGoogleAdsLoginCustomerId(input.loginCustomerId);
    }
    if (input.campaignId !== undefined)
      await this.settings.setGoogleAdsCampaignId(input.campaignId);
    if (input.serviceAccountKeyBase64 !== undefined) {
      await this.settings.setGoogleAdsServiceAccountKeyBase64(input.serviceAccountKeyBase64);
    }
    return this.googleAdsCredentials();
  }

  async overview() {
    const [
      enabled,
      campaignsByStatus,
      budgetAgg,
      spendTodayAgg,
      spendMonthAgg,
      subcategoriesWithoutCampaign,
      lastRuns,
      feedCpc,
    ] = await Promise.all([
      this.settings.googleAdsAgentEnabled(),
      this.prisma.googleAdsSubcategoryCampaign.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.googleAdsSubcategoryCampaign.aggregate({
        where: { status: 'active' },
        _sum: { dailyBudgetMinor: true },
      }),
      this.prisma.platformExpense.aggregate({
        where: { category: 'google_ads', incurredOn: { gte: startOfTodayUtc() } },
        _sum: { amountMinor: true },
      }),
      this.prisma.platformExpense.aggregate({
        where: { category: 'google_ads', incurredOn: { gte: startOfMonthUtc() } },
        _sum: { amountMinor: true },
      }),
      this.prisma.category.count({
        where: { parentId: { not: null }, isActive: true, googleAdsCampaign: null },
      }),
      this.lastRuns(),
      this.feedCpc(),
    ]);

    const countByStatus = (status: string) =>
      campaignsByStatus.find((r) => r.status === status)?._count._all ?? 0;

    return {
      enabled,
      campaigns: {
        active: countByStatus('active'),
        paused: countByStatus('paused'),
        pendingCreation: countByStatus('pending_creation'),
      },
      totalActiveDailyBudgetCredits: (budgetAgg._sum.dailyBudgetMinor ?? 0) / 100,
      spendTodayCredits: (spendTodayAgg._sum.amountMinor ?? 0) / 100,
      spendThisMonthCredits: (spendMonthAgg._sum.amountMinor ?? 0) / 100,
      subcategoriesWithoutCampaign,
      lastRuns,
      feedCpc,
    };
  }

  /**
   * The real Google cost-per-click the FEED algorithm actually prices
   * Google-Ads-attributed clicks against (`AnalyticsService.marginConfig()`
   * -> `googleAdsCostPromovareCredits()`) — surfaced here so an admin can see
   * it without reading code: the raw rolling average `GoogleAdsCpcSyncService`
   * caches, the safety buffer applied on top, whether that cache is still
   * fresh enough to be used at all, and — mirroring that same method's own
   * fallback logic exactly — what's ACTUALLY in effect right now (the
   * buffered average when fresh, or the flat organic default when the cache
   * is stale/missing, same as a sync outage would fall back to).
   */
  private async feedCpc() {
    const [avgCpc, bufferPct, fallbackCredits] = await Promise.all([
      this.settings.googleAdsAvgCpc(),
      this.settings.googleAdsCpcBufferPct(),
      this.settings.feedCostPromovareCredits(),
    ]);
    const freshCutoff = Date.now() - GOOGLE_ADS_CPC_STALE_AFTER_MS;
    const fresh = !!avgCpc && new Date(avgCpc.updatedAt).getTime() >= freshCutoff;
    const bufferedCredits = avgCpc ? avgCpc.credits * (1 + bufferPct / 100) : null;
    return {
      rawAvgCpcCredits: avgCpc?.credits ?? null,
      updatedAt: avgCpc?.updatedAt ?? null,
      bufferPct,
      bufferedCredits,
      fresh,
      staleAfterMinutes: GOOGLE_ADS_CPC_STALE_AFTER_MS / 60_000,
      fallbackCredits,
      activeCostPromovareCredits:
        fresh && bufferedCredits != null ? bufferedCredits : fallbackCredits,
    };
  }

  private async lastRuns() {
    const kinds = ['structural', 'content', 'intelligence'] as const;
    const rows = await Promise.all(
      kinds.map((kind) =>
        this.prisma.googleAdsAgentRun.findFirst({
          where: { kind },
          orderBy: { startedAt: 'desc' },
        }),
      ),
    );
    const out: Record<string, unknown> = {};
    kinds.forEach((kind, i) => (out[kind] = rows[i]));
    return out;
  }

  listProposals() {
    return this.prisma.googleAdsAgentAction.findMany({
      where: { status: 'pending_approval' },
      orderBy: { createdAt: 'desc' },
      include: { category: { include: { parent: true } } },
    });
  }

  approveProposal(actionId: string, approvedByUserId: string): Promise<void> {
    return this.intelligence.approveProposal(actionId, approvedByUserId);
  }

  rejectProposal(actionId: string, approvedByUserId: string): Promise<void> {
    return this.intelligence.rejectProposal(actionId, approvedByUserId);
  }

  async listCampaigns() {
    const mappings = await this.prisma.googleAdsSubcategoryCampaign.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { category: { include: { parent: true } } },
    });
    const counts = await Promise.all(
      mappings.map((m) =>
        this.prisma.companyCategory.count({
          where: { categoryId: m.categoryId, company: { status: 'active' } },
        }),
      ),
    );
    return mappings.map((m, i) => ({ ...m, activeCompanyCount: counts[i] }));
  }

  async listActions(params: ListGoogleAdsAgentActionsParams) {
    const where: Prisma.GoogleAdsAgentActionWhereInput = {
      categoryId: params.categoryId,
      action: params.action,
      status: params.status,
      createdAt:
        params.dateFrom || params.dateTo ? { gte: params.dateFrom, lte: params.dateTo } : undefined,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.googleAdsAgentAction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { category: true, approvedBy: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.googleAdsAgentAction.count({ where }),
    ]);
    return { items: rows, page: params.page, pageSize: params.pageSize, total };
  }

  /**
   * Deliberately fire-and-forget: a real pass calls Claude and/or the real
   * Google Ads API once per category, sequentially — easily well past the
   * frontend's ~12s request timeout for anything but a handful of
   * categories. Previously this awaited the whole run, so the admin's
   * browser showed a timeout error even though the run had (or would)
   * complete successfully server-side — confusing and indistinguishable
   * from an actual failure. Each service's own `run()` already tracks
   * progress/outcome in `GoogleAdsAgentRun` (what "Ultimele rulări"/"Istoric"
   * read), so there's nothing useful to await here; the `.catch()` only
   * exists to stop an eventual rejection — already logged, and the run
   * already marked `failed`, inside `run()` itself — from surfacing as an
   * unhandled promise rejection now that nothing awaits this call.
   */
  runNow(kind: GoogleAdsAgentRunKindParam): void {
    const run =
      kind === 'structural'
        ? this.structural.run()
        : kind === 'content'
          ? this.content.run()
          : this.intelligence.run();
    run.catch((err) => {
      this.logger.error(
        `Fire-and-forget '${kind}' run rejected.`,
        err instanceof Error ? err.stack : err,
      );
    });
  }
}
