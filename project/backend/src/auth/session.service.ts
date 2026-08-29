import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/env';

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/**
 * Opaque DB-backed sessions. The raw token is only ever in the httpOnly cookie;
 * we persist its SHA-256 so a DB leak does not hand out live sessions.
 */
@Injectable()
export class SessionService {
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.ttlMs = config.get('sessionTtlDays', { infer: true }) * 24 * 60 * 60 * 1000;
  }

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(userId: string, meta: { userAgent?: string; ip?: string }): Promise<IssuedSession> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: SessionService.hash(token),
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 400),
        ip: meta.ip,
      },
    });
    return { token, expiresAt };
  }

  /** Returns the live session + user, or null if missing / expired / revoked. */
  async resolve(token: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: SessionService.hash(token) },
      include: { user: { include: { platformRoles: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      return null;
    }
    if (session.user.status !== 'active') {
      return null;
    }
    return session;
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: SessionService.hash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Active (not revoked, not expired) sessions for a user, newest first. */
  listActiveForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userAgent: true, ip: true, createdAt: true },
    });
  }

  /** Revoke every active session for a user, optionally keeping one by id. */
  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  async revokeById(userId: string, sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  get maxAgeMs(): number {
    return this.ttlMs;
  }
}
