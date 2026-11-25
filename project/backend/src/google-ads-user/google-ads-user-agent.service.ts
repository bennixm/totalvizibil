import type Anthropic from '@anthropic-ai/sdk';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAdsUserCampaign, Prisma } from '@prisma/client';
import { AffiliateService } from '../affiliate/affiliate.service';
import { AiService } from '../ai/ai.service';
import { AppConfig } from '../config/env';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AgentActivity } from '../google-ads/optimization/google-ads-activity';
import { CampaignData, fetchAccountData } from '../google-ads/optimization/google-ads-account-data';
import {
  CampaignEvaluation,
  evaluateCampaign,
} from '../google-ads/optimization/google-ads-campaign-evaluator';
import { rankKeywordsByPopularity } from '../google-ads/optimization/google-ads-keyword-popularity';
import { OptimizationTarget } from '../google-ads/optimization/google-ads-optimizer.service';
import { GoogleAdsWritesDisabledError } from '../google-ads/google-ads-api-client.service';
import { readSettings, SCHEDULE_DAYS, UserAgentSettings } from './agent-settings';
import { assessReadiness, businessContext, readBrief, Readiness } from './campaign-brief';
import { applyChatChange, isChatChange, verifyChatChange } from './chat-changes';
import { GoogleAdsOAuthService } from './google-ads-oauth.service';
import { GoogleAdsConnectionRevokedError, GoogleAdsUserClient } from './google-ads-user-client';
import { aiCostUsd, TokenUsage } from './chat-pricing';
import { PriceBreakdown, priceWork } from './pricing';
import { checkUrls, discoverSitePages, landingText } from './site-pages';
import { UserGoogleAdsOptimizer } from './user-optimizer';
import { hasWork, performedWork, planWork, WorkPlan } from './work-plan';

/** Wallet `provider` of every optimization charge/credit-back. Also the
 *  key of its spend category and its bucket in the AI usage report. */
export const OPTIMIZER_PROVIDER = 'google-ads-optimizer';
const CHARGE_DESCRIPTION = 'Google Ads optimization cycle';

/** A cycle still `running` after this long is treated as interrupted. */
const STALE_CYCLE_MS = 60 * 60 * 1000;
const SCHEDULER_INTERVAL_MS = 10 * 60 * 1000;
const PROPOSAL_TTL_MS = 30 * 86_400_000;
/** Longer than any approval takes. */
const STUCK_APPROVAL_MS = 10 * 60 * 1000;
/** Free re-sync at most this often per campaign (Google API quota). */
const MIN_SYNC_INTERVAL_MS = 2 * 60 * 1000;

export interface CampaignSnapshot {
  evaluation: CampaignEvaluation;
  campaign: {
    status: string;
    primaryStatus: string | null;
    primaryStatusReasons: string[];
    channelType: string;
    biddingStrategyType: string | null;
    dailyBudgetMicros: string | null;
    currencyCode: string | null;
    keywords: number;
  };
  readiness: Readiness;
  syncedAt: string;
}

export interface Analysis {
  c: CampaignData;
  ev: CampaignEvaluation;
  client: GoogleAdsUserClient;
  settings: UserAgentSettings;
  plan: WorkPlan;
  quote: PriceBreakdown;
  budgetRecommendations: BudgetRecommendation[];
  readiness: Readiness;
  landing: { url: string; text: string };
}

interface BudgetRecommendation {
  resourceName: string;
  currentMicros: number;
  recommendedMicros: number;
}

interface CycleNotice {
  campaignId: string;
  name: string;
  applied: number;
  proposed: number;
  refundMinor: number;
  failed: boolean;
  charged: boolean;
  scheduled: boolean;
}

/** What a cycle did, in one or two plain sentences. */
function cycleText(n: CycleNotice): string {
  const name = `„${n.name}”`;
  if (n.applied + n.proposed === 0) {
    const what = n.failed
      ? `Agentul nu a putut termina optimizarea campaniei ${name} și nu a schimbat nimic.`
      : `Agentul a verificat campania ${name}, dar nu a putut schimba nimic acum.`;
    if (!n.charged) return what;
    return `${what} Nu ai plătit: ${(n.refundMinor / 100).toLocaleString('ro-RO')} credite s-au întors în portofel.`;
  }
  const parts = [
    ...(n.applied
      ? [n.applied === 1 ? 'o modificare aplicată' : `${n.applied} modificări aplicate`]
      : []),
    ...(n.proposed
      ? [
          n.proposed === 1
            ? 'o propunere așteaptă aprobarea ta'
            : `${n.proposed} propuneri așteaptă aprobarea ta`,
        ]
      : []),
  ];
  return (
    `Campania ${name}: ${parts.join(', ')}.` +
    (n.failed
      ? ` Optimizarea s-a oprit înainte de final${n.charged ? '; ai plătit doar ce s-a făcut' : ''}.`
      : '')
  );
}

const QUIET_SKIPS = new Set([
  'nothing_to_do',
  'google_ads_reconnect_required',
  'cycle_already_running',
  'cycle_already_started',
  'campaign_paused',
  'restarting',
]);
const CREDIT_REASONS = new Set(['insufficient_credits', 'wallet_blocked']);
const SKIP_REASONS: Record<string, string> = {
  insufficient_credits: 'nu ai destule credite.',
  wallet_blocked: 'portofelul este blocat.',
  quote_above_limit: 'prețul depășește limita ta pe ciclu.',
  needs_information: 'agentul are nevoie de informații despre afacere; răspunde-i în chat.',
};

/** How long an unchanged campaign is not offered the same cycle again. */
const NO_CHANGE_RETRY_MS = 24 * 3_600_000;

/** Order-independent fingerprint of the settings a cycle ran with. */
function settingsKey(s: UserAgentSettings): string {
  return JSON.stringify(Object.entries(s).sort(([a], [b]) => a.localeCompare(b)));
}

