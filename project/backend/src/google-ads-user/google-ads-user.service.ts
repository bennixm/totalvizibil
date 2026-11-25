import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';
import { isIP } from 'node:net';
import { GoogleAdsConnection, GoogleAdsUserCampaign, Prisma } from '@prisma/client';
import { BusinessActionLogService } from '../admin/business-action-log.service';
import { AppConfig } from '../config/env';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { DEFAULT_AGENT_SETTINGS, readSettings, SCHEDULE_DAYS } from './agent-settings';
import { readBrief, readinessNow, Readiness } from './campaign-brief';
import { GoogleAdsOAuthService } from './google-ads-oauth.service';
import { GoogleAdsConnectionRevokedError, GoogleAdsUserClient } from './google-ads-user-client';
import { GoogleAdsUserAgentService } from './google-ads-user-agent.service';
import { priceWork } from './pricing';
import { randomToken, sha256 } from './token-crypto';

export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
/** Holds the consent's `state` in the browser that started it. */
export const OAUTH_COOKIE = 'tvz_ads_oauth';
/** A builder draft nobody finished is forgotten after this long. */
const DRAFT_TTL_MS = 7 * 86_400_000;
const CLEAN_UP_MS = 60 * 60 * 1000;
const MAX_ACCOUNTS = 30;
/** Channel types the agent fully optimizes (the optimizer works on
 *  Responsive Search Ads + extensions). */
const SUPPORTED_CHANNELS = new Set(['SEARCH']);
/** Campaigns that can be picked at once. */
const MAX_SELECTIONS = 20;

type GoogleIdentity = { googleSub: string | null; googleEmail: string | null };
const hasIdentity = (c: GoogleIdentity) => !!(c.googleSub || c.googleEmail);
/** The same Google account: by Google's id, by email where that is unknown. */
function sameGoogle(a: GoogleIdentity, b: GoogleIdentity): boolean {
  if (a.googleSub && b.googleSub) return a.googleSub === b.googleSub;
  return !!a.googleEmail && a.googleEmail.toLowerCase() === b.googleEmail?.toLowerCase();
}

export interface SelectionInput {
  customerId: string;
  loginCustomerId?: string | null;
  campaignId: string;
}
interface Selection {
  customerId: string;
  loginCustomerId: string | null;
  campaignId: string;
}

export interface AccountRow {
  customerId: string;
  loginCustomerId: string | null;
  name: string;
  currencyCode: string | null;
  manager: boolean;
  testAccount: boolean;
  /** Can be opened to pick a campaign. False rows are shown with `reason`
   *  so the visitor knows why (never silently dropped). */
  selectable: boolean;
  /** `manager_no_clients` | `not_enabled` (CANCELED/SUSPENDED/CLOSED/…) */
  reason?: string;
  /** Google's customer status, when known. */
  status?: string;
}

/**
 * Whether an account under a manager can be managed. Google reports EVERY
 * test account as CLOSED although it works normally through the API, so for
 * those the status says nothing.
 */
export function isUsableCustomer(status: string | undefined, testAccount: boolean): boolean {
  return !status || status === 'ENABLED' || (testAccount && status === 'CLOSED');
}

/**
 * The builder flow (connect → pick campaign → account) and the owner's
 * dashboard reads. Before an account exists, the builder is accessed with a
 * draft token kept in the browser (only its hash is stored); everything up to
 * and including the dashboard is free, only optimization cycles are billed
 * (GoogleAdsUserAgentService).
 */
