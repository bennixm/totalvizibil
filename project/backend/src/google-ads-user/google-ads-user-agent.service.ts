import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAdsUserCampaign, Prisma } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { AppConfig } from '../config/env';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AgentActivity } from '../google-ads/optimization/google-ads-activity';
import { CampaignData, fetchAccountData } from '../google-ads/optimization/google-ads-account-data';
import {
  CampaignEvaluation,
  evaluateCampaign,
} from '../google-ads/optimization/google-ads-campaign-evaluator';
import { OptimizationTarget } from '../google-ads/optimization/google-ads-optimizer.service';
import { GoogleAdsWritesDisabledError } from '../google-ads/google-ads-api-client.service';
import { readSettings, SCHEDULE_DAYS, UserAgentSettings } from './agent-settings';
import { GoogleAdsOAuthService } from './google-ads-oauth.service';
import { GoogleAdsConnectionRevokedError, GoogleAdsUserClient } from './google-ads-user-client';
import { PriceBreakdown, priceWork } from './pricing';
import { checkUrls, discoverSitePages } from './site-pages';
import { UserGoogleAdsOptimizer } from './user-optimizer';
import { performedWork, planWork, WorkPlan } from './work-plan';

/** Wallet `provider` of every optimization charge/credit-back. Also the
 *  key of its spend category and its bucket in the AI usage report. */
export const OPTIMIZER_PROVIDER = 'google-ads-optimizer';
const CHARGE_DESCRIPTION = 'Google Ads optimization cycle';

/** A cycle still `running` after this long is treated as interrupted. */
const STALE_CYCLE_MS = 60 * 60 * 1000;
const SCHEDULER_INTERVAL_MS = 10 * 60 * 1000;
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
}

interface BudgetRecommendation {
  resourceName: string;
  currentMicros: number;
  recommendedMicros: number;
}

