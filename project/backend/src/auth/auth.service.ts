import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TotpService } from './totp.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthUserView } from './auth.types';

/** Sentinel messages the frontend keys off to show the 2FA code field. */
export const TOTP_REQUIRED = 'totp_required';
export const TOTP_INVALID = 'totp_invalid';

const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$0000000000000000$00000000000000000000000000000000';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthUserView> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash: await this.passwords.hash(dto.password),
        passwordChangedAt: new Date(),
      },
      include: { platformRoles: true },
    });

    return this.toView(user);
  }

  async validateCredentials(dto: LoginDto): Promise<AuthUserView> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { platformRoles: true },
    });

    // Constant-ish work whether or not the user exists, to blunt enumeration.
    const ok = await this.passwords.verify(user?.passwordHash ?? DUMMY_HASH, dto.password);
    if (!user || !ok) {
      throw new UnauthorizedException('Invalid email or password');
    }
    // The password checked out — it's safe to tell the real owner their account
    // is suspended rather than pretending the credentials are wrong.
    if (user.status !== 'active') {
      throw new UnauthorizedException('account_suspended');
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
  }): AuthUserView {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      platformRoles: user.platformRoles.map((r) => r.role),
    };
  }
}
