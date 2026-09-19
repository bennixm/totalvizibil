import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { BillingService, isProfileComplete } from '../billing/billing.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { StripeService } from '../stripe/stripe.service';
import { AppConfig } from '../config/env';
import { CREDIT_MINOR, eurCentsToRonBani, minorToCredits, money } from './money';
import { WALLET_CURRENCIES, WalletCurrency } from './dto/set-currency.dto';

const MAX_PURCHASE_CREDITS = 100_000;
const STUB_PROVIDER = 'stub-dev';
/** Real payments — Stripe Checkout, test mode key or not. */
const STRIPE_PROVIDER = 'stripe';
/** Marks the one rolling "Ad clicks" spend row per company per UTC day. */
const CPC_PROVIDER = 'cpc';
const WALLET_TXN_TYPES = ['purchase', 'spend', 'refund', 'adjustment'] as const;
type WalletTxnTypeFilter = (typeof WALLET_TXN_TYPES)[number];

/** A refund can be canceled up to this long after it's requested — see
 *  WalletService.requestRefund/cancelRefund. Same shape as the company
 *  deletion grace window (COMPANY_DELETE_GRACE_MS). */
const REFUND_HOLD_MS = 7 * 24 * 60 * 60 * 1000;
const REFUND_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * One wallet per user. It funds every business the user owns; campaigns have no
 * balance of their own. Each spend is tagged with `companyId` so we can report
 * exactly how much each business/campaign has consumed.
 */
