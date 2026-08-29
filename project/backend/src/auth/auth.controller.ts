import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Request, Response, CookieOptions } from 'express';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthPrincipal, AuthUserView, toAuthUserView } from './auth.types';
import { AppConfig } from '../config/env';

@Controller('auth')
export class AuthController {
  private readonly cookieName: string;
  private readonly cookieSecure: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cookieName = config.get('sessionCookieName', { infer: true });
    this.cookieSecure = config.get('sessionCookieSecure', { infer: true });
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cookieSecure,
      path: '/',
      maxAge: this.sessions.maxAgeMs,
    };
  }

  private async startSession(req: Request, res: Response, userId: string): Promise<void> {
    const { token } = await this.sessions.issue(userId, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    res.cookie(this.cookieName, token, this.cookieOptions());
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUserView }> {
    const user = await this.auth.register(dto);
    await this.startSession(req, res, user.id);
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
    await this.startSession(req, res, user.id);
    return { user };
  }

  @HttpCode(200)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const token = req.cookies?.[this.cookieName] as string | undefined;
    if (token) await this.sessions.revoke(token);
    res.clearCookie(this.cookieName, { ...this.cookieOptions(), maxAge: undefined });
    return { ok: true };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthPrincipal): { user: AuthUserView } {
    return { user: toAuthUserView(user) };
  }
}
