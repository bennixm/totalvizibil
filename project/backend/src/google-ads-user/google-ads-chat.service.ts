import type Anthropic from '@anthropic-ai/sdk';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAdsUserCampaign, Prisma } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { AppConfig } from '../config/env';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { readSettings } from './agent-settings';
import { CampaignBrief, mergeBrief, readBrief, Readiness, readinessNow } from './campaign-brief';
import {
  campaignKeywords,
  changeOps,
  ChatChange,
  ChatChangeError,
  planAdTexts,
  planExtensions,
  planKeywords,
  planNewAd,
  planStatus,
} from './chat-changes';
import {
  aiCostUsd,
  ChangeUnits,
  ChatPricing,
  holdFor,
  priceChatTurn,
  TokenUsage,
} from './chat-pricing';
import { CHAT_SYSTEM, CHAT_TOOLS, campaignContext } from './chat-prompt';
import {
  Analysis,
  GoogleAdsUserAgentService,
  OPTIMIZER_PROVIDER,
} from './google-ads-user-agent.service';
import { responds } from './site-pages';

/** Same wallet provider as cycles (spend category „Optimizare Google Ads”),
 *  told apart by this description. */
export const CHAT_DESCRIPTION = 'Google Ads agent chat';
const MAX_TOKENS = 8_000;
const AI_TIMEOUT_MS = 90_000;
const HISTORY_TURNS = 12;
const PAGE = 50;
/** A message still `running` after this long was interrupted. */
const STALE_MS = 15 * 60_000;
const SWEEP_MS = 5 * 60_000;

interface Question {
  question: string;
  options: string[];
}

/** What a turn has done so far; everything settlement needs. */
interface TurnState {
  usage: TokenUsage;
  calls: number;
  changes: ChangeUnits;
  proposals: number;
  text: string;
  questions: Question[];
}

/**
 * The agent chat of one customer campaign: the agent asks for what it does not
 * know, the owner asks for changes. One message = one billed turn, priced by
 * chat-pricing.ts (hold the ceiling, capture the real price), independent of
 * optimization cycles. Runs in the background; the panel polls.
 */
