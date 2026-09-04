import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { BillingService, isProfileComplete } from '../billing/billing.service';
import { CREDIT_MINOR, eurCentsToRonBani, minorToCredits, money } from './money';
import { WALLET_CURRENCIES, WalletCurrency } from './dto/set-currency.dto';

const MAX_PURCHASE_CREDITS = 100_000;
const STUB_PROVIDER = 'stub-dev';
/** Marks the one rolling "Ad clicks" spend row per company per UTC day. */
const CPC_PROVIDER = 'cpc';

/**
 * One wallet per user. It funds every business the user owns; campaigns have no
 * balance of their own. Each spend is tagged with `companyId` so we can report
 * exactly how much each business/campaign has consumed.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly billing: BillingService,
  ) {}

  // --- helpers ---------------------------------------------------------

  /** Freeze state of a wallet, without creating one. */
  async blockInfo(userId: string): Promise<{ blocked: boolean; reason: string | null }> {
    const w = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { blockedAt: true, blockedReason: true },
    });
    return { blocked: !!w?.blockedAt, reason: w?.blockedReason ?? null };
  }

  /**
   * Throw a structured `wallet_blocked` error (carrying the admin's reason) if
   * the wallet is frozen. Call before any top-up or spend so the user sees why.
   */
  async assertSpendable(userId: string): Promise<void> {
    const { blocked, reason } = await this.blockInfo(userId);
    if (blocked) {
      throw new ForbiddenException({ message: 'wallet_blocked', reason, statusCode: 403 });
    }
  }

  /** Get or lazily create the user's wallet row. */
  private async ensureWallet(userId: string) {
    return this.prisma.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /** Resolve the wallet owner for a business (its owner's single wallet). */
  async ownerIdForCompany(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { ownerUserId: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company.ownerUserId;
  }

  // --- summary --------------------------------------------------------

  /** Wallet summary for a user. No auth check — callers guard access. */
  async getSummary(userId: string) {
    const wallet = await this.ensureWallet(userId);
    const [purchases, spends, eurRonRate, billingProfile, unbilled] = await Promise.all([
      this.prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id, type: 'purchase', status: 'completed' },
        _sum: { amountMinor: true, eurCents: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { walletId: wallet.id, type: 'spend', status: 'completed' },
        _sum: { amountMinor: true },
      }),
      this.settings.eurRonRate(),
      this.billing.getProfile(userId),
      this.billing.unbilledPurchases(userId),
    ]);

    const purchasedMinor = purchases._sum.amountMinor ?? 0;
    const spentMinor = Math.abs(spends._sum.amountMinor ?? 0);

    return {
      balance: money(wallet.balanceMinor),
      currency: this.normalizeCurrency(wallet.currency),
      eurRonRate,
      depositedEurCents: purchases._sum.eurCents ?? 0,
      purchased: money(purchasedMinor),
      spent: money(spentMinor),
      blocked: !!wallet.blockedAt,
      blockedAt: wallet.blockedAt,
      blockedReason: wallet.blockedReason,
      updatedAt: wallet.updatedAt,
      // A deposit can never be confirmed without a complete billing profile
      // (see confirmPurchase) — surfaced here so the Wallet page can show the
      // gate/alert without a second round-trip.
      billingProfileComplete: isProfileComplete(billingProfile),
      unbilledPurchases: unbilled.count,
    };
  }

  /**
   * Lightweight FX context for the client: the wallet's chosen display currency
   * and the live EUR->RON rate. Read on every page that shows a credit amount,
   * so it stays cheap (one wallet row + the cached rate).
   */
  async fx(userId: string): Promise<{ currency: WalletCurrency; eurRonRate: number }> {
    const [wallet, eurRonRate] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId }, select: { currency: true } }),
      this.settings.eurRonRate(),
    ]);
    return { currency: this.normalizeCurrency(wallet?.currency), eurRonRate };
  }

  /** Set the wallet's display currency (EUR or RON). Credits are unaffected. */
  async setCurrency(userId: string, currency: WalletCurrency) {
    const wallet = await this.ensureWallet(userId);
    if (wallet.currency !== currency) {
      await this.prisma.wallet.update({ where: { id: wallet.id }, data: { currency } });
    }
    return this.getSummary(userId);
  }

  private normalizeCurrency(raw: string | null | undefined): WalletCurrency {
    return (WALLET_CURRENCIES as readonly string[]).includes(raw ?? '')
      ? (raw as WalletCurrency)
      : 'EUR';
  }

  // --- admin controls ----------------------------------------------

  /** Freeze / unfreeze a wallet. Blocked wallets can't top up or spend. */
  async setBlocked(userId: string, blocked: boolean, reason?: string | null) {
    const wallet = await this.ensureWallet(userId);
    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        blockedAt: blocked ? (wallet.blockedAt ?? new Date()) : null,
        blockedReason: blocked ? (reason ?? wallet.blockedReason ?? null) : null,
      },
    });
    return this.getSummary(userId);
  }

  /**
   * Admin credit/debit. `credits` may be negative (a claw-back); a debit is
   * clamped so the balance never goes below zero. Records an `adjustment`
   * transaction with the reason.
   */
  async adjust(userId: string, credits: number, reason: string) {
    if (!Number.isFinite(credits) || credits === 0) {
      throw new BadRequestException('credits must be a non-zero number');
    }
    const wallet = await this.ensureWallet(userId);
    let deltaMinor = Math.round(credits * CREDIT_MINOR);
    if (wallet.balanceMinor + deltaMinor < 0) deltaMinor = -wallet.balanceMinor;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceMinor: { increment: deltaMinor } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'adjustment',
          status: 'completed',
          amountMinor: deltaMinor,
          balanceAfterMinor: updated.balanceMinor,
          description: reason.trim() || 'Admin adjustment',
        },
      });
    });
    return this.getSummary(userId);
  }

  /** Lifetime credits consumed by one business (completed spend transactions). */
  async consumedByCompany(companyId: string): Promise<number> {
    const agg = await this.prisma.walletTransaction.aggregate({
      where: { companyId, type: 'spend', status: 'completed' },
      _sum: { amountMinor: true },
    });
    return Math.abs(agg._sum.amountMinor ?? 0);
  }

  /** Consumed-per-business map for a set of companies (dashboard/overview). */
  async consumedByCompanies(companyIds: string[]): Promise<Map<string, number>> {
    if (!companyIds.length) return new Map();
    const rows = await this.prisma.walletTransaction.groupBy({
      by: ['companyId'],
      where: { companyId: { in: companyIds }, type: 'spend', status: 'completed' },
      _sum: { amountMinor: true },
    });
    return new Map(
      rows
        .filter((r) => r.companyId)
        .map((r) => [r.companyId as string, Math.abs(r._sum.amountMinor ?? 0)]),
    );
  }

  async listTransactions(
    userId: string,
    opts: { limit?: number; cursor?: string; companyId?: string } = {},
  ) {
    const wallet = await this.ensureWallet(userId);
    const take = Math.min(Math.max(opts.limit ?? 20, 1), 100);

    const rows = await this.prisma.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        ...(opts.companyId ? { companyId: opts.companyId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: { company: { select: { displayName: true } } },
    });

    const hasMore = rows.length > take;
    const items = (hasMore ? rows.slice(0, take) : rows).map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      amount: money(t.amountMinor),
      balanceAfter: t.balanceAfterMinor != null ? money(t.balanceAfterMinor) : null,
      eurCents: t.eurCents,
      ronBani: t.ronBani,
      fxRate: t.fxRate ? Number(t.fxRate) : null,
      provider: t.provider,
      description: t.description,
      companyId: t.companyId,
      companyName: t.company?.displayName ?? null,
      // Rolled-up ad-click count for the daily CPC row (else null).
      clicks: t.provider === CPC_PROVIDER ? (t.clickCount ?? null) : null,
      createdAt: t.createdAt,
    }));

    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  // --- purchases -----------------------------------------------------

  /**
   * Start a credit purchase. Creates a `pending` transaction and returns the
   * amounts (EUR + RON at the current rate). The balance is not moved until the
   * payment is confirmed — in prod by the provider webhook, here by a manual
   * dev confirm.
   */
  async startPurchase(userId: string, credits: number) {
    if (!Number.isInteger(credits) || credits < 1 || credits > MAX_PURCHASE_CREDITS) {
      throw new BadRequestException('credits must be a whole number between 1 and 100000');
    }

    await this.assertSpendable(userId);
    const wallet = await this.ensureWallet(userId);
    const amountMinor = credits * CREDIT_MINOR;
    const eurCents = credits * 100;
    const rate = await this.settings.eurRonRate();
    const ronBani = eurCentsToRonBani(eurCents, rate);

    const txn = await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'purchase',
        status: 'pending',
        amountMinor,
        eurCents,
        ronBani,
        fxRate: new Prisma.Decimal(rate),
        provider: STUB_PROVIDER,
        description: `Buy ${credits} credits`,
      },
    });

    return {
      transactionId: txn.id,
      credits,
      amount: money(amountMinor),
      eurCents,
      ronBani,
      fxRate: rate,
      provider: STUB_PROVIDER,
      // No real PSP wired yet — the client confirms directly (PRD §17).
      requiresConfirmation: true,
    };
  }

  /**
   * Confirm a pending purchase and apply the credits to the balance. Atomic.
   * Every deposit must produce an invoice, so a client with no complete billing
   * profile is rejected up front — no balance change, nothing to undo.
   */
  async confirmPurchase(userId: string, transactionId: string) {
    const wallet = await this.ensureWallet(userId);
    const profile = await this.billing.getProfile(userId);
    if (!isProfileComplete(profile)) {
      throw new BadRequestException('billing_profile_incomplete');
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      const txn = await tx.walletTransaction.findUnique({ where: { id: transactionId } });
      if (!txn || txn.walletId !== wallet.id || txn.type !== 'purchase') {
        throw new NotFoundException('Transaction not found');
      }
      if (txn.status !== 'pending') {
        throw new BadRequestException('Transaction is not pending');
      }

      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceMinor: { increment: txn.amountMinor } },
      });
      await tx.walletTransaction.update({
        where: { id: txn.id },
        data: {
          status: 'completed',
          balanceAfterMinor: updated.balanceMinor,
          providerRef: `dev-${Date.now()}`,
        },
      });

      return this.billing.issueInvoice(tx, {
        userId,
        walletTransactionId: txn.id,
        ronBani: txn.ronBani ?? txn.amountMinor,
        eurCents: txn.eurCents,
        fxRate: txn.fxRate,
        credits: minorToCredits(txn.amountMinor),
      });
    });

    return { ...(await this.getSummary(userId)), invoice };
  }

  // --- spend --------------------------------------------------------

  /** Prepaid guard — never let the balance go negative, and a blocked wallet can never spend. */
  async canAfford(userId: string, minor: number): Promise<boolean> {
    const wallet = await this.ensureWallet(userId);
    return !wallet.blockedAt && wallet.balanceMinor >= minor;
  }

  /**
   * Debit the wallet from within an existing transaction. Prepaid — returns
   * `null` (no throw) when the balance can't cover `amountMinor`, so callers
   * like the CPC loop can decide what to do (mark the click free, deplete the
   * campaign). Records a completed `spend` transaction tagged with `companyId`.
   */
  async spendWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    amountMinor: number,
    opts: { description: string; companyId?: string },
  ): Promise<{ balanceMinor: number; transactionId: string } | null> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('spend amount must be a positive integer');
    }
    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    if (wallet.blockedAt || wallet.balanceMinor < amountMinor) return null;

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { decrement: amountMinor } },
    });
    const txn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        companyId: opts.companyId ?? null,
        type: 'spend',
        status: 'completed',
        amountMinor: -amountMinor,
        balanceAfterMinor: updated.balanceMinor,
        description: opts.description,
      },
    });
    return { balanceMinor: updated.balanceMinor, transactionId: txn.id };
  }

  /**
   * CPC click charge. Instead of one ledger row per click (a spam of tiny
   * transactions), it accumulates into a single "Ad clicks" `spend` row per
   * company per UTC day — amount and click count roll up on that row. The
   * roll-up is a single atomic `upsert` on the `(walletId, companyId,
   * provider, spendDay)` unique constraint (schema), so two clicks landing at
   * the same instant for the same company can never create two rows for the
   * same day — the DB serializes the conflict, not a racy read-then-write.
   * Prepaid — returns `null` if the balance can't cover one more click.
   */
  async chargeClickWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    amountMinor: number,
    companyId: string,
    dayStart: Date,
  ): Promise<{ balanceMinor: number } | null> {
    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    if (wallet.blockedAt || wallet.balanceMinor < amountMinor) return null;

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { decrement: amountMinor } },
    });

    await tx.walletTransaction.upsert({
      where: {
        walletId_companyId_provider_spendDay: {
          walletId: wallet.id,
          companyId,
          provider: CPC_PROVIDER,
          spendDay: dayStart,
        },
      },
      create: {
        walletId: wallet.id,
        companyId,
        type: 'spend',
        status: 'completed',
        provider: CPC_PROVIDER,
        spendDay: dayStart,
        clickCount: 1,
        amountMinor: -amountMinor,
        balanceAfterMinor: updated.balanceMinor,
        description: 'Ad clicks',
      },
      update: {
        amountMinor: { decrement: amountMinor },
        balanceAfterMinor: updated.balanceMinor,
        clickCount: { increment: 1 },
      },
    });
    return { balanceMinor: updated.balanceMinor };
  }

  /**
   * Debit the wallet for a platform service (advanced builder unlock, additional
   * business). Atomic and prepaid — throws `insufficient_credits` rather than
   * going negative. `amountMinor` is a positive magnitude.
   */
  async spend(
    userId: string,
    amountMinor: number,
    opts: { description: string; companyId?: string },
  ): Promise<{ balanceMinor: number; transactionId: string }> {
    await this.assertSpendable(userId);
    const result = await this.prisma.$transaction((tx) =>
      this.spendWithin(tx, userId, amountMinor, opts),
    );
    if (!result) throw new BadRequestException('insufficient_credits');
    return result;
  }
}
