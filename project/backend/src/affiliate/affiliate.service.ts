import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CREDIT_MINOR } from '../wallet/money';
import { BillingService } from '../billing/billing.service';

/** A referred account can still claim its `?ref=` code within this window. */
const CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;
const CODE_LEN = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

function makeCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export interface AffiliateReferralRow {
  id: string;
  name: string;
  emailMasked: string;
  status: 'pending' | 'rewarded';
  rewardCredits: number | null;
  createdAt: Date;
  rewardedAt: Date | null;
  invoiceId: string | null;
}

export interface AffiliateStats {
  enabled: boolean;
  rewardCredits: number;
  minDepositCredits: number;
  code: string;
  referred: number;
  rewarded: number;
  creditsEarned: number;
  items: AffiliateReferralRow[];
}

/** `andrei.popescu@gmail.com` → `an•••@gmail.com` — enough to recognise, not to harvest. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  const head = local.slice(0, 2);
  return `${head}${'•'.repeat(3)}@${domain}`;
}

@Injectable()
export class AffiliateService {
  private readonly logger = new Logger(AffiliateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly billing: BillingService,
  ) {}

  /** Get the user's referral code, generating + persisting one on first use. */
  async ensureCode(userId: string): Promise<string> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (existing?.referralCode) return existing.referralCode;

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = makeCode();
      try {
        await this.prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
        return code;
      } catch (err) {
        // A racing request set a code first, or the (astronomically unlikely)
        // code collided — re-read / retry.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const now = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { referralCode: true },
          });
          if (now?.referralCode) return now.referralCode;
          continue;
        }
        throw err;
      }
    }
    throw new BadRequestException('could_not_allocate_referral_code');
  }

  /**
   * Record that `referredUserId` signed up via `code`. Best-effort — a bad code,
   * a self-referral, an already-referred account, or an account past its claim
   * window are all silently ignored (no error to the caller). The reward itself
   * is gated later, at campaign-activation time, on the program being enabled.
   */
  async claim(referredUserId: string, code: string): Promise<{ claimed: boolean }> {
    const clean = code.trim().toUpperCase().slice(0, 32);
    if (!clean) return { claimed: false };

    const [referred, referrer] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: referredUserId },
        select: { createdAt: true, referralReceived: { select: { id: true } } },
      }),
      this.prisma.user.findUnique({
        where: { referralCode: clean },
        select: { id: true, status: true },
      }),
    ]);

    if (!referred || referred.referralReceived) return { claimed: false };
    if (Date.now() - referred.createdAt.getTime() > CLAIM_WINDOW_MS) return { claimed: false };
    if (!referrer || referrer.status !== 'active' || referrer.id === referredUserId) {
      return { claimed: false };
    }

    try {
      await this.prisma.referral.create({
        data: { referrerId: referrer.id, referredUserId },
      });
      return { claimed: true };
    } catch (err) {
      // Unique(referred_user_id) — a concurrent claim won. Treat as success.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { claimed: true };
      }
      throw err;
    }
  }

  /**
   * Re-evaluate a referred user's pending referral. Called after their campaign
   * goes live AND after every top-up they make — whichever event finally makes
   * all of these true pays the one-time reward:
   *   1. the program is enabled,
   *   2. the referred user has started a campaign,
   *   3. their total deposits have reached the admin-set minimum (in credits).
   * Idempotent and never throws — a reward failure must not block activation or
   * a purchase confirmation.
   */
  async maybeReward(referredUserId: string): Promise<void> {
    try {
      const referral = await this.prisma.referral.findUnique({
        where: { referredUserId },
        select: { id: true, status: true, referrerId: true },
      });
      if (!referral || referral.status !== 'pending') return;
      if (!(await this.settings.affiliateEnabled())) return;
      if (!(await this.hasStartedCampaign(referredUserId))) return;

      const minDeposit = await this.settings.affiliateMinDepositCredits();
      if ((await this.depositedCredits(referredUserId)) < minDeposit) return;

      const reward = await this.settings.affiliateRewardCredits();
      const referred = await this.prisma.user.findUnique({
        where: { id: referredUserId },
        select: { name: true },
      });
      const note = `Referral reward — ${referred?.name ?? 'client'}`.slice(0, 200);

      await this.prisma.$transaction(async (tx) => {
        // Re-check status inside the tx to serialise concurrent triggers.
        const locked = await tx.referral.updateMany({
          where: { id: referral.id, status: 'pending' },
          data: { status: 'rewarded', rewardCredits: reward, rewardedAt: new Date() },
        });
        if (locked.count === 0) return;
        const txnId = await this.creditReferrer(tx, referral.referrerId, reward, note);
        // A payout document for the reward — every reward gets one. If this
        // throws, the whole reward rolls back and retries on the next trigger.
        const invoice = await this.billing.issueAffiliateRewardInvoice(tx, {
          userId: referral.referrerId,
          walletTransactionId: txnId,
          credits: reward,
          referredName: referred?.name ?? null,
        });
        await tx.referral.update({
          where: { id: referral.id },
          data: { rewardInvoiceId: invoice.id },
        });
      });

      this.logger.log(
        `Referral rewarded: ${reward} credits to ${referral.referrerId} for ${referredUserId}`,
      );
    } catch (err) {
      this.logger.error(
        `maybeReward failed for ${referredUserId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /** Whether the user has ever put a campaign live on any business they own. */
  private async hasStartedCampaign(userId: string): Promise<boolean> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { company: { ownerUserId: userId }, activatedAt: { not: null } },
      select: { id: true },
    });
    return campaign != null;
  }

  /** Total credits the user has actually deposited (sum of completed top-ups). */
  private async depositedCredits(userId: string): Promise<number> {
    const agg = await this.prisma.walletTransaction.aggregate({
      where: { wallet: { userId }, type: 'purchase', status: 'completed' },
      _sum: { amountMinor: true },
    });
    return (agg._sum.amountMinor ?? 0) / CREDIT_MINOR;
  }

  /** Credit the referrer's wallet for a reward, inside the reward transaction. */
  private async creditReferrer(
    tx: Prisma.TransactionClient,
    userId: string,
    credits: number,
    note: string,
  ): Promise<string> {
    const minor = Math.round(credits * CREDIT_MINOR);
    const wallet = await tx.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: minor } },
    });
    const txn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'adjustment',
        status: 'completed',
        amountMinor: minor,
        balanceAfterMinor: updated.balanceMinor,
        description: note.trim().slice(0, 200) || 'Referral reward',
      },
      select: { id: true },
    });
    return txn.id;
  }

  /** The signed-in user's own affiliate panel data. */
  async myStats(userId: string): Promise<AffiliateStats> {
    const [code, enabled, rewardCredits, minDepositCredits, rows] = await Promise.all([
      this.ensureCode(userId),
      this.settings.affiliateEnabled(),
      this.settings.affiliateRewardCredits(),
      this.settings.affiliateMinDepositCredits(),
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          rewardCredits: true,
          rewardedAt: true,
          createdAt: true,
          rewardInvoiceId: true,
          referredUser: { select: { name: true, email: true } },
        },
      }),
    ]);
    return {
      enabled,
      rewardCredits,
      minDepositCredits,
      code,
      referred: rows.length,
      rewarded: rows.filter((r) => r.status === 'rewarded').length,
      creditsEarned: rows.reduce((s, r) => s + (r.rewardCredits ?? 0), 0),
      items: rows.map((r) => ({
        id: r.id,
        name: r.referredUser.name,
        emailMasked: maskEmail(r.referredUser.email),
        status: r.status,
        rewardCredits: r.rewardCredits,
        createdAt: r.createdAt,
        rewardedAt: r.rewardedAt,
        invoiceId: r.rewardInvoiceId,
      })),
    };
  }

  /** Admin: paginated referral ledger + program totals. */
  async adminList(params: { page?: number; pageSize?: number; status?: 'pending' | 'rewarded' }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const where: Prisma.ReferralWhereInput = params.status ? { status: params.status } : {};

    const [rows, total, rewardedAgg] = await this.prisma.$transaction([
      this.prisma.referral.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          rewardCredits: true,
          rewardedAt: true,
          createdAt: true,
          referrer: { select: { id: true, name: true, email: true } },
          referredUser: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.referral.count({ where }),
      this.prisma.referral.aggregate({
        where: { status: 'rewarded' },
        _count: true,
        _sum: { rewardCredits: true },
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        rewardCredits: r.rewardCredits,
        rewardedAt: r.rewardedAt,
        createdAt: r.createdAt,
        referrer: r.referrer,
        referred: r.referredUser,
      })),
      page,
      pageSize,
      total,
      totalRewarded: rewardedAgg._count,
      creditsPaid: rewardedAgg._sum.rewardCredits ?? 0,
    };
  }
}