@Injectable()
export class GoogleAdsUserAgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleAdsUserAgentService.name);
  private timer?: NodeJS.Timeout;
  /** Campaign ids with a cycle executing in THIS process. */
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: GoogleAdsOAuthService,
    private readonly wallet: WalletService,
    private readonly settings: PlatformSettingsService,
    private readonly ai: AiService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), SCHEDULER_INTERVAL_MS);
    this.timer.unref?.();
    // Interrupted cycles from a previous process: settle them right away.
    setTimeout(() => void this.settleStaleCycles(), 15_000).unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- access

  async ownedCampaign(userId: string, id: string): Promise<GoogleAdsUserCampaign> {
    const row = await this.prisma.googleAdsUserCampaign.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Campania nu a fost găsită.');
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

  /** Google refused the token: mark connection + its campaigns. */
  private async markRevoked(row: GoogleAdsUserCampaign): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.googleAdsConnection.update({
        where: { id: row.connectionId },
        data: {
          status: 'revoked',
          lastError: 'Google a refuzat accesul (consimțământ revocat sau expirat).',
        },
      }),
      this.prisma.googleAdsUserCampaign.updateMany({
        where: { connectionId: row.connectionId },
        data: { status: 'disconnected' },
      }),
    ]);
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
        await this.markRevoked(row);
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
    const ev = evaluateCampaign(c, { managed: true, urlChecks });
    const settings = readSettings(row.settings);
    const budgetRecommendations = settings.budgetProposals
      ? await this.budgetRecommendations(client, c).catch(() => [])
      : [];
    const optimizer = this.optimizerFor(row, client, settings, null);
    const rsaBlocked = !!(await optimizer.rsaChangeBlocker(c));
    const plan = planWork(c, ev, settings, {
      rsaBlocked,
      imagesAvailable: !!this.config.get('pexelsApiKey', { infer: true }),
      budgetRecommendations: budgetRecommendations.length,
      hasBusinessName: !!settings.businessName,
    });
    const pricing = await this.settings.googleAdsOptimizerPricing();
    const quote = priceWork(pricing, plan.units, plan.elementsAnalyzed);
    await this.saveSnapshot(row, c, ev);
    return { c, ev, client, settings, plan, quote, budgetRecommendations };
  }

  private async saveSnapshot(row: GoogleAdsUserCampaign, c: CampaignData, ev: CampaignEvaluation) {
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
    const name = settings.businessDescription || settings.businessName || row.name;
    return {
      owner: { userCampaignId: row.id },
      name,
      imageQuery: (settings.imageQuery || settings.businessDescription || row.name).slice(0, 80),
      landingFallback: '',
      businessName: settings.businessName || null,
      advertiser: {
        businessName: settings.businessName || row.customerName || undefined,
        description: settings.businessDescription || undefined,
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

  private async liveBudget(
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
      trigger: 'manual' | 'scheduled';
      maxMinor?: number;
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
    const row = await this.ownedCampaign(userId, id);
    if (row.status !== 'active') {
      throw new BadRequestException(
        row.status === 'disconnected' ? 'google_ads_reconnect_required' : 'campaign_paused',
      );
    }
    if (this.running.has(row.id)) throw new ConflictException('cycle_already_running');
    await this.wallet.assertSpendable(userId);

    const a = await this.analyze(row);
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
            quote: { ...a.quote, tasks: a.plan.tasks } as unknown as Prisma.InputJsonValue,
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
    void this.execute(row, cycleId, a).finally(() => this.running.delete(row.id));
    return { cycleId, status: 'running' as const, chargedMinor: a.quote.minor };
  }

  /** The cycle's work, the same passes the platform monitor runs. */
  private async execute(row: GoogleAdsUserCampaign, cycleId: string, a: Analysis): Promise<void> {
    const activity = new AgentActivity(this.prisma, cycleId, row.id);
    const meta = { googleCampaignId: a.c.googleCampaignId, campaignName: a.c.name };
    const optimizer = this.optimizerFor(row, a.client, a.settings, cycleId);
    const target = this.targetFor(row, a.settings);
    let aiCostMinor = 0;
    let error: string | null = null;
    try {
      await activity.record(
        { ...meta, step: 'analyze', message: 'Analiză și scor față de cerințele Google' },
        {
          result:
            `Scor ${a.ev.score ?? '–'}/100, Ad Strength ${a.ev.adStrength ?? '–'}, ` +
            `${a.ev.issues.length} probleme găsite (${a.ev.issues.filter((i) => i.autoFixable).length} rezolvabile automat).`,
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
    } catch (err) {
      if (err instanceof GoogleAdsConnectionRevokedError) await this.markRevoked(row);
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
    await this.settle(cycleId, { error, aiCostMinor, scoreAfter });
  }

  /**
   * Final price = the work actually performed, priced with the same rules,
   * never more than the quote. Failure before any work = full refund. The
   * difference goes back to the wallet in one transaction with the cycle
   * update, so the cycle and the ledger can never disagree.
   */
  async settle(
    cycleId: string,
    opts: { error: string | null; aiCostMinor: number; scoreAfter: number | null },
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
    const finalMinor = failedEarly
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
    const applied = cycle.actions.filter((x) => x.status === 'applied').length;
    const proposed = cycle.actions.filter((x) => x.status === 'pending_approval').length;

    await this.prisma.$transaction(async (tx) => {
      // Claim: only one settlement ever (running -> completed/failed).
      const claimed = await tx.googleAdsOptimizationCycle.updateMany({
        where: { id: cycleId, status: 'running' },
        data: { status: opts.error ? 'failed' : 'completed', finishedAt: new Date() },
      });
      if (!claimed.count) return;
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
          aiCostMinor: opts.aiCostMinor,
          aiCallCount: aiCalls,
          aiModel: this.config.get('anthropicModelFast', { infer: true }) || null,
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
    });
  }

  /** Cycles left `running` by a crashed/restarted process. */
  async settleStaleCycles(): Promise<void> {
    const stale = await this.prisma.googleAdsOptimizationCycle.findMany({
      where: { status: 'running', startedAt: { lt: new Date(Date.now() - STALE_CYCLE_MS) } },
      select: { id: true, userCampaignId: true },
    });
    for (const c of stale) {
      if (this.running.has(c.userCampaignId)) continue;
      await this.settle(c.id, {
        error: 'Ciclul a fost întrerupt (repornire server); ai plătit doar pentru ce s-a efectuat.',
        aiCostMinor: 0,
        scoreAfter: null,
      }).catch((err) => this.logger.error(`Settling stale cycle ${c.id} failed`, err));
    }
  }

  /** Scheduled cycles (opt-in per campaign, each billed, capped). */
  private async tick(): Promise<void> {
    try {
      await this.settleStaleCycles();
      const due = await this.prisma.googleAdsUserCampaign.findMany({
        where: { status: 'active', nextCycleAt: { lte: new Date() } },
        take: 20,
      });
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
    } catch (err) {
      this.logger.error('Scheduler tick failed', err instanceof Error ? err.stack : err);
    }
  }

  // ------------------------------------------------------------ approvals

  async approveAction(userId: string, campaignId: string, actionId: string) {
    const row = await this.ownedCampaign(userId, campaignId);
    const action = await this.prisma.googleAdsUserAction.findUnique({ where: { id: actionId } });
    if (!action || action.userCampaignId !== row.id) throw new NotFoundException();
    if (action.status !== 'pending_approval') {
      throw new BadRequestException('Propunerea nu mai așteaptă o decizie.');
    }
    const client = await this.clientFor(row);
    if (action.action === 'creative.replace_text') {
      const optimizer = this.optimizerFor(row, client, readSettings(row.settings), null);
      await optimizer.approveProposal(actionId, userId);
      return this.prisma.googleAdsUserAction.findUnique({ where: { id: actionId } });
    }
    if (action.action === 'budget.change.proposed')
      return this.applyBudget(row, client, action.id, userId);
    throw new BadRequestException('Tip de propunere necunoscut.');
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

  async rejectAction(userId: string, campaignId: string, actionId: string) {
    const row = await this.ownedCampaign(userId, campaignId);
    const res = await this.prisma.googleAdsUserAction.updateMany({
      where: { id: actionId, userCampaignId: row.id, status: 'pending_approval' },
      data: { status: 'rejected', approvedByUserId: userId, approvedAt: new Date() },
    });
    if (!res.count) throw new BadRequestException('Propunerea nu mai așteaptă o decizie.');
    return { ok: true };
  }
}
