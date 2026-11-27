import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { PasswordService } from '../auth/password.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { AuditActor, AuditLogService } from '../admin/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { minorToCredits, money } from '../wallet/money';

/** Influencer codes: 3-24 chars, letters/digits/dash, stored uppercase. */
export const INFLUENCER_CODE_RE = /^[A-Z0-9-]{3,24}$/;
/** Sum of all discounts on one purchase never reaches a free top-up. */
export const MAX_TOTAL_DISCOUNT_PCT = 90;

/** Commission (credit minor units) on a payment of `paidEurCents`. */
export function commissionMinorFor(paidEurCents: number, pct: number): number {
  return Math.round((paidEurCents * pct) / 100);
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** `ana.pop@gmail.com` → `an•••@gmail.com`: an influencer sees WHO joined
 *  (name) without getting the customer's full address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  return `${local.slice(0, 2)}•••@${domain}`;
}

export interface InfluencerInput {
  code?: string;
  discountPct?: number;
  commissionPct?: number;
  active?: boolean;
  note?: string | null;
}

/**
 * Influencers: promoters an admin creates, each with its own discount code.
 *
 * Built on the existing referral system instead of a parallel one: a code
 * use is a `Referral` row (one per referred user, ever) with `influencerId`
 * set and `referrerId` = the influencer's own user. What differs from a
 * regular affiliate referral:
 *  - the referred user gets `discountPct` off their FIRST deposit only
 *    (stacked on any global discount, see WalletService.startPurchase);
 *  - the influencer earns `commissionPct` of the money actually paid on that
 *    first deposit, credited to their wallet with a reward invoice, inside
 *    the same transaction that credits the deposit (exactly once, never lost);
 *  - the regular one-off affiliate reward is NOT paid for such a referral.
 *
 * The influencer only READS their numbers (`dashboard`); every write lives
 * behind the admin endpoints.
 */
@Injectable()
export class InfluencersService {
  private readonly logger = new Logger(InfluencersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly passwords: PasswordService,
    private readonly passwordReset: PasswordResetService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- codes ---------------------------------------------------------------

  /** Influencer and user referral codes share one namespace (`?ref=CODE`
   *  works for both), so a new influencer code must not match either. */
  private async assertCodeFree(code: string, exceptInfluencerId?: string): Promise<void> {
    if (!INFLUENCER_CODE_RE.test(code)) throw new BadRequestException('influencer_code_invalid');
    const [inf, user] = await Promise.all([
      this.prisma.influencer.findUnique({ where: { code }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } }),
    ]);
    if ((inf && inf.id !== exceptInfluencerId) || user) {
      throw new ConflictException('influencer_code_taken');
    }
  }

