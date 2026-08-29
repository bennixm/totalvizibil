import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { SessionService } from './session.service';
import { AppConfig } from '../config/env';
import { AuthPrincipal } from './auth.types';

/**
 * Reads the session cookie, resolves it, and attaches `request.user`.
 * Applied per-route (not global) so public discovery endpoints stay open.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cookieName: string;

  constructor(
    private readonly sessions: SessionService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cookieName = config.get('sessionCookieName', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.[this.cookieName] as string | undefined;
    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }

    const session = await this.sessions.resolve(token);
    if (!session) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    const principal: AuthPrincipal = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      platformRoles: session.user.platformRoles.map((r) => r.role),
      sessionId: session.id,
    };
    (request as Request & { user: AuthPrincipal }).user = principal;
    return true;
  }
}
