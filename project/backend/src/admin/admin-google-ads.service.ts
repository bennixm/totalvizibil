import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GoogleAdsAgentContentService } from '../google-ads/google-ads-agent-content.service';
import { GoogleAdsApiClient } from '../google-ads/google-ads-api-client.service';
import { GoogleAdsAgentIntelligenceService } from '../google-ads/google-ads-agent-intelligence.service';
import { GoogleAdsAgentRecommendationsService } from '../google-ads/google-ads-agent-recommendations.service';
import { GoogleAdsAgentStructuralService } from '../google-ads/google-ads-agent-structural.service';
import { getGoogleAdsRecommendationCatalogEntry } from '../google-ads/google-ads-recommendation-catalog';
import {
  GOOGLE_ADS_CPC_STALE_AFTER_MS,
  PlatformSettingsService,
} from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';

/** Human label for the handful of non-`recommendation.*` action codes this
 *  agent writes (budget/CPC/keyword/targeting/campaign lifecycle) — used
 *  so the admin's History search box can match what the admin actually
 *  reads on screen (`actionSearchLabel()`), not the raw machine code only
 *  (see `GoogleAdsAgentAction.action`'s doc comment in schema.prisma for
 *  the full raw set). Recommendation actions use the catalog's own
 *  `labelRo` instead — see `actionSearchLabel()`. */
const ACTION_LABELS_RO: Record<string, string> = {
  'campaign.create': 'Campanie creată',
  'campaign.pause': 'Campanie pusă pe pauză',
  'campaign.resume': 'Campanie repornită',
  'geo_targeting.updated': 'Targetare geografică actualizată',
  'keywords.updated': 'Cuvinte cheie actualizate',
  'cpc.adjusted': 'CPC maxim ajustat',
  'budget.increase.proposed': 'Propunere de creștere a bugetului',
};

/** The text an admin would actually recognize for one action row — the
 *  catalog's Romanian label for a recommendation, the static label above
 *  for everything else, or the raw code as a last resort (an action this
 *  map doesn't (yet) know about) — used both by the frontend label and by
 *  `listActions`' free-text search, so typing what's on screen always
 *  matches it. */
export function actionSearchLabel(action: string): string {
  if (action.startsWith('recommendation.')) {
    return getGoogleAdsRecommendationCatalogEntry(action.replace('recommendation.', '')).labelRo;
  }
  return ACTION_LABELS_RO[action] ?? action;
}

/** Case- and diacritic-insensitive fold for the History free-text search —
 *  "strength"/"Strength" and "puterea"/"puțerea" should all match the
 *  same way an admin typing without special characters would expect. */
function foldSearchText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

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
    private readonly recommendations: GoogleAdsAgentRecommendationsService,
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

  async approveProposal(actionId: string, approvedByUserId: string): Promise<void> {
    // Two shapes share this one approval queue (`GoogleAdsAgentAction`) —
    // a budget/CPC increase (intelligence pass) or a Google Ads
    // Recommendation (Direction 4) — each with its own apply logic, so
    // route by the `action` prefix rather than assuming budget/CPC.
    const action = await this.prisma.googleAdsAgentAction.findUnique({
      where: { id: actionId },
      select: { action: true },
    });
    if (action?.action.startsWith('recommendation.')) {
      return this.recommendations.approveProposal(actionId, approvedByUserId);
    }
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
      status: params.status,
      createdAt:
        params.dateFrom || params.dateTo ? { gte: params.dateFrom, lte: params.dateTo } : undefined,
    };
    const search = params.action?.trim();
    if (!search) {
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.googleAdsAgentAction.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
          include: {
            category: true,
            approvedBy: { select: { id: true, name: true, email: true } },
          },
        }),
        this.prisma.googleAdsAgentAction.count({ where }),
      ]);
      return { items: rows, page: params.page, pageSize: params.pageSize, total };
    }

    // The admin's search box matches the LABEL shown on screen (e.g.
    // "Îmbunătățește puterea reclamei"), not the raw machine code stored
    // in `action` (e.g. `recommendation.RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH`)
    // — an exact-match `where.action` filter (the previous implementation)
    // could only ever match if the admin typed that exact raw string, so it
    // effectively never filtered anything. There's no SQL-side way to match
    // against a label computed in application code, so this filters/paginates
    // in memory instead — fine at the scale of one agent's action history;
    // capped defensively so a pathologically large history can't blow up
    // memory on an admin page load.
    const candidates = await this.prisma.googleAdsAgentAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { category: true, approvedBy: { select: { id: true, name: true, email: true } } },
    });
    const needle = foldSearchText(search);
    const matches = candidates.filter(
      (row) =>
        foldSearchText(actionSearchLabel(row.action)).includes(needle) ||
        foldSearchText(row.action).includes(needle) ||
        (row.reasoning && foldSearchText(row.reasoning).includes(needle)),
    );
    const start = (params.page - 1) * params.pageSize;
    return {
      items: matches.slice(start, start + params.pageSize),
      page: params.page,
      pageSize: params.pageSize,
      total: matches.length,
    };
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