@Injectable()
export class GoogleAdsChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleAdsChatService.name);
  private timer?: NodeJS.Timeout;
  private readonly running = new Set<string>();
  /** See GoogleAdsUserAgentService.bootedAt. */
  private readonly bootedAt = new Date();
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: GoogleAdsUserAgentService,
    private readonly wallet: WalletService,
    private readonly settings: PlatformSettingsService,
    private readonly ai: AiService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.settleStale(), SWEEP_MS);
    this.timer.unref?.();
    setTimeout(() => void this.settleStale(), 3_000).unref?.();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    clearInterval(this.timer);
  }

  private get model(): string {
    return this.config.get('anthropicModelFast', { infer: true }) || 'claude-sonnet-5';
  }

  // ------------------------------------------------------------------ read

  async conversation(userId: string, campaignId: string) {
    const row = await this.agent.ownedCampaign(userId, campaignId);
    const [turns, pricing, wallet, spentToday] = await Promise.all([
      this.prisma.googleAdsChatTurn.findMany({
        // Erased messages (campaign removed, then added again) are not shown.
        where: { userCampaignId: row.id, userText: { not: '' } },
        orderBy: { createdAt: 'desc' },
        take: PAGE,
        include: { actions: { orderBy: { createdAt: 'asc' } } },
      }),
      this.settings.googleAdsChatPricing(),
      this.wallet.getSummary(userId),
      this.spentToday(this.prisma, row.id),
    ]);
    const snapshot = row.snapshot as { readiness?: Readiness } | null;
    const limit = readSettings(row.settings).chatDailyLimitCredits;
    return {
      turns: turns.reverse().map((t) => ({
        id: t.id,
        status: t.status,
        userText: t.userText,
        assistantText: t.assistantText,
        questions: t.questions ?? [],
        chargedMinor: t.chargedMinor,
        heldMinor: t.heldMinor,
        pricing: t.pricing,
        errorCode: t.errorCode,
        createdAt: t.createdAt,
        actions: t.actions,
      })),
      brief: readBrief(row.brief),
      readiness: readinessNow(snapshot?.readiness, readBrief(row.brief)),
      available: this.ai.configured,
      pricing: {
        minCredits: pricing.minCredits,
        maxCredits: pricing.maxCredits,
        baseCredits: pricing.baseCredits,
        changeCredits: pricing.changeCredits,
      },
      spentTodayMinor: spentToday,
      dailyLimitMinor: limit > 0 ? Math.round(limit * 100) : null,
      balanceMinor: wallet.balance.minor,
    };
  }

  /** Free: the owner edits by hand what the agent knows. */
  async updateBrief(
    userId: string,
    campaignId: string,
    patch: Record<string, unknown>,
  ): Promise<CampaignBrief> {
    const row = await this.agent.ownedCampaign(userId, campaignId);
    return this.saveBrief(row.id, patch);
  }

  private async saveBrief(id: string, patch: unknown): Promise<CampaignBrief> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM google_ads_user_campaigns WHERE id = ${id}::uuid FOR UPDATE`;
      const cur = await tx.googleAdsUserCampaign.findUniqueOrThrow({
        where: { id },
        select: { brief: true },
      });
      const next = mergeBrief(cur.brief, patch);
      await tx.googleAdsUserCampaign.update({
        where: { id },
        data: { brief: next as Prisma.InputJsonValue },
      });
      return next;
    });
  }

  /** Charged today plus what running messages hold (UTC day). */
  private async spentToday(db: Prisma.TransactionClient, campaignId: string): Promise<number> {
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    const rows = await db.googleAdsChatTurn.groupBy({
      by: ['status'],
      where: { userCampaignId: campaignId, createdAt: { gte: from } },
      _sum: { chargedMinor: true, heldMinor: true },
    });
    return rows.reduce(
      (n, r) => n + ((r.status === 'running' ? r._sum.heldMinor : r._sum.chargedMinor) ?? 0),
      0,
    );
  }

  // ------------------------------------------------------------------ send

  async send(
    userId: string,
    campaignId: string,
    input: { text: string; idempotencyKey: string; locale: string },
  ) {
    const key = `${userId}:${input.idempotencyKey}`;
    const row = await this.agent.ownedCampaign(userId, campaignId);
    const existing = await this.prisma.googleAdsChatTurn.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) {
      if (existing.userCampaignId !== row.id) throw new ForbiddenException();
      return { turnId: existing.id, status: existing.status };
    }
    if (this.stopping) throw new ServiceUnavailableException('restarting');
    const text = input.text.trim();
    if (!text) throw new BadRequestException('empty_message');
    if (row.status === 'disconnected')
      throw new BadRequestException('google_ads_reconnect_required');
    if (!this.ai.configured) throw new ServiceUnavailableException('ai_unavailable');
    await this.wallet.assertSpendable(userId);
    const pricing = await this.settings.googleAdsChatPricing();
    const balanceMinor = (await this.wallet.getSummary(userId)).balance.minor;
    const limit = readSettings(row.settings).chatDailyLimitCredits;

    let turn: { id: string; heldMinor: number };
    try {
      turn = await this.prisma.$transaction(async (tx) => {
        // One message at a time per campaign: concurrent sends serialize here.
        await tx.$queryRaw`SELECT id FROM google_ads_user_campaigns WHERE id = ${row.id}::uuid FOR UPDATE`;
        const busy = await tx.googleAdsChatTurn.count({
          where: { userCampaignId: row.id, status: 'running' },
        });
        if (busy) throw new ConflictException('chat_busy');
        const remaining =
          limit > 0 ? Math.round(limit * 100) - (await this.spentToday(tx, row.id)) : null;
        const hold = holdFor(pricing, balanceMinor, remaining);
        if ('error' in hold) throw new BadRequestException(hold.error);
        const charge = await this.wallet.holdWithin(tx, userId, hold.minor, {
          description: CHAT_DESCRIPTION,
          provider: OPTIMIZER_PROVIDER,
        });
        if (!charge) throw new BadRequestException('insufficient_credits');
        return tx.googleAdsChatTurn.create({
          data: {
            userCampaignId: row.id,
            userId,
            idempotencyKey: key,
            userText: text,
            heldMinor: hold.minor,
            chargeTxnId: charge.transactionId,
            aiModel: this.model,
          },
          select: { id: true, heldMinor: true },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw new ConflictException('chat_busy');
      throw err;
    }
    this.running.add(turn.id);
    void this.run(row, turn, text, input.locale, pricing)
      .catch((err) =>
        this.logger.error(
          `Chat turn ${turn.id} could not be settled`,
          err instanceof Error ? err.stack : err,
        ),
      )
      .finally(() => this.running.delete(turn.id));
    return { turnId: turn.id, status: 'running' as const };
  }

  // ------------------------------------------------------------------- run

  private async run(
    row: GoogleAdsUserCampaign,
    turn: { id: string; heldMinor: number },
    text: string,
    locale: string,
    pricing: ChatPricing,
  ): Promise<void> {
    const state: TurnState = {
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      calls: 0,
      changes: {},
      proposals: 0,
      text: '',
      questions: [],
    };
    let errorCode: string | null = null;
    try {
      errorCode = await this.converse(row, turn, text, locale, pricing, state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Chat turn ${turn.id} failed: ${msg}`);
      errorCode =
        msg === 'google_ads_reconnect_required' ? 'google_ads_reconnect_required' : 'google_error';
    }
    await this.settle(turn.id, pricing, state, errorCode);
  }

  /** The tool loop. Returns an error code, or null when it ended normally. */
  private async converse(
    row: GoogleAdsUserCampaign,
    turn: { id: string; heldMinor: number },
    text: string,
    locale: string,
    pricing: ChatPricing,
    state: TurnState,
  ): Promise<string | null> {
    const analysis = await this.agent.analyze(row);
    const messages: Anthropic.MessageParam[] = [
      ...(await this.history(row.id, turn.id)),
      {
        role: 'user',
        content: [
          { type: 'text', text: campaignContext(analysis, readBrief(row.brief), locale) },
          {
            type: 'text',
            text: `Mesajul proprietarului:\n${text}`,
            // The context is resent on every tool round: cached after the first.
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ];
    for (let call = 1; call <= pricing.maxAiCalls; call++) {
      const res = await this.ai.agentMessage({
        system: CHAT_SYSTEM,
        messages,
        tools: CHAT_TOOLS,
        maxTokens: MAX_TOKENS,
        model: this.model,
        timeoutMs: AI_TIMEOUT_MS,
        effort: 'medium',
      });
      if (!res) return 'ai_error';
      state.calls++;
      state.usage.input += res.usage.input_tokens;
      state.usage.output += res.usage.output_tokens;
      state.usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
      state.usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
      // Saved at once, so an interrupted message keeps its cost.
      await this.prisma.googleAdsChatTurn.updateMany({
        where: { id: turn.id, status: 'running' },
        data: this.usageData(state),
      });
      if (res.stop_reason === 'refusal') return 'ai_refused';
      const said = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      if (said) state.text = said;
      // A truncated answer may carry a truncated tool call: never run it.
      if (res.stop_reason === 'max_tokens') return said ? null : 'ai_error';
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!uses.length) return said ? null : 'ai_error';

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        const out = await this.runTool(row, turn.id, analysis, u.name, u.input, state);
        results.push({
          type: 'tool_result',
          tool_use_id: u.id,
          content: out.content,
          ...(out.error ? { is_error: true } : {}),
        });
      }
      if (state.questions.length) return null;
      const soFar = priceChatTurn(
        pricing,
        aiCostUsd(this.model, state.usage),
        state.changes,
        Number.MAX_SAFE_INTEGER,
      );
      // The owner's reservation is used up: deliver what there is.
      if (Math.round(soFar.computedCredits * 100) >= turn.heldMinor) break;
      const last = call === pricing.maxAiCalls - 1;
      messages.push(
        { role: 'assistant', content: res.content },
        {
          role: 'user',
          content: last
            ? [
                ...results,
                { type: 'text', text: 'Nu mai apela instrumente; răspunde acum proprietarului.' },
              ]
            : results,
        },
      );
    }
    return state.text || state.proposals ? null : 'ai_error';
  }

  /** Earlier messages as plain text, with what happened to each proposal. */
  private async history(campaignId: string, currentId: string): Promise<Anthropic.MessageParam[]> {
    const turns = await this.prisma.googleAdsChatTurn.findMany({
      where: {
        userCampaignId: campaignId,
        status: 'completed',
        id: { not: currentId },
        userText: { not: '' },
      },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS,
      include: { actions: { select: { action: true, status: true, errorMessage: true } } },
    });
    return turns.reverse().flatMap((t): Anthropic.MessageParam[] => {
      const questions = ((t.questions ?? []) as unknown as Question[]).map((q) => q.question);
      const said = [
        t.assistantText ?? '',
        ...questions,
        ...t.actions.map(
          (a) =>
            `[propunere ${a.action}: ${a.status}${a.errorMessage ? `, ${a.errorMessage}` : ''}]`,
        ),
      ]
        .filter(Boolean)
        .join('\n');
      return [
        { role: 'user', content: t.userText },
        { role: 'assistant', content: said || '…' },
      ];
    });
  }

  // ----------------------------------------------------------------- tools

  private async runTool(
    row: GoogleAdsUserCampaign,
    turnId: string,
    a: Analysis,
    name: string,
    input: unknown,
    state: TurnState,
  ): Promise<{ content: string; error?: boolean }> {
    const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const reason = String(i.reason ?? '').slice(0, 500);
    try {
      switch (name) {
        case 'ask_user': {
          const qs = (Array.isArray(i.questions) ? i.questions : []).slice(0, 3) as Record<
            string,
            unknown
          >[];
          const clean = qs
            .map((q) => ({
              question: String(q?.question ?? '')
                .trim()
                .slice(0, 300),
              options: (Array.isArray(q?.options) ? q.options : [])
                .filter((o): o is string => typeof o === 'string' && !!o.trim())
                .map((o) => o.trim().slice(0, 80))
                .slice(0, 4),
            }))
            .filter((q) => q.question);
          if (!clean.length) return { content: 'Nicio întrebare validă.', error: true };
          state.questions.push(...clean);
          return { content: 'Întrebările au fost trimise.' };
        }
        case 'save_business_facts': {
          await this.saveBrief(row.id, i);
          return { content: 'Salvat.' };
        }
        case 'read_campaign':
          return { content: await this.readMore(a, String(i.what ?? '')) };
        case 'propose_ad_texts':
          return await this.propose(row, turnId, a, planAdTexts(a.c, i), reason, state);
        case 'propose_new_ad':
          return await this.propose(
            row,
            turnId,
            a,
            await planNewAd(a.client, a.c, i, responds),
            reason,
            state,
          );
        case 'propose_keywords':
          return await this.propose(
            row,
            turnId,
            a,
            await planKeywords(a.client, a.c, i),
            reason,
            state,
          );
        case 'propose_extensions':
          return await this.propose(
            row,
            turnId,
            a,
            await planExtensions(a.c, i, a.landing.url, responds),
            reason,
            state,
          );
        case 'propose_status':
          return await this.propose(row, turnId, a, planStatus(a.c, i), reason, state);
        case 'propose_budget':
          return await this.proposeBudget(row, turnId, a, i, reason, state);
        default:
          return { content: 'Instrument necunoscut.', error: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!(err instanceof ChatChangeError)) this.logger.warn(`Chat tool ${name}: ${msg}`);
      return { content: msg.slice(0, 800), error: true };
    }
  }

  private async readMore(a: Analysis, what: string): Promise<string> {
    if (what === 'keywords') {
      const ks = await campaignKeywords(a.client, a.c.googleCampaignId);
      return JSON.stringify(
        ks.slice(0, 200).map((k) => ({
          text: k.text,
          match: k.matchType,
          ...(k.negative ? { negativ: true } : { stare: k.status }),
        })),
      );
    }
    const rows = await a.client.search(
      'SELECT campaign.id, search_term_view.search_term, metrics.impressions, metrics.clicks, ' +
        'metrics.cost_micros, metrics.conversions FROM search_term_view ' +
        `WHERE campaign.id = ${a.c.googleCampaignId} AND segments.date DURING LAST_30_DAYS ` +
        'ORDER BY metrics.impressions DESC LIMIT 60',
    );
    if (!rows.length) return 'Nicio căutare înregistrată în ultimele 30 de zile.';
    return JSON.stringify(
      rows.map((r) => {
        const m = (r.metrics ?? {}) as Record<string, unknown>;
        return {
          cautare: (r.searchTermView as { searchTerm?: string } | undefined)?.searchTerm,
          afisari: Number(m.impressions ?? 0),
          clickuri: Number(m.clicks ?? 0),
          cost: Number(m.costMicros ?? 0) / 1e6,
          conversii: Number(m.conversions ?? 0),
        };
      }),
    );
  }

  private async propose(
    row: GoogleAdsUserCampaign,
    turnId: string,
    a: Analysis,
    plan: { change: ChatChange; units: ChangeUnits },
    reason: string,
    state: TurnState,
  ): Promise<{ content: string; error?: boolean }> {
    await a.client.mutate(changeOps(a.client.customerId, plan.change), { validateOnly: true });
    await this.store(row, turnId, a, plan.change, reason, state, plan.units);
    return { content: 'Propunere pregătită și validată de Google; așteaptă aprobarea.' };
  }

  private async proposeBudget(
    row: GoogleAdsUserCampaign,
    turnId: string,
    a: Analysis,
    i: Record<string, unknown>,
    reason: string,
    state: TurnState,
  ): Promise<{ content: string; error?: boolean }> {
    const amount = Number(i.daily_amount);
    const live = await this.agent.liveBudget(a.client, a.c.googleCampaignId);
    if (!live) throw new ChatChangeError('Bugetul campaniei nu a putut fi citit.');
    if (live.shared)
      throw new ChatChangeError('Bugetul este partajat cu alte campanii; nu îl modificăm de aici.');
    // Whole cents of the account currency (Google's smallest billable unit).
    const micros = Math.round(amount * 100) * 10_000;
    if (!Number.isFinite(micros) || micros <= 0) throw new ChatChangeError('Sumă invalidă.');
    if (micros === live.amountMicros) throw new ChatChangeError('Bugetul este deja acesta.');
    if (micros > live.amountMicros * 5)
      throw new ChatChangeError(
        'Peste de 5 ori bugetul actual; o astfel de creștere se face din Google Ads.',
      );
    await a.client.mutate(
      [
        {
          campaignBudgetOperation: {
            update: { resourceName: live.resourceName, amountMicros: String(micros) },
            updateMask: 'amount_micros',
          },
        },
      ],
      { validateOnly: true },
    );
    await this.store(
      row,
      turnId,
      a,
      {
        action: 'budget.change.proposed',
        before: {
          budgetResourceName: live.resourceName,
          amountMicros: String(live.amountMicros),
          currencyCode: a.c.currencyCode ?? null,
        },
        after: {
          amountMicros: String(micros),
          currencyCode: a.c.currencyCode ?? null,
          source: 'chat',
        },
      },
      reason,
      state,
      { budget: 1 },
    );
    return { content: 'Propunere de buget pregătită; așteaptă aprobarea.' };
  }

  /** Stores a proposal; a newer one of the same kind replaces the pending one
   *  (they describe the same thing, only the last should be approvable). */
  private async store(
    row: GoogleAdsUserCampaign,
    turnId: string,
    a: Analysis,
    ch: { action: string; before: unknown; after: unknown },
    reason: string,
    state: TurnState,
    units: ChangeUnits,
  ): Promise<void> {
    const replaces = ['chat.ad_texts', 'chat.ad_create', 'chat.status', 'budget.change.proposed'];
    await this.prisma.$transaction(async (tx) => {
      if (replaces.includes(ch.action)) {
        await tx.googleAdsUserAction.updateMany({
          where: { userCampaignId: row.id, action: ch.action, status: 'pending_approval' },
          data: { status: 'superseded' },
        });
      }
      await tx.googleAdsUserAction.create({
        data: {
          userCampaignId: row.id,
          chatTurnId: turnId,
          googleCampaignId: a.c.googleCampaignId,
          action: ch.action,
          status: 'pending_approval',
          requiredApproval: true,
          before: ch.before as Prisma.InputJsonValue,
          after: ch.after as Prisma.InputJsonValue,
          reasoning: reason || null,
        },
      });
    });
    state.proposals++;
    for (const [k, n] of Object.entries(units) as [keyof ChangeUnits, number][])
      state.changes[k] = (state.changes[k] ?? 0) + n;
  }

  private usageData(state: TurnState) {
    return {
      aiCostUsd: aiCostUsd(this.model, state.usage),
      aiCallCount: state.calls,
      inputTokens: state.usage.input,
      outputTokens: state.usage.output,
      cacheReadTokens: state.usage.cacheRead,
      cacheWriteTokens: state.usage.cacheWrite,
    };
  }

  // ---------------------------------------------------------------- settle

  /**
   * Final price, exactly once, in one transaction with the turn. A turn that
   * delivered nothing (no answer, no proposal) costs nothing, whatever it cost
   * us; a turn interrupted after preparing changes is billed for them.
   */
  async settle(
    turnId: string,
    pricing: ChatPricing,
    state: TurnState,
    errorCode: string | null,
    /** Our AI cost is always recorded; an interrupted message does not bill it. */
    billAi = true,
  ): Promise<void> {
    const delivered = errorCode === null || state.proposals > 0;
    const costUsd = billAi ? aiCostUsd(this.model, state.usage) : 0;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.googleAdsChatTurn.updateMany({
        where: { id: turnId, status: 'running' },
        data: { status: delivered ? 'completed' : 'failed', finishedAt: new Date() },
      });
      if (!claimed.count) return;
      const turn = await tx.googleAdsChatTurn.findUniqueOrThrow({ where: { id: turnId } });
      const price = delivered
        ? priceChatTurn(pricing, costUsd, state.changes, turn.heldMinor)
        : null;
      let charged = 0;
      if (turn.chargeTxnId) {
        const cap = await this.wallet.captureHold(tx, turn.chargeTxnId, price?.minor ?? 0);
        charged = cap?.capturedMinor ?? 0;
      }
      await tx.googleAdsChatTurn.update({
        where: { id: turnId },
        data: {
          assistantText: delivered ? state.text || null : null,
          questions: state.questions as unknown as Prisma.InputJsonValue,
          chargedMinor: charged,
          ...(price ? { pricing: price as unknown as Prisma.InputJsonValue } : {}),
          ...this.usageData(state),
          errorCode,
        },
      });
    });
  }

  /** Messages left `running` by a crashed or restarted process. */
  async settleStale(): Promise<void> {
    try {
      const stale = await this.prisma.googleAdsChatTurn.findMany({
        where: {
          status: 'running',
          OR: [
            { createdAt: { lt: this.bootedAt } },
            { createdAt: { lt: new Date(Date.now() - STALE_MS) } },
          ],
        },
        include: { actions: { select: { id: true } } },
      });
      if (!stale.length) return;
      const pricing = await this.settings.googleAdsChatPricing();
      for (const t of stale) {
        if (this.running.has(t.id)) continue;
        await this.settle(
          t.id,
          pricing,
          {
            usage: {
              input: t.inputTokens,
              output: t.outputTokens,
              cacheRead: t.cacheReadTokens,
              cacheWrite: t.cacheWriteTokens,
            },
            calls: t.aiCallCount,
            changes: {},
            // Its proposals stay usable: the minimum is charged for them.
            proposals: t.actions.length,
            text: '',
            questions: [],
          },
          'interrupted',
          false,
        );
      }
    } catch (err) {
      this.logger.error('Settling stale chat turns failed', err instanceof Error ? err.stack : err);
    }
  }
}
