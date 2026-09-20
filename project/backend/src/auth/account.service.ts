import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';
import { AuthPrincipal, AuthUserView } from './auth.types';
import { ChangePasswordDto, UpdateProfileDto } from './dto/account.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  private async requireUser(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { platformRoles: true },
    });
  }

  private view(u: {
    id: string;
    email: string;
    name: string;
    platformRoles: { role: AuthUserView['platformRoles'][number] }[];
  }): AuthUserView {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      platformRoles: u.platformRoles.map((r) => r.role),
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
      include: { platformRoles: true },
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
      void this.mail
        .send({
          to: oldEmail,
          subject: 'Adresa de email a contului a fost schimbată',
          text: `Adresa de email a contului tău a fost schimbată din ${oldEmail} în ${newEmail}.\n\nDacă nu ai fost tu, contactează-ne imediat.`,
        })
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
          title: 'Adresa de email a contului a fost schimbată',
          body: `Adresa de email a contului a fost schimbată în ${newEmail}. Dacă nu ai fost tu, contactează-ne imediat.`,
          channels: { email: true },
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
        title: 'Parola contului a fost schimbată',
        body: 'Parola contului tău a fost schimbată recent. Dacă nu ai fost tu, contactează-ne imediat.',
        channels: { email: true },
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

  async totpEnable(userId: string, code: string): Promise<{ ok: true }> {
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
    void this.notifications
      .notify({
        userId,
        type: 'totp_enabled',
        title: 'Autentificarea în doi pași a fost activată',
        body: 'Autentificarea în doi pași a fost activată pe contul tău.',
        channels: { email: true },
      })
      .catch((err) =>
        this.logger.error(
          '2FA-enabled notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
    return { ok: true };
  }

  async totpDisable(userId: string, code: string): Promise<{ ok: true }> {
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
    void this.notifications
      .notify({
        userId,
        type: 'totp_disabled',
        title: 'Autentificarea în doi pași a fost dezactivată',
        body: 'Autentificarea în doi pași a fost dezactivată pe contul tău. Dacă nu ai fost tu, schimbă-ți parola imediat.',
        channels: { email: true },
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
