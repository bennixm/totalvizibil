import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GoogleAdsMonitorService } from '../google-ads/optimization/google-ads-monitor.service';
import { GoogleAdsOptimizerService } from '../google-ads/optimization/google-ads-optimizer.service';
import {
  GoogleAdsProposalWorkflowService,
  proposalContentHash,
} from '../google-ads/optimization/google-ads-proposal-workflow.service';
import { buildProposalPreview, ProposalPreview } from '../google-ads/google-ads-proposal-preview';
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
  'creative.rsa_gap_fill': 'Titluri/descrieri adăugate în reclamă',
  'creative.keyword_headlines': 'Cuvinte cheie adăugate în titluri',
  'creative.assets_gap_fill': 'Sitelink-uri/callout-uri adăugate',
  'creative.replace_text': 'Înlocuire text cu performanță scăzută',
};

/** Statuses an action row can have, for the history filter. */
export type GoogleAdsActionStatusParam =
  'applied' | 'pending_approval' | 'rejected' | 'failed' | 'approved' | 'superseded';

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

export type GoogleAdsAgentRunKindParam = 'structural' | 'content' | 'intelligence' | 'monitor';

export interface ListGoogleAdsAgentActionsParams {
  categoryId?: string;
  action?: string;
  status?: GoogleAdsActionStatusParam;
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

function withPreview<T extends { action: string; before: unknown; after: unknown }>(
  row: T,
): T & { preview: ProposalPreview } {
  return { ...row, preview: buildProposalPreview(row) };
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
    private readonly monitor?: GoogleAdsMonitorService,
    private readonly optimizer?: GoogleAdsOptimizerService,
    private readonly workflow?: GoogleAdsProposalWorkflowService,
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

  /** Each row carries a `preview`: the exact change it would apply
   *  (sitelinks, texts, keyword, budget…) — see google-ads-proposal-preview.ts. */
  async listProposals() {
    const rows = await this.prisma.googleAdsAgentAction.findMany({
      where: { status: 'pending_approval' },
      orderBy: { createdAt: 'desc' },
      include: { category: { include: { parent: true } } },
    });
    // Revisions show the version they replaced, with its exact content.
    const previousIds = rows.map((r) => r.revisionOfId).filter((id): id is string => !!id);
    const previous = previousIds.length
      ? await this.prisma.googleAdsAgentAction.findMany({ where: { id: { in: previousIds } } })
      : [];
    const prevById = new Map(previous.map((p) => [p.id, p]));
    const target = await this.proposalTargets(rows);
    return rows.map((r) => {
      const prev = r.revisionOfId ? prevById.get(r.revisionOfId) : undefined;
      return {
        ...withPreview(r),
        contentHash: proposalContentHash(r),
        target: target.get(r.id) ?? null,
        revisionOf: prev
          ? {
              id: prev.id,
              createdAt: prev.createdAt,
              preview: buildProposalPreview(prev),
              manualInstructions: prev.manualInstructions,
            }
          : null,
      };
    });
  }

  /** Where a proposal will be applied: the real Google campaign (name from
   *  the latest sync) and the level of the change. */
  private async proposalTargets(
    rows: { id: string; action: string; categoryId: string; googleCampaignId: string | null }[],
  ): Promise<
    Map<string, { campaignName: string | null; googleCampaignId: string | null; level: string }>
  > {
    const mappings = await this.prisma.googleAdsSubcategoryCampaign.findMany({
      where: { categoryId: { in: rows.map((r) => r.categoryId) } },
      select: { categoryId: true, googleCampaignId: true },
    });
    const campaignByCategory = new Map(mappings.map((m) => [m.categoryId, m.googleCampaignId]));
    const ids = rows
      .map((r) => r.googleCampaignId ?? campaignByCategory.get(r.categoryId))
      .filter((x): x is string => !!x);
    const snaps = await this.prisma.googleAdsCampaignSnapshot.findMany({
      where: { googleCampaignId: { in: ids } },
      select: { googleCampaignId: true, name: true },
    });
    const nameById = new Map(snaps.map((s) => [s.googleCampaignId, s.name]));
    const levelOf = (action: string = '') => {
      const t = action.replace('recommendation.', '');
      if (/SITELINK|CALLOUT|CALL_ASSET|LEAD_FORM/.test(t) || action === 'creative.assets_gap_fill')
        return 'campanie (element atașat campaniei)';
      if (/RESPONSIVE_SEARCH_AD/.test(t) || action.startsWith('creative.'))
        return 'reclama RSA a campaniei';
      if (/KEYWORD/.test(t)) return 'grupul de anunțuri (cuvinte cheie)';
      if (/BUDGET/.test(t) || action === 'budget.increase.proposed')
        return (
          'bugetul campaniei' +
          (action === 'budget.increase.proposed' ? ' și CPC-ul maxim al grupului de anunțuri' : '')
        );
      if (/TARGET|MAXIMIZE|CPC|ROAS|CPA/.test(t)) return 'strategia de licitare a campaniei';
      if (/OPTIMIZE_AD_ROTATION/.test(t)) return 'setarea de rotație a reclamelor din campanie';
      if (/DYNAMIC_IMAGE/.test(t)) return 'contul (setare la nivel de cont)';
      return 'campanie';
    };
    const out = new Map<
      string,
      { campaignName: string | null; googleCampaignId: string | null; level: string }
    >();
    for (const r of rows) {
      const id = r.googleCampaignId ?? campaignByCategory.get(r.categoryId) ?? null;
      out.set(r.id, {
        campaignName: id ? (nameById.get(id) ?? null) : null,
        googleCampaignId: id,
        level: levelOf(r.action),
      });
    }
    return out;
  }

  /** Approves and executes through the workflow (hash check, atomic claim,
   *  exact execution, Google verification). */
  async approveProposalChecked(actionId: string, approvedByUserId: string, expectedHash?: string) {
    if (!this.workflow) return this.approveProposal(actionId, approvedByUserId);
    return this.workflow.approve(actionId, approvedByUserId, expectedHash);
  }

  /** "Recomandă manual": a corrected proposal from the admin's instructions,
   *  queued again for approval (never executed by itself). */
  async reviseProposal(actionId: string, userId: string, instructions: string) {
    if (!this.workflow) throw new BadRequestException('Fluxul de aprobare nu este disponibil.');
    const created = await this.workflow.revise(actionId, userId, instructions);
    return { ...withPreview(created), contentHash: proposalContentHash(created) };
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
    if (action?.action.startsWith('creative.')) {
      if (!this.optimizer) throw new Error('Optimizer unavailable.');
      return this.optimizer.approveProposal(actionId, approvedByUserId);
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
      return { items: rows.map(withPreview), page: params.page, pageSize: params.pageSize, total };
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
      items: matches.slice(start, start + params.pageSize).map(withPreview),
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
    // The write-based passes refuse to run where Google Ads writes are
    // disabled (outside production) instead of failing on every write; the
    // monitor runs anywhere (it only writes through the guarded optimizer).
    if (kind !== 'monitor' && !this.client.writesAllowed) {
      throw new BadRequestException(
        'Scrierile în contul Google Ads sunt blocate în acest mediu; doar ciclul de monitorizare poate fi pornit.',
      );
    }
    const run =
      kind === 'monitor'
        ? this.requireMonitor().run('manual')
        : kind === 'structural'
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

  private requireMonitor(): GoogleAdsMonitorService {
    if (!this.monitor) throw new Error('Monitor unavailable.');
    return this.monitor;
  }

  // --- optimization dashboard ------------------------------------------

  /** Account-level summary for the top of the admin page — every number
   *  derived from the latest real snapshots and run rows. */
  async optimizationSummary() {
    const [snapshots, lastMonitor, lastApplied, pendingCount, running] = await Promise.all([
      this.prisma.googleAdsCampaignSnapshot.findMany({
        select: {
          score: true,
          status: true,
          issues: true,
          managed: true,
          syncedAt: true,
          metrics: true,
          currencyCode: true,
        },
      }),
      this.prisma.googleAdsAgentRun.findFirst({
        where: { kind: 'monitor' },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.googleAdsAgentAction.findFirst({
        where: {
          status: 'applied',
          OR: [
            { action: { startsWith: 'creative.' } },
            { action: { startsWith: 'recommendation.' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        include: { category: true },
      }),
      this.prisma.googleAdsAgentAction.count({ where: { status: 'pending_approval' } }),
      this.monitor ? this.monitor.inProgress() : Promise.resolve(false),
    ]);
    type Issue = {
      priority: string;
      autoFixable?: boolean;
      scope?: string;
      code?: string;
      title?: string;
    };
    const allIssuesOf = (s: { issues: unknown }) =>
      Array.isArray(s.issues) ? (s.issues as Issue[]) : [];
    // Account-level issues are repeated on every campaign for visibility;
    // they are counted once below, never per campaign.
    const issuesOf = (s: { issues: unknown }) =>
      allIssuesOf(s).filter((i) => i.scope !== 'account');
    const accountIssues = [
      ...new Map(
        snapshots
          .flatMap((s) => allIssuesOf(s).filter((i) => i.scope === 'account'))
          .map((i) => [`${i.code}|${i.title}`, i]),
      ).values(),
    ];
    const scored = snapshots.filter((s) => s.score !== null);
    const weightOf = (s: { metrics: unknown }) => {
      const cost = Number(
        (s.metrics as { current?: { costMicros?: number } } | null)?.current?.costMicros ?? 0,
      );
      return cost > 0 ? cost : 0;
    };
    // Account score: average of campaign scores, weighted by 30-day spend
    // when there is spend (a campaign that spends more matters more),
    // plain average otherwise. Explained in the UI.
    const totalWeight = scored.reduce((s, x) => s + weightOf(x), 0);
    const accountScore = scored.length
      ? Math.round(
          totalWeight > 0
            ? scored.reduce((s, x) => s + (x.score ?? 0) * weightOf(x), 0) / totalWeight
            : scored.reduce((s, x) => s + (x.score ?? 0), 0) / scored.length,
        )
      : null;
    const needsAttention = (s: { score: number | null; issues: unknown }) =>
      (s.score !== null && s.score < 70) ||
      issuesOf(s).some((i) => i.priority === 'critical' || i.priority === 'high');
    const optimized = (s: { score: number | null; issues: unknown }) =>
      s.score !== null &&
      s.score >= 85 &&
      !issuesOf(s).some((i) => i.priority === 'critical' || i.priority === 'high');
    const byPriority: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of [...snapshots.flatMap(issuesOf), ...accountIssues]) {
      byPriority[i.priority] = (byPriority[i.priority] ?? 0) + 1;
    }
    return {
      accountScore,
      accountScoreWeighting: totalWeight > 0 ? 'spend' : 'average',
      campaigns: snapshots.length,
      activeCampaigns: snapshots.filter((s) => s.status === 'ENABLED').length,
      managedCampaigns: snapshots.filter((s) => s.managed).length,
      optimizedCampaigns: snapshots.filter(optimized).length,
      attentionCampaigns: snapshots.filter(needsAttention).length,
      opportunities: snapshots.reduce((n, s) => n + issuesOf(s).length, 0) + accountIssues.length,
      accountIssues,
      autoFixableOpportunities: snapshots.reduce(
        (n, s) => n + issuesOf(s).filter((i) => i.autoFixable).length,
        0,
      ),
      issuesByPriority: byPriority,
      pendingApprovals: pendingCount,
      lastSyncAt: snapshots.reduce<Date | null>(
        (d, s) => (!d || s.syncedAt > d ? s.syncedAt : d),
        null,
      ),
      lastRun: lastMonitor
        ? {
            status: lastMonitor.status,
            startedAt: lastMonitor.startedAt,
            finishedAt: lastMonitor.finishedAt,
            actionsTaken: lastMonitor.actionsTaken,
            actionsPendingApproval: lastMonitor.actionsPendingApproval,
            errorSummary: lastMonitor.errorSummary,
          }
        : null,
      lastOptimization: lastApplied
        ? {
            action: lastApplied.action,
            label: actionSearchLabel(lastApplied.action),
            at: lastApplied.createdAt,
            googleCampaignId: lastApplied.googleCampaignId,
          }
        : null,
      running,
      writesAllowed: this.client.writesAllowed,
      // Scheduled cycles only run while the agent is enabled; a manual run
      // works either way.
      enabled: await this.settings.googleAdsAgentEnabled(),
      monitorIntervalMinutes: await this.settings.googleAdsAgentMonitorIntervalMinutes(),
      autoFillEnabled: await this.settings.googleAdsAgentAutoFillGapsEnabled(),
    };
  }

  /** Campaign list (no heavy asset JSON). */
  async optimizationCampaigns() {
    const rows = await this.prisma.googleAdsCampaignSnapshot.findMany({
      orderBy: [{ managed: 'desc' }, { score: 'asc' }],
      select: {
        googleCampaignId: true,
        name: true,
        channelType: true,
        status: true,
        primaryStatus: true,
        managed: true,
        adStrength: true,
        score: true,
        metrics: true,
        issues: true,
        currencyCode: true,
        syncedAt: true,
        lastOptimizedAt: true,
      },
    });
    return rows.map(({ issues, ...r }) => {
      const list = Array.isArray(issues) ? (issues as { priority: string }[]) : [];
      const count = (p: string) => list.filter((i) => i.priority === p).length;
      return {
        ...r,
        issueCounts: {
          critical: count('critical'),
          high: count('high'),
          medium: count('medium'),
          low: count('low'),
        },
      };
    });
  }

  /** Full detail for one campaign: snapshot + its history + recent activity. */
  async optimizationCampaign(googleCampaignId: string) {
    const snapshot = await this.prisma.googleAdsCampaignSnapshot.findUnique({
      where: { googleCampaignId },
    });
    if (!snapshot)
      throw new NotFoundException('Campania nu apare în ultima sincronizare cu Google Ads.');
    const historyWhere: Prisma.GoogleAdsAgentActionWhereInput = snapshot.categoryId
      ? { OR: [{ googleCampaignId }, { categoryId: snapshot.categoryId, googleCampaignId: null }] }
      : { googleCampaignId };
    const [history, events] = await Promise.all([
      this.prisma.googleAdsAgentAction.findMany({
        where: historyWhere,
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { category: true, approvedBy: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.googleAdsAgentEvent.findMany({
        where: { googleCampaignId },
        orderBy: { startedAt: 'desc' },
        take: 60,
      }),
    ]);
    return {
      snapshot,
      history: history.map((a) => ({ ...withPreview(a), label: actionSearchLabel(a.action) })),
      events,
    };
  }

  /** The live activity feed. `after` (ISO) returns only events that
   *  started or changed since then, for cheap polling. */
  async activity(params: { after?: Date; googleCampaignId?: string; limit?: number }) {
    const take = Math.min(Math.max(params.limit ?? 80, 1), 300);
    const where: Prisma.GoogleAdsAgentEventWhereInput = {
      ...(params.googleCampaignId ? { googleCampaignId: params.googleCampaignId } : {}),
      ...(params.after
        ? { OR: [{ startedAt: { gt: params.after } }, { finishedAt: { gt: params.after } }] }
        : {}),
    };
    const [events, running] = await Promise.all([
      this.prisma.googleAdsAgentEvent.findMany({ where, orderBy: { startedAt: 'desc' }, take }),
      this.monitor ? this.monitor.inProgress() : Promise.resolve(false),
    ]);
    return { events, running, serverTime: new Date() };
  }
}
