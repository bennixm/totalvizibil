import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';
import { AuthPrincipal, AuthUserView } from './auth.types';
import { ChangePasswordDto, UpdateProfileDto } from './dto/account.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { emailChangedOldAddressEmail } from '../mail/templates/emails';
import { AppConfig } from '../config/env';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  private readonly frontendOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
  }

  private async requireUser(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { platformRoles: true, influencer: { select: { id: true } } },
    });
  }

  private view(u: {
    id: string;
    email: string;
    name: string;
    platformRoles: { role: AuthUserView['platformRoles'][number] }[];
    emailVerifiedAt?: Date | null;
    influencer?: { id: string } | null;
  }): AuthUserView {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      platformRoles: u.platformRoles.map((r) => r.role),
      emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
      isInfluencer: !!u.influencer,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<AuthUserView> {
    const user = await this.requireUser(userId);
    const data: { name?: string; email?: string } = {};

    if (dto.name && dto.name !== user.name) data.name = dto.name;

    if (dto.email && dto.email !== user.email) {
      if (!(await this.passwords.verify(user.passwordHash, dto.currentPassword ?? ''))) {
        throw new ForbiddenException('Current password is incorrect');
      }
      const taken = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (taken) throw new ConflictException('That email is already in use');
      data.email = dto.email;
    }

    if (Object.keys(data).length === 0) return this.view(user);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      include: { platformRoles: true, influencer: { select: { id: true } } },
    });

    // Already committed — a notification hiccup must never mask this.
    // Standard security practice: both addresses get told, so if an
    // attacker changes the email, the rightful owner's OLD inbox still
    // hears about it. `notify()` always mails the account's CURRENT
    // (already-updated) address, so the old one gets a direct, one-off
    // send instead — it's no longer tied to this account.
    if (data.email) {
      const oldEmail = user.email;
      const newEmail = data.email;
      const supportCta = { label: 'Contactează suportul', url: `${this.frontendOrigin}/support` };
      const oldAddressEmail = emailChangedOldAddressEmail({
        name: user.name,
        oldEmail,
        newEmail,
        byAdmin: false,
        supportUrl: supportCta.url,
      });
      void this.mail
        .send({ to: oldEmail, ...oldAddressEmail })
        .catch((err) =>
          this.logger.error(
            'Email-changed (old address) notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );
      void this.notifications
        .notify({
          userId,
          type: 'email_changed',
          title: 'Adresa ta de email a fost actualizată',
          body: `Contul tău folosește de acum adresa ${newEmail}.`,
          channels: { email: true },
          email: {
            greet: true,
            text: `Contul tău Totalvizibil folosește de acum adresa ${newEmail}. Aici vei primi facturile, cererile de la clienți și alertele de securitate.`,
            notice: {
              title: 'Nu ai făcut tu această schimbare?',
              text: 'Contactează imediat echipa de suport.',
              tone: 'danger',
            },
            cta: supportCta,
          },
        })
        .catch((err) =>
          this.logger.error(
            'Email-changed notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );
    }
    return this.view(updated);
  }

  async changePassword(principal: AuthPrincipal, dto: ChangePasswordDto): Promise<{ ok: true }> {
    const user = await this.requireUser(principal.id);
    if (!(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw new ForbiddenException('Current password is incorrect');
    }
    if (await this.passwords.verify(user.passwordHash, dto.newPassword)) {
      throw new BadRequestException('The new password must be different');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.passwords.hash(dto.newPassword),
        passwordChangedAt: new Date(),
      },
    });
    // Keep the current session, drop the rest.
    await this.sessions.revokeAllForUser(user.id, principal.sessionId);
    // The password is already changed by this point — a notification hiccup
    // must never make a successful password change look like it failed.
    void this.notifications
      .notify({
        userId: user.id,
        type: 'password_changed',
        title: 'Parola contului tău a fost schimbată',
        body: 'Parola contului tău a fost schimbată.',
        channels: { email: true },
        email: {
          greet: true,
          text: 'Parola contului tău Totalvizibil a fost schimbată, iar sesiunile deschise pe alte dispozitive au fost închise.\n\nDacă tu ai făcut schimbarea, nu trebuie să faci nimic.',
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
          'Password-change notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
    return { ok: true };
  }

  async security(userId: string) {
    const user = await this.requireUser(userId);
    return {
      twoFactor: {
        enabled: !!user.totpEnabledAt,
        pendingSetup: !!user.totpSecret && !user.totpEnabledAt,
      },
      passwordChangedAt: user.passwordChangedAt,
      email: user.email,
      name: user.name,
    };
  }

  async totpSetup(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.requireUser(userId);
    if (user.totpEnabledAt) throw new ConflictException('Two-factor is already enabled');
    const secret = this.totp.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret } });
    return { secret, otpauthUrl: this.totp.otpauthUrl(secret, user.email) };
  }

  async totpEnable(userId: string, code: string, currentSessionId?: string): Promise<{ ok: true }> {
    const user = await this.requireUser(userId);
    if (user.totpEnabledAt) throw new ConflictException('Two-factor is already enabled');
    if (!user.totpSecret) throw new BadRequestException('Start the setup first');
    if (!this.totp.verify(code, user.totpSecret)) {
      throw new BadRequestException('That code is not valid');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date() },
    });
    // Same reasoning as changePassword: turning 2FA on is exactly what a user
    // does to lock out an intruder, and a session cookie stolen beforehand
    // would otherwise sail straight through it (sessions are checked, not
    // re-authenticated). Keep the current session, drop the rest.
    await this.sessions.revokeAllForUser(user.id, currentSessionId);
    void this.notifications
      .notify({
        userId,
        type: 'totp_enabled',
        title: 'Autentificarea în doi pași a fost activată',
        body: 'Contul tău este acum protejat prin autentificare în doi pași.',
        channels: { email: true },
        email: {
          greet: true,
          text: 'Contul tău Totalvizibil este acum protejat prin autentificarea în doi pași. La fiecare conectare îți vom cere, pe lângă parolă, un cod din aplicația de autentificare.',
          notice: {
            title: 'Păstrează codurile de rezervă',
            text: 'Dacă pierzi telefonul, codurile de rezervă sunt singura cale de a intra în cont. Păstrează-le într-un loc sigur.',
            tone: 'brand',
          },
        },
      })
      .catch((err) =>
        this.logger.error(
          '2FA-enabled notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
    return { ok: true };
  }

  async totpDisable(
    userId: string,
    code: string,
    currentSessionId?: string,
  ): Promise<{ ok: true }> {
    const user = await this.requireUser(userId);
    if (!user.totpEnabledAt || !user.totpSecret) {
      throw new BadRequestException('Two-factor is not enabled');
    }
    if (!this.totp.verify(code, user.totpSecret)) {
      throw new BadRequestException('That code is not valid');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null },
    });
    // A 2FA change in either direction is a security-posture change: close
    // every other session so the device that made the change is the only one
    // left standing.
    await this.sessions.revokeAllForUser(user.id, currentSessionId);
    void this.notifications
      .notify({
        userId,
        type: 'totp_disabled',
        title: 'Autentificarea în doi pași a fost dezactivată',
        body: 'Contul tău nu mai este protejat prin autentificare în doi pași.',
        channels: { email: true },
        email: {
          greet: true,
          text: 'Autentificarea în doi pași a fost dezactivată pentru contul tău Totalvizibil. De acum, la conectare îți cerem doar parola.',
          notice: {
            title: 'Nu ai făcut tu această schimbare?',
            text: 'Schimbă-ți imediat parola și reactivează autentificarea în doi pași.',
            tone: 'danger',
          },
          cta: {
            label: 'Reactivează autentificarea în doi pași',
            url: `${this.frontendOrigin}/account?tab=security`,
          },
        },
      })
      .catch((err) =>
        this.logger.error(
          '2FA-disabled notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
    return { ok: true };
  }

  async listSessions(principal: AuthPrincipal) {
    const rows = await this.sessions.listActiveForUser(principal.id);
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      current: s.id === principal.sessionId,
    }));
  }

  async revokeOtherSessions(principal: AuthPrincipal): Promise<{ revoked: number }> {
    const revoked = await this.sessions.revokeAllForUser(principal.id, principal.sessionId);
    return { revoked };
  }
}
