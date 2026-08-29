import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { ListUsersQuery } from './dto/list-users.query';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async list(query: ListUsersQuery) {
    const { search, status, role, staffOnly, page = 1, pageSize = 20 } = query;

    const where: Prisma.UserWhereInput = {
      ...(status ? { status } : {}),
      ...(role ? { platformRoles: { some: { role } } } : {}),
      ...(staffOnly && !role ? { platformRoles: { some: {} } } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          platformRoles: true,
          _count: { select: { companyMembers: true, sessions: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: u.status,
        platformRoles: u.platformRoles.map((r) => r.role),
        twoFactorEnabled: !!u.totpEnabledAt,
        companyCount: u._count.companyMembers,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      })),
      page,
      pageSize,
      total,
    };
  }

  async detail(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        platformRoles: true,
        companyMembers: {
          where: { status: 'active' },
          include: {
            company: { select: { id: true, displayName: true, slug: true, status: true } },
          },
        },
      },
    });
    if (!u) throw new NotFoundException('User not found');

    const sessions = await this.sessions.listActiveForUser(id);

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      platformRoles: u.platformRoles.map((r) => r.role),
      twoFactorEnabled: !!u.totpEnabledAt,
      lastLoginAt: u.lastLoginAt,
      passwordChangedAt: u.passwordChangedAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      companies: u.companyMembers.map((m) => ({
        id: m.company.id,
        displayName: m.company.displayName,
        slug: m.company.slug,
        status: m.company.status,
        role: m.role,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
      })),
    };
  }

  async update(callerId: string, id: string, dto: UpdateUserDto) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      include: { platformRoles: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const isSelf = callerId === id;
    if (isSelf) {
      if (dto.status === 'suspended') {
        throw new ForbiddenException('You cannot suspend your own account');
      }
      if (dto.platformRoles && !dto.platformRoles.includes('admin')) {
        throw new ForbiddenException('You cannot remove your own admin role');
      }
    }

    if (dto.email && dto.email !== target.email) {
      const taken = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (taken) throw new BadRequestException('That email is already in use');
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    ops.push(
      this.prisma.user.update({
        where: { id },
        data: {
          name: dto.name,
          email: dto.email,
          status: dto.status,
          ...(dto.disableTotp ? { totpSecret: null, totpEnabledAt: null } : {}),
        },
      }),
    );

    if (dto.platformRoles) {
      const current = new Set(target.platformRoles.map((r) => r.role));
      const desired = new Set(dto.platformRoles);
      const toAdd = [...desired].filter((r) => !current.has(r));
      const toRemove = [...current].filter((r) => !desired.has(r));
      if (toRemove.length) {
        ops.push(
          this.prisma.platformRoleAssignment.deleteMany({
            where: { userId: id, role: { in: toRemove } },
          }),
        );
      }
      for (const role of toAdd) {
        ops.push(this.prisma.platformRoleAssignment.create({ data: { userId: id, role } }));
      }
    }

    await this.prisma.$transaction(ops);

    if (dto.revokeSessions || dto.status === 'suspended') {
      await this.sessions.revokeAllForUser(id, isSelf ? callerId : undefined);
    }

    return this.detail(id);
  }

  async setPassword(id: string, newPassword: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await this.passwords.hash(newPassword),
        passwordChangedAt: new Date(),
      },
    });
    await this.sessions.revokeAllForUser(id);
    return { ok: true as const };
  }
}
