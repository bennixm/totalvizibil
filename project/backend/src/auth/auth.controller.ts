import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { EmailVerificationService } from './email-verification.service';
import { SessionCookieService } from './session-cookie.service';
import { SessionService } from './session.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { ResendVerificationDto, VerifyEmailDto } from './dto/email-verification.dto';
import { AuthPrincipal, AuthUserView, toAuthUserView } from './auth.types';
import { NotificationsService } from '../notifications/notifications.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly emailVerification: EmailVerificationService,
    private readonly cookie: SessionCookieService,
    private readonly sessions: SessionService,
    private readonly notifications: NotificationsService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUserView }> {
    const user = await this.auth.register(dto);
    await this.cookie.start(req, res, user.id);
    // Best-effort: a mail hiccup here must never fail the signup the user is
    // actively watching complete — the "Resend code" button on the
    // verification screen is the real recovery path for that case, so a
    // logged failure here (not surfaced) is the correct amount of handling.
    this.emailVerification
      .sendCode(user.id)
      .catch((err) =>
        this.logger.error(
          'Initial verification-code send failed',
          err instanceof Error ? err.stack : err,
        ),
      );
    return { user };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUserView }> {
    const user = await this.auth.validateCredentials(dto);

    // "New device" notification — only meaningful once there's at least one
    // other known device to compare against; a user's very first login ever
    // has nothing to be "new" relative to. Entirely best-effort: a hiccup
    // here (the session lookup, the notify call) must never block a login
    // whose credentials already checked out.
    this.notifyIfNewDevice(user.id, req.get('user-agent') ?? undefined).catch((err) =>
      this.logger.error('New-device check failed', err instanceof Error ? err.stack : err),
    );

    await this.cookie.start(req, res, user.id);
    return { user };
  }

  @HttpCode(200)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.cookie.clear(req, res);
    return { ok: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('password/forgot')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordReset.request(dto.email);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('password/reset')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordReset.reset(dto.token, dto.password);
  }

  /** Lets the reset-password PAGE check the link before showing the form —
   *  never renders a live password field for an already-expired/used token. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('password/reset/validate')
  async validateResetToken(@Query('token') token?: string): Promise<{ valid: boolean }> {
    const valid = !!token && (await this.passwordReset.isTokenValid(token));
    return { valid };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('email/resend')
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<{ ok: true }> {
    await this.emailVerification.resendFor(dto.email);
    return { ok: true };
  }

  /** Same code mechanism from both entry points: the setup wizard (already
   *  has a session from `register()`) and the login flow (rejected before a
   *  session was ever started, so this never itself grants one — it only
   *  flips `emailVerifiedAt`, and the caller re-submits the login/continues
   *  the wizard once verified). */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('email/verify')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.emailVerification.verify(dto.email, dto.code);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthPrincipal): { user: AuthUserView } {
    return { user: toAuthUserView(user) };
  }

  private async notifyIfNewDevice(userId: string, userAgent: string | undefined): Promise<void> {
    const priorSessions = await this.sessions.listActiveForUser(userId);
    if (priorSessions.length === 0 || priorSessions.some((s) => s.userAgent === userAgent)) return;
    const device = describeUserAgent(userAgent);
    const when = new Date().toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' });
    await this.notifications.notify({
      userId,
      type: 'new_session',
      title: 'Conectare nouă detectată',
      body: `Contul tău a fost accesat de pe un dispozitiv nou (${device}) pe ${when}. Dacă nu ai fost tu, schimbă-ți parola imediat.`,
      channels: { email: true },
    });
  }
}

/**
 * A rough, dependency-free "what device was this" hint for the new-session
 * security email — enough for the recipient to judge "yes that's my phone"
 * vs "I don't recognize this" without pulling in a full UA-parsing library
 * for one string. Deliberately coarse: exact browser/OS versions aren't the
 * point, recognizability is.
 */
function describeUserAgent(ua: string | undefined): string {
  if (!ua) return 'dispozitiv necunoscut';
  const os = /windows/i.test(ua)
    ? 'Windows'
    : /iphone|ipad/i.test(ua)
      ? 'iOS'
      : /android/i.test(ua)
        ? 'Android'
        : /mac os/i.test(ua)
          ? 'macOS'
          : /linux/i.test(ua)
            ? 'Linux'
            : null;
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /chrome\//i.test(ua)
      ? 'Chrome'
      : /firefox\//i.test(ua)
        ? 'Firefox'
        : /safari\//i.test(ua)
          ? 'Safari'
          : null;
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(' pe ') : 'dispozitiv necunoscut';
}
