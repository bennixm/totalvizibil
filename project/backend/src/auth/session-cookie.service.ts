import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { SessionService } from './session.service';
import { AppConfig } from '../config/env';

/**
 * Issues / clears the session cookie. Shared by the auth controller (login,
 * register) and the website-draft claim flow, so the cookie contract lives in
 * one place.
 */
@Injectable()
export class SessionCookieService {
  private readonly cookieName: string;
  private readonly cookieSecure: boolean;

  constructor(
    private readonly sessions: SessionService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cookieName = config.get('sessionCookieName', { infer: true });
    this.cookieSecure = config.get('sessionCookieSecure', { infer: true });
  }

  private options(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cookieSecure,
      path: '/',
      maxAge: this.sessions.maxAgeMs,
    };
  }

  async start(req: Request, res: Response, userId: string): Promise<void> {
    const { token } = await this.sessions.issue(userId, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    res.cookie(this.cookieName, token, this.options());
  }

  async clear(req: Request, res: Response): Promise<void> {
    const token = req.cookies?.[this.cookieName] as string | undefined;
    if (token) await this.sessions.revoke(token);
    res.clearCookie(this.cookieName, { ...this.options(), maxAge: undefined });
  }
}
