import { randomInt, createHash } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { renderEmailLayout, textToHtml } from '../mail/templates/layout';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough to check an inbox, short enough to matter
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 45 * 1000;

/**
 * Email-verification codes for the account-creation step of the business
 * setup wizard, and (the SAME mechanism) for a login attempt on an account
 * that never finished verifying. One shared service so the two entry points
 * can never drift out of sync on what counts as a valid/expired/used code.
 *
 * Deliberately its own model/service rather than reusing PasswordResetToken:
 * a link token is pasted (32 random bytes, never guessed), while a code here
 * is manually TYPED (6 digits — a much smaller space), so it needs its own
 * per-code wrong-guess lockout that a reset link has no reason to carry.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger('EmailVerification');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private static hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private static generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /**
   * Creates and emails a fresh code, invalidating any still-outstanding one
   * for this user. Throws `resend_cooldown` if called again too soon after
   * the last send (returns the remaining seconds so the UI can show a
   * countdown) — the ONE case here that intentionally surfaces failure
   * synchronously, since without this code the user is fully stuck.
   */
  async sendCode(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return; // nothing to verify

    const last = await this.prisma.emailVerificationCode.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (last) {
      const elapsed = Date.now() - last.createdAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        throw new BadRequestException({
          message: 'resend_cooldown',
          retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000),
        });
      }
    }

    const code = EmailVerificationService.generateCode();
    await this.prisma.$transaction([
      this.prisma.emailVerificationCode.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailVerificationCode.create({
        data: {
          userId,
          codeHash: EmailVerificationService.hash(code),
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      }),
    ]);

    const text =
      `Codul tău de verificare este ${code}.\n\n` +
      `Introdu-l pentru a-ți confirma adresa de email — este valabil 10 minute.\n\n` +
      `Dacă nu ai cerut acest cod, poți ignora acest email.`;
    const html = renderEmailLayout({
      heading: 'Confirmă-ți adresa de email',
      preheader: `Codul tău de verificare: ${code}`,
      bodyHtml: textToHtml(
        `Bună, ${user.name},\n\nCodul tău de verificare este:\n\n${code}\n\nIntrodu-l pentru a-ți confirma adresa de email — este valabil 10 minute. Dacă nu ai cerut acest cod, poți ignora acest email.`,
      ),
    });

    const result = await this.mail
      .send({ to: user.email, subject: 'Codul tău de verificare', text, html })
      .catch((err) => {
        this.logger.error('Verification-code email failed', err instanceof Error ? err.stack : err);
        return { dispatched: false };
      });

    // `dispatched: false` in dev (no SMTP configured) is the expected
    // dev-log fallback, not a real failure — only a genuinely CONFIGURED
    // transport failing to deliver is worth surfacing to the caller.
    if (this.mail.configured && !result.dispatched) {
      throw new BadRequestException('email_send_failed');
    }
  }

  /** Enumeration-safe wrapper for the public resend endpoint — always the
   *  same outcome whether the email exists, already verified, or not. */
  async resendFor(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) return;
    await this.sendCode(user.id);
  }

  /**
   * Verifies a code for the given email — used identically from the setup
   * wizard (where the user already has a session from `register()`) and
   * from the login flow (where they don't yet, since login was rejected
   * before a session was ever started). Never itself starts a session: it
   * only flips `emailVerifiedAt`, so a guessed code alone can never grant
   * access without the password the login/register step already checked.
   */
  async verify(email: string, code: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('code_invalid');
    if (user.emailVerifiedAt) return { ok: true }; // already done — idempotent

    const record = await this.prisma.emailVerificationCode.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new BadRequestException('code_invalid');
    if (record.usedAt) throw new BadRequestException('code_already_used');
    if (record.expiresAt.getTime() < Date.now()) throw new BadRequestException('code_expired');
    if (record.attempts >= MAX_ATTEMPTS) throw new BadRequestException('too_many_attempts');

    if (EmailVerificationService.hash(code) !== record.codeHash) {
      await this.prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('code_invalid');
    }

    await this.prisma.$transaction([
      this.prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }
}
