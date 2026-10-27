import { ConfigService } from '@nestjs/config';
import { OnModuleInit } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SessionService } from '../auth/session.service';
import { AppConfig } from '../config/env';

/** How often a connected socket's session is re-checked against the DB. The
 *  session was previously only validated once, at handshake — a revoked
 *  session (password reset, an admin ban, a forced logout) left that socket
 *  receiving live pushes (including other users' PII in lead/appointment
 *  notification bodies) for as long as the tab stayed open. */
const SESSION_REVALIDATE_INTERVAL_MS = 60_000;

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
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly cookieName: string;
  /** Tracks every currently-connected socket's raw session token, so it can
   *  be re-resolved on a timer — see `revalidateSessions`. */
  private readonly tokenByClientId = new Map<string, string>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessions: SessionService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cookieName = config.get('sessionCookieName', { infer: true });
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    setInterval(() => void this.revalidateSessions(), SESSION_REVALIDATE_INTERVAL_MS);
  }

  async handleConnection(client: Socket): Promise<void> {
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

  /** Re-resolves every connected socket's session and disconnects any that
   *  no longer hold one (revoked, expired, or the user got suspended) — the
   *  only thing that ever invalidated a session before this existed was the
   *  one-time check at handshake. */
  private async revalidateSessions(): Promise<void> {
    for (const [clientId, token] of this.tokenByClientId) {
      const session = await this.sessions.resolve(token);
      if (session) continue;
      this.tokenByClientId.delete(clientId);
      this.server?.sockets.sockets.get(clientId)?.disconnect(true);
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