@Injectable()
export class WalletService implements OnModuleInit {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly billing: BillingService,
    private readonly affiliate: AffiliateService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Same "no cron dependency, a plain timer" approach as
   *  CompaniesService.sweepStaleDrafts — skipped under Jest so test runs
   *  don't pick up a background interval. */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.sweepDueRefunds(), 90_000);
    setInterval(() => void this.sweepDueRefunds(), REFUND_SWEEP_INTERVAL_MS);
  }

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
    const [purchases, spends, eurRonRate, billingProfile, unbilled, refundFeePct] =
      await Promise.all([
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
        this.settings.refundFeePct(),
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
      // Shown in the refund confirm dialog before the customer commits —
      // the actual rate applied is whatever's current when they request it,
      // same source (`PlatformSettingsService`), just read again there.
      refundFeePct,
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

  /**
   * Lifetime ad spend for one business — only CPC click-billing rows.
   * Excludes one-off charges tied to the company (Advanced-builder unlock,
   * additional-business fee) so the campaign/dashboard "spent" figures match
   * `billed clicks × CPC`.
   */
  async consumedByCompany(companyId: string): Promise<number> {
    const agg = await this.prisma.walletTransaction.aggregate({
      where: {
        companyId,
        type: 'spend',
        status: 'completed',
        provider: CPC_PROVIDER,
      },
      _sum: { amountMinor: true },
    });
    return Math.abs(agg._sum.amountMinor ?? 0);
  }

  /** Ad-spend-per-business map for a set of companies (dashboard/overview). CPC rows only. */
  async consumedByCompanies(companyIds: string[]): Promise<Map<string, number>> {
    if (!companyIds.length) return new Map();
    const rows = await this.prisma.walletTransaction.groupBy({
      by: ['companyId'],
      where: {
        companyId: { in: companyIds },
        type: 'spend',
        status: 'completed',
        provider: CPC_PROVIDER,
      },
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
    opts: { limit?: number; cursor?: string; companyId?: string; type?: string } = {},
  ) {
    const wallet = await this.ensureWallet(userId);
    const take = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const type = WALLET_TXN_TYPES.includes(opts.type as WalletTxnTypeFilter)
      ? (opts.type as WalletTxnTypeFilter)
      : undefined;

    const rows = await this.prisma.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        ...(opts.companyId ? { companyId: opts.companyId } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: { company: { select: { displayName: true } } },
    });

    const hasMore = rows.length > take;
    const pageRows = hasMore ? rows.slice(0, take) : rows;

    // For each `purchase` row on this page, is there already an active
    // (pending or completed) refund against it? One extra indexed query
    // instead of guessing client-side across pagination boundaries.
    const purchaseIds = pageRows.filter((t) => t.type === 'purchase').map((t) => t.id);
    const activeRefunds = purchaseIds.length
      ? await this.prisma.walletTransaction.findMany({
          where: { refundOfId: { in: purchaseIds }, status: { in: ['pending', 'completed'] } },
          select: { id: true, refundOfId: true, status: true, processAt: true },
        })
      : [];
    const refundByPurchase = new Map(activeRefunds.map((r) => [r.refundOfId as string, r]));

    const items = pageRows.map((t) => {
      const activeRefund = t.type === 'purchase' ? (refundByPurchase.get(t.id) ?? null) : null;
      return {
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
        // Refund context — populated only where relevant (see comments).
        refundOfId: t.refundOfId,
        feePct: t.feePct,
        feeMinor: t.feeMinor != null ? money(t.feeMinor) : null,
        // A `refund` row's own cancel-window deadline.
        processAt: t.type === 'refund' ? t.processAt : null,
        // A `purchase` row's own eligibility: only a completed Stripe
        // purchase with no active refund already on it can be refunded.
        refundEligible:
          t.type === 'purchase' &&
          t.status === 'completed' &&
          t.provider === STRIPE_PROVIDER &&
          !activeRefund,
        activeRefundId: activeRefund?.id ?? null,
      };
    });

    return { items, nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null };
  }

  // --- purchases -----------------------------------------------------

  /**
   * Start a credit purchase. Creates a `pending` transaction and returns the
   * amounts (EUR + RON at the current rate). When Stripe is configured, this
   * also opens a real (test-mode) Checkout Session and returns its URL for
   * the client to redirect to; the balance moves only once `confirmPurchase`
   * verifies the session actually paid. With no Stripe key, behaviour is
   * unchanged: a dev stub the client confirms directly (PRD §17).
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

    // A real charge needs a billing profile to actually deliver on (every
    // deposit must produce an invoice) — the stub flow only checks this at
    // confirm time, but that would mean a customer pays via Stripe first and
    // only THEN learns their profile is incomplete. Check upfront instead.
    if (this.stripe.configured) {
      const profile = await this.billing.getProfile(userId);
      if (!isProfileComplete(profile)) {
        throw new BadRequestException('billing_profile_incomplete');
      }
    }

    const txn = await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'purchase',
        status: 'pending',
        amountMinor,
        eurCents,
        ronBani,
        fxRate: new Prisma.Decimal(rate),
        provider: this.stripe.configured ? STRIPE_PROVIDER : STUB_PROVIDER,
        description: `Buy ${credits} credits`,
      },
    });

    let checkoutUrl: string | null = null;
    if (this.stripe.configured) {
      const frontendOrigin = this.config.get('frontendOrigin', { infer: true });
      const session = await this.stripe.createCheckoutSession({
        amountMinor: eurCents,
        credits,
        successUrl: `${frontendOrigin}/wallet?checkout=success&txn=${txn.id}`,
        cancelUrl: `${frontendOrigin}/wallet?checkout=cancel&txn=${txn.id}`,
        metadata: { walletTransactionId: txn.id, userId },
      });
      await this.prisma.walletTransaction.update({
        where: { id: txn.id },
        data: { providerRef: session.id },
      });
      checkoutUrl = session.url;
    }

    return {
      transactionId: txn.id,
      credits,
      amount: money(amountMinor),
      eurCents,
      ronBani,
      fxRate: rate,
      provider: this.stripe.configured ? STRIPE_PROVIDER : STUB_PROVIDER,
      checkoutUrl,
      requiresConfirmation: true,
    };
  }

  /**
   * Confirm a pending purchase and apply the credits to the balance. Atomic.
   * Every deposit must produce an invoice, so a client with no complete billing
   * profile is rejected up front — no balance change, nothing to undo.
   *
   * When the purchase went through Stripe, this is where the payment is
   * actually verified: the Checkout Session is retrieved server-side and its
   * `payment_status` checked before a single credit moves — the redirect back
   * from Stripe is just a hint to check, never trusted on its own. The
   * session's real PaymentIntent id replaces the pending session id in
   * `providerRef`, so a later refund targets the actual charge.
   */
  async confirmPurchase(userId: string, transactionId: string) {
    const wallet = await this.ensureWallet(userId);
    const profile = await this.billing.getProfile(userId);
    if (!isProfileComplete(profile)) {
      throw new BadRequestException('billing_profile_incomplete');
    }

    // Stripe purchases: verify with Stripe's own API BEFORE touching the
    // balance — a call to this endpoint (via the success-page redirect) is
    // only ever a hint to go check, never trusted on its own. A network call
    // has no place inside the DB transaction below, so it happens first.
    let stripePaymentIntentId: string | null = null;
    const preTxn = await this.prisma.walletTransaction.findUnique({
      where: { id: transactionId },
    });
    if (!preTxn || preTxn.walletId !== wallet.id || preTxn.type !== 'purchase') {
      throw new NotFoundException('Transaction not found');
    }
    if (preTxn.provider === STRIPE_PROVIDER && preTxn.status === 'pending') {
      if (!preTxn.providerRef) throw new BadRequestException('missing_checkout_session');
      const session = await this.stripe.retrieveCheckoutSession(preTxn.providerRef);
      if (session.payment_status !== 'paid') {
        throw new BadRequestException('payment_not_completed');
      }
      const pi = session.payment_intent;
      stripePaymentIntentId = typeof pi === 'string' ? pi : (pi?.id ?? null);
      if (!stripePaymentIntentId) {
        throw new BadRequestException('missing_payment_intent');
      }
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
          providerRef: stripePaymentIntentId ?? `dev-${Date.now()}`,
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

    // A top-up may be the event that lifts a referred user over the affiliate
    // minimum-deposit threshold — re-evaluate their referral. Fire-and-forget.
    void this.affiliate.maybeReward(userId).catch(() => undefined);

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
   * Debit the wallet for AI usage inside the Website Builder. Unlike `spend()`,
   * this never throws or refuses: the AI call already happened (the cost is
   * already incurred on our side) by the time this runs, so there's nothing
   * to "reject" — it just settles the bill, clamping the deduction so the
   * balance never goes below zero (same clamp as `adjust()`) instead of
   * silently skipping the charge when the exact remaining balance is less
   * than this hop's cost. What actually stops a NEW turn once the wallet is
   * empty is `AiUsageService.assertUserCanAfford`, checked before any of this
   * runs. A zero-cost hop (or an already-empty wallet) writes nothing.
   */
  async chargeAiUsage(userId: string, minor: number, companyId: string): Promise<void> {
    if (minor <= 0) return;
    const wallet = await this.ensureWallet(userId);
    const deltaMinor = Math.min(minor, Math.max(0, wallet.balanceMinor));
    if (deltaMinor <= 0) return;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceMinor: { decrement: deltaMinor } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          companyId,
          type: 'spend',
          status: 'completed',
          provider: 'ai-usage',
          amountMinor: -deltaMinor,
          balanceAfterMinor: updated.balanceMinor,
          description: 'Website Builder usage',
        },
      });
    });
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

  // --- refunds --------------------------------------------------------

  /**
   * Request a refund of a completed Stripe purchase. Places an immediate
   * hold: the full purchase amount leaves the balance right away (a `refund`
   * transaction, status `pending`) so the customer can't spend money they've
   * asked back — same "prepaid, never negative" spirit as the rest of this
   * service. Nothing is actually sent to Stripe yet: `processAt` (now + 7
   * days) is when `sweepDueRefunds` may execute it, and the customer can
   * `cancelRefund` any time before then to release the hold. `initiatedBy
   * AdminId` records an admin-initiated refund — the SAME hold/cancel/sweep
   * path either way (see `CampaignSpendView`-style deletion grace window
   * this mirrors: `COMPANY_DELETE_GRACE_MS`).
   */
  async requestRefund(
    userId: string,
    transactionId: string,
    opts: { initiatedByAdminId?: string } = {},
  ) {
    const feePct = await this.settings.refundFeePct();

    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      const txn = await tx.walletTransaction.findUnique({ where: { id: transactionId } });
      if (!txn || txn.walletId !== wallet.id || txn.type !== 'purchase') {
        throw new NotFoundException('Transaction not found');
      }
      if (txn.status !== 'completed') {
        throw new BadRequestException('only_completed_purchases_can_be_refunded');
      }
      if (txn.provider !== STRIPE_PROVIDER || !txn.providerRef) {
        throw new BadRequestException('purchase_not_refundable');
      }
      const already = await tx.walletTransaction.findFirst({
        where: { refundOfId: txn.id, status: { in: ['pending', 'completed'] } },
      });
      if (already) throw new BadRequestException('refund_already_requested');

      const amountMinor = Math.abs(txn.amountMinor);
      if (wallet.balanceMinor < amountMinor) {
        throw new BadRequestException('insufficient_balance_for_refund');
      }
      const feeMinor = Math.round((amountMinor * feePct) / 100);

      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceMinor: { decrement: amountMinor } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'refund',
          status: 'pending',
          amountMinor: -amountMinor,
          balanceAfterMinor: updated.balanceMinor,
          refundOfId: txn.id,
          feePct,
          feeMinor,
          processAt: new Date(Date.now() + REFUND_HOLD_MS),
          initiatedByAdminId: opts.initiatedByAdminId ?? null,
          description: `Refund — ${txn.description ?? 'Purchase'}`,
        },
      });
    });

    return this.getSummary(userId);
  }

  /** Cancel a still-pending refund within its 7-day hold — releases the hold
   *  (credits the balance back) and marks the refund `canceled`. Works the
   *  same whether the refund was customer- or admin-initiated: it's still
   *  the customer's own wallet. */
  async cancelRefund(userId: string, refundTransactionId: string) {
    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      const refund = await tx.walletTransaction.findUnique({
        where: { id: refundTransactionId },
      });
      if (!refund || refund.walletId !== wallet.id || refund.type !== 'refund') {
        throw new NotFoundException('Refund not found');
      }
      if (refund.status !== 'pending') {
        throw new BadRequestException('refund_not_cancelable');
      }
      if (refund.processAt && refund.processAt.getTime() <= Date.now()) {
        throw new BadRequestException('refund_hold_expired');
      }

      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceMinor: { increment: Math.abs(refund.amountMinor) } },
      });
      await tx.walletTransaction.update({
        where: { id: refund.id },
        data: { status: 'canceled', balanceAfterMinor: updated.balanceMinor },
      });
    });

    return this.getSummary(userId);
  }

  /** Runs hourly (see `onModuleInit`): executes every refund whose 7-day hold
   *  has elapsed and that nobody canceled. No cron dependency, same pattern
   *  as `CompaniesService.sweepStaleDrafts`. */
  private async sweepDueRefunds(): Promise<void> {
    try {
      const due = await this.prisma.walletTransaction.findMany({
        where: { type: 'refund', status: 'pending', processAt: { lte: new Date() } },
        select: { id: true },
      });
      for (const { id } of due) {
        await this.executeRefund(id).catch((err) => {
          this.logger.error(`Refund ${id} failed`, err instanceof Error ? err.stack : err);
        });
      }
      if (due.length > 0) {
        this.logger.log(`Processed ${due.length} due refund(s)`);
      }
    } catch (err) {
      this.logger.error('Refund sweep failed', err instanceof Error ? err.stack : err);
    }
  }

  /** Actually sends the refund to Stripe (or, with no Stripe key configured,
   *  completes it as a no-op — same "empty key ⇒ deterministic fallback"
   *  idiom as every other optional integration in this app, so the whole
   *  request → wait → execute flow is fully testable without real
   *  credentials). A Stripe failure releases the hold rather than leaving
   *  the customer's credits stuck in limbo. */
  private async executeRefund(refundTransactionId: string): Promise<void> {
    const refund = await this.prisma.walletTransaction.findUnique({
      where: { id: refundTransactionId },
      include: { refundOf: true },
    });
    // Already handled (e.g. raced with a cancel) — nothing to do.
    if (!refund || refund.status !== 'pending') return;

    if (!this.stripe.configured) {
      await this.prisma.walletTransaction.update({
        where: { id: refund.id },
        data: { status: 'completed', providerRef: `dev-refund-${Date.now()}` },
      });
      return;
    }

    const original = refund.refundOf;
    if (!original?.providerRef) {
      await this.markRefundFailed(refund.id, 'missing_original_payment_reference');
      return;
    }

    const refundAmountMinor = Math.abs(refund.amountMinor) - (refund.feeMinor ?? 0);
    try {
      const stripeRefund = await this.stripe.createRefund({
        paymentIntentId: original.providerRef,
        amountMinor: refundAmountMinor,
      });
      await this.prisma.walletTransaction.update({
        where: { id: refund.id },
        data: { status: 'completed', providerRef: stripeRefund.id },
      });
    } catch (err) {
      await this.markRefundFailed(refund.id, err instanceof Error ? err.message : 'stripe_error');
    }
  }

  /** A refund Stripe couldn't actually execute releases its hold — the
   *  customer keeps the credits rather than losing them to a failed call,
   *  and the failure is visible in their history for support to follow up. */
  private async markRefundFailed(refundTransactionId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const refund = await tx.walletTransaction.findUnique({ where: { id: refundTransactionId } });
      if (!refund || refund.status !== 'pending') return;
      const updated = await tx.wallet.update({
        where: { id: refund.walletId },
        data: { balanceMinor: { increment: Math.abs(refund.amountMinor) } },
      });
      await tx.walletTransaction.update({
        where: { id: refund.id },
        data: {
          status: 'failed',
          balanceAfterMinor: updated.balanceMinor,
          description: `${refund.description ?? 'Refund'} — failed: ${reason.slice(0, 200)}`,
        },
      });
    });
  }
}
