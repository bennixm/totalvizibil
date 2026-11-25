import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GoogleAdsUserCampaign, Prisma } from '@prisma/client';
import { AuditLogService } from '../admin/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { readSettings, SCHEDULE_DAYS, UserAgentSettings } from './agent-settings';
import {
  campaignKeywords,
  changeOps,
  ChatChange,
  ChatChangeError,
  mainAd,
  planAdTexts,
  planExtensions,
  planKeywords,
  planStatus,
} from './chat-changes';
import { GoogleAdsUserAgentService } from './google-ads-user-agent.service';
import { GoogleAdsUserService } from './google-ads-user.service';
import { responds } from './site-pages';

export interface AdminActor {
  id: string;
  roles: string[];
}

export const ADMIN_CHANGE_KINDS = [
  'ad_texts',
  'keywords',
  'extensions',
  'status',
  'budget',
] as const;
export type AdminChangeKind = (typeof ADMIN_CHANGE_KINDS)[number];

const AUDIT_TARGET = 'google_ads_user_campaign';

/**
 * Staff administration of ONE customer's Google Ads campaigns. Everything
 * goes through the owner's own services and the chat's change engine
 * (local checks, Google validateOnly, apply, re-read), so staff can never do
 * something the platform would not let the owner do. On top of that:
 *  - the customer is never charged for staff work;
 *  - nothing here can raise what the customer may be charged;
 *  - the daily budget stays the owner's decision: staff only propose it;
 *  - every write is audit-logged and the owner is notified.
 */
