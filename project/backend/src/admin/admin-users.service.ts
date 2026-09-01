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
import { WalletService } from '../wallet/wallet.service';
import { money } from '../wallet/money';
import { effectiveActiveSeconds } from '../analytics/visibility';
import { ListUsersQuery } from './dto/list-users.query';
import { UpdateUserDto } from './dto/update-user.dto';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { BlockWalletDto } from './dto/block-wallet.dto';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly wallet: WalletService,
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
          wallet: { select: { balanceMinor: true, blockedAt: true } },
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
        walletCredits: u.wallet ? money(u.wallet.balanceMinor).credits : 0,
        walletBlocked: !!u.wallet?.blockedAt,
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
        wallet: true,
        companyMembers: {
          where: { status: 'active' },
          include: {
            company: {
              select: {
                id: true,
                displayName: true,
                slug: true,
                status: true,
                ownerUserId: true,
                createdAt: true,
                campaign: true,
                _count: { select: { leads: true, adClicks: true } },
              },
            },
          },
        },
      },
    });
    if (!u) throw new NotFoundException('User not found');

    const now = new Date();
    const companyIds = u.companyMembers.map((m) => m.company.id);

    const [sessions, walletSummary, transactions, spendByCompany] = await Promise.all([
      this.sessions.listActiveForUser(id),
      this.wallet.getSummary(id),
      this.prisma.walletTransaction.findMany({
        where: { wallet: { userId: id } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { company: { select: { displayName: true } } },
      }),
      companyIds.length
        ? this.prisma.walletTransaction.groupBy({
            by: ['companyId'],
            where: { companyId: { in: companyIds }, type: 'spend', status: 'completed' },
            _sum: { amountMinor: true },
          })
        : Promise.resolve([]),
    ]);

    const consumedBy = new Map(
      spendByCompany
        .filter((r) => r.companyId)
        .map((r) => [r.companyId as string, Math.abs(r._sum.amountMinor ?? 0)]),
    );

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
      wallet: {
        balance: walletSummary.balance,
        purchased: walletSummary.purchased,
        spent: walletSummary.spent,
        currency: walletSummary.currency,
        eurRonRate: walletSummary.eurRonRate,
        blocked: walletSummary.blocked,
        blockedAt: walletSummary.blockedAt,
        blockedReason: walletSummary.blockedReason,
      },
      companies: u.companyMembers.map((m) => {
        const c = m.company;
        const camp = c.campaign;
        const activeSeconds = camp
          ? effectiveActiveSeconds(
              camp.activeSecondsAccrued,
              camp.activatedAt,
              camp.status === 'active',
              now,
              camp.pausedAt,
            )
          : 0;
        return {
          id: c.id,
          displayName: c.displayName,
          slug: c.slug,
          status: c.status,
          role: m.role,
          isOwner: c.ownerUserId === id,
          leadCount: c._count.leads,
          clickCount: c._count.adClicks,
          consumed: money(consumedBy.get(c.id) ?? 0),
          createdAt: c.createdAt,
          campaign: camp
            ? {
                status: camp.status,
                dailyBudget: money(camp.dailyBudgetMinor),
                cpc: money(camp.cpcMinor),
                appearFirst: camp.appearFirst,
                spentToday: money(camp.spentTodayMinor),
                activeDays: Math.floor(activeSeconds / 86_400),
              }
            : null,
        };
      }),
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        status: t.status,
        amount: money(t.amountMinor),
        balanceAfter: t.balanceAfterMinor != null ? money(t.balanceAfterMinor) : null,
        description: t.description,
        companyName: t.company?.displayName ?? null,
        clicks: t.provider === 'cpc' && t.providerRef ? Number(t.providerRef) : null,
        createdAt: t.createdAt,
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

    // Banning a user pulls their businesses out of the feed too.
    if (dto.status === 'suspended') {
      await this.suspendOwnedListings(id);
    }

    if (dto.revokeSessions || dto.status === 'suspended') {
      await this.sessions.revokeAllForUser(id, isSelf ? callerId : undefined);
    }

    return this.detail(id);
  }

  /** Pause every campaign and unpublish every website owned by a banned user. */
  private async suspendOwnedListings(ownerUserId: string) {
    const companies = await this.prisma.company.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    if (!companies.length) return;
    const ids = companies.map((c) => c.id);
    await this.prisma.$transaction([
      this.prisma.campaign.updateMany({
        where: { companyId: { in: ids }, status: 'active' },
        data: { status: 'paused', pausedAt: new Date(), autoOptimize: false },
      }),
      this.prisma.company.updateMany({
        where: { id: { in: ids }, status: 'active' },
        data: { status: 'draft', featured: false },
      }),
      this.prisma.website.updateMany({
        where: { companyId: { in: ids } },
        data: { status: 'unpublished' },
      }),
    ]);
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

  async blockWallet(id: string, dto: BlockWalletDto) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    await this.wallet.setBlocked(id, dto.blocked, dto.reason ?? null);
    return this.detail(id);
  }

  async adjustWallet(id: string, dto: AdjustWalletDto) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    await this.wallet.adjust(id, dto.credits, dto.reason);
    return this.detail(id);
  }
}
