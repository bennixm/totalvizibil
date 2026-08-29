import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '@prisma/client';
import { AuthPrincipal } from './auth.types';

export const PLATFORM_ROLES_KEY = 'platform_roles';

/** Restrict a route to platform staff. Use together with AuthGuard. */
export const PlatformRoles = (...roles: PlatformRole[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);

@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthPrincipal | undefined;
    if (!user || !user.platformRoles.some((r) => required.includes(r))) {
      throw new ForbiddenException('Platform staff access required');
    }
    return true;
  }
}
