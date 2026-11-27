import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { MailService } from '../mail/mail.service';
import { passwordResetEmail } from '../mail/templates/emails';
import { NotificationsService } from '../notifications/notifications.service';
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
    private readonly notifications: NotificationsService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
  }

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * A first "set your password" link for an account created FOR someone
   * (an influencer added by an admin). Same single-use token mechanism as a
   * reset, but no email is sent here: the caller sends its own welcome email
   * with this link, and the page it opens says "set", not "reset".
   */
  async issueSetPasswordLink(userId: string, ttlMs: number): Promise<string> {
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: PasswordResetService.hash(token),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return `${this.frontendOrigin}/set-password?token=${token}`;
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
    const { subject, text, html } = passwordResetEmail({ url });

    // The token is already committed by this point — a mail hiccup must
    // never turn an already-valid reset link into a hung request. Not tied
    // to `notify()`/the user's own panel: they're not logged in, so the only
    // channel that can reach them at all is a direct email to the address
    // they typed, same pattern as the old-address notice in
    // AccountService.updateProfile.
    void this.mail
      .send({ to: user.email, subject, text, html })
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

    // This is the one password-change path in the app that used to notify
    // NOTHING — self-service `changePassword` and an admin's `setPassword`
    // both correctly fire `password_changed`; this "forgot password" email
    // link was the silent exception, and it's the exact path an account
    // takeover uses. Already committed by this point — a notification
    // hiccup must never make a successful reset look like it failed. Email
    // only: the user has no session right after this (every one was just
    // revoked), so the panel can't reach them anyway.
    void this.notifications
      .notify({
        userId: record.userId,
        type: 'password_changed',
        title: 'Parola contului tău a fost schimbată',
        body: 'Parola contului tău a fost schimbată.',
        channels: { email: true },
        email: {
          greet: true,
          text: 'Parola contului tău Totalvizibil a fost resetată prin linkul „Am uitat parola”, iar toate sesiunile deschise au fost închise.\n\nDacă tu ai făcut resetarea, nu trebuie să faci nimic.',
          details: [
            {
              label: 'Data și ora',
              value: new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' }),
            },
          ],
          notice: {
            title: 'Nu ai fost tu?',
            text: 'Contactează imediat echipa de suport. Este posibil ca altcineva să aibă acces la contul tău.',
            tone: 'danger',
          },
          cta: { label: 'Contactează suportul', url: `${this.frontendOrigin}/support` },
        },
      })
      .catch((err) =>
        this.logger.error(
          'Password-reset-completed notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

    return { ok: true };
  }
}