@Injectable()
export class GoogleAdsUserAgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleAdsUserAgentService.name);
  private timer?: NodeJS.Timeout;
  /** Campaign ids with a cycle executing in THIS process. */
  private readonly running = new Set<string>();
  /** Work still `running` from before this process started is interrupted:
   *  the API runs as ONE process (pm2, see deploy/README.md). */
  private readonly bootedAt = new Date();
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: GoogleAdsOAuthService,
    private readonly wallet: WalletService,
    private readonly settings: PlatformSettingsService,
    private readonly ai: AiService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly notifications: NotificationsService,
    private readonly affiliate: AffiliateService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), SCHEDULER_INTERVAL_MS);
    this.timer.unref?.();
    // Interrupted cycles from a previous process: settle them right away.
    setTimeout(() => void this.settleStaleCycles(), 3_000).unref?.();
    setTimeout(() => void this.resumeReadbacks(), 30_000).unref?.();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    clearInterval(this.timer);
  }

  /** Keyword-headline checks a restart interrupted (last day). */
  async resumeReadbacks(): Promise<void> {
    try {
      const actions = await this.prisma.googleAdsUserAction.findMany({
        where: {
          action: 'creative.keyword_headlines',
          status: 'applied',
          createdAt: { gte: new Date(Date.now() - 86_400_000) },
          userCampaign: { status: 'active', user: { status: 'active' } },
        },
        include: { userCampaign: true },
      });
      for (const a of actions) {
        const row = a.userCampaign;
        try {
          const client = await this.clientFor(row);
          this.optimizerFor(row, client, readSettings(row.settings), null).resumeKeywordReadback(a);
        } catch (err) {
          this.logger.warn(
            `Read-back of ${a.id} not resumed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    } catch (err) {
      this.logger.error('Resuming read-backs failed', err instanceof Error ? err.stack : err);
    }
  }

  // ---------------------------------------------------------------- access

  async ownedCampaign(userId: string, id: string): Promise<GoogleAdsUserCampaign> {
    const row = await this.prisma.googleAdsUserCampaign.findUnique({ where: { id } });
    if (!row || row.userId !== userId || row.status === 'removed')
      throw new NotFoundException('Campania nu a fost găsită.');
    return row;
  }

  async clientFor(row: GoogleAdsUserCampaign): Promise<GoogleAdsUserClient> {
    const conn = await this.prisma.googleAdsConnection.findUnique({
      where: { id: row.connectionId },
    });
    if (!conn?.refreshTokenEnc || conn.status !== 'connected') {
      throw new BadRequestException('google_ads_reconnect_required');
    }
    return this.oauth.adsClient(conn.refreshTokenEnc, row.customerId, row.loginCustomerId);
  }

  /** Google refused the token: the connection and its campaigns stop, and
   *  the owner (if it has one yet) is told once. */
  async connectionLost(connectionId: string): Promise<void> {
    const [changed] = await this.prisma.$transaction([
      this.prisma.googleAdsConnection.updateMany({
        where: { id: connectionId, status: { not: 'revoked' } },
        data: {
          status: 'revoked',
          lastError: 'Google a refuzat accesul (consimțământ revocat sau expirat).',
        },
      }),
      ...this.loseConnection(connectionId),
    ]);
    if (!changed.count) return;
    const conn = await this.prisma.googleAdsConnection.findUnique({
      where: { id: connectionId },
      select: { userId: true, googleEmail: true, draftTokenHash: true },
    });
    if (!conn?.userId || conn.draftTokenHash) return;
    await this.tell(conn.userId, {
      type: 'google_ads_connection_lost',
      title: 'Am pierdut accesul la contul tău Google Ads',
      body: `Google nu mai permite accesul${conn.googleEmail ? ` la contul ${conn.googleEmail}` : ''}. Agentul s-a oprit până reconectezi contul. Nimic nu s-a schimbat în Google Ads.`,
      path: '/google-ads/connections',
      cta: 'Reconectează contul',
      email: true,
    });
  }

  /** One notice to an owner. Never breaks the work it describes. */
  private async tell(
    userId: string,
    n: {
      type: string;
      title: string;
      body: string;
      path: string;
      cta: string;
      campaignId?: string;
      tab?: string;
      email?: boolean;
    },
  ): Promise<void> {
    try {
      await this.notifications.notify({
        userId,
        type: n.type,
        title: n.title,
        body: n.body,
        data: {
          ...(n.campaignId ? { adsCampaignId: n.campaignId } : {}),
          ...(n.tab ? { tab: n.tab } : {}),
        },
        channels: { panel: true, email: !!n.email },
        ...(n.email ? { email: { greet: true, cta: { label: n.cta, url: n.path } } } : {}),
      });
    } catch (err) {
      this.logger.warn(
        `Notice ${n.type} for ${userId} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Every campaign of a lost connection, remembering what a reconnect
   *  restores. Run inside a transaction. */
  loseConnection(connectionId: string) {
    return (['active', 'paused'] as const).map((status) =>
      this.prisma.googleAdsUserCampaign.updateMany({
        where: { connectionId, status },
        data: { status: 'disconnected', resumeStatus: status },
      }),
    );
  }

  // -------------------------------------------------------------- analysis

  /** Free: reads the campaign from Google, evaluates it with the platform's
   *  evaluator, stores the snapshot, plans the next cycle and prices it. */
  async analyze(row: GoogleAdsUserCampaign): Promise<Analysis> {
    const client = await this.clientFor(row);
    let data;
    try {
      data = await fetchAccountData(client);
    } catch (err) {
      if (err instanceof GoogleAdsConnectionRevokedError) {
        await this.connectionLost(row.connectionId);
        throw new BadRequestException('google_ads_reconnect_required');
      }
      throw err;
    }
    const c = data.campaigns.find((x) => x.googleCampaignId === row.googleCampaignId);
    if (!c) {
      throw new BadRequestException(
        'Campania nu mai apare în contul Google Ads (a fost ștearsă sau accesul s-a schimbat).',
      );
    }
    const urlChecks = await checkUrls(c.ads.flatMap((a) => a.finalUrls));
    let ev = evaluateCampaign(c, { managed: true, urlChecks });
    const settings = readSettings(row.settings);
    const budgetRecommendations = settings.budgetProposals
      ? await this.budgetRecommendations(client, c).catch(() => [])
      : [];
    const optimizer = this.optimizerFor(row, client, settings, null);
    const rsaBlocked = !!(await optimizer.rsaChangeBlocker(c));
    const keywordsBlocked = !!(await optimizer.keywordChangeBlocker(c));
    // Never promise (or price) a business name Google refuses to accept.
    const canName = settings.autoApply && !!settings.businessName;
    const nameRefused =
      canName &&
      !ev.assets.businessName &&
      (await optimizer.businessNameRefused(c, settings.businessName));
    if (!ev.assets.businessName && (!canName || nameRefused)) {
      ev = evaluateCampaign(c, {
        managed: true,
        urlChecks,
        businessNameBlocker: nameRefused ? 'unverified' : 'unset',
      });
    }
    // Same popularity order as the cycle, so the plan matches what it does.
    const kw = ev.assets.headlineKeywords;
    const rankedKeywords =
      settings.autoApply && settings.keywordHeadlines && !keywordsBlocked && kw?.missing.length
        ? (
            await rankKeywordsByPopularity(client, c.googleCampaignId, [
              ...kw.covered,
              ...kw.missing,
            ])
          ).ranked.map((r) => r.keyword)
        : undefined;
    const plan = planWork(c, ev, settings, {
      rsaBlocked,
      imagesAvailable: !!this.config.get('pexelsApiKey', { infer: true }),
      budgetRecommendations: budgetRecommendations.length,
      hasBusinessName: canName && !nameRefused,
      keywordsBlocked,
      rankedKeywords,
    });
    const pricing = await this.settings.googleAdsOptimizerPricing();
    const quote = priceWork(pricing, plan.units, plan.elementsAnalyzed);
    const landingUrl =
      [...c.ads]
        .sort((a, b) => Number(b.status === 'ENABLED') - Number(a.status === 'ENABLED'))
        .flatMap((a) => a.finalUrls)[0] ?? '';
    const landing = { url: landingUrl, text: await landingText(landingUrl) };
    const readiness = assessReadiness(c, settings, readBrief(row.brief), landing.text);
    await this.saveSnapshot(row, c, ev, readiness);
    return {
      c,
      ev,
      client,
      settings,
      plan,
      quote,
      budgetRecommendations,
      readiness,
      landing,
    };
  }

  private async saveSnapshot(
    row: GoogleAdsUserCampaign,
    c: CampaignData,
    ev: CampaignEvaluation,
    readiness: Readiness,
  ) {
    const rsa = c.ads.find((a) => a.status === 'ENABLED') ?? c.ads[0];
    const snapshot: CampaignSnapshot = {
      evaluation: ev,
      campaign: {
        status: c.status,
        primaryStatus: c.primaryStatus ?? null,
        primaryStatusReasons: c.primaryStatusReasons,
        channelType: c.channelType,
        biddingStrategyType: c.biddingStrategyType ?? null,
        dailyBudgetMicros: c.dailyBudgetMicros ?? null,
        currencyCode: c.currencyCode ?? null,
        keywords: rsa?.keywords.length ?? 0,
      },
      readiness,
      syncedAt: new Date().toISOString(),
    };
    await this.prisma.googleAdsUserCampaign.update({
      where: { id: row.id },
      data: {
        name: c.name,
        channelType: c.channelType,
        currencyCode: c.currencyCode ?? row.currencyCode,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        score: ev.score,
        adStrength: ev.adStrength,
        syncedAt: new Date(),
      },
    });
  }

  /** Free re-sync for the dashboard, throttled per campaign. */
  async sync(userId: string, id: string) {
    const row = await this.ownedCampaign(userId, id);
    if (row.syncedAt && Date.now() - row.syncedAt.getTime() < MIN_SYNC_INTERVAL_MS) {
      return { synced: false, syncedAt: row.syncedAt };
    }
    const a = await this.analyze(row);
    return { synced: true, syncedAt: new Date(), score: a.ev.score };
  }

  /** Free: what the next cycle would do and cost. */
  async quote(userId: string, id: string) {
    const row = await this.ownedCampaign(userId, id);
    const a = await this.analyze(row);
    return {
      quote: a.quote,
      tasks: a.plan.tasks,
      score: a.ev.score,
      readiness: a.readiness,
      nothingToDo: !hasWork(a.plan, a.ev) || (await this.nothingChangedSince(row, a.settings)),
      balanceMinor: (await this.wallet.getSummary(userId)).balance.minor,
    };
  }

  private optimizerFor(
    row: GoogleAdsUserCampaign,
    client: GoogleAdsUserClient,
    settings: UserAgentSettings,
    cycleId: string | null,
  ): UserGoogleAdsOptimizer {
    return new UserGoogleAdsOptimizer(client, this.ai, settings, this.prisma, this.config, cycleId);
  }

  private targetFor(row: GoogleAdsUserCampaign, settings: UserAgentSettings): OptimizationTarget {
    const context = businessContext(settings, readBrief(row.brief));
    const name = settings.businessDescription || settings.businessName || row.name;
    return {
      owner: { userCampaignId: row.id },
      name,
      imageQuery: (settings.imageQuery || settings.businessDescription || row.name).slice(0, 80),
      landingFallback: '',
      businessName: settings.businessName || null,
      advertiser: {
        businessName: settings.businessName || row.customerName || undefined,
        description: context || undefined,
      },
      sitelinkDestinations: async (exclude, count) => {
        const landing = [...exclude].find((u) => /^https?:\/\//.test(u)) ?? '';
        return discoverSitePages(landing, exclude, count);
      },
    };
  }

  // ------------------------------------------------------- budget proposals

  private async budgetRecommendations(
    client: GoogleAdsUserClient,
    c: CampaignData,
  ): Promise<BudgetRecommendation[]> {
    const rows = await client.search(
      'SELECT recommendation.resource_name, recommendation.type, ' +
        'recommendation.campaign_budget_recommendation.current_budget_amount_micros, ' +
        'recommendation.campaign_budget_recommendation.recommended_budget_amount_micros ' +
        `FROM recommendation WHERE recommendation.type = 'CAMPAIGN_BUDGET' AND recommendation.campaign = '${c.resourceName}'`,
    );
    return rows
      .map((r) => {
        const rec = r.recommendation as
          | {
              resourceName?: string;
              campaignBudgetRecommendation?: {
                currentBudgetAmountMicros?: string;
                recommendedBudgetAmountMicros?: string;
              };
            }
          | undefined;
        return {
          resourceName: rec?.resourceName ?? '',
          currentMicros: Number(rec?.campaignBudgetRecommendation?.currentBudgetAmountMicros ?? 0),
          recommendedMicros: Number(
            rec?.campaignBudgetRecommendation?.recommendedBudgetAmountMicros ?? 0,
          ),
        };
      })
      .filter(
        (r) => r.resourceName && r.recommendedMicros > 0 && r.recommendedMicros !== r.currentMicros,
      );
  }

  private async proposeBudgets(
    row: GoogleAdsUserCampaign,
    a: Analysis,
    cycleId: string,
    activity: AgentActivity,
  ): Promise<number> {
    const meta = { googleCampaignId: a.c.googleCampaignId, campaignName: a.c.name };
    if (!a.budgetRecommendations.length) {
      await activity.record(
        { ...meta, step: 'budget', message: 'Verificare recomandări de buget Google' },
        {
          status: 'skipped',
          result: 'Google nu recomandă momentan o modificare de buget pentru această campanie.',
        },
      );
      return 0;
    }
    const pending = await this.prisma.googleAdsUserAction.count({
      where: {
        userCampaignId: row.id,
        action: 'budget.change.proposed',
        status: 'pending_approval',
      },
    });
    if (pending) {
      await activity.record(
        { ...meta, step: 'budget', message: 'Propunere de buget' },
        { status: 'skipped', result: 'Există deja o propunere de buget care așteaptă decizia ta.' },
      );
      return 0;
    }
    const rec = a.budgetRecommendations[0];
    const budget = await this.liveBudget(a.client, a.c.googleCampaignId);
    if (!budget) return 0;
    if (budget.shared) {
      await activity.record(
        { ...meta, step: 'budget', message: 'Propunere de buget' },
        {
          status: 'skipped',
          result:
            'Bugetul campaniei este partajat cu alte campanii; agentul nu propune modificări care le-ar afecta și pe ele.',
        },
      );
      return 0;
    }
    await this.prisma.googleAdsUserAction.create({
      data: {
        userCampaignId: row.id,
        cycleId,
        googleCampaignId: a.c.googleCampaignId,
        action: 'budget.change.proposed',
        status: 'pending_approval',
        requiredApproval: true,
        before: {
          budgetResourceName: budget.resourceName,
          amountMicros: String(budget.amountMicros),
          currencyCode: a.c.currencyCode ?? null,
        },
        after: {
          amountMicros: String(rec.recommendedMicros),
          currencyCode: a.c.currencyCode ?? null,
          source: 'google_recommendation',
          recommendationResourceName: rec.resourceName,
        },
        reasoning:
          'Google recomandă acest buget zilnic pentru campanie, pe baza datelor ei reale. ' +
          'Bugetul nu se modifică niciodată fără aprobarea ta.',
      },
    });
    await activity.record(
      { ...meta, step: 'budget', message: 'Propunere de buget creată' },
      {
        status: 'waiting_approval',
        result: `Buget zilnic propus: ${(rec.recommendedMicros / 1e6).toFixed(2)} ${a.c.currencyCode ?? ''} (acum ${(budget.amountMicros / 1e6).toFixed(2)}). Așteaptă aprobarea ta.`,
      },
    );
    return 1;
  }

  async liveBudget(
    client: GoogleAdsUserClient,
    googleCampaignId: string,
  ): Promise<{ resourceName: string; amountMicros: number; shared: boolean } | null> {
    const rows = await client.search(
      'SELECT campaign.id, campaign.campaign_budget, campaign_budget.amount_micros, campaign_budget.explicitly_shared ' +
        `FROM campaign WHERE campaign.id = ${googleCampaignId}`,
    );
    const r = rows[0];
    const rn = (r?.campaign as { campaignBudget?: string } | undefined)?.campaignBudget;
    const b = r?.campaignBudget as
      { amountMicros?: string; explicitlyShared?: boolean } | undefined;
    if (!rn || !b?.amountMicros) return null;
    return { resourceName: rn, amountMicros: Number(b.amountMicros), shared: !!b.explicitlyShared };
  }

  // ------------------------------------------------------------- cycles

  /**
   * Starts a billed cycle. Prepaid and idempotent: the quote is charged in
   * the same transaction that creates the cycle row (unique idempotency
   * key, one running cycle per campaign), then the work runs in the
   * background. `expectedQuoteMinor` (what the owner saw) protects against
   * paying more than they agreed to.
   */
  async startCycle(
    userId: string,
    id: string,
    opts: {
      idempotencyKey?: string;
      expectedQuoteMinor?: number;
      trigger: 'manual' | 'scheduled' | 'staff';
      /** Started by staff: nothing is held or charged. */
      free?: boolean;
      maxMinor?: number;
      /** The owner chose to run although the agent lacks information. */
      ignoreMissingInfo?: boolean;
    },
  ) {
    if (opts.idempotencyKey) {
      const existing = await this.prisma.googleAdsOptimizationCycle.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      if (existing) {
        if (existing.userId !== userId) throw new ForbiddenException();
        return {
          cycleId: existing.id,
          status: existing.status,
          chargedMinor: existing.quotedMinor,
        };
      }
    }
    // Shutting down (deploy): the work would be cut off at once.
    if (this.stopping) throw new ServiceUnavailableException('restarting');
    const row = await this.ownedCampaign(userId, id);
    if (row.status !== 'active') {
      throw new BadRequestException(
        row.status === 'disconnected' ? 'google_ads_reconnect_required' : 'campaign_paused',
      );
    }
    if (this.running.has(row.id)) throw new ConflictException('cycle_already_running');
    if (!opts.free) await this.wallet.assertSpendable(userId);

    const a = await this.analyze(row);
    // Nothing it could change: a cycle would only cost credits.
    if (!hasWork(a.plan, a.ev) || (await this.nothingChangedSince(row, a.settings))) {
      throw new ConflictException('nothing_to_do');
    }
    // Not enough to work from: the agent asks (chat) instead of guessing.
    if (a.readiness.level === 'insufficient' && !opts.ignoreMissingInfo) {
      throw new ConflictException({
        statusCode: 409,
        message: 'needs_information',
        readiness: a.readiness,
      });
    }
    if (opts.expectedQuoteMinor != null && a.quote.minor > opts.expectedQuoteMinor) {
      throw new ConflictException({
        statusCode: 409,
        message: 'quote_changed',
        quote: a.quote,
        tasks: a.plan.tasks,
      });
    }
    if (opts.maxMinor != null && a.quote.minor > opts.maxMinor) {
      throw new BadRequestException('quote_above_limit');
    }

    let cycleId: string;
    try {
      cycleId = await this.prisma.$transaction(async (tx) => {
        // Lock the campaign row: concurrent starts serialize here.
        await tx.$queryRaw`SELECT id FROM google_ads_user_campaigns WHERE id = ${row.id}::uuid FOR UPDATE`;
        const busy = await tx.googleAdsOptimizationCycle.count({
          where: { userCampaignId: row.id, status: 'running' },
        });
        if (busy) throw new ConflictException('cycle_already_running');
        const cycle = await tx.googleAdsOptimizationCycle.create({
          data: {
            userCampaignId: row.id,
            userId,
            trigger: opts.trigger,
            idempotencyKey: opts.idempotencyKey ?? null,
            quote: {
              ...a.quote,
              tasks: a.plan.tasks,
              settingsKey: settingsKey(a.settings),
            } as unknown as Prisma.InputJsonValue,
            quotedMinor: a.quote.minor,
            complexityLevel: a.quote.level.key,
            complexityPoints: a.quote.points,
            tasksPlanned: a.plan.tasks.length,
            elementsAnalyzed: a.plan.elementsAnalyzed,
            scoreBefore: a.ev.score,
          },
        });
        // Hold the quote now (prepaid, cannot be spent twice); the final
        // price is captured on this same row when the cycle settles.
        if (opts.free) return cycle.id;
        const charge = await this.wallet.holdWithin(tx, userId, a.quote.minor, {
          description: CHARGE_DESCRIPTION,
          provider: OPTIMIZER_PROVIDER,
        });
        if (!charge) throw new BadRequestException('insufficient_credits');
        await tx.googleAdsOptimizationCycle.update({
          where: { id: cycle.id },
          data: { chargeTxnId: charge.transactionId, chargedMinor: a.quote.minor },
        });
        return cycle.id;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('cycle_already_started');
      }
      throw err;
    }

    this.running.add(row.id);
    // A failed settlement must not crash the process (unhandled rejection);
    // the cycle stays `running` and the stale sweep settles it.
    void this.execute(row, cycleId, a)
      .catch((err) =>
        this.logger.error(
          `Cycle ${cycleId} could not be settled`,
          err instanceof Error ? err.stack : err,
        ),
      )
      .finally(() => this.running.delete(row.id));
    return {
      cycleId,
      status: 'running' as const,
      chargedMinor: opts.free ? 0 : a.quote.minor,
    };
  }

  /**
   * The last cycle (today) changed nothing and was returned in full, and the
   * owner has not given the agent anything new since: running it again would
   * end the same way, so it is not offered again until something changes.
   */
  private async nothingChangedSince(
    row: GoogleAdsUserCampaign,
    settings: UserAgentSettings,
  ): Promise<boolean> {
    const last = await this.prisma.googleAdsOptimizationCycle.findFirst({
      where: { userCampaignId: row.id, status: { not: 'running' } },
      orderBy: { startedAt: 'desc' },
    });
    if (
      !last ||
      last.status !== 'completed' ||
      last.tasksApplied + last.tasksProposed > 0 ||
      Date.now() - last.startedAt.getTime() > NO_CHANGE_RETRY_MS
    ) {
      return false;
    }
    const key = (last.quote as { settingsKey?: string } | null)?.settingsKey;
    if (key !== settingsKey(settings)) return false;
    const since = { gt: last.startedAt };
    const [turns, actions] = await Promise.all([
      this.prisma.googleAdsChatTurn.count({
        where: { userCampaignId: row.id, createdAt: since },
      }),
      this.prisma.googleAdsUserAction.count({
        where: { userCampaignId: row.id, approvedAt: since },
      }),
    ]);
    return turns + actions === 0;
  }

  /** The cycle's work, the same passes the platform monitor runs. */
  private async execute(row: GoogleAdsUserCampaign, cycleId: string, a: Analysis): Promise<void> {
    const activity = new AgentActivity(this.prisma, cycleId, row.id);
    const meta = { googleCampaignId: a.c.googleCampaignId, campaignName: a.c.name };
    const optimizer = this.optimizerFor(row, a.client, a.settings, cycleId);
    const target = this.targetFor(row, a.settings);
    let aiCostMinor = 0;
    let error: string | null = null;
    // Saved after every AI call, so an interrupted cycle keeps its cost.
    const used = { calls: 0, usd: 0, input: 0, output: 0, model: '' };
    const onUsage = (model: string, u: Anthropic.Usage) => {
      const t: TokenUsage = {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      };
      used.calls++;
      used.usd += aiCostUsd(model, t);
      used.input += t.input + t.cacheRead + t.cacheWrite;
      used.output += t.output;
      used.model = model;
      void this.prisma.googleAdsOptimizationCycle
        .updateMany({
          where: { id: cycleId, status: 'running' },
          data: {
            aiCostMinor: Math.round(used.usd * 100),
            aiCallCount: used.calls,
            aiModel: model,
            inputTokens: used.input,
            outputTokens: used.output,
          },
        })
        .catch(() => undefined);
    };
    const work = async (): Promise<void> => {
      await activity.record(
        { ...meta, step: 'analyze', message: 'Analiză și scor față de cerințele Google' },
        {
          result:
            `Scor ${a.ev.score ?? '–'} din 100. ` +
            `Lucruri de îmbunătățit: ${a.ev.issues.length}, dintre care agentul poate rezolva ${a.ev.issues.filter((i) => i.autoFixable).length}.`,
          details: {
            quote: a.quote.credits,
            tasks: a.plan.tasks,
          } as unknown as Prisma.InputJsonValue,
        },
      );
      if (!a.client.writesAllowed) {
        await activity.record(
          { ...meta, step: 'environment', message: 'Mod doar-validare' },
          {
            status: 'skipped',
            result:
              'Mediu non-producție: modificările sunt validate la Google, dar nu sunt aplicate în cont.',
          },
        );
      }
      const changed = new Set<string>();
      // Policy compliance first: disapproved texts/assets/keywords block
      // serving, so they are fixed before anything else, then the campaign
      // is re-read so the next steps work on what is live now.
      let cur = { c: a.c, ev: a.ev };
      const policy = await optimizer.fixPolicyViolations(a.c, target, activity);
      aiCostMinor += policy.costEstimateMinor;
      if (policy.applied) {
        changed.add(a.c.googleCampaignId);
        try {
          const fresh = await this.analyze(row);
          cur = { c: fresh.c, ev: fresh.ev };
        } catch {
          /* keep the pre-fix data; gap filling re-checks against Google */
        }
      }
      // Popular keywords in headlines first (direct Ad Strength factor);
      // gap filling then leaves the just-changed ad text alone.
      if (a.settings.keywordHeadlines) {
        const k = await optimizer.fixHeadlineKeywords(cur.c, target, activity);
        aiCostMinor += k.costEstimateMinor;
        if (k.applied) changed.add(a.c.googleCampaignId);
      }
      const fill = await optimizer.fillGaps(cur.c, cur.ev, target, activity);
      aiCostMinor += fill.costEstimateMinor;
      if (fill.applied) changed.add(a.c.googleCampaignId);
      if (a.settings.textRewriteProposals) {
        const r = await optimizer.proposeReplacements(cur.c, target, activity);
        aiCostMinor += r.costEstimateMinor;
        if (!changed.size) {
          const s = await optimizer.proposeAdStrengthRewrite(cur.c, target, activity);
          aiCostMinor += s.costEstimateMinor;
        }
      }
      if (a.settings.budgetProposals) await this.proposeBudgets(row, a, cycleId, activity);
    };
    try {
      await this.ai.meter(onUsage, work);
    } catch (err) {
      if (err instanceof GoogleAdsConnectionRevokedError)
        await this.connectionLost(row.connectionId);
      error =
        err instanceof GoogleAdsWritesDisabledError
          ? null
          : err instanceof Error
            ? err.message
            : String(err);
      this.logger.error(`Cycle ${cycleId} failed`, err instanceof Error ? err.stack : err);
    }

    // Score after the cycle (free re-read; best effort).
    let scoreAfter: number | null = null;
    try {
      const after = await this.analyze(row);
      scoreAfter = after.ev.score;
    } catch {
      /* keep scoreBefore as the latest known */
    }
    await this.settle(cycleId, {
      error,
      ai: used.calls
        ? { ...used, costMinor: Math.round(used.usd * 100) }
        : { costMinor: aiCostMinor },
      scoreAfter,
    });
  }

  /**
   * Final price = the work actually performed, priced with the same rules,
   * never more than the quote. A cycle that changed and proposed nothing is
   * free: the whole hold goes back and the owner is told why. The
   * difference goes back to the wallet in one transaction with the cycle
   * update, so the cycle and the ledger can never disagree.
   */
  async settle(
    cycleId: string,
    opts: {
      error: string | null;
      /** Absent = keep what was saved while the cycle ran. */
      ai?: {
        costMinor: number;
        calls?: number;
        input?: number;
        output?: number;
        model?: string;
      };
      scoreAfter: number | null;
    },
  ): Promise<void> {
    const cycle = await this.prisma.googleAdsOptimizationCycle.findUnique({
      where: { id: cycleId },
      include: { actions: { select: { action: true, status: true, after: true } } },
    });
    if (!cycle || cycle.status !== 'running') return;
    const pricing = await this.settings.googleAdsOptimizerPricing();
    const failedEarly = !!opts.error && cycle.actions.length === 0;
    const work = performedWork(cycle.actions, !failedEarly);
    const performed = priceWork(pricing, work, failedEarly ? 0 : cycle.elementsAnalyzed);
    const applied = cycle.actions.filter((x) => x.status === 'applied').length;
    const proposed = cycle.actions.filter((x) => x.status === 'pending_approval').length;
    const noChange = applied + proposed === 0;
    const finalMinor = noChange
      ? 0
      : Math.min(
          cycle.quotedMinor,
          Math.max(Math.round(pricing.minCredits * 100), performed.minor),
        );
    const charged = cycle.chargeTxnId ? cycle.quotedMinor : 0;
    const refundMinor = Math.max(0, charged - finalMinor);
    const aiCalls = await this.prisma.googleAdsAgentEvent.count({
      where: { runId: cycleId, step: 'generate' },
    });

    const settled = await this.prisma.$transaction(async (tx) => {
      // Claim: only one settlement ever (running -> completed/failed).
      const claimed = await tx.googleAdsOptimizationCycle.updateMany({
        where: { id: cycleId, status: 'running' },
        data: { status: opts.error ? 'failed' : 'completed', finishedAt: new Date() },
      });
      if (!claimed.count) return false;
      // Capture the final price on the held row; the rest goes back.
      if (cycle.chargeTxnId) {
        await this.wallet.captureHold(tx, cycle.chargeTxnId, charged - refundMinor);
      }
      const summary = opts.error
        ? `Ciclul s-a oprit: ${opts.error}`
        : `${applied} modificări aplicate, ${proposed} propuneri pentru aprobare.`;
      await tx.googleAdsOptimizationCycle.update({
        where: { id: cycleId },
        data: {
          chargedMinor: charged - refundMinor,
          refundedMinor: refundMinor,
          settlement: performed as unknown as Prisma.InputJsonValue,
          tasksApplied: applied,
          tasksProposed: proposed,
          ...(opts.ai
            ? {
                aiCostMinor: opts.ai.costMinor,
                aiCallCount: opts.ai.calls ?? aiCalls,
                inputTokens: opts.ai.input ?? 0,
                outputTokens: opts.ai.output ?? 0,
                aiModel:
                  opts.ai.model ?? (this.config.get('anthropicModelFast', { infer: true }) || null),
              }
            : {}),
          scoreAfter: opts.scoreAfter,
          summary,
          errorMessage: opts.error,
        },
      });
      const settings = readSettings(
        (await tx.googleAdsUserCampaign.findUnique({ where: { id: cycle.userCampaignId } }))
          ?.settings,
      );
      const days = SCHEDULE_DAYS[settings.schedule];
      await tx.googleAdsUserCampaign.update({
        where: { id: cycle.userCampaignId },
        data: {
          lastCycleAt: new Date(),
          nextCycleAt: days ? new Date(Date.now() + days * 86_400_000) : null,
        },
      });
      return true;
    });
    // Paid agent work counts as "started using the platform" for referrals.
    if (settled && charged - refundMinor > 0)
      void this.affiliate.maybeReward(cycle.userId).catch(() => undefined);
    if (settled)
      await this.announce(cycle, { applied, proposed, refundMinor, failed: !!opts.error });
  }

  /** Results of scheduled cycles waiting for the owner's other scheduled
   *  cycles, so several campaigns make one message. */
  private readonly notices = new Map<string, CycleNotice[]>();

  private async announce(
    cycle: { userId: string; userCampaignId: string; trigger: string; chargeTxnId: string | null },
    r: { applied: number; proposed: number; refundMinor: number; failed: boolean },
  ): Promise<void> {
    const row = await Promise.resolve()
      .then(() =>
        this.prisma.googleAdsUserCampaign.findUnique({
          where: { id: cycle.userCampaignId },
          select: { name: true },
        }),
      )
      .catch(() => null);
    const notice: CycleNotice = {
      ...r,
      campaignId: cycle.userCampaignId,
      name: row?.name ?? '',
      charged: !!cycle.chargeTxnId,
      scheduled: cycle.trigger === 'scheduled',
    };
    if (!notice.scheduled) return this.tellCycle(cycle.userId, notice);
    const list = [...(this.notices.get(cycle.userId) ?? []), notice];
    const more = await Promise.resolve()
      .then(() =>
        this.prisma.googleAdsOptimizationCycle.count({
          where: { userId: cycle.userId, trigger: 'scheduled', status: 'running' },
        }),
      )
      .catch(() => 0);
    if (more) {
      this.notices.set(cycle.userId, list);
      return;
    }
    this.notices.delete(cycle.userId);
    if (list.length === 1) return this.tellCycle(cycle.userId, list[0]);
    const proposed = list.reduce((n, x) => n + x.proposed, 0);
    await this.tell(cycle.userId, {
      type: 'google_ads_cycle_done',
      title: `Agentul a verificat ${list.length} campanii Google Ads`,
      body: list.map((x) => cycleText(x)).join(' '),
      path: '/google-ads/panel',
      cta: 'Vezi campaniile',
      email: proposed > 0 || list.some((x) => x.failed),
    });
  }

  private async tellCycle(userId: string, n: CycleNotice): Promise<void> {
    const none = n.applied + n.proposed === 0;
    // A free staff run that found nothing: the owner was told it started.
    if (none && !n.charged && !n.failed) return;
    const tab = n.proposed ? 'proposals' : 'history';
    return this.tell(userId, {
      type:
        none && !n.failed
          ? 'google_ads_no_change'
          : n.failed
            ? 'google_ads_cycle_failed'
            : 'google_ads_cycle_done',
      title:
        none && n.charged
          ? 'Ți-am returnat creditele'
          : n.failed
            ? 'Optimizarea Google Ads s-a oprit'
            : none
              ? 'Agentul a verificat campania'
              : 'Agentul a optimizat campania',
      body: cycleText(n),
      campaignId: n.campaignId,
      tab,
      path: `/google-ads/c/${n.campaignId}?tab=${tab}`,
      cta: n.proposed ? 'Vezi propunerile' : 'Vezi campania',
      // Nobody is watching a scheduled cycle; what needs a decision is mailed.
      email: n.scheduled && (n.failed || n.proposed > 0),
    });
  }

  /** Scheduled cycles that could not start, one message per owner. */
  private async tellSkipped(userId: string, list: { id: string; name: string; reason: string }[]) {
    const credits = list.some((x) => CREDIT_REASONS.has(x.reason));
    await this.tell(userId, {
      type: 'google_ads_cycle_skipped',
      title:
        list.length === 1
          ? 'Un ciclu Google Ads programat nu a pornit'
          : `${list.length} cicluri Google Ads programate nu au pornit`,
      body: `${list.map((x) => `„${x.name}”: ${SKIP_REASONS[x.reason] ?? 'Google Ads nu a răspuns corect.'}`).join(' ')} Nu ai plătit nimic, iar agentul încearcă din nou la următoarea programare.`,
      ...(list.length === 1 ? { campaignId: list[0].id, tab: 'home' } : {}),
      path: credits
        ? '/wallet'
        : list.length === 1
          ? `/google-ads/c/${list[0].id}`
          : '/google-ads/panel',
      cta: credits ? 'Vezi portofelul' : 'Vezi campania',
      email: true,
    });
  }

  /** Cycles left `running` by a crashed/restarted process. */
  async settleStaleCycles(): Promise<void> {
    const stale = await this.prisma.googleAdsOptimizationCycle.findMany({
      where: {
        status: 'running',
        OR: [
          { startedAt: { lt: this.bootedAt } },
          { startedAt: { lt: new Date(Date.now() - STALE_CYCLE_MS) } },
        ],
      },
      select: { id: true, userCampaignId: true },
    });
    for (const c of stale) {
      if (this.running.has(c.userCampaignId)) continue;
      await this.settle(c.id, {
        error: 'Ciclul a fost întrerupt (repornire server); ai plătit doar pentru ce s-a efectuat.',
        scoreAfter: null,
      }).catch((err) => this.logger.error(`Settling stale cycle ${c.id} failed`, err));
    }
  }

  /** Scheduled cycles (opt-in per campaign, each billed, capped). */
  private async tick(): Promise<void> {
    try {
      await this.settleStaleCycles();
      await this.expireProposals();
      await this.settleStuckApprovals();
      const due = await this.prisma.googleAdsUserCampaign.findMany({
        where: {
          status: 'active',
          nextCycleAt: { lte: new Date() },
          // A suspended account is never charged and its ads never touched.
          user: { status: 'active' },
        },
        take: 20,
      });
      const skipped = new Map<string, { id: string; name: string; reason: string }[]>();
      for (const row of due) {
        const s = readSettings(row.settings);
        if (s.schedule === 'manual') {
          await this.prisma.googleAdsUserCampaign.update({
            where: { id: row.id },
            data: { nextCycleAt: null },
          });
          continue;
        }
        try {
          await this.startCycle(row.userId, row.id, {
            trigger: 'scheduled',
            maxMinor: Math.round(s.maxCreditsPerCycle * 100),
            idempotencyKey: `sched:${row.id}:${row.nextCycleAt?.toISOString()}`,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          // Nothing to improve is good news; a lost account has its own notice.
          if (!QUIET_SKIPS.has(reason))
            skipped.set(row.userId, [
              ...(skipped.get(row.userId) ?? []),
              { id: row.id, name: row.name, reason },
            ]);
          await new AgentActivity(this.prisma, null, row.id).record(
            {
              googleCampaignId: row.googleCampaignId,
              campaignName: row.name,
              step: 'schedule',
              message: 'Ciclu programat',
            },
            {
              status: 'skipped',
              result: `Ciclul programat nu a pornit (${reason}). Se reîncearcă la următoarea programare.`,
            },
          );
          const days = SCHEDULE_DAYS[s.schedule] ?? 7;
          await this.prisma.googleAdsUserCampaign.update({
            where: { id: row.id },
            data: { nextCycleAt: new Date(Date.now() + days * 86_400_000) },
          });
        }
      }
      for (const [userId, list] of skipped) await this.tellSkipped(userId, list);
    } catch (err) {
      this.logger.error('Scheduler tick failed', err instanceof Error ? err.stack : err);
    }
  }

  // ------------------------------------------------------------ approvals

  /** `actorId`: who decided, when it is staff and not the owner. */
  async approveAction(userId: string, campaignId: string, actionId: string, actorId = userId) {
    const result = await this.executeApproval(userId, campaignId, actionId, actorId);
    // The dashboard shows the stored snapshot: re-read the campaign so what
    // was just applied no longer appears as missing.
    if (result?.status === 'applied') {
      await this.analyze(await this.ownedCampaign(userId, campaignId)).catch((err) =>
        this.logger.warn(
          `Re-read after approval of ${actionId} failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }
    return result;
  }

  private async executeApproval(
    userId: string,
    campaignId: string,
    actionId: string,
    actorId: string,
  ) {
    const row = await this.ownedCampaign(userId, campaignId);
    const action = await this.prisma.googleAdsUserAction.findUnique({ where: { id: actionId } });
    if (!action || action.userCampaignId !== row.id) throw new NotFoundException();
    if (action.status !== 'pending_approval') {
      throw new BadRequestException('Propunerea nu mai așteaptă o decizie.');
    }
    const client = await this.clientFor(row);
    if (action.action === 'creative.replace_text') {
      const optimizer = this.optimizerFor(row, client, readSettings(row.settings), null);
      if (client.writesAllowed) {
        // Claim first: one approval executes at most once.
        const claimed = await this.prisma.googleAdsUserAction.updateMany({
          where: { id: actionId, status: 'pending_approval' },
          data: { status: 'approved', approvedByUserId: actorId, approvedAt: new Date() },
        });
        if (!claimed.count) throw new BadRequestException('Propunerea a fost deja procesată.');
      }
      await optimizer.approveProposal(actionId, actorId);
      return this.prisma.googleAdsUserAction.findUnique({ where: { id: actionId } });
    }
    if (isChatChange(action.action)) return this.applyChat(client, action.id, actorId, row);
    if (action.action === 'budget.change.proposed')
      return this.applyBudget(row, client, action.id, actorId);
    throw new BadRequestException('Tip de propunere necunoscut.');
  }

  /** Applies a change prepared in the chat, exactly as approved. */
  private async applyChat(
    client: GoogleAdsUserClient,
    actionId: string,
    userId: string,
    row: GoogleAdsUserCampaign,
  ) {
    if (!client.writesAllowed) {
      throw new BadRequestException(
        'Scrierile în conturile Google Ads sunt blocate în acest mediu (doar producția aplică modificări).',
      );
    }
    const claimed = await this.prisma.googleAdsUserAction.updateMany({
      where: { id: actionId, status: 'pending_approval' },
      data: { status: 'approved', approvedByUserId: userId, approvedAt: new Date() },
    });
    if (!claimed.count) throw new BadRequestException('Propunerea a fost deja procesată.');
    const action = await this.prisma.googleAdsUserAction.findUniqueOrThrow({
      where: { id: actionId },
    });
    let error: string | null = null;
    try {
      await applyChatChange(client, row.googleCampaignId, action);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return this.prisma.googleAdsUserAction.update({
      where: { id: actionId },
      data: error
        ? { status: 'failed', errorMessage: error }
        : {
            status: 'applied',
            verifiedAt: new Date(),
            executionResult: 'Confirmat în Google după aplicare.',
          },
    });
  }

  private async applyBudget(
    row: GoogleAdsUserCampaign,
    client: GoogleAdsUserClient,
    actionId: string,
    userId: string,
  ) {
    // Claim first: one approval executes at most once.
    const claimed = await this.prisma.googleAdsUserAction.updateMany({
      where: { id: actionId, status: 'pending_approval' },
      data: { status: 'approved', approvedByUserId: userId, approvedAt: new Date() },
    });
    if (!claimed.count) throw new BadRequestException('Propunerea a fost deja procesată.');
    const action = await this.prisma.googleAdsUserAction.findUniqueOrThrow({
      where: { id: actionId },
    });
    const before = action.before as { budgetResourceName?: string; amountMicros?: string };
    const after = action.after as { amountMicros?: string };
    let error: string | null = null;
    try {
      if (!client.writesAllowed) {
        throw new Error(
          'Scrierile în conturile Google Ads sunt blocate în acest mediu (doar producția aplică modificări).',
        );
      }
      const live = await this.liveBudget(client, row.googleCampaignId);
      if (!live || live.resourceName !== before.budgetResourceName) {
        throw new Error('Bugetul campaniei s-a schimbat între timp; propunerea nu mai corespunde.');
      }
      if (String(live.amountMicros) !== before.amountMicros) {
        throw new Error(
          'Bugetul a fost modificat între timp în Google Ads; propunerea nu mai corespunde.',
        );
      }
      if (live.shared) throw new Error('Bugetul este partajat cu alte campanii.');
      const ops = [
        {
          campaignBudgetOperation: {
            update: { resourceName: live.resourceName, amountMicros: after.amountMicros },
            updateMask: 'amount_micros',
          },
        },
      ];
      await client.mutate(ops, { validateOnly: true });
      await client.mutate(ops);
      const check = await this.liveBudget(client, row.googleCampaignId);
      if (String(check?.amountMicros) !== after.amountMicros) {
        throw new Error('Google nu arată bugetul nou după aplicare.');
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return this.prisma.googleAdsUserAction.update({
      where: { id: actionId },
      data: error
        ? { status: 'failed', errorMessage: error }
        : {
            status: 'applied',
            verifiedAt: new Date(),
            executionResult: `Confirmat în Google: bugetul zilnic este acum ${(Number(after.amountMicros) / 1e6).toFixed(2)}.`,
          },
    });
  }

  /** Proposals nobody decided on: they describe an ad as it was, and an open
   *  one keeps the agent from touching the same ad. */
  async expireProposals(): Promise<void> {
    await this.prisma.googleAdsUserAction.updateMany({
      where: {
        status: 'pending_approval',
        createdAt: { lt: new Date(Date.now() - PROPOSAL_TTL_MS) },
      },
      data: {
        status: 'expired',
        errorMessage: 'A expirat: nu a fost aprobată în 30 de zile.',
      },
    });
  }

  /** Approvals a restart interrupted half way: Google says how they ended. */
  async settleStuckApprovals(): Promise<void> {
    const stuck = await this.prisma.googleAdsUserAction.findMany({
      where: { status: 'approved', approvedAt: { lt: new Date(Date.now() - STUCK_APPROVAL_MS) } },
      include: { userCampaign: true },
      take: 50,
    });
    for (const a of stuck) {
      const row = a.userCampaign;
      let error: string | null;
      try {
        const client = await this.clientFor(row);
        if (isChatChange(a.action)) error = await verifyChatChange(client, row.googleCampaignId, a);
        else if (a.action === 'budget.change.proposed') {
          const live = await this.liveBudget(client, row.googleCampaignId);
          const want = (a.after as { amountMicros?: string } | null)?.amountMicros;
          error = live && String(live.amountMicros) === want ? null : 'not_applied';
        } else {
          const texts = new Set(
            (await fetchAccountData(client)).campaigns
              .filter((c) => c.googleCampaignId === row.googleCampaignId)
              .flatMap((c) => c.ads)
              .flatMap((ad) => [...ad.headlines, ...ad.descriptions])
              .map((t) => t.text),
          );
          const before = (a.before as { text?: string } | null)?.text ?? '';
          const after = (a.after as { text?: string } | null)?.text ?? '';
          error = texts.has(after) && !texts.has(before) ? null : 'not_applied';
        }
      } catch (err) {
        // Google can't be read now: try again later, but not forever.
        if (a.approvedAt && Date.now() - a.approvedAt.getTime() < 86_400_000) continue;
        error = err instanceof Error ? err.message : String(err);
      }
      await this.prisma.googleAdsUserAction.updateMany({
        where: { id: a.id, status: 'approved' },
        data: error
          ? {
              status: 'failed',
              errorMessage:
                'Aplicarea a fost întreruptă, iar Google nu arată modificarea. Verifică în Google Ads.',
            }
          : {
              status: 'applied',
              verifiedAt: new Date(),
              executionResult: 'Confirmat în Google după o întrerupere.',
            },
      });
    }
  }

  async rejectAction(userId: string, campaignId: string, actionId: string, actorId = userId) {
    const row = await this.ownedCampaign(userId, campaignId);
    const res = await this.prisma.googleAdsUserAction.updateMany({
      where: { id: actionId, userCampaignId: row.id, status: 'pending_approval' },
      data: { status: 'rejected', approvedByUserId: actorId, approvedAt: new Date() },
    });
    if (!res.count) throw new BadRequestException('Propunerea nu mai așteaptă o decizie.');
    return { ok: true };
  }
}
