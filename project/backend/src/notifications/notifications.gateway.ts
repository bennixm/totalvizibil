import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SessionService } from '../auth/session.service';
import { AppConfig } from '../config/env';

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
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly cookieName: string;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessions: SessionService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cookieName = config.get('sessionCookieName', { infer: true });
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = readCookie(client.handshake.headers.cookie, this.cookieName);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) {
      client.disconnect(true);
      return;
    }
    client.data.userId = session.user.id;
    void client.join(session.user.id);
  }

  handleDisconnect(): void {
    // Nothing to clean up — room membership is dropped automatically.
  }

  pushToUser(userId: string, payload: unknown): void {
    this.server?.to(userId).emit('notification', payload);
  }

  broadcast(payload: unknown): void {
    this.server?.emit('notification', payload);
  }
}