  private assertPcts(input: InfluencerInput): void {
    for (const v of [input.discountPct, input.commissionPct]) {
      if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > MAX_TOTAL_DISCOUNT_PCT)) {
        throw new BadRequestException('influencer_pct_invalid');
      }
    }
  }

  /** Active influencer owning `code`, if any (for the claim flow). */
  findActiveByCode(code: string) {
    return this.prisma.influencer.findFirst({
      where: { code: normalizeCode(code), active: true, user: { status: 'active' } },
      select: { id: true, userId: true, discountPct: true, code: true },
    });
  }

  // --- first-deposit discount + commission (wallet integration) ------------

  /**
   * The influencer discount the user gets on THIS purchase: only while they
   * have no completed deposit yet, only if they joined with an active
   * influencer's code. Later deposits return null (normal price).
   */
  async firstDepositDiscount(
    userId: string,
  ): Promise<{ influencerId: string; pct: number; code: string } | null> {
    const referral = await this.prisma.referral.findUnique({
      where: { referredUserId: userId },
      select: { influencer: { select: { id: true, discountPct: true, code: true, active: true } } },
    });
    const inf = referral?.influencer;
    if (!inf || !inf.active || inf.discountPct <= 0) return null;
    const deposited = await this.prisma.walletTransaction.count({
      where: { wallet: { userId }, type: 'purchase', status: 'completed' },
    });
    if (deposited > 0) return null;
    return { influencerId: inf.id, pct: inf.discountPct, code: inf.code };
  }

  /**
   * Book the influencer's commission for a referred user's first deposit.
   * Runs INSIDE the deposit's own confirm transaction, so the commission and
   * the deposit commit or roll back together. One commission per referred
   * user (unique `referredUserId`): a later deposit never earns another.
   */
  async recordCommissionWithin(
    tx: Prisma.TransactionClient,
    purchase: {
      id: string;
      influencerId: string | null;
      eurCents: number | null;
      amountMinor: number;
      discountPct: number | null;
    },
    referredUserId: string,
  ): Promise<void> {
    if (!purchase.influencerId) return;
    const influencer = await tx.influencer.findUnique({
      where: { id: purchase.influencerId },
      select: { id: true, userId: true, commissionPct: true },
    });
    if (!influencer) return;
    const already = await tx.influencerCommission.findUnique({
      where: { referredUserId },
      select: { id: true },
    });
    if (already) return;

    const paidCents = purchase.eurCents ?? purchase.amountMinor;
    // 1 credit = 1 EUR, so EUR cents are credit minor units.
    const commissionMinor = commissionMinorFor(paidCents, influencer.commissionPct);

    let walletTxnId: string;
    let invoiceId: string | null = null;
    if (commissionMinor > 0) {
      const wallet = await tx.wallet.upsert({
        where: { userId: influencer.userId },
        create: { userId: influencer.userId },
        update: {},
      });
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceMinor: { increment: commissionMinor } },
      });
      const referred = await tx.user.findUnique({
        where: { id: referredUserId },
        select: { name: true },
      });
      const credit = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'adjustment',
          status: 'completed',
          amountMinor: commissionMinor,
          balanceAfterMinor: updated.balanceMinor,
          description: `Influencer commission — ${referred?.name ?? 'client'}`.slice(0, 200),
        },
      });
      walletTxnId = credit.id;
      const invoice = await this.billing.issueAffiliateRewardInvoice(tx, {
        userId: influencer.userId,
        walletTransactionId: credit.id,
        credits: minorToCredits(commissionMinor),
        referredName: referred?.name ?? null,
      });
      invoiceId = invoice.id;
    } else {
      // 0% commission: still record that the first deposit happened (the
      // stats count it), with no money moved and no invoice.
      walletTxnId = purchase.id;
    }

    await tx.influencerCommission.create({
      data: {
        influencerId: influencer.id,
        referredUserId,
        purchaseTransactionId: purchase.id,
        depositEurCents: paidCents,
        depositCreditsMinor: purchase.amountMinor,
        discountPct: purchase.discountPct ?? 0,
        commissionPct: influencer.commissionPct,
        commissionMinor,
        walletTransactionId: walletTxnId,
        invoiceId,
      },
    });

    if (commissionMinor > 0) {
      const credits = minorToCredits(commissionMinor);
      // Outside the money path: after commit, best-effort.
      setImmediate(() => {
        void this.notifications
          .notify({
            userId: influencer.userId,
            type: 'influencer_commission',
            title: 'Ai primit un comision nou',
            body: `Un client adus de tine a făcut prima depunere. ${credits} credite au fost adăugate în portofel.`,
            channels: { panel: true, email: true },
            data: { influencerId: influencer.id },
          })
          .catch((err) =>
            this.logger.error(
              'Commission notification failed',
              err instanceof Error ? err.stack : err,
            ),
          );
      });
    }
  }

  // --- statistics (shared by the influencer panel and the admin) -----------

  private async statsFor(influencerId: string) {
    const [referrals, commissions] = await Promise.all([
      this.prisma.referral.findMany({
        where: { influencerId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          referredUser: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.influencerCommission.findMany({
        where: { influencerId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const userIds = referrals.map((r) => r.referredUser.id);
    const deposits = userIds.length
      ? await this.prisma.walletTransaction.findMany({
          where: {
            wallet: { userId: { in: userIds } },
            type: 'purchase',
            status: 'completed',
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            amountMinor: true,
            eurCents: true,
            discountPct: true,
            influencerId: true,
            createdAt: true,
            wallet: { select: { userId: true } },
          },
        })
      : [];

    const commissionByUser = new Map(commissions.map((c) => [c.referredUserId, c]));
    const depositsByUser = new Map<string, typeof deposits>();
    for (const d of deposits) {
      const list = depositsByUser.get(d.wallet.userId) ?? [];
      list.push(d);
      depositsByUser.set(d.wallet.userId, list);
    }

    const sumPaid = deposits.reduce((s, d) => s + (d.eurCents ?? d.amountMinor), 0);
    const sumCredits = deposits.reduce((s, d) => s + d.amountMinor, 0);
    const commissionTotal = commissions.reduce((s, c) => s + c.commissionMinor, 0);
    const firstDepositPaid = commissions.reduce((s, c) => s + c.depositEurCents, 0);
    const depositors = depositsByUser.size;

    // Last 6 months, for the performance chart (sign-ups vs first deposits).
    const months: {
      month: string;
      signups: number;
      firstDeposits: number;
      commissionMinor: number;
    }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push({
        month: d.toISOString().slice(0, 7),
        signups: 0,
        firstDeposits: 0,
        commissionMinor: 0,
      });
    }
    const monthOf = (dt: Date) => dt.toISOString().slice(0, 7);
    for (const r of referrals) {
      const m = months.find((x) => x.month === monthOf(r.createdAt));
      if (m) m.signups += 1;
    }
    for (const c of commissions) {
      const m = months.find((x) => x.month === monthOf(c.createdAt));
      if (m) {
        m.firstDeposits += 1;
        m.commissionMinor += c.commissionMinor;
      }
    }

    return {
      totals: {
        users: referrals.length,
        depositors,
        conversionPct: referrals.length ? Math.round((depositors / referrals.length) * 100) : 0,
        deposits: deposits.length,
        /** Real money the referred users paid (all their deposits). */
        depositsPaid: money(sumPaid),
        /** Credits those deposits put in their wallets. */
        depositsCredits: money(sumCredits),
        /** Money paid on the first (discounted) deposits, the commission base. */
        firstDepositsPaid: money(firstDepositPaid),
        commissions: money(commissionTotal),
      },
      months,
      users: referrals.map((r) => {
        const list = depositsByUser.get(r.referredUser.id) ?? [];
        const c = commissionByUser.get(r.referredUser.id);
        return {
          id: r.referredUser.id,
          name: r.referredUser.name,
          email: r.referredUser.email,
          joinedAt: r.createdAt,
          deposits: list.length,
          depositsPaid: money(list.reduce((s, d) => s + (d.eurCents ?? d.amountMinor), 0)),
          firstDepositAt: c?.createdAt ?? null,
          commission: c ? money(c.commissionMinor) : null,
        };
      }),
      deposits: deposits.slice(0, 200).map((d) => ({
        id: d.id,
        userId: d.wallet.userId,
        paid: money(d.eurCents ?? d.amountMinor),
        credits: money(d.amountMinor),
        discountPct: d.discountPct ?? 0,
        first: commissionByUser.get(d.wallet.userId)?.purchaseTransactionId === d.id,
        createdAt: d.createdAt,
      })),
      commissions: commissions.map((c) => ({
        id: c.id,
        userId: c.referredUserId,
        depositPaid: money(c.depositEurCents),
        commissionPct: c.commissionPct,
        commission: money(c.commissionMinor),
        invoiceId: c.invoiceId,
        createdAt: c.createdAt,
      })),
    };
  }

  /** The influencer's own panel: read-only, their data only. Customers'
   *  emails are masked; the influencer never sees anyone else's numbers. */
  async dashboard(userId: string) {
    const inf = await this.prisma.influencer.findUnique({
      where: { userId },
      select: {
        id: true,
        code: true,
        discountPct: true,
        commissionPct: true,
        active: true,
        createdAt: true,
      },
    });
    if (!inf) throw new NotFoundException('not_an_influencer');
    const stats = await this.statsFor(inf.id);
    const names = new Map(stats.users.map((u) => [u.id, u.name]));
    return {
      influencer: inf,
      ...stats,
      users: stats.users.map(({ email, ...u }) => ({ ...u, email: maskEmail(email) })),
      deposits: stats.deposits.map(({ userId: uid, ...d }) => ({
        ...d,
        userName: names.get(uid) ?? '',
      })),
      commissions: stats.commissions.map(({ userId: uid, ...c }) => ({
        ...c,
        userName: names.get(uid) ?? '',
      })),
    };
  }

  // --- admin ---------------------------------------------------------------

  async adminList() {
    const rows = await this.prisma.influencer.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, status: true } },
        _count: { select: { referrals: true, commissions: true } },
      },
    });
    const sums = await this.prisma.influencerCommission.groupBy({
      by: ['influencerId'],
      _sum: { commissionMinor: true, depositEurCents: true },
    });
    const sumBy = new Map(sums.map((s) => [s.influencerId, s._sum]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        discountPct: r.discountPct,
        commissionPct: r.commissionPct,
        active: r.active,
        note: r.note,
        createdAt: r.createdAt,
        user: r.user,
        users: r._count.referrals,
        depositors: r._count.commissions,
        firstDepositsPaid: money(sumBy.get(r.id)?.depositEurCents ?? 0),
        commissions: money(sumBy.get(r.id)?.commissionMinor ?? 0),
      })),
    };
  }

  async adminDetail(id: string) {
    const inf = await this.prisma.influencer.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true } },
      },
    });
    if (!inf) throw new NotFoundException('influencer_not_found');
    return { influencer: inf, ...(await this.statsFor(inf.id)) };
  }

  /**
   * Make an account an influencer. An existing account (by email) is used as
   * is; otherwise one is created, already verified, with an unusable random
   * password, and the person gets the standard "set your password" email.
   */
  async adminCreate(
    dto: { email: string; name: string } & Required<
      Pick<InfluencerInput, 'code' | 'discountPct' | 'commissionPct'>
    > &
      Pick<InfluencerInput, 'note'>,
    actor: AuditActor,
  ) {
    const code = normalizeCode(dto.code);
    const email = dto.email.trim().toLowerCase();
    this.assertPcts(dto);
    await this.assertCodeFree(code);

    let user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, influencer: { select: { id: true } } },
    });
    if (user?.influencer) throw new ConflictException('already_influencer');
    let invited = false;
    if (!user) {
      const created = await this.prisma.user.create({
        data: {
          email,
          name: dto.name.trim(),
          passwordHash: await this.passwords.hash(randomBytes(32).toString('base64url')),
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });
      user = { id: created.id, influencer: null };
      invited = true;
    }

    let inf;
    try {
      inf = await this.prisma.influencer.create({
        data: {
          userId: user.id,
          code,
          discountPct: dto.discountPct,
          commissionPct: dto.commissionPct,
          note: dto.note?.trim() || null,
          createdById: actor.id,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('influencer_code_taken');
      }
      throw err;
    }

    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.roles,
      action: 'influencer.create',
      targetType: 'influencer',
      targetId: inf.id,
      after: { email, code, discountPct: dto.discountPct, commissionPct: dto.commissionPct },
    });
    if (invited) await this.passwordReset.request(email);
    void this.notifications
      .notify({
        userId: user.id,
        type: 'influencer_created',
        title: 'Contul tău de influencer este activ',
        body: `Codul tău de reducere este ${code}. Clienții primesc ${dto.discountPct}% reducere la prima depunere.`,
        channels: { panel: true, email: !invited },
        data: { influencerId: inf.id },
      })
      .catch(() => undefined);
    return { ...(await this.adminDetail(inf.id)), invited };
  }

  async adminUpdate(id: string, dto: InfluencerInput, actor: AuditActor) {
    const before = await this.prisma.influencer.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('influencer_not_found');
    this.assertPcts(dto);
    const code = dto.code !== undefined ? normalizeCode(dto.code) : undefined;
    if (code !== undefined && code !== before.code) await this.assertCodeFree(code, id);
    try {
      await this.prisma.influencer.update({
        where: { id },
        data: {
          ...(code !== undefined ? { code } : {}),
          ...(dto.discountPct !== undefined ? { discountPct: dto.discountPct } : {}),
          ...(dto.commissionPct !== undefined ? { commissionPct: dto.commissionPct } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('influencer_code_taken');
      }
      throw err;
    }
    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.roles,
      action: 'influencer.update',
      targetType: 'influencer',
      targetId: id,
      before: {
        code: before.code,
        discountPct: before.discountPct,
        commissionPct: before.commissionPct,
        active: before.active,
      },
      after: dto,
    });
    return this.adminDetail(id);
  }

  /** Re-send the "set your password" email (link expired, lost email). */
  async adminResendInvite(id: string) {
    const inf = await this.prisma.influencer.findUnique({
      where: { id },
      select: { user: { select: { email: true } } },
    });
    if (!inf) throw new NotFoundException('influencer_not_found');
    await this.passwordReset.request(inf.user.email);
    return { ok: true as const };
  }
}
