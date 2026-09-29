import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { MailService } from '../mail/mail.service';
import { ctaButton, renderEmailLayout, textToHtml } from '../mail/templates/layout';
import { AppConfig } from '../config/env';

const TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger('PasswordReset');
  private readonly frontendOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
  }

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Always resolves the same way regardless of whether the email exists, to
   * avoid account enumeration. One real path, no environment branching: the
   * link only ever reaches the customer through a real email. Locally, with
   * no SMTP configured, MailService's own dev-log fallback prints the full
   * message (link included) to the console — that's a property of
   * MailService, not a special case here.
   */
  async request(email: string): Promise<{ ok: true }> {
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
    const text =
      `Am primit o cerere de resetare a parolei pentru contul tău.\n\n` +
      `Apasă pe linkul de mai jos pentru a-ți alege o parolă nouă (valabil o oră):\n${url}\n\n` +
      `Dacă nu ai cerut tu resetarea, poți ignora acest email — parola ta rămâne neschimbată.`;
    const html = renderEmailLayout({
      heading: 'Resetează-ți parola',
      preheader: 'Cererea ta de resetare a parolei — linkul e valabil o oră.',
      bodyHtml:
        textToHtml(
          'Am primit o cerere de resetare a parolei pentru contul tău. Apasă butonul de mai jos pentru a-ți alege o parolă nouă — linkul este valabil o oră.\n\nDacă nu ai cerut tu resetarea, poți ignora acest email — parola ta rămâne neschimbată.',
        ) + ctaButton('Resetează parola', url),
    });

    // The token is already committed by this point — a mail hiccup must
    // never turn an already-valid reset link into a hung request. Not tied
    // to `notify()`/the user's own panel: they're not logged in, so the only
    // channel that can reach them at all is a direct email to the address
    // they typed, same pattern as the old-address notice in
    // AccountService.updateProfile.
    void this.mail
      .send({ to: user.email, subject: 'Resetează-ți parola', text, html })
      .catch((err) =>
        this.logger.error('Password-reset email failed', err instanceof Error ? err.stack : err),
      );

    return { ok: true };
  }

  /**
   * Read-only pre-check so the reset-password PAGE never renders a live
   * form for a token that's already expired or used — it just checks the
   * same two conditions `reset()` enforces, without touching the row.
   * Never throws: an invalid/expired/used token is a normal outcome here,
   * not an error.
   */
  async isTokenValid(token: string): Promise<boolean> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: PasswordResetService.hash(token) },
    });
    return !!record && !record.usedAt && record.expiresAt.getTime() >= Date.now();
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