@Injectable()
export class GoogleAdsUserService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleAdsUserService.name);
  private readonly frontendOrigin: string;
  private readonly cookieSecure: boolean;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: GoogleAdsOAuthService,
    private readonly agent: GoogleAdsUserAgentService,
    private readonly wallet: WalletService,
    private readonly settings: PlatformSettingsService,
    private readonly ownerLog: BusinessActionLogService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
    this.cookieSecure = config.get('sessionCookieSecure', { infer: true });
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    const run = () =>
      void this.cleanUp().catch((err) =>
        this.logger.error('Clean-up failed', err instanceof Error ? err.stack : err),
      );
    this.timer = setInterval(run, CLEAN_UP_MS);
    this.timer.unref?.();
    setTimeout(run, 60_000).unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  // -------------------------------------------------------------- builder

  /** Public status of the builder (is connecting possible at all). */
  async status() {
    const missing = await this.oauth.missingConfig();
    const pricing = await this.settings.googleAdsOptimizerPricing();
    return { available: missing.length === 0, minCredits: pricing.minCredits };
  }

  /** New draft (or the existing one for this token). */
  async start(draftToken: string | undefined, userId: string | null) {
    if (draftToken) {
      const existing = await this.prisma.googleAdsConnection.findUnique({
        where: { draftTokenHash: sha256(draftToken) },
      });
      if (existing) return { draftToken, connection: this.connectionView(existing) };
    }
    const token = randomToken();
    const conn = await this.prisma.googleAdsConnection.create({
      data: { draftTokenHash: sha256(token), userId },
    });
    return { draftToken: token, connection: this.connectionView(conn) };
  }

  connectionView(c: GoogleAdsConnection) {
    return {
      id: c.id,
      status: c.status,
      googleEmail: c.googleEmail,
      lastError: c.lastError,
      selected: c.selectedCampaignId
        ? {
            customerId: c.selectedCustomerId,
            loginCustomerId: c.selectedLoginCustomerId,
            campaignId: c.selectedCampaignId,
          }
        : null,
      selections: this.selectionsOf(c),
    };
  }

  async draft(draftToken: string | undefined): Promise<GoogleAdsConnection> {
    if (!draftToken) throw new ForbiddenException('draft_required');
    const conn = await this.prisma.googleAdsConnection.findUnique({
      where: { draftTokenHash: sha256(draftToken) },
    });
    if (!conn) throw new NotFoundException('draft_not_found');
    return conn;
  }

  async connectUrl(draftToken: string | undefined) {
    const conn = await this.draft(draftToken);
    const missing = await this.oauth.missingConfig();
    if (missing.length) throw new BadRequestException({ message: 'oauth_not_configured', missing });
    const state = randomToken();
    await this.prisma.googleAdsConnection.update({
      where: { id: conn.id },
      data: {
        oauthStateHash: sha256(state),
        oauthStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
      },
    });
    return { url: await this.oauth.authUrl(state), state };
  }

  /** `lax`: Google's redirect back is a top-level GET and must carry it. The
   *  domain covers www too, since the callback is always on the main origin. */
  get oauthCookie(): CookieOptions {
    const host = new URL(this.frontendOrigin).hostname.replace(/^www\./, '');
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cookieSecure,
      path: '/api/v1/google-ads-user/oauth',
      ...(host.includes('.') && !isIP(host) ? { domain: host } : {}),
    };
  }

  /**
   * Google redirects here after consent. Returns where to send the browser.
   * `state` must match the cookie of the browser that asked for the consent:
   * otherwise anyone could send their own consent link to somebody else and
   * receive that person's Google Ads access in their own draft.
   */
  async oauthCallback(q: {
    code?: string;
    state?: string;
    error?: string;
    browserState?: string;
  }): Promise<string> {
    const back = (params: string) => `${this.frontendOrigin}/google-ads/campaigns?${params}`;
    if (!q.state) return back('error=state');
    const conn = await this.prisma.googleAdsConnection.findUnique({
      where: { oauthStateHash: sha256(q.state) },
    });
    // Reconnect from the panel (no builder draft): back to the connected
    // Google accounts page, where every campaign of this account is listed.
    const reconnect = !!conn && !conn.draftTokenHash && !!conn.userId;
    const fail = (code: string) =>
      reconnect
        ? `${this.frontendOrigin}/google-ads/connections?error=${code}`
        : back(`error=${code}`);
    if (!q.browserState || sha256(q.state) !== sha256(q.browserState)) return fail('state');
    if (!conn || !conn.oauthStateExpiresAt || conn.oauthStateExpiresAt < new Date()) {
      return fail('expired');
    }
    // One-time state.
    await this.prisma.googleAdsConnection.update({
      where: { id: conn.id },
      data: { oauthStateHash: null, oauthStateExpiresAt: null },
    });
    if (q.error || !q.code) return fail(encodeURIComponent(q.error ?? 'denied'));
    try {
      const { refreshTokenEnc, email, sub } = await this.oauth.exchange(q.code);
      const identity = { googleSub: sub, googleEmail: email };
      // Another Google account cannot reach these campaigns.
      if (reconnect && hasIdentity(conn) && !sameGoogle(conn, identity)) {
        await this.revokeUnlessShared({ id: conn.id, refreshTokenEnc, ...identity });
        return fail('account');
      }
      await this.prisma.googleAdsConnection.update({
        where: { id: conn.id },
        data: {
          refreshTokenEnc,
          googleEmail: email,
          googleSub: sub,
          status: 'connected',
          connectedAt: new Date(),
          lastError: null,
        },
      });
      // A reconnect revives this connection's campaigns.
      const taken = await this.reviveCampaigns(conn.id);
      if (reconnect) {
        await this.ownerLog.log({
          actorId: conn.userId!,
          action: 'ads.reconnect',
          targetType: 'google_ads_connection',
          targetId: conn.id,
        });
        return `${this.frontendOrigin}/google-ads/connections?reconnected=1${taken ? `&taken=${taken}` : ''}`;
      }
      return back('connected=1');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OAuth exchange failed for connection ${conn.id}: ${reason}`);
      await this.prisma.googleAdsConnection.update({
        where: { id: conn.id },
        data: { status: 'error', lastError: reason.slice(0, 300) },
      });
      const code = /adwords_scope/.test(reason)
        ? 'scope'
        : /refresh/.test(reason)
          ? 'refresh'
          : 'exchange';
      return fail(code);
    }
  }

  private async rootClient(conn: GoogleAdsConnection, customerId: string, login: string | null) {
    if (!conn.refreshTokenEnc || conn.status !== 'connected') {
      throw new BadRequestException('google_ads_not_connected');
    }
    return this.oauth.adsClient(conn.refreshTokenEnc, customerId, login);
  }

  private async guard<T>(conn: GoogleAdsConnection, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof GoogleAdsConnectionRevokedError) {
        await this.agent.connectionLost(conn.id);
        throw new BadRequestException('google_ads_reconnect_required');
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (/CUSTOMER_NOT_ENABLED/.test(msg)) throw new BadRequestException('customer_not_enabled');
      throw new BadRequestException(msg);
    }
  }

  /** Every Google Ads account the connected Google user can open, including
   *  client accounts under a manager (MCC) they have access to. */
  async accounts(draftToken: string | undefined): Promise<AccountRow[]> {
    return this.accountsFor(await this.draft(draftToken));
  }

  /** Accounts of one connection (builder draft or a signed-in owner's). */
  private async accountsFor(conn: GoogleAdsConnection): Promise<AccountRow[]> {
    return this.guard(conn, async () => {
      const root = await this.rootClient(conn, '0', null);
      const ids = (await root.listAccessibleCustomers()).slice(0, MAX_ACCOUNTS);
      this.logger.log(`Connection ${conn.id}: Google lists ${ids.length} accessible customer(s).`);
      const out: AccountRow[] = [];
      // Why an account could not be read, so an empty result is never
      // reported as "no access" when Google actually said something else.
      const failures: string[] = [];
      for (const id of ids) {
        const client = await this.rootClient(conn, id, null);
        const row = await client
          .search(
            'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.test_account FROM customer LIMIT 1',
          )
          .catch((err: unknown) => {
            if (err instanceof GoogleAdsConnectionRevokedError) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Connection ${conn.id}: customer ${id} not readable: ${msg}`);
            failures.push(`${id}: ${msg}`);
            return [];
          });
        const c = row[0]?.customer as
          | {
              descriptiveName?: string;
              currencyCode?: string;
              manager?: boolean;
              testAccount?: boolean;
            }
          | undefined;
        if (!c) continue;
        if (!c.manager) {
          // Already listed through a manager: keep one row, the direct one.
          const dup = out.findIndex((o) => o.customerId === id);
          if (dup >= 0) out.splice(dup, 1);
          out.push({
            customerId: id,
            loginCustomerId: null,
            name: c.descriptiveName || id,
            currencyCode: c.currencyCode ?? null,
            manager: false,
            testAccount: !!c.testAccount,
            selectable: true,
          });
          continue;
        }
        // Every client account under the manager, whatever its status:
        // inactive ones are listed as not selectable, with the reason.
        const clients = await client
          .search(
            'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, ' +
              'customer_client.manager, customer_client.test_account, customer_client.status ' +
              'FROM customer_client WHERE customer_client.manager = FALSE',
          )
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Connection ${conn.id}: clients of manager ${id} not readable: ${msg}`,
            );
            failures.push(`${id}: ${msg}`);
            return [];
          });
        let listed = 0;
        for (const r of clients) {
          const cc = r.customerClient as
            | {
                id?: string;
                descriptiveName?: string;
                currencyCode?: string;
                testAccount?: boolean;
                status?: string;
              }
            | undefined;
          if (!cc?.id || out.some((o) => o.customerId === cc.id)) continue;
          const enabled = isUsableCustomer(cc.status, !!cc.testAccount);
          out.push({
            customerId: String(cc.id),
            loginCustomerId: id,
            name: cc.descriptiveName || String(cc.id),
            currencyCode: cc.currencyCode ?? null,
            manager: false,
            testAccount: !!cc.testAccount,
            selectable: enabled,
            ...(enabled ? {} : { reason: 'not_enabled', status: cc.status }),
          });
          listed++;
          if (out.length >= MAX_ACCOUNTS) break;
        }
        this.logger.log(
          `Connection ${conn.id}: manager ${id} has ${clients.length} client account(s) (${listed} listed).`,
        );
        if (!listed && !failures.some((f) => f.startsWith(`${id}:`))) {
          // A manager with no client accounts: say so instead of "no access".
          out.push({
            customerId: id,
            loginCustomerId: null,
            name: c.descriptiveName || id,
            currencyCode: c.currencyCode ?? null,
            manager: true,
            testAccount: !!c.testAccount,
            selectable: false,
            reason: 'manager_no_clients',
          });
        }
      }
      if (!out.length && failures.length) {
        // Accounts exist but none could be read: surface Google's reason.
        throw new Error(failures[0]);
      }
      return out;
    });
  }

  /** Campaigns of one account with real last-30-days metrics. */
  async campaigns(
    draftToken: string | undefined,
    customerId: string,
    loginCustomerId: string | null,
  ) {
    return this.campaignsFor(await this.draft(draftToken), customerId, loginCustomerId);
  }

  private async campaignsFor(
    conn: GoogleAdsConnection,
    customerId: string,
    loginCustomerId: string | null,
  ) {
    const cid = customerId.replace(/\D/g, '');
    const login = loginCustomerId ? loginCustomerId.replace(/\D/g, '') : null;
    return this.guard(conn, async () => {
      const client = await this.rootClient(conn, cid, login);
      return this.listCampaigns(client);
    });
  }

  /**
   * Validates picked campaigns against Google (they exist in that account
   * and are a supported type) and returns them normalized. Max 20.
   */
  private async validateSelections(
    conn: GoogleAdsConnection,
    items: SelectionInput[],
  ): Promise<Selection[]> {
    if (!items.length) throw new BadRequestException('no_campaign_selected');
    if (items.length > MAX_SELECTIONS) throw new BadRequestException('too_many_campaigns');
    const norm = items.map((i) => ({
      customerId: i.customerId.replace(/\D/g, ''),
      loginCustomerId: i.loginCustomerId ? i.loginCustomerId.replace(/\D/g, '') : null,
      campaignId: i.campaignId.replace(/\D/g, ''),
    }));
    const unique = [...new Map(norm.map((n) => [`${n.customerId}:${n.campaignId}`, n])).values()];
    const byAccount = new Map<string, Selection[]>();
    for (const s of unique) {
      const k = `${s.customerId}:${s.loginCustomerId ?? ''}`;
      byAccount.set(k, [...(byAccount.get(k) ?? []), s]);
    }
    for (const group of byAccount.values()) {
      const list = await this.campaignsFor(conn, group[0].customerId, group[0].loginCustomerId);
      for (const s of group) {
        const picked = list.find((c) => c.id === s.campaignId);
        if (!picked) throw new BadRequestException('Campania nu a fost găsită în acest cont.');
        if (!picked.supported) throw new BadRequestException('unsupported_channel');
      }
    }
    return unique;
  }

  /**
   * Creates (or revives) the managed campaigns for `userId` from validated
   * selections, then runs each one's first free analysis. Shared by the
   * builder's account step and "add campaigns" on a connected account.
   */
  private async attachCampaigns(
    conn: GoogleAdsConnection,
    userId: string,
    selections: Selection[],
  ): Promise<{ ids: string[]; taken: string[] }> {
    const ids: string[] = [];
    const taken: string[] = [];
    const byAccount = new Map<string, Selection[]>();
    for (const s of selections) {
      const k = `${s.customerId}:${s.loginCustomerId ?? ''}`;
      byAccount.set(k, [...(byAccount.get(k) ?? []), s]);
    }
    for (const group of byAccount.values()) {
      const { customerId, loginCustomerId } = group[0];
      const client = await this.rootClient(conn, customerId, loginCustomerId);
      const list = await this.guard(conn, () => this.listCampaigns(client));
      const customer = await client
        .search('SELECT customer.descriptive_name FROM customer LIMIT 1')
        .catch(() => []);
      const customerName =
        (customer[0]?.customer as { descriptiveName?: string } | undefined)?.descriptiveName ??
        null;
      for (const s of group) {
        const picked = list.find((c) => c.id === s.campaignId);
        if (!picked) continue;
        const key = {
          userId_customerId_googleCampaignId: {
            userId,
            customerId,
            googleCampaignId: picked.id,
          },
        };
        const row = await this.prisma.$transaction(async (tx) => {
          if (await this.managedByOther(tx, userId, customerId, picked.id)) return null;
          const known = await tx.googleAdsUserCampaign.findUnique({ where: key });
          return tx.googleAdsUserCampaign.upsert({
            where: key,
            create: {
              userId,
              connectionId: conn.id,
              customerId,
              loginCustomerId,
              customerName,
              googleCampaignId: picked.id,
              name: picked.name,
              channelType: picked.channelType,
              currencyCode: picked.currencyCode,
              // No business name: the Google account label is often not it, and
              // the agent would publish it next to the ads. The owner writes it.
              settings: { ...DEFAULT_AGENT_SETTINGS } as unknown as Prisma.InputJsonValue,
            },
            update: {
              connectionId: conn.id,
              loginCustomerId,
              ...(known?.status === 'disconnected' ? this.revived(known) : {}),
              // Added again after being removed: a fresh start, nothing
              // scheduled or remembered from before.
              ...(known?.status === 'removed'
                ? {
                    status: 'active' as const,
                    resumeStatus: null,
                    nextCycleAt: null,
                    settings: { ...DEFAULT_AGENT_SETTINGS } as unknown as Prisma.InputJsonValue,
                  }
                : {}),
            },
          });
        });
        if (!row) {
          taken.push(picked.name);
          continue;
        }
        ids.push(row.id);
        await this.agent
          .analyze(row)
          .catch((err) =>
            this.logger.warn(
              `First analysis of ${row.id} failed: ${err instanceof Error ? err.message : err}`,
            ),
          );
      }
    }
    return { ids, taken };
  }

  /**
   * Whether another account's agent already works on this Google campaign:
   * two agents would undo each other and both would be billed. Locks the
   * campaign for the rest of the transaction.
   */
  private async managedByOther(
    tx: Prisma.TransactionClient,
    userId: string,
    customerId: string,
    googleCampaignId: string,
  ): Promise<boolean> {
    const key = `gads:${customerId}:${googleCampaignId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
    const other = await tx.googleAdsUserCampaign.count({
      where: {
        customerId,
        googleCampaignId,
        userId: { not: userId },
        status: { in: ['active', 'paused'] },
      },
    });
    return other > 0;
  }

  /** Brings back a connection's campaigns. Returns how many could not be,
   *  because another account manages them meanwhile. */
  private async reviveCampaigns(connectionId: string): Promise<number> {
    const lost = await this.prisma.googleAdsUserCampaign.findMany({
      where: { connectionId, status: 'disconnected' },
    });
    let taken = 0;
    for (const row of lost) {
      await this.prisma.$transaction(async (tx) => {
        if (await this.managedByOther(tx, row.userId, row.customerId, row.googleCampaignId))
          taken++;
        else
          await tx.googleAdsUserCampaign.update({
            where: { id: row.id },
            data: this.revived(row),
          });
      });
    }
    return taken;
  }

  /**
   * Revokes at Google only when no other connection uses the same Google
   * account: Google withdraws the app's whole access for that account, so
   * revoking one token would cut the others off too.
   */
  private async revokeUnlessShared(conn: {
    id: string;
    refreshTokenEnc: string | null;
    googleSub: string | null;
    googleEmail: string | null;
  }): Promise<void> {
    if (!conn.refreshTokenEnc) return;
    const same: Prisma.GoogleAdsConnectionWhereInput[] = [
      ...(conn.googleSub ? [{ googleSub: conn.googleSub }] : []),
      ...(conn.googleEmail
        ? [{ googleEmail: { equals: conn.googleEmail, mode: 'insensitive' as const } }]
        : []),
    ];
    const shared = same.length
      ? await this.prisma.googleAdsConnection.count({
          where: { id: { not: conn.id }, refreshTokenEnc: { not: null }, OR: same },
        })
      : 0;
    if (!shared) await this.oauth.revoke(conn.refreshTokenEnc);
  }

  /** One connection per Google account and owner: everything on `from` moves
   *  to `to`, then `from` is deleted. */
  private async mergeConnection(from: string, to: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.googleAdsUserCampaign.updateMany({
        where: { connectionId: from },
        data: { connectionId: to },
      }),
      this.prisma.googleAdsConnection.delete({ where: { id: from } }),
    ]);
  }

  /** Hourly: forget abandoned builder drafts (their Google access included)
   *  and unite connections of the same Google account. */
  async cleanUp(): Promise<void> {
    const drafts = await this.prisma.googleAdsConnection.findMany({
      where: {
        userId: null,
        updatedAt: { lt: new Date(Date.now() - DRAFT_TTL_MS) },
        campaigns: { none: {} },
      },
      take: 100,
    });
    for (const d of drafts) {
      await this.revokeUnlessShared(d);
      await this.prisma.googleAdsConnection.deleteMany({ where: { id: d.id, userId: null } });
    }
    const owned = await this.prisma.googleAdsConnection.findMany({
      where: { userId: { not: null }, draftTokenHash: null },
      orderBy: { createdAt: 'asc' },
    });
    const kept: GoogleAdsConnection[] = [];
    // Working connections first, so they are the ones that stay.
    owned.sort((a, b) => Number(b.status === 'connected') - Number(a.status === 'connected'));
    for (const c of owned) {
      const keep = kept.find((k) => k.userId === c.userId && sameGoogle(k, c));
      if (!keep) {
        kept.push(c);
        continue;
      }
      const busy = { status: 'running' as const, userCampaign: { connectionId: c.id } };
      const [cycles, chats] = await Promise.all([
        this.prisma.googleAdsOptimizationCycle.count({ where: busy }),
        this.prisma.googleAdsChatTurn.count({ where: busy }),
      ]);
      // Both tokens belong to the same Google access, so none is revoked.
      if (!cycles && !chats) await this.mergeConnection(c.id, keep.id);
    }
  }

  private async listCampaigns(client: GoogleAdsUserClient) {
    const [base, metrics] = await Promise.all([
      client.search(
        'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
          'campaign.primary_status, campaign.bidding_strategy_type, campaign_budget.amount_micros, customer.currency_code ' +
          "FROM campaign WHERE campaign.status != 'REMOVED'",
      ),
      client.search(
        'SELECT campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
          "FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date DURING LAST_30_DAYS",
      ),
    ]);
    const m = new Map<string, Record<string, unknown>>();
    for (const r of metrics) {
      const id = String((r.campaign as { id?: string })?.id ?? '');
      if (id) m.set(id, (r.metrics as Record<string, unknown>) ?? {});
    }
    return base
      .map((r) => {
        const c = (r.campaign ?? {}) as {
          id?: string;
          name?: string;
          status?: string;
          advertisingChannelType?: string;
          primaryStatus?: string;
          biddingStrategyType?: string;
        };
        const id = String(c.id ?? '');
        const mm = m.get(id) ?? {};
        const num = (v: unknown) => Number(v ?? 0) || 0;
        return {
          id,
          name: c.name ?? id,
          status: c.status ?? 'UNKNOWN',
          primaryStatus: c.primaryStatus ?? null,
          channelType: c.advertisingChannelType ?? 'UNKNOWN',
          biddingStrategyType: c.biddingStrategyType ?? null,
          dailyBudgetMicros: (r.campaignBudget as { amountMicros?: string })?.amountMicros ?? null,
          currencyCode: (r.customer as { currencyCode?: string })?.currencyCode ?? null,
          supported: SUPPORTED_CHANNELS.has(c.advertisingChannelType ?? ''),
          last30: {
            impressions: num(mm.impressions),
            clicks: num(mm.clicks),
            costMicros: num(mm.costMicros),
            conversions: num(mm.conversions),
          },
        };
      })
      .filter((c) => c.id)
      .sort(
        (a, b) =>
          Number(b.supported) - Number(a.supported) || b.last30.costMicros - a.last30.costMicros,
      );
  }

  /** Builder step 2: the campaigns picked (one or several, across the
   *  accounts of this Google login). */
  async select(draftToken: string | undefined, items: SelectionInput[]) {
    const conn = await this.draft(draftToken);
    const picked = await this.validateSelections(conn, items);
    const updated = await this.prisma.googleAdsConnection.update({
      where: { id: conn.id },
      data: {
        selections: picked as unknown as Prisma.InputJsonValue,
        selectedCustomerId: picked[0].customerId,
        selectedLoginCustomerId: picked[0].loginCustomerId,
        selectedCampaignId: picked[0].campaignId,
      },
    });
    return this.connectionView(updated);
  }

  /**
   * Account step: binds the draft (connection + picked campaigns) to the
   * signed-in platform account and creates the managed campaigns. Free;
   * each gets its first (free) analysis so the dashboard opens with data.
   */
  async claim(draftToken: string | undefined, userId: string) {
    const conn = await this.draft(draftToken);
    if (conn.userId && conn.userId !== userId) throw new ForbiddenException('draft_owned_by_other');
    const selections = this.selectionsOf(conn);
    if (conn.status !== 'connected' || !selections.length) {
      throw new BadRequestException('setup_incomplete');
    }
    // Bound to this user now, but the draft stays usable until the campaigns
    // exist, so a failure in between can simply be retried.
    const bound = await this.prisma.googleAdsConnection.updateMany({
      where: { id: conn.id, OR: [{ userId: null }, { userId }] },
      data: { userId },
    });
    if (!bound.count) throw new ForbiddenException('draft_owned_by_other');
    const mine = await this.prisma.googleAdsConnection.findMany({
      where: { userId, id: { not: conn.id }, draftTokenHash: null },
      orderBy: { createdAt: 'asc' },
    });
    const existing = mine.find((c) => sameGoogle(c, conn));
    let target: GoogleAdsConnection = { ...conn, userId };
    if (existing) {
      target = await this.prisma.googleAdsConnection.update({
        where: { id: existing.id },
        data: {
          refreshTokenEnc: conn.refreshTokenEnc,
          googleSub: conn.googleSub,
          googleEmail: conn.googleEmail,
          status: 'connected',
          connectedAt: conn.connectedAt,
          lastError: null,
        },
      });
    }
    const { ids, taken } = await this.attachCampaigns(target, userId, selections);
    if (!ids.length)
      throw new BadRequestException(
        taken.length ? 'campaign_managed_elsewhere' : 'Campaniile nu mai există în cont.',
      );
    if (existing) {
      await this.reviveCampaigns(existing.id);
      await this.mergeConnection(conn.id, existing.id);
    } else {
      await this.prisma.googleAdsConnection.update({
        where: { id: conn.id },
        data: { draftTokenHash: null },
      });
    }
    return { campaignId: ids[0], campaignIds: ids, taken };
  }

  private selectionsOf(conn: GoogleAdsConnection): Selection[] {
    const raw = Array.isArray(conn.selections) ? (conn.selections as unknown as Selection[]) : [];
    if (raw.length) return raw;
    return conn.selectedCampaignId && conn.selectedCustomerId
      ? [
          {
            customerId: conn.selectedCustomerId,
            loginCustomerId: conn.selectedLoginCustomerId,
            campaignId: conn.selectedCampaignId,
          },
        ]
      : [];
  }

  // ------------------------------------------- connected Google accounts

  private async ownedConnection(userId: string, id: string): Promise<GoogleAdsConnection> {
    const conn = await this.prisma.googleAdsConnection.findUnique({ where: { id } });
    if (!conn || conn.userId !== userId) throw new NotFoundException('Contul nu a fost găsit.');
    return conn;
  }

  /** The owner's connected Google accounts with their managed campaigns. */
  async connections(userId: string) {
    const rows = await this.prisma.googleAdsConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        campaigns: {
          where: { status: { not: 'removed' } },
          select: { id: true, name: true, status: true, customerName: true, customerId: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      googleEmail: c.googleEmail,
      status: c.status,
      connectedAt: c.connectedAt,
      lastError: c.lastError,
      campaigns: c.campaigns,
    }));
  }

  async connectionAccounts(userId: string, id: string) {
    return this.accountsFor(await this.ownedConnection(userId, id));
  }

  /** Campaigns of one account of a connection, flagging the ones already
   *  in the owner's panel. */
  async connectionCampaigns(
    userId: string,
    id: string,
    customerId: string,
    loginCustomerId: string | null,
  ) {
    const conn = await this.ownedConnection(userId, id);
    const list = await this.campaignsFor(conn, customerId, loginCustomerId);
    const cid = customerId.replace(/\D/g, '');
    const managed = await this.prisma.googleAdsUserCampaign.findMany({
      where: { userId, customerId: cid },
      select: { googleCampaignId: true, status: true },
    });
    const managedIds = new Set(
      managed
        .filter((m) => m.status === 'active' || m.status === 'paused')
        .map((m) => m.googleCampaignId),
    );
    return list.map((c) => ({ ...c, managed: managedIds.has(c.id) }));
  }

  /** "Add campaigns" from an already connected Google account: no new
   *  Google sign-in. */
  async addCampaigns(userId: string, id: string, items: SelectionInput[]) {
    const conn = await this.ownedConnection(userId, id);
    const picked = await this.validateSelections(conn, items);
    const { ids, taken } = await this.attachCampaigns(conn, userId, picked);
    if (!ids.length && taken.length) throw new BadRequestException('campaign_managed_elsewhere');
    return { campaignIds: ids, taken };
  }

  /** Disconnect a whole Google account: revoke at Google, delete the token,
   *  every campaign on it becomes `disconnected` (history kept). */
  async disconnectConnection(userId: string, id: string) {
    const conn = await this.ownedConnection(userId, id);
    const running = await this.prisma.googleAdsOptimizationCycle.count({
      where: { userCampaign: { connectionId: conn.id }, status: 'running' },
    });
    if (running) throw new BadRequestException('cycle_running');
    const chatting = await this.prisma.googleAdsChatTurn.count({
      where: { userCampaign: { connectionId: conn.id }, status: 'running' },
    });
    if (chatting) throw new BadRequestException('chat_running');
    await this.revokeUnlessShared(conn);
    await this.prisma.$transaction([
      this.prisma.googleAdsUserAction.updateMany({
        where: { userCampaign: { connectionId: conn.id }, status: 'pending_approval' },
        data: { status: 'expired', errorMessage: 'Contul Google a fost deconectat.' },
      }),
      this.prisma.googleAdsConnection.update({
        where: { id: conn.id },
        data: { refreshTokenEnc: null, status: 'revoked', lastError: 'Deconectat de utilizator.' },
      }),
      ...this.agent.loseConnection(conn.id),
    ]);
    return { ok: true };
  }

  async reconnectConnectionUrl(userId: string, id: string) {
    const conn = await this.ownedConnection(userId, id);
    return this.oauthUrlFor(conn.id);
  }

  private async oauthUrlFor(connectionId: string) {
    const missing = await this.oauth.missingConfig();
    if (missing.length) throw new BadRequestException({ message: 'oauth_not_configured', missing });
    const state = randomToken();
    await this.prisma.googleAdsConnection.update({
      where: { id: connectionId },
      data: {
        oauthStateHash: sha256(state),
        oauthStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
      },
    });
    return { url: await this.oauth.authUrl(state), state };
  }

  /** A campaign whose Google access is back: the status it had, and a
   *  schedule that never starts an overdue (billed) cycle on the spot. */
  private revived(row: GoogleAdsUserCampaign) {
    const days = SCHEDULE_DAYS[readSettings(row.settings).schedule];
    return {
      status: row.resumeStatus ?? ('active' as const),
      resumeStatus: null,
      ...(days && (!row.nextCycleAt || row.nextCycleAt.getTime() <= Date.now())
        ? { nextCycleAt: this.nextRun(days, null) }
        : {}),
    };
  }

  // ------------------------------------------------------------ dashboard

  async list(userId: string) {
    const rows = await this.prisma.googleAdsUserCampaign.findMany({
      where: { userId, status: { not: 'removed' } },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { actions: { where: { status: 'pending_approval' } } } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      customerName: r.customerName,
      status: r.status,
      score: r.score,
      adStrength: r.adStrength,
      lastCycleAt: r.lastCycleAt,
      pendingApprovals: r._count.actions,
    }));
  }

  async detail(userId: string, id: string) {
    const row = await this.agent.ownedCampaign(userId, id);
    const [conn, pending, cycles, pricing, wallet, running, chat] = await Promise.all([
      this.prisma.googleAdsConnection.findUnique({ where: { id: row.connectionId } }),
      this.prisma.googleAdsUserAction.findMany({
        where: { userCampaignId: id, status: 'pending_approval' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.googleAdsOptimizationCycle.findMany({
        where: { userCampaignId: id },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
      this.settings.googleAdsOptimizerPricing(),
      this.wallet.getSummary(userId),
      this.prisma.googleAdsOptimizationCycle.findFirst({
        where: { userCampaignId: id, status: 'running' },
        select: { id: true, startedAt: true },
      }),
      this.prisma.googleAdsChatTurn.aggregate({
        where: { userCampaignId: id, status: { not: 'running' } },
        _count: true,
        _sum: { chargedMinor: true },
      }),
    ]);
    return {
      campaign: {
        id: row.id,
        name: row.name,
        customerId: row.customerId,
        customerName: row.customerName,
        googleCampaignId: row.googleCampaignId,
        channelType: row.channelType,
        currencyCode: row.currencyCode,
        status: row.status,
        score: row.score,
        adStrength: row.adStrength,
        syncedAt: row.syncedAt,
        lastCycleAt: row.lastCycleAt,
        nextCycleAt: row.nextCycleAt,
        createdAt: row.createdAt,
      },
      connection: conn ? { status: conn.status, googleEmail: conn.googleEmail } : null,
      snapshot: row.snapshot,
      settings: readSettings(row.settings),
      brief: readBrief(row.brief),
      readiness: readinessNow(
        (row.snapshot as { readiness?: Readiness } | null)?.readiness,
        readBrief(row.brief),
      ),
      pending,
      cycles,
      runningCycle: running,
      firstCycleDone: cycles.length > 0,
      pricing: {
        minCredits: pricing.minCredits,
        maxCredits: pricing.maxCredits,
        levels: pricing.levels,
      },
      balance: wallet.balance,
      chatCosts: { messages: chat._count, chargedMinor: chat._sum.chargedMinor ?? 0 },
    };
  }

  /** What the owner paid the agent, per campaign, in a period. */
  async costs(userId: string, from?: Date, to?: Date) {
    const range = from || to ? { gte: from, lte: to } : undefined;
    const [rows, cycles, chat] = await Promise.all([
      this.prisma.googleAdsUserCampaign.findMany({
        where: { userId },
        select: { id: true, name: true, status: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.googleAdsOptimizationCycle.groupBy({
        by: ['userCampaignId'],
        where: { userId, startedAt: range, status: { not: 'running' } },
        _count: true,
        _sum: { chargedMinor: true, refundedMinor: true },
      }),
      this.prisma.googleAdsChatTurn.groupBy({
        by: ['userCampaignId'],
        where: { userId, createdAt: range, status: { not: 'running' } },
        _count: true,
        _sum: { chargedMinor: true },
      }),
    ]);
    const items = rows
      .map((r) => {
        const c = cycles.find((x) => x.userCampaignId === r.id);
        const m = chat.find((x) => x.userCampaignId === r.id);
        return {
          id: r.id,
          // A campaign removed since is still listed: its costs happened.
          name: r.name,
          removed: r.status === 'removed',
          cycles: c?._count ?? 0,
          cyclesMinor: c?._sum.chargedMinor ?? 0,
          returnedMinor: c?._sum.refundedMinor ?? 0,
          messages: m?._count ?? 0,
          chatMinor: m?._sum.chargedMinor ?? 0,
        };
      })
      .filter((x) => !x.removed || x.cycles || x.messages);
    const sum = (k: 'cyclesMinor' | 'chatMinor' | 'returnedMinor') =>
      items.reduce((n, x) => n + x[k], 0);
    return {
      items,
      totals: {
        cyclesMinor: sum('cyclesMinor'),
        chatMinor: sum('chatMinor'),
        returnedMinor: sum('returnedMinor'),
        totalMinor: sum('cyclesMinor') + sum('chatMinor'),
      },
    };
  }

  async actions(userId: string, id: string) {
    await this.agent.ownedCampaign(userId, id);
    return this.prisma.googleAdsUserAction.findMany({
      where: { userCampaignId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async activity(userId: string, id: string, after?: Date) {
    await this.agent.ownedCampaign(userId, id);
    const events = await this.prisma.googleAdsAgentEvent.findMany({
      where: {
        userCampaignId: id,
        ...(after ? { OR: [{ startedAt: { gt: after } }, { finishedAt: { gt: after } }] } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: 120,
    });
    const running = await this.prisma.googleAdsOptimizationCycle.count({
      where: { userCampaignId: id, status: 'running' },
    });
    return { events, running: running > 0, serverTime: new Date() };
  }

  async updateSettings(userId: string, id: string, patch: Record<string, unknown>) {
    const row = await this.agent.ownedCampaign(userId, id);
    const next = readSettings({ ...readSettings(row.settings), ...patch });
    const days = SCHEDULE_DAYS[next.schedule];
    const pricing = await this.settings.googleAdsOptimizerPricing();
    if (days && next.maxCreditsPerCycle < pricing.minCredits) {
      throw new BadRequestException(
        `Limita pe ciclu trebuie să fie cel puțin ${pricing.minCredits} credite (prețul minim al unui ciclu).`,
      );
    }
    const prevDays = SCHEDULE_DAYS[readSettings(row.settings).schedule];
    await this.prisma.googleAdsUserCampaign.update({
      where: { id },
      data: {
        settings: next as unknown as Prisma.InputJsonValue,
        // Schedule changed: first automatic cycle one period from now (or
        // from the last cycle), never immediately.
        ...(days !== prevDays
          ? {
              nextCycleAt: days ? this.nextRun(days, row.lastCycleAt) : null,
            }
          : {}),
      },
    });
    return next;
  }

  /** One period after the last cycle; a moment already past would start a
   *  billed cycle right away, so then it is one period from now. */
  private nextRun(days: number, lastCycleAt: Date | null): Date {
    const period = days * 86_400_000;
    const next = (lastCycleAt?.getTime() ?? Date.now()) + period;
    return new Date(next > Date.now() ? next : Date.now() + period);
  }

  async setPaused(userId: string, id: string, paused: boolean) {
    const row = await this.agent.ownedCampaign(userId, id);
    if (row.status === 'disconnected')
      throw new BadRequestException('google_ads_reconnect_required');
    const days = SCHEDULE_DAYS[readSettings(row.settings).schedule];
    await this.prisma.googleAdsUserCampaign.update({
      where: { id },
      data: {
        status: paused ? 'paused' : 'active',
        // Resuming never triggers an overdue (billed) cycle on the spot.
        ...(!paused && days && row.nextCycleAt && row.nextCycleAt.getTime() <= Date.now()
          ? { nextCycleAt: this.nextRun(days, null) }
          : {}),
      },
    });
    return { status: paused ? 'paused' : 'active' };
  }

  /** Stops managing the campaign (nothing changes in Google Ads). Revokes
   *  the Google consent when no other campaign uses this connection. */
  async remove(userId: string, id: string) {
    const row = await this.agent.ownedCampaign(userId, id);
    const running = await this.prisma.googleAdsOptimizationCycle.count({
      where: { userCampaignId: id, status: 'running' },
    });
    if (running) throw new BadRequestException('cycle_running');
    // A running chat message holds credits that its own row must settle.
    const chatting = await this.prisma.googleAdsChatTurn.count({
      where: { userCampaignId: id, status: 'running' },
    });
    if (chatting) throw new BadRequestException('chat_running');
    // Kept as a tombstone for the books; what the owner told the agent goes.
    await this.prisma.$transaction([
      this.prisma.googleAdsUserCampaign.update({
        where: { id },
        data: {
          status: 'removed',
          resumeStatus: null,
          nextCycleAt: null,
          settings: Prisma.DbNull,
          brief: Prisma.DbNull,
          snapshot: Prisma.DbNull,
        },
      }),
      this.prisma.googleAdsUserAction.updateMany({
        where: { userCampaignId: id, status: 'pending_approval' },
        data: { status: 'expired', errorMessage: 'Campania a fost scoasă din platformă.' },
      }),
      this.prisma.googleAdsChatTurn.updateMany({
        where: { userCampaignId: id },
        data: { userText: '', assistantText: null, questions: Prisma.DbNull },
      }),
    ]);
    const others = await this.prisma.googleAdsUserCampaign.count({
      where: { connectionId: row.connectionId, status: { not: 'removed' } },
    });
    if (!others) {
      const conn = await this.prisma.googleAdsConnection.findUnique({
        where: { id: row.connectionId },
      });
      if (conn) await this.revokeUnlessShared(conn);
      await this.prisma.googleAdsConnection.update({
        where: { id: row.connectionId },
        data: { refreshTokenEnc: null, status: 'revoked' },
      });
    }
    return { ok: true };
  }

  /**
   * Builder: forget the connected Google account (revoke at Google, delete
   * the stored token, clear the picked campaign) so the visitor can connect
   * a different one. The draft itself stays.
   */
  async disconnectDraft(draftToken: string | undefined) {
    const conn = await this.draft(draftToken);
    await this.revokeUnlessShared(conn);
    const updated = await this.prisma.googleAdsConnection.update({
      where: { id: conn.id },
      data: {
        refreshTokenEnc: null,
        status: 'pending',
        googleEmail: null,
        googleSub: null,
        connectedAt: null,
        lastError: null,
        // Otherwise the next account connected on this draft would inherit the
        // previous account's picks at the claim step.
        selections: Prisma.DbNull,
        selectedCustomerId: null,
        selectedLoginCustomerId: null,
        selectedCampaignId: null,
      },
    });
    return this.connectionView(updated);
  }

  /**
   * Dashboard: disconnect the Google account behind a campaign. Access is
   * revoked at Google and the token deleted; every campaign on that
   * connection becomes `disconnected` (history kept, reconnect anytime).
   * Nothing changes in Google Ads itself.
   */
  async disconnectCampaign(userId: string, id: string) {
    const row = await this.agent.ownedCampaign(userId, id);
    return this.disconnectConnection(userId, row.connectionId);
  }

  /** Reconnect an existing campaign's Google account (after a revoke). */
  async reconnectUrl(userId: string, id: string) {
    const row = await this.agent.ownedCampaign(userId, id);
    return this.oauthUrlFor(row.connectionId);
  }

  /** Free: the price a given amount of work would have (for the pricing
   *  explainer in the dashboard). */
  async pricingPreview() {
    const pricing = await this.settings.googleAdsOptimizerPricing();
    return { pricing, example: priceWork(pricing, { analysis: 1 }, 0) };
  }
}
