import { ConfigService } from '@nestjs/config';
import { Logger, OnModuleInit } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createHash } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { AppConfig } from '../config/env';

/** How often a connected socket's session is re-checked against the DB. The
 *  session was previously only validated once, at handshake — a revoked
 *  session (password reset, an admin ban, a forced logout) left that socket
 *  receiving live pushes (including other users' PII in lead/appointment
 *  notification bodies) for as long as the tab stayed open. */
const SESSION_REVALIDATE_INTERVAL_MS = 60_000;

/** Max token hashes per batched `IN (…)` lookup. Prisma serializes an `in`
 *  list as one bind parameter per element with no chunking of its own, and
 *  Postgres hard-caps a statement at 65,535 bind parameters — so the revalidate
 *  pass has to do the chunking itself or it simply starts failing outright
 *  once enough sockets are connected. */
const SESSION_REVALIDATE_CHUNK = 1_000;

/** Reads one cookie's value out of a raw `Cookie` header — socket.io's
 *  handshake isn't run through Express's cookie-parser middleware, so the
 *  session cookie has to be pulled out manually here. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Real-time push for the notification bell. Auth reuses the SAME session
 * cookie as the REST API (see AuthGuard) — no separate token scheme. Each
 * socket joins a room named after its userId, so `pushToUser`/`broadcast`
 * reach every open tab/device for that user without tracking sockets by hand.
 *
 * ORIGIN POLICY. `cors.origin: true` here reflects whatever `Origin` the
 * connecting browser sent, and `credentials: true` accepts the session cookie
 * on that connection — on its own that is the exact opposite of the strict,
 * single-origin, credentialed policy `main.ts` applies to every authenticated
 * REST route (`strictCors`, built from the ConfigService-validated
 * `frontendOrigin`). It is NOT left permissive: the real allowlist check runs
 * in `handleConnection` below, against that same `frontendOrigin` value, and
 * runs BEFORE any cookie/session resolution.
 *
 * The decorator's argument is a static object evaluated at module load, long
 * before Nest's DI container exists, so the configured origin cannot be
 * injected into it. Re-reading `FRONTEND_ORIGIN` from `process.env` here would
 * work, but it would create a SECOND place that derives "the allowed origin"
 * (with its own dev fallback and production fail-fast rules — see
 * `config/env.ts`) and those two can silently drift apart. Keeping the
 * decorator permissive and enforcing the single injected value inside the
 * instance method keeps exactly one source of truth.
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly cookieName: string;
  /** The one allowed `Origin` for a credentialed socket — the SAME
   *  ConfigService value `main.ts` hands to `strictCors` for the REST API. */
  private readonly frontendOrigin: string;
  /** Tracks every currently-connected socket's raw session token, so it can
   *  be re-resolved on a timer — see `revalidateSessions`. */
  private readonly tokenByClientId = new Map<string, string>();
  /** Re-entrancy guard for `revalidateSessions` — same pattern as
   *  NotificationsSweepService's `sweeping`. */
  private revalidating = false;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cookieName = config.get('sessionCookieName', { infer: true });
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    setInterval(() => void this.revalidateSessions(), SESSION_REVALIDATE_INTERVAL_MS);
  }

  /**
   * Whether a handshake is allowed to proceed to session resolution at all.
   * Exact string compare against the configured frontend origin — the same
   * comparison the `cors` package does for the REST API, so the two layers
   * can't disagree about what counts as "our frontend".
   *
   * A handshake with NO `Origin` header is rejected too. Every browser sends
   * it on a WebSocket upgrade, so this only ever turns away non-browser
   * clients — which have no business holding a browser session cookie, and
   * for which omitting `Origin` would otherwise be a trivial way to skip the
   * check entirely.
   */
  private originAllowed(client: Socket): boolean {
    const origin = client.handshake.headers.origin;
    return typeof origin === 'string' && origin === this.frontendOrigin;
  }

  async handleConnection(client: Socket): Promise<void> {
    // Deliberately BEFORE the cookie read / `sessions.resolve` call: a
    // cross-origin connection attempt must never get as far as touching the
    // victim's session, and must not cost a DB round-trip either.
    if (!this.originAllowed(client)) {
      client.disconnect(true);
      return;
    }
    const token = readCookie(client.handshake.headers.cookie, this.cookieName);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session || !token) {
      client.disconnect(true);
      return;
    }
    client.data.userId = session.user.id;
    this.tokenByClientId.set(client.id, token);
    void client.join(session.user.id);
  }

  handleDisconnect(client: Socket): void {
    this.tokenByClientId.delete(client.id);
  }

  /** SHA-256 of a raw session token — the `tokenHash` column's value. Mirrors
   *  `SessionService`'s own private hash so the batched lookup below can build
   *  its `IN (…)` list without a per-socket call into that service. */
  private static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Re-resolves every connected socket's session and disconnects any that no
   * longer hold one (revoked, expired, or the user got suspended) — the only
   * thing that ever invalidated a session before this existed was the
   * one-time check at handshake.
   *
   * It never admits a connection: it only ever reads `tokenByClientId`, which
   * `handleConnection` populates AFTER the origin check above, and only ever
   * disconnects. So the origin allowlist needs no second enforcement point
   * here — nothing can enter the registry without having passed it.
   *
   * Three things this deliberately does NOT do any more:
   *
   * 1. Throw. There is no `process.on('unhandledRejection')` handler anywhere
   *    in this app and Node 20 kills the process on an unhandled rejection —
   *    so a single transient pool timeout in here used to take the whole API
   *    down. Everything is inside one try/catch; a failed pass just logs and
   *    the next tick retries.
   * 2. Stack. The bare 60s `setInterval` fires regardless of whether the
   *    previous pass finished, so a slow pass used to overlap itself without
   *    bound. Same boolean guard as NotificationsSweepService.sweep().
   * 3. Query per socket. It used to `await sessions.resolve(token)` once per
   *    CONNECTED SOCKET, strictly sequentially — a user with four tabs open
   *    resolved the identical token four times, and tens of thousands of
   *    sockets either overran the 60s interval or flooded the shared Prisma
   *    pool. Now: dedupe to distinct tokens, batch-resolve in chunks, then
   *    map each result back onto every clientId sharing that token.
   */
  private async revalidateSessions(): Promise<void> {
    if (this.revalidating) return;
    this.revalidating = true;
    try {
      // Distinct tokens → the clientIds sharing each one (multi-tab/device).
      const clientIdsByToken = new Map<string, string[]>();
      for (const [clientId, token] of this.tokenByClientId) {
        const existing = clientIdsByToken.get(token);
        if (existing) existing.push(clientId);
        else clientIdsByToken.set(token, [clientId]);
      }
      if (clientIdsByToken.size === 0) return;

      const tokenByHash = new Map<string, string>();
      for (const token of clientIdsByToken.keys()) {
        tokenByHash.set(NotificationsGateway.hashToken(token), token);
      }

      // Same validity rules as SessionService.resolve — not revoked, not
      // expired, user still active. A narrow `select` rather than that
      // method's `include: { user: { include: { platformRoles: true } } }`:
      // nothing here reads the roles, and pulling every role row for every
      // connected socket once a minute is exactly the kind of waste this
      // batching exists to remove.
      const now = Date.now();
      const liveTokens = new Set<string>();
      const hashes = [...tokenByHash.keys()];
      for (let i = 0; i < hashes.length; i += SESSION_REVALIDATE_CHUNK) {
        const chunk = hashes.slice(i, i + SESSION_REVALIDATE_CHUNK);
        const rows = await this.prisma.session.findMany({
          where: { tokenHash: { in: chunk } },
          select: {
            tokenHash: true,
            revokedAt: true,
            expiresAt: true,
            user: { select: { status: true } },
          },
        });
        for (const row of rows) {
          if (row.revokedAt) continue;
          if (row.expiresAt.getTime() < now) continue;
          if (row.user.status !== 'active') continue;
          const token = tokenByHash.get(row.tokenHash);
          if (token) liveTokens.add(token);
        }
      }

      // Anything whose token didn't come back as a live session goes — same
      // behaviour as before, just decided from one batched read instead of
      // one query per socket. A token missing from the result set entirely
      // (deleted row) is handled by the same branch.
      let dropped = 0;
      for (const [token, clientIds] of clientIdsByToken) {
        if (liveTokens.has(token)) continue;
        for (const clientId of clientIds) {
          this.tokenByClientId.delete(clientId);
          this.server?.sockets.sockets.get(clientId)?.disconnect(true);
          dropped++;
        }
      }
      if (dropped > 0) {
        this.logger.log(`Disconnected ${dropped} socket(s) whose session is no longer valid`);
      }
    } catch (err) {
      this.logger.error('Session revalidation pass failed', err instanceof Error ? err.stack : err);
    } finally {
      this.revalidating = false;
    }
  }

  pushToUser(userId: string, payload: unknown): void {
    this.server?.to(userId).emit('notification', payload);
  }

  broadcast(payload: unknown): void {
    this.server?.emit('notification', payload);
  }

  /** Cross-tab/cross-device state sync — a separate event from `notification`
   *  (a brand-new item) so the client never confuses "mark this read" with
   *  "here's something new". Every subscriber (including the tab that made
   *  the change) applies it idempotently, so the acting tab's own optimistic
   *  update and this echo never double-apply. */
  syncUser(userId: string, event: { kind: 'read' | 'read-all' | 'dismissed'; id?: string }): void {
    this.server?.to(userId).emit('notification:sync', event);
  }
}
