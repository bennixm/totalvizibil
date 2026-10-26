import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES_KEY, PlatformRolesGuard } from 'src/auth/platform-roles.guard';
import { AuthPrincipal } from 'src/auth/auth.types';

function fakeContext(user?: Partial<AuthPrincipal>) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as any;
}

function makeGuard(requiredRoles?: string[]) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as Reflector;
  return new PlatformRolesGuard(reflector);
}

describe('PlatformRolesGuard', () => {
  it('allows when no @PlatformRoles metadata', () => {
    const guard = makeGuard(undefined);
    expect(guard.canActivate(fakeContext())).toBe(true);
  });

  it('allows when roles array is empty', () => {
    const guard = makeGuard([]);
    expect(guard.canActivate(fakeContext())).toBe(true);
  });

  it('allows when user has required role', () => {
    const guard = makeGuard(['admin'] as any);
    const ctx = fakeContext({ platformRoles: ['admin'] as any });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when user lacks required role', () => {
    const guard = makeGuard(['admin'] as any);
    const ctx = fakeContext({ platformRoles: ['support'] as any });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when request.user is undefined', () => {
    const guard = makeGuard(['admin'] as any);
    expect(() => guard.canActivate(fakeContext(undefined))).toThrow(ForbiddenException);
  });
});
