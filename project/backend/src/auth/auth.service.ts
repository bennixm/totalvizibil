import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthUserView } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
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
      },
      include: { platformRoles: true },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      platformRoles: user.platformRoles.map((r) => r.role),
    };
  }

  async validateCredentials(dto: LoginDto): Promise<AuthUserView> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { platformRoles: true },
    });

    // Constant-ish work whether or not the user exists, to blunt enumeration.
    const hash =
      user?.passwordHash ??
      '$argon2id$v=19$m=65536,t=3,p=4$0000000000000000$00000000000000000000000000000000';
    const ok = await this.passwords.verify(hash, dto.password);

    if (!user || !ok || user.status !== 'active') {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      platformRoles: user.platformRoles.map((r) => r.role),
    };
  }
}
