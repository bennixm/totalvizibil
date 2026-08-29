import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthPrincipal } from './auth.types';

/** Injects `request.user` (set by AuthGuard) into a controller handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthPrincipal;
  },
);
