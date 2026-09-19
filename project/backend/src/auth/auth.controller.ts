import { Body, Controller, Get, HttpCode, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { SessionCookieService } from './session-cookie.service';
import { SessionService } from './session.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { AuthPrincipal, AuthUserView, toAuthUserView } from './auth.types';
import { NotificationsService } from '../notifications/notifications.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
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

  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthPrincipal): { user: AuthUserView } {
    return { user: toAuthUserView(user) };
  }

  private async notifyIfNewDevice(userId: string, userAgent: string | undefined): Promise<void> {
    const priorSessions = await this.sessions.listActiveForUser(userId);
    if (priorSessions.length === 0 || priorSessions.some((s) => s.userAgent === userAgent)) return;
    await this.notifications.notify({
      userId,
      type: 'new_session',
      title: 'Conectare nouă detectată',
      body: 'Contul tău a fost accesat de pe un dispozitiv nou. Dacă nu ai fost tu, schimbă-ți parola imediat.',
      channels: { email: true },
    });
  }
}