@Injectable()
export class AdminUserAdsService {
  private readonly logger = new Logger(AdminUserAdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ads: GoogleAdsUserService,
    private readonly agent: GoogleAdsUserAgentService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.googleAdsUserCampaign.findMany({
      where: { userId, status: { not: 'removed' } },
      orderBy: { createdAt: 'asc' },
      include: {
        connection: { select: { googleEmail: true, status: true } },
        _count: { select: { actions: { where: { status: 'pending_approval' } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      customerId: r.customerId,
      customerName: r.customerName,
      googleCampaignId: r.googleCampaignId,
      channelType: r.channelType,
      status: r.status,
      score: r.score,
      adStrength: r.adStrength,
      syncedAt: r.syncedAt,
      lastCycleAt: r.lastCycleAt,
      nextCycleAt: r.nextCycleAt,
      createdAt: r.createdAt,
      googleEmail: r.connection.googleEmail,
      connectionStatus: r.connection.status,
      pendingApprovals: r._count.actions,
    }));
  }

  /** The campaign as it is in Google right now, in an editable shape. */
  async editor(userId: string, id: string) {
    const row = await this.agent.ownedCampaign(userId, id);
    const a = await this.agent.analyze(row);
    const ad = mainAd(a.c);
    const [keywords, budget] = await Promise.all([
      campaignKeywords(a.client, a.c.googleCampaignId),
      this.agent.liveBudget(a.client, a.c.googleCampaignId),
    ]);
    const pendingBudget = await this.prisma.googleAdsUserAction.findFirst({
      where: {
        userCampaignId: id,
        action: 'budget.change.proposed',
        status: 'pending_approval',
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      writesAllowed: a.client.writesAllowed,
      status: a.c.status,
      currencyCode: a.c.currencyCode ?? row.currencyCode,
      budget: budget ? { amountMicros: String(budget.amountMicros), shared: budget.shared } : null,
      pendingBudgetMicros:
        (pendingBudget?.after as { amountMicros?: string } | null)?.amountMicros ?? null,
      landingUrl: a.landing.url,
      ad: ad
        ? {
            headlines: ad.headlines.map((h) => ({ text: h.text, pinned: !!h.pinnedField })),
            descriptions: ad.descriptions.map((d) => ({ text: d.text, pinned: !!d.pinnedField })),
          }
        : null,
      keywords: keywords.map(({ text, matchType, status, negative }) => ({
        text,
        matchType,
        status,
        negative,
      })),
      sitelinks: a.ev.assets.sitelinks.map((s) => ({ text: s.linkText, url: s.finalUrl ?? '' })),
      callouts: a.ev.assets.callouts.map((c) => c.text),
    };
  }

  async change(
    actor: AdminActor,
    userId: string,
    id: string,
    kind: AdminChangeKind,
    input: Record<string, unknown>,
    reason: string,
  ) {
    const row = await this.agent.ownedCampaign(userId, id);
    const a = await this.agent.analyze(row);
    if (!a.client.writesAllowed) {
      throw new BadRequestException(
        'Scrierile în conturile Google Ads sunt blocate în acest mediu (doar producția aplică modificări).',
      );
    }
    if (kind === 'budget') return this.proposeBudget(actor, row, a, input, reason);

    let change: ChatChange;
    try {
      change = (
        kind === 'ad_texts'
          ? planAdTexts(a.c, input)
          : kind === 'keywords'
            ? await planKeywords(a.client, a.c, input)
            : kind === 'extensions'
              ? await planExtensions(a.c, input, a.landing.url, responds)
              : planStatus(a.c, input)
      ).change;
      await a.client.mutate(changeOps(a.client.customerId, change), { validateOnly: true });
    } catch (err) {
      if (err instanceof ChatChangeError || err instanceof Error)
        throw new BadRequestException(err.message);
      throw err;
    }
    const action = await this.store(row, change, reason);
    const result = await this.agent.approveAction(userId, id, action.id, actor.id);
    await this.record(actor, row, `google_ads.${kind}`, change.before, change.after, reason);
    if (result?.status === 'applied') {
      await this.notify(
        row,
        `Echipa Totalvizibil a modificat campania „${row.name}”. Motiv: ${reason}`,
      );
    }
    return result;
  }

  /** A budget spends the customer's money: proposed, the owner approves it. */
  private async proposeBudget(
    actor: AdminActor,
    row: GoogleAdsUserCampaign,
    a: Awaited<ReturnType<GoogleAdsUserAgentService['analyze']>>,
    input: Record<string, unknown>,
    reason: string,
  ) {
    const live = await this.agent.liveBudget(a.client, a.c.googleCampaignId);
    if (!live) throw new BadRequestException('Bugetul campaniei nu a putut fi citit.');
    if (live.shared)
      throw new BadRequestException(
        'Bugetul este partajat cu alte campanii; nu îl modificăm de aici.',
      );
    const micros = Math.round(Number(input.dailyAmount) * 100) * 10_000;
    if (!Number.isFinite(micros) || micros <= 0) throw new BadRequestException('Sumă invalidă.');
    if (micros === live.amountMicros) throw new BadRequestException('Bugetul este deja acesta.');
    if (micros > live.amountMicros * 5)
      throw new BadRequestException(
        'Peste de 5 ori bugetul actual; o astfel de creștere se face din Google Ads.',
      );
    const currencyCode = a.c.currencyCode ?? null;
    const change = {
      action: 'budget.change.proposed',
      before: {
        budgetResourceName: live.resourceName,
        amountMicros: String(live.amountMicros),
        currencyCode,
      },
      after: { amountMicros: String(micros), currencyCode, source: 'staff' },
    };
    try {
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
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    const action = await this.store(row, change, reason);
    await this.record(actor, row, 'google_ads.budget.propose', change.before, change.after, reason);
    await this.notify(
      row,
      `Echipa Totalvizibil îți propune un buget nou pentru campania „${row.name}”. Se aplică doar dacă îl aprobi. Motiv: ${reason}`,
      'proposals',
    );
    return action;
  }

  /** A newer change of the same kind replaces the pending one. */
  private store(
    row: GoogleAdsUserCampaign,
    ch: { action: string; before: unknown; after: unknown },
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (['chat.ad_texts', 'chat.status', 'budget.change.proposed'].includes(ch.action)) {
        await tx.googleAdsUserAction.updateMany({
          where: { userCampaignId: row.id, action: ch.action, status: 'pending_approval' },
          data: { status: 'superseded' },
        });
      }
      return tx.googleAdsUserAction.create({
        data: {
          userCampaignId: row.id,
          googleCampaignId: row.googleCampaignId,
          action: ch.action,
          status: 'pending_approval',
          requiredApproval: true,
          before: ch.before as Prisma.InputJsonValue,
          after: ch.after as Prisma.InputJsonValue,
          reasoning: `Echipa Totalvizibil: ${reason}`,
        },
      });
    });
  }

  async updateSettings(
    actor: AdminActor,
    userId: string,
    id: string,
    patch: Record<string, unknown>,
  ) {
    const row = await this.agent.ownedCampaign(userId, id);
    const before = readSettings(row.settings);
    const wanted = readSettings({ ...before, ...patch });
    this.assertNotCostlier(before, wanted);
    const after = await this.ads.updateSettings(userId, id, patch);
    const keys = (Object.keys(after) as (keyof UserAgentSettings)[]).filter(
      (k) => after[k] !== before[k],
    );
    if (keys.length) {
      const pick = (s: UserAgentSettings) => Object.fromEntries(keys.map((k) => [k, s[k]]));
      await this.record(actor, row, 'google_ads.settings', pick(before), pick(after));
      await this.notify(
        row,
        `Echipa Totalvizibil a actualizat setările agentului pentru campania „${row.name}”.`,
        'settings',
      );
    }
    return after;
  }

  /** What the owner can be charged is the owner's decision. */
  private assertNotCostlier(before: UserAgentSettings, after: UserAgentSettings): void {
    const perYear = (s: UserAgentSettings) => {
      const days = SCHEDULE_DAYS[s.schedule];
      return days ? 365 / days : 0;
    };
    const limit = (v: number) => (v > 0 ? v : Infinity);
    if (
      perYear(after) > perYear(before) ||
      after.maxCreditsPerCycle > before.maxCreditsPerCycle ||
      limit(after.chatDailyLimitCredits) > limit(before.chatDailyLimitCredits)
    ) {
      throw new BadRequestException(
        'Poți reduce sau opri ciclurile plătite și limitele de credite, dar nu le poți mări: asta decide doar proprietarul campaniei.',
      );
    }
  }

  async setPaused(actor: AdminActor, userId: string, id: string, paused: boolean) {
    const row = await this.agent.ownedCampaign(userId, id);
    const res = await this.ads.setPaused(userId, id, paused);
    await this.record(
      actor,
      row,
      paused ? 'google_ads.agent.pause' : 'google_ads.agent.resume',
      {
        status: row.status,
      },
      res,
    );
    await this.notify(
      row,
      `Echipa Totalvizibil a ${paused ? 'pus pe pauză' : 'repornit'} agentul pentru campania „${row.name}”.`,
    );
    return res;
  }

  /** Free for the customer; the platform pays the AI. */
  async startCycle(
    actor: AdminActor,
    userId: string,
    id: string,
    opts: { idempotencyKey?: string; ignoreMissingInfo?: boolean },
  ) {
    const row = await this.agent.ownedCampaign(userId, id);
    const res = await this.agent.startCycle(userId, id, {
      trigger: 'staff',
      idempotencyKey: opts.idempotencyKey ? `${actor.id}:${opts.idempotencyKey}` : undefined,
      ignoreMissingInfo: opts.ignoreMissingInfo,
      free: true,
    });
    await this.record(actor, row, 'google_ads.cycle.start', undefined, { cycleId: res.cycleId });
    await this.notify(
      row,
      `Echipa Totalvizibil a pornit agentul pentru campania „${row.name}”. Nu plătești nimic pentru această rulare.`,
      'history',
    );
    return res;
  }

  async decide(actor: AdminActor, userId: string, id: string, actionId: string, approve: boolean) {
    const row = await this.agent.ownedCampaign(userId, id);
    const action = await this.prisma.googleAdsUserAction.findUnique({ where: { id: actionId } });
    if (!action || action.userCampaignId !== id) throw new NotFoundException();
    if (approve && action.action === 'budget.change.proposed') {
      throw new BadRequestException('Bugetul poate fi aprobat doar de proprietarul campaniei.');
    }
    const res = approve
      ? await this.agent.approveAction(userId, id, actionId, actor.id)
      : await this.agent.rejectAction(userId, id, actionId, actor.id);
    await this.record(
      actor,
      row,
      approve ? 'google_ads.proposal.approve' : 'google_ads.proposal.reject',
      { action: action.action },
      { actionId },
    );
    await this.notify(
      row,
      `Echipa Totalvizibil a ${approve ? 'aprobat' : 'respins'} o modificare pregătită de agent pentru campania „${row.name}”.`,
      'history',
    );
    return res;
  }

  private record(
    actor: AdminActor,
    row: GoogleAdsUserCampaign,
    action: string,
    before?: unknown,
    after?: unknown,
    reason?: string,
  ) {
    return this.audit.log({
      actorId: actor.id,
      actorRoles: actor.roles,
      action,
      targetType: AUDIT_TARGET,
      targetId: row.id,
      before,
      after,
      reason: reason ?? null,
    });
  }

  private async notify(row: GoogleAdsUserCampaign, body: string, tab?: string): Promise<void> {
    try {
      await this.notifications.notify({
        userId: row.userId,
        type: 'google_ads_staff_change',
        title: 'Campania ta Google Ads a fost actualizată',
        body,
        data: { adsCampaignId: row.id, ...(tab ? { tab } : {}) },
        channels: { panel: true },
      });
    } catch (err) {
      this.logger.warn(
        `Owner notice for ${row.id} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
