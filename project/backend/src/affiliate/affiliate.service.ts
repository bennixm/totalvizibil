import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CREDIT_MINOR } from '../wallet/money';
import { BillingService } from '../billing/billing.service';
import { generateInvoicePdf } from '../billing/invoice-pdf';
import { generateTablePdf } from '../common/table-pdf';
import { NotificationsService } from '../notifications/notifications.service';
import { AppConfig } from '../config/env';

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
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<AppConfig, true>,
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
      // Stamp today's reward amount onto the referral now, at claim time —
      // not re-read from the live setting later at payout time. Otherwise an
      // admin lowering the reward retroactively cuts the pay owed on every
      // still-pending referral, even though the referrer was shown (and
      // shared their link under) the higher amount the whole time.
      const promisedReward = await this.settings.affiliateRewardCredits();
      await this.prisma.referral.create({
        data: { referrerId: referrer.id, referredUserId, rewardCredits: promisedReward },
      });
      // Mild engagement news, not important enough for an inbox — the
      // REWARD notification (once it actually lands) is the one that
      // matters and already fires with its own email.
      void this.notifications
        .notify({
          userId: referrer.id,
          type: 'referral_claimed',
          title: 'Cineva s-a înscris cu codul tău de recomandare',
          body: 'Recompensa vine după ce finalizează o campanie și alimentează portofelul.',
          channels: { panel: true },
        })
        .catch((err) =>
          this.logger.error(
            'Referral-claimed notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );
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
        select: { id: true, status: true, referrerId: true, rewardCredits: true },
      });
      if (!referral || referral.status !== 'pending') return;
      if (!(await this.settings.affiliateEnabled())) return;
      if (!(await this.hasStartedCampaign(referredUserId))) return;

      const minDeposit = await this.settings.affiliateMinDepositCredits();
      if ((await this.depositedCredits(referredUserId)) < minDeposit) return;

      // Pay what was promised at claim time (`rewardCredits`, stamped in
      // `claim()`), not whatever the live setting says today — falls back to
      // the live setting only for a referral claimed before this stamping
      // existed (`rewardCredits` still null).
      const reward = referral.rewardCredits ?? (await this.settings.affiliateRewardCredits());
      const referred = await this.prisma.user.findUnique({
        where: { id: referredUserId },
        select: { name: true },
      });
      const note = `Referral reward — ${referred?.name ?? 'client'}`.slice(0, 200);

      const result = await this.prisma.$transaction(async (tx) => {
        // Re-check status inside the tx to serialise concurrent triggers.
        const locked = await tx.referral.updateMany({
          where: { id: referral.id, status: 'pending' },
          data: { status: 'rewarded', rewardCredits: reward, rewardedAt: new Date() },
        });
        if (locked.count === 0) return null;
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
        return { invoice };
      });
      if (!result) return; // a concurrent trigger already claimed this reward

      this.logger.log(
        `Referral rewarded: ${reward} credits to ${referral.referrerId} for ${referredUserId}`,
      );

      // The credit + invoice are already committed by this point — a
      // notification hiccup must never mask that, same rule as everywhere
      // else money moves in this app.
      const frontendOrigin = this.config.get('frontendOrigin', { infer: true });
      const invoiceUrl = `${frontendOrigin}/account/invoices/${result.invoice.id}`;
      let attachments: { filename: string; content: Buffer; contentType: string }[] | undefined;
      try {
        const pdf = await generateInvoicePdf(result.invoice);
        attachments = [
          {
            filename: `${result.invoice.number}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          },
        ];
      } catch (err) {
        this.logger.error(
          `Reward invoice PDF generation failed for ${result.invoice.number}`,
          err instanceof Error ? err.stack : err,
        );
      }
      void this.notifications
        .notify({
          userId: referral.referrerId,
          type: 'referral_rewarded',
          title: 'Ai primit o recompensă din programul de afiliere',
          body: `Ai primit ${reward} credite pentru cineva pe care l-ai adus în Totalvizibil.`,
          channels: { panel: true, email: true },
          data: { invoiceId: result.invoice.id },
          email: {
            greet: true,
            text: `Cineva pe care l-ai adus în Totalvizibil și-a pornit prima campanie — iar tu tocmai ai primit recompensa pentru asta. Documentul de recompensă este atașat acestui email și disponibil oricând în cont.`,
            details: [
              { label: 'Credite primite', value: `${reward} credite` },
              { label: 'Document', value: result.invoice.number },
            ],
            cta: { label: 'Vezi documentul', url: invoiceUrl },
            attachments,
          },
        })
        .catch((err) =>
          this.logger.error(
            'Referral-rewarded notification failed',
            err instanceof Error ? err.stack : err,
          ),
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
      // `rewardCredits` is now stamped at claim time (the promised amount),
      // not just at payout — so a pending referral has a non-null value too.
      // Only an actually-`rewarded` row represents credits really earned.
      creditsEarned: rows
        .filter((r) => r.status === 'rewarded')
        .reduce((s, r) => s + (r.rewardCredits ?? 0), 0),
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

    const [rows, total, rewardedAgg, totalAll, totalPending] = await this.prisma.$transaction([
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
      // Unfiltered totals for the summary chips — `total` above is scoped to
      // whatever status filter is active, so deriving "pending" as
      // `total - totalRewarded` on the frontend went negative/nonsensical
      // under a filter. These two are never filtered.
      this.prisma.referral.count(),
      this.prisma.referral.count({ where: { status: 'pending' } }),
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
      totalAll,
      totalPending,
      totalRewarded: rewardedAgg._count,
      creditsPaid: rewardedAgg._sum.rewardCredits ?? 0,
    };
  }

  /** Same referral ledger as a downloadable PDF. */
  async exportPdf(params: { status?: 'pending' | 'rewarded' }): Promise<Buffer> {
    const EXPORT_CAP = 2000;
    const where: Prisma.ReferralWhereInput = params.status ? { status: params.status } : {};
    const rows = await this.prisma.referral.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_CAP,
      select: {
        status: true,
        rewardCredits: true,
        rewardedAt: true,
        createdAt: true,
        referrer: { select: { name: true, email: true } },
        referredUser: { select: { name: true, email: true } },
      },
    });

    return generateTablePdf({
      title: 'RECOMANDĂRI',
      ownerName: 'Panou admin',
      subtitle: `${rows.length} recomandări`,
      columns: [
        { label: 'Recomandat de', width: 0.32 },
        { label: 'Utilizator recomandat', width: 0.32 },
        { label: 'Status', width: 0.14 },
        { label: 'Recompensă', width: 0.1, align: 'right' },
        { label: 'Dată', width: 0.12, align: 'right' },
      ],
      rows: rows.map((r) => [
        `${r.referrer.name} (${r.referrer.email})`,
        `${r.referredUser.name} (${r.referredUser.email})`,
        r.status === 'rewarded' ? 'Recompensată' : 'În așteptare',
        r.rewardCredits != null ? `${r.rewardCredits} cr` : '—',
        (r.rewardedAt ?? r.createdAt).toLocaleDateString('ro-RO'),
      ]),
      emptyText: 'Nicio recomandare pentru acest filtru.',
    });
  }
}
