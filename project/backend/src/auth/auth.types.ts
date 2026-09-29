import { PlatformRole } from '@prisma/client';

/** The authenticated principal attached to `request.user` by AuthGuard. */
export interface AuthPrincipal {
  id: string;
  email: string;
  name: string;
  platformRoles: PlatformRole[];
  sessionId: string;
  emailVerifiedAt: Date | null;
}

/** Shape returned to the client for the current user. */
export interface AuthUserView {
  id: string;
  email: string;
  name: string;
  platformRoles: PlatformRole[];
  emailVerifiedAt: string | null;
}

export function toAuthUserView(p: AuthPrincipal): AuthUserView {
  return {
    id: p.id,
    email: p.email,
    name: p.name,
    platformRoles: p.platformRoles,
    emailVerifiedAt: p.emailVerifiedAt ? p.emailVerifiedAt.toISOString() : null,
  };
}
