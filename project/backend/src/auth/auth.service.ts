import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TotpService } from './totp.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthUserView } from './auth.types';

/** Sentinel messages the frontend keys off to show the 2FA code field. */
export const TOTP_REQUIRED = 'totp_required';
export const TOTP_INVALID = 'totp_invalid';
/** Sentinel the frontend keys off to show the email-verification-code step
 *  instead of a generic login failure — same mechanism as the setup-wizard's
 *  own verification screen (see EmailVerificationService). */
export const EMAIL_NOT_VERIFIED = 'email_not_verified';

/** How long a `tvz_pending_reg` token stays usable. */
export const PENDING_REG_TTL_MS = 30 * 60 * 1000;

/** What `register()` hands the controller: the view, the raw pending-registration
 *  token to put in the cookie, and whether a row was actually written. */
export interface RegisterResult {
  user: AuthUserView;
  pendingRegToken: string;
  didMutate: boolean;
}

@Injectable()
export class AuthService {
  /**
   * Compare target for the "no such email" login path. Built lazily on the
   * first login attempt (not at boot, so app startup stays unaffected) with
   * the SAME cost parameters PasswordService uses for real users — a
   * hardcoded string would freeze whatever parameters were current when it
   * was written, and since `argon2.verify` reads cost from the hash itself,
   * any drift turns the miss path into measurably more (or less) work than a
   * real check and re-opens the timing-based user-enumeration oracle.
   *
   * The promise (not the resolved value) is cached, so concurrent first
   * logins share one computation; a rejected computation is dropped so the
   * next attempt retries instead of permanently failing.
   */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
  ) {}

  private dummyCompareTarget(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = this.passwords.hash('timing-oracle-filler').catch((err) => {
        this.dummyHash = undefined;
        throw err;
      });
    }
    return this.dummyHash;
  }

  private static hashPendingRegToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Mirrors SessionService's opaque-token recipe: 32 random bytes, base64url. */
  private static newPendingRegToken(): string {
    return randomBytes(32).toString('base64url');
  }

  async register(dto: RegisterDto, submittedPendingToken?: string): Promise<RegisterResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { platformRoles: true },
    });
    if (existing) {
      if (existing.emailVerifiedAt) {
        throw new ConflictException('An account with this email already exists');
      }
      // Still-unverified account re-attempting signup with the same email — e.g.
      // the setup wizard's "change email" step sends them back here and they
      // resubmit unchanged. Updating in place (instead of bouncing them with a
      // conflict) is the supported flow, but ONLY for the browser that created
      // the pending signup: it must present the unexpired token we issued it.
      // Otherwise anyone who knows a pending email could overwrite its
      // password and take the account over the moment the real owner verifies.
      if (!this.pendingTokenMatches(existing, submittedPendingToken)) {
        // Can't tell an attacker from the real user on a second device, so do
        // the safe thing: touch nothing, send no mail (the controller keys off
        // `didMutate`), and return the row exactly as it stands. The token is
        // generated but never stored, purely so the response shape — and the
        // cookie it sets — is identical to the legitimate branch.
        return {
          user: this.toView(existing),
          pendingRegToken: AuthService.newPendingRegToken(),
          didMutate: false,
        };
      }

      const pendingRegToken = AuthService.newPendingRegToken();
      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name: dto.name,
          passwordHash: await this.passwords.hash(dto.password),
          passwordChangedAt: new Date(),
          // Rotate on every accepted resubmit: only the most recently issued
          // token works, so a leaked earlier one can't be replayed.
          pendingRegTokenHash: AuthService.hashPendingRegToken(pendingRegToken),
          pendingRegExpiresAt: new Date(Date.now() + PENDING_REG_TTL_MS),
        },
        include: { platformRoles: true },
      });
      return { user: this.toView(updated), pendingRegToken, didMutate: true };
    }

    const pendingRegToken = AuthService.newPendingRegToken();
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash: await this.passwords.hash(dto.password),
        passwordChangedAt: new Date(),
        pendingRegTokenHash: AuthService.hashPendingRegToken(pendingRegToken),
        pendingRegExpiresAt: new Date(Date.now() + PENDING_REG_TTL_MS),
      },
      include: { platformRoles: true },
    });

    return { user: this.toView(user), pendingRegToken, didMutate: true };
  }

  private pendingTokenMatches(
    existing: { pendingRegTokenHash?: string | null; pendingRegExpiresAt?: Date | null },
    submitted: string | undefined,
  ): boolean {
    if (!submitted || !existing.pendingRegTokenHash || !existing.pendingRegExpiresAt) return false;
    if (existing.pendingRegExpiresAt.getTime() <= Date.now()) return false;
    return AuthService.hashPendingRegToken(submitted) === existing.pendingRegTokenHash;
  }

  async validateCredentials(dto: LoginDto): Promise<AuthUserView> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { platformRoles: true },
    });

    // Constant-ish work whether or not the user exists, to blunt enumeration.
    const compareTarget = user?.passwordHash ?? (await this.dummyCompareTarget());
    const ok = await this.passwords.verify(compareTarget, dto.password);
    if (!user || !ok) {
      throw new UnauthorizedException('Invalid email or password');
    }
    // The password checked out — it's safe to tell the real owner their account
    // is suspended rather than pretending the credentials are wrong.
    if (user.status !== 'active') {
      throw new UnauthorizedException('account_suspended');
    }
    // Same reasoning: the password already proved this is the real owner, so
    // it's safe (and helpful) to route them to the verification step instead
    // of a generic failure. Pre-existing accounts are backfilled with a
    // non-null emailVerifiedAt by the migration that added this column, so
    // this only ever gates genuinely new, never-verified signups.
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(EMAIL_NOT_VERIFIED);
    }

    if (user.totpEnabledAt && user.totpSecret) {
      if (!dto.totpCode) throw new UnauthorizedException(TOTP_REQUIRED);
      if (!this.totp.verify(dto.totpCode, user.totpSecret)) {
        throw new UnauthorizedException(TOTP_INVALID);
      }
    }

    // Upgrade a legacy (heavier-parameter) hash while we hold the plaintext, so
    // this user's next logins are fast.
    const rehash = this.passwords.needsRehash(user.passwordHash)
      ? await this.passwords.hash(dto.password)
      : undefined;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), ...(rehash ? { passwordHash: rehash } : {}) },
    });

    return this.toView(user);
  }

  private toView(user: {
    id: string;
    email: string;
    name: string;
    platformRoles: { role: AuthUserView['platformRoles'][number] }[];
    emailVerifiedAt?: Date | null;
  }): AuthUserView {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      platformRoles: user.platformRoles.map((r) => r.role),
      emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    };
  }
}
