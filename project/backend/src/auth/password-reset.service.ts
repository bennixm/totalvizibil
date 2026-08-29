import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { AppConfig } from '../config/env';

const TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger('PasswordReset');
  private readonly isProd: boolean;
  private readonly frontendOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.isProd = config.get('nodeEnv', { infer: true }) === 'production';
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
  }

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Always resolves the same way regardless of whether the email exists, to
   * avoid account enumeration. In non-production the reset link is returned in
   * the response and logged (no email provider is wired yet — PRD §17).
   */
  async request(email: string): Promise<{ ok: true; devResetUrl?: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'active') {
      return { ok: true };
    }

    // Invalidate any outstanding tokens for this user.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: PasswordResetService.hash(token),
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    });

    const url = `${this.frontendOrigin}/reset-password?token=${token}`;
    if (this.isProd) {
      this.logger.log(`Password reset requested for ${user.id} (email dispatch not implemented)`);
      return { ok: true };
    }
    this.logger.warn(`DEV password reset link: ${url}`);
    return { ok: true, devResetUrl: url };
  }

  async reset(token: string, newPassword: string): Promise<{ ok: true }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: PasswordResetService.hash(token) },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash: await this.passwords.hash(newPassword),
          passwordChangedAt: new Date(),
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // A reset invalidates every existing session.
    await this.sessions.revokeAllForUser(record.userId);
    return { ok: true };
  }
}
