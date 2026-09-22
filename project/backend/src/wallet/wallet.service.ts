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
import { generateInvoicePdf } from '../billing/invoice-pdf';
import { AffiliateService } from '../affiliate/affiliate.service';
import { StripeService } from '../stripe/stripe.service';
import { NotificationsService } from '../notifications/notifications.service';
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
/** A pending Stripe purchase isn't reconciled until it's had this long for the
 *  client's own success-page confirm to do it first — see
 *  sweepPendingStripePurchases. */
const PENDING_PURCHASE_GRACE_MS = 30 * 60 * 1000;

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
    private readonly notifications: NotificationsService,
  ) {}

  /** Same "no cron dependency, a plain timer" approach as
   *  CompaniesService.sweepStaleDrafts — skipped under Jest so test runs
   *  don't pick up a background interval. */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.sweepDueRefunds(), 90_000);
    setInterval(() => void this.sweepDueRefunds(), REFUND_SWEEP_INTERVAL_MS);
    if (this.stripe.configured) {
      setTimeout(() => void this.sweepPendingStripePurchases(), 150_000);
      setInterval(() => void this.sweepPendingStripePurchases(), REFUND_SWEEP_INTERVAL_MS);
    }
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

  /**
   * Atomically decrement a wallet by `amountMinor` — a single conditional
   * `UPDATE ... WHERE balance_minor >= $amount`, not a read-then-write.
   * Two concurrent debits against the same wallet serialize on Postgres's
   * row lock: whichever commits second re-evaluates this WHERE clause
   * against the already-decremented balance, so the balance can never be
   * driven negative by a race. Returns null (no throw) if it can't cover
   * the amount (or, with `requireUnblocked`, if the wallet is frozen) so
   * callers decide what "can't afford it" means for them.
   */
  private async debitAtomic(
    tx: Prisma.TransactionClient,
    walletId: string,
    amountMinor: number,
    opts: { requireUnblocked?: boolean } = {},
  ): Promise<{ balanceMinor: number } | null> {
    const result = await tx.wallet.updateMany({
      where: {
        id: walletId,
        balanceMinor: { gte: amountMinor },
        ...(opts.requireUnblocked ? { blockedAt: null } : {}),
      },
      data: { balanceMinor: { decrement: amountMinor } },
    });
    if (result.count === 0) return null;
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
    return { balanceMinor: wallet.balanceMinor };
  }

  /**
   * Atomically decrement a wallet by up to `amountMinor`, clamped so the
   * balance never goes below zero — for charges where the cost is already
   * incurred and there's nothing to reject (chargeAiUsage/adjust's debit
   * branch). A single `UPDATE ... SET balance = GREATEST(balance - $amount,
   * 0)` against the row locked by the CTE below, so concurrent clamped
   * debits against the same wallet can't each read the same stale balance
   * and jointly clamp past zero.
   */
  private async debitClamped(
    tx: Prisma.TransactionClient,
    walletId: string,
    amountMinor: number,
  ): Promise<{ deltaMinor: number; balanceMinor: number }> {
    const rows = await tx.$queryRaw<{ balanceMinor: number; before: number }[]>`
      WITH old AS (
        SELECT balance_minor FROM wallets WHERE id = ${walletId}::uuid FOR UPDATE
      )
      UPDATE wallets w
      SET balance_minor = GREATEST(old.balance_minor - ${amountMinor}, 0)
      FROM old
      WHERE w.id = ${walletId}::uuid
      RETURNING w.balance_minor AS "balanceMinor", old.balance_minor AS "before"
    `;
    const row = rows[0];
    return { deltaMinor: row.before - row.balanceMinor, balanceMinor: row.balanceMinor };
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
    const [purchases, spends, eurRonRate, billingProfile, unbilled, refundFeePct, refundableMinor] =
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
        this.refundableMinor(wallet.id, wallet.balanceMinor),
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
      // The practical refund ceiling — may be less than `balance` if part of
      // it isn't backed by a real Stripe charge (an admin credit, or a
      // purchase from before Stripe was wired up).
      refundable: money(refundableMinor),
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

    // Already committed — a notification hiccup must never mask this.
    void this.notifications
      .notify({
        userId,
        type: blocked ? 'wallet_blocked' : 'wallet_unblocked',
        title: blocked ? 'Portofelul tău a fost blocat' : 'Portofelul tău a fost deblocat',
        body: blocked
          ? `Nu mai poți cumpăra sau folosi credite momentan.${reason ? ` Motiv: ${reason}` : ''}`
          : 'Poți din nou cumpăra și folosi credite normal.',
        channels: { panel: true, email: true },
      })
      .catch((err) =>
        this.logger.error(
          'Wallet-block notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

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
    const requestedDeltaMinor = Math.round(credits * CREDIT_MINOR);

    // A debit is clamped atomically (debitClamped) so it can't be raced past
    // zero by a concurrent spend; a credit is a plain atomic increment, no
    // clamp needed.
    const deltaMinor = await this.prisma.$transaction(async (tx) => {
      if (requestedDeltaMinor < 0) {
        const { deltaMinor: debited, balanceMinor } = await this.debitClamped(
          tx,
          wallet.id,
          -requestedDeltaMinor,
        );
        const applied = -debited;
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'adjustment',
            status: 'completed',
            amountMinor: applied,
            balanceAfterMinor: balanceMinor,
            description: reason.trim() || 'Admin adjustment',
          },
        });
        return applied;
      }
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceMinor: { increment: requestedDeltaMinor } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'adjustment',
          status: 'completed',
          amountMinor: requestedDeltaMinor,
          balanceAfterMinor: updated.balanceMinor,
          description: reason.trim() || 'Admin adjustment',
        },
      });
      return requestedDeltaMinor;
    });

    // Already committed — a notification hiccup must never mask this.
    void this.notifications
      .notify({
        userId,
        type: 'wallet_adjusted',
        title:
          deltaMinor > 0 ? 'Ai primit credite în portofel' : 'Soldul portofelului a fost ajustat',
        body:
          deltaMinor > 0
            ? `Ai primit ${minorToCredits(deltaMinor)} credite în portofel.`
            : `Din portofelul tău au fost retrase ${minorToCredits(-deltaMinor)} credite.`,
        channels: { panel: true },
      })
      .catch((err) =>
        this.logger.error(
          'Wallet-adjusted notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

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

    const items = pageRows.map((t) => ({
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
      // A `refund` row's own detail — fee withheld + its cancel-window
      // deadline while still `pending`. Not meaningful on other row types.
      feePct: t.type === 'refund' ? t.feePct : null,
      feeMinor: t.type === 'refund' && t.feeMinor != null ? money(t.feeMinor) : null,
      processAt: t.type === 'refund' ? t.processAt : null,
    }));

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
    const discountPct = (await this.settings.creditsDiscountEnabled())
      ? await this.settings.creditsDiscountPct()
      : 0;
    // The discount lowers what's actually charged — the wallet is still
    // credited the full `credits` requested, just for less money.
    const eurCents = Math.round(credits * 100 * (1 - discountPct / 100));
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
      discountPct,
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

    const { invoice, credits } = await this.prisma.$transaction(async (tx) => {
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

      const credits = minorToCredits(txn.amountMinor);
      const invoice = await this.billing.issueInvoice(tx, {
        userId,
        walletTransactionId: txn.id,
        ronBani: txn.ronBani ?? txn.amountMinor,
        eurCents: txn.eurCents,
        fxRate: txn.fxRate,
        credits,
      });
      return { invoice, credits };
    });

    // A top-up may be the event that lifts a referred user over the affiliate
    // minimum-deposit threshold — re-evaluate their referral. Fire-and-forget.
    void this.affiliate.maybeReward(userId).catch(() => undefined);

    // The money has already moved and the invoice is already issued by this
    // point — a notification hiccup must NEVER make a successful payment
    // look like it failed to the customer. That includes the PDF itself: a
    // generation failure loses the attachment, never the email.
    const frontendOrigin = this.config.get('frontendOrigin', { infer: true });
    const invoiceUrl = `${frontendOrigin}/account/invoices/${invoice.id}`;
    let invoicePdf: { filename: string; content: Buffer; contentType: string }[] | undefined;
    try {
      const pdf = await generateInvoicePdf(invoice);
      invoicePdf = [
        { filename: `${invoice.number}.pdf`, content: pdf, contentType: 'application/pdf' },
      ];
    } catch (err) {
      this.logger.error(
        `Invoice PDF generation failed for ${invoice.number}`,
        err instanceof Error ? err.stack : err,
      );
    }

    void this.notifications
      .notify({
        userId,
        type: 'payment_succeeded',
        title: 'Plata a fost realizată cu succes',
        body: `Plata ta a fost procesată cu succes. Factura ${invoice.number} este disponibilă în cont.`,
        channels: { panel: true, email: true },
        data: { invoiceId: invoice.id },
        email: {
          text: `Plata ta a fost procesată cu succes. Factura ${invoice.number} este atașată acestui email și disponibilă oricând în cont.`,
          details: [
            { label: 'Factură', value: invoice.number },
            { label: 'Data', value: invoice.issuedAt.toLocaleDateString('ro-RO') },
            { label: 'Credite achiziționate', value: `${credits} credite` },
            {
              label: 'Sumă plătită',
              value: `${(invoice.totalMinor / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`,
            },
          ],
          cta: { label: 'Vezi factura', url: invoiceUrl },
          attachments: invoicePdf,
        },
      })
      .catch((err) =>
        this.logger.error(
          'Payment-succeeded notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

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
    const debited = await this.debitAtomic(tx, wallet.id, amountMinor, { requireUnblocked: true });
    if (!debited) return null;

    const txn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        companyId: opts.companyId ?? null,
        type: 'spend',
        status: 'completed',
        amountMinor: -amountMinor,
        balanceAfterMinor: debited.balanceMinor,
        description: opts.description,
      },
    });
    return { balanceMinor: debited.balanceMinor, transactionId: txn.id };
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
    const debited = await this.debitAtomic(tx, wallet.id, amountMinor, { requireUnblocked: true });
    if (!debited) return null;

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
        balanceAfterMinor: debited.balanceMinor,
        description: 'Ad clicks',
      },
      update: {
        amountMinor: { decrement: amountMinor },
        balanceAfterMinor: debited.balanceMinor,
        clickCount: { increment: 1 },
      },
    });
    return { balanceMinor: debited.balanceMinor };
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
    await this.prisma.$transaction(async (tx) => {
      const { deltaMinor, balanceMinor } = await this.debitClamped(tx, wallet.id, minor);
      if (deltaMinor <= 0) return;
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          companyId,
          type: 'spend',
          status: 'completed',
          provider: 'ai-usage',
          amountMinor: -deltaMinor,
          balanceAfterMinor: balanceMinor,
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
   * How much of the current balance is actually backed by refundable Stripe
   * purchases (completed, real charge, not already fully allocated to
   * another pending/completed refund). Can be less than the raw balance —
   * e.g. credits from an admin adjustment or the pre-Stripe dev stub have no
   * real charge behind them. Shown to the customer as the practical ceiling
   * before they even try to request a refund.
   */
  private async refundableMinor(walletId: string, balanceMinor: number): Promise<number> {
    const purchases = await this.prisma.walletTransaction.findMany({
      where: { walletId, type: 'purchase', status: 'completed', provider: STRIPE_PROVIDER },
      select: { amountMinor: true, refundReservedMinor: true },
    });
    const capacity = purchases.reduce(
      (sum, p) => sum + Math.max(0, p.amountMinor - p.refundReservedMinor),
      0,
    );
    return Math.min(capacity, balanceMinor);
  }

  /**
   * Request a refund of up to the wallet's CURRENT balance — not tied to any
   * one past purchase. The balance is a fungible pool (a user who already
   * spent part of what they bought can only get the unspent rest back), and
   * Stripe can only ever refund against a specific charge, so this allocates
   * `amountMinor` across one or more eligible `purchase` rows (oldest first)
   * that still have refundable capacity, recording the plan as
   * `refundSources` on a single new `refund` row.
   *
   * Places an immediate hold: the requested amount leaves the balance right
   * away (status `pending`) so the customer can't spend money they've asked
   * back — same "prepaid, never negative" spirit as the rest of this
   * service. Nothing is actually sent to Stripe yet: `processAt` (now + 7
   * days) is when `sweepDueRefunds` may execute it, and the customer can
   * `cancelRefund` any time before then to release the hold. `initiatedBy
   * AdminId` records an admin-initiated refund — the SAME hold/cancel/sweep
   * path either way (mirrors the deletion grace window, `COMPANY_DELETE_
   * GRACE_MS`).
   */
  async requestRefund(userId: string, credits: number, opts: { initiatedByAdminId?: string } = {}) {
    if (!Number.isFinite(credits) || credits <= 0) {
      throw new BadRequestException('credits must be a positive number');
    }
    const amountMinor = Math.round(credits * CREDIT_MINOR);
    const feePct = await this.settings.refundFeePct();

    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      if (wallet.balanceMinor < amountMinor) {
        throw new BadRequestException('insufficient_balance_for_refund');
      }

      // Oldest first — the standard, defensible "first money in, first
      // money out" allocation when the balance itself doesn't say which
      // purchase it came from.
      const candidates = await tx.walletTransaction.findMany({
        where: {
          walletId: wallet.id,
          type: 'purchase',
          status: 'completed',
          provider: STRIPE_PROVIDER,
        },
        orderBy: { createdAt: 'asc' },
      });

      const sources: { purchaseId: string; amountMinor: number; moneyMinor: number }[] = [];
      let remaining = amountMinor;
      for (const p of candidates) {
        if (remaining <= 0) break;
        const available = p.amountMinor - p.refundReservedMinor;
        if (available <= 0) continue;
        const take = Math.min(available, remaining);
        // The real charge behind a purchase can be LESS than its credit face
        // value (a discount was active at purchase time — see
        // PlatformSettingsService.setCreditsDiscount) — the wallet still
        // gives up the full credit slice, but Stripe can never be asked to
        // refund more than it was actually paid, so this slice's money
        // amount is proportional, not equal, to the credit slice taken.
        const moneyMinor = Math.round((take * (p.eurCents ?? p.amountMinor)) / p.amountMinor);
        sources.push({ purchaseId: p.id, amountMinor: take, moneyMinor });
        remaining -= take;
        await tx.walletTransaction.update({
          where: { id: p.id },
          data: { refundReservedMinor: { increment: take } },
        });
      }
      if (remaining > 0) {
        // The balance is real, but not enough of it traces back to an
        // actual Stripe charge to refund (e.g. it came from an admin credit
        // or the pre-Stripe dev stub) — there's nothing to send it back on.
        throw new BadRequestException('insufficient_refundable_purchases');
      }

      // Withheld from the real money being refunded, not the credit face
      // value — a discounted purchase never had that much money to begin with.
      const totalMoneyMinor = sources.reduce((sum, s) => sum + s.moneyMinor, 0);
      const feeMinor = Math.round((totalMoneyMinor * feePct) / 100);
      // The authoritative check — the plain read above is just a fast-fail
      // for the common case; this atomic conditional decrement is what
      // actually prevents two concurrent refund requests from jointly
      // taking the wallet negative.
      const debited = await this.debitAtomic(tx, wallet.id, amountMinor);
      if (!debited) throw new BadRequestException('insufficient_balance_for_refund');
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'refund',
          status: 'pending',
          amountMinor: -amountMinor,
          balanceAfterMinor: debited.balanceMinor,
          refundSources: sources,
          feePct,
          feeMinor,
          processAt: new Date(Date.now() + REFUND_HOLD_MS),
          initiatedByAdminId: opts.initiatedByAdminId ?? null,
          description: 'Wallet refund',
        },
      });
    });

    // The refund hold is already placed by this point — a notification
    // hiccup must never make an already-successful request look like it failed.
    void this.notifications
      .notify({
        userId,
        type: 'refund_requested',
        title: 'Cererea de refund a fost înregistrată',
        body: `Cererea ta de refund pentru ${credits} credite a fost înregistrată și va fi procesată în curând.`,
        channels: { email: true },
      })
      .catch((err) =>
        this.logger.error(
          'Refund-requested notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

    return this.getSummary(userId);
  }

  /** Cancel a still-pending refund within its 7-day hold — releases the hold
   *  on every source purchase it allocated from, credits the balance back,
   *  and marks the refund `canceled`. Works the same whether the refund was
   *  customer- or admin-initiated: it's still the customer's own wallet. */
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

      await this.releaseSources(tx, refund.refundSources);
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

  /** Releases each source purchase's reserved amount — shared by cancel and
   *  a failed execution, both of which give the credits back to the
   *  customer. `sources` is the `refundSources` JSON column, untyped at the
   *  Prisma boundary. */
  private async releaseSources(tx: Prisma.TransactionClient, sources: unknown): Promise<void> {
    for (const s of this.parseSources(sources)) {
      await tx.walletTransaction.update({
        where: { id: s.purchaseId },
        data: { refundReservedMinor: { decrement: s.amountMinor } },
      });
    }
  }

  private parseSources(
    raw: unknown,
  ): { purchaseId: string; amountMinor: number; moneyMinor?: number; stripeRefundId?: string }[] {
    if (!Array.isArray(raw)) return [];
    return raw as {
      purchaseId: string;
      amountMinor: number;
      moneyMinor?: number;
      stripeRefundId?: string;
    }[];
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

  /**
   * Actually sends the refund to Stripe — one call per source purchase,
   * since each is a separate charge. With no Stripe key configured, it
   * completes as a no-op instead (same "empty key ⇒ deterministic fallback"
   * idiom as every other optional integration in this app, so the whole
   * request → wait → execute flow is fully testable without real
   * credentials). The platform's fee is withheld from the first source(s)
   * in the plan until it's used up, not split evenly, to avoid rounding
   * drift across multiple calls.
   *
   * All-or-nothing: if any source's Stripe call fails, the whole refund is
   * marked `failed` and every reservation is released — a partial success
   * followed by a failure on a later source is a rare edge case this
   * doesn't try to reconcile automatically; it would need a manual look.
   *
   * Claims the refund with an atomic `pending -> processing` UPDATE before
   * ever calling Stripe. Without this, two overlapping sweeps (the hourly
   * timer firing twice back-to-back, or — more realistically once there's
   * more than one app instance — each instance running its own independent
   * sweep) could both read `status === 'pending'` and both call
   * `stripe.refunds.create` for the same refund, sending the customer's
   * money back twice. The claim is a single conditional UPDATE, not a
   * read-then-write, so only one caller can ever win it; a second caller
   * (or a stray retry) gets `count === 0` and returns immediately.
   */
  private async executeRefund(refundTransactionId: string): Promise<void> {
    const claim = await this.prisma.walletTransaction.updateMany({
      where: { id: refundTransactionId, status: 'pending' },
      data: { status: 'processing' },
    });
    if (claim.count === 0) return; // already claimed/canceled/handled elsewhere

    const refund = await this.prisma.walletTransaction.findUnique({
      where: { id: refundTransactionId },
    });
    if (!refund) return;
    const sources = this.parseSources(refund.refundSources);
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { id: refund.walletId },
      select: { userId: true },
    });

    if (!this.stripe.configured) {
      await this.prisma.walletTransaction.update({
        where: { id: refund.id },
        data: { status: 'completed', providerRef: `dev-refund-${Date.now()}` },
      });
      this.notifyRefundCompleted(wallet.userId, refund.id, Math.abs(refund.amountMinor));
      return;
    }

    let feeLeft = refund.feeMinor ?? 0;
    const executed: typeof sources = [];
    try {
      for (const s of sources) {
        // Pre-existing refund rows from before the discount feature have no
        // `moneyMinor` — they were always 1:1 with `amountMinor` (credits),
        // so that's the correct fallback, not a guess.
        const sourceMoneyMinor = s.moneyMinor ?? s.amountMinor;
        const deduct = Math.min(feeLeft, sourceMoneyMinor);
        feeLeft -= deduct;
        const netAmountMinor = sourceMoneyMinor - deduct;
        if (netAmountMinor <= 0) {
          executed.push(s);
          continue;
        }
        const purchase = await this.prisma.walletTransaction.findUniqueOrThrow({
          where: { id: s.purchaseId },
        });
        if (!purchase.providerRef) throw new Error('missing_original_payment_reference');
        const stripeRefund = await this.stripe.createRefund({
          paymentIntentId: purchase.providerRef,
          amountMinor: netAmountMinor,
        });
        executed.push({ ...s, stripeRefundId: stripeRefund.id });
      }
      await this.prisma.walletTransaction.update({
        where: { id: refund.id },
        data: {
          status: 'completed',
          providerRef: executed.map((s) => s.stripeRefundId).find(Boolean) ?? null,
          refundSources: executed,
        },
      });
      this.notifyRefundCompleted(wallet.userId, refund.id, Math.abs(refund.amountMinor));
    } catch (err) {
      await this.markRefundFailed(
        refund.id,
        wallet.userId,
        err instanceof Error ? err.message : 'stripe_error',
      );
    }
  }

  /** A refund Stripe couldn't actually execute releases every reservation —
   *  the customer keeps the credits rather than losing them to a failed
   *  call, and the failure is visible in their history for support to
   *  follow up. Only ever reached from `executeRefund`'s catch, after the
   *  `pending -> processing` claim already succeeded — so the guard here is
   *  `processing`, not `pending`. */
  private async markRefundFailed(
    refundTransactionId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const refund = await tx.walletTransaction.findUnique({ where: { id: refundTransactionId } });
      if (!refund || refund.status !== 'processing') return;
      await this.releaseSources(tx, refund.refundSources);
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

    // Credits are already back in the balance by this point — a notification
    // hiccup must never make this look like anything other than what it is.
    void this.notifications
      .notify({
        userId,
        type: 'refund_failed',
        title: 'Cererea de refund nu a putut fi procesată',
        body: 'Cererea ta de refund a eșuat — creditele au fost puse înapoi în portofel. Contactează suportul dacă ai nevoie de ajutor.',
        channels: { panel: true, email: true },
      })
      .catch((err) =>
        this.logger.error(
          'Refund-failed notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
  }

  private notifyRefundCompleted(userId: string, refundId: string, amountMinor: number): void {
    // Days may have passed since the request — the completion itself
    // deserves its own confirmation, separate from the "requested" one.
    void this.notifications
      .notify({
        userId,
        type: 'refund_completed',
        title: 'Refund-ul tău a fost finalizat',
        body: `${minorToCredits(amountMinor)} credite au fost rambursate — banii ar trebui să apară în contul tău în câteva zile lucrătoare, în funcție de bancă.`,
        channels: { panel: true, email: true },
        data: { refundId },
      })
      .catch((err) =>
        this.logger.error(
          'Refund-completed notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
  }

  // --- pending-purchase reconciliation --------------------------------

  /**
   * There is no Stripe webhook in this app (see StripeService/confirmPurchase
   * doc) — a purchase is normally confirmed by the client itself, from the
   * success-page redirect. If the customer pays but never comes back to that
   * page (closed tab, network drop, crash), Stripe has the money and the
   * transaction sits `pending` forever with nothing to notice it. This sweep
   * is that missing reconciliation: for any `pending` Stripe purchase old
   * enough that the client had a fair chance to confirm it itself, ask
   * Stripe directly what actually happened and settle it one way or the
   * other. Runs hourly, same pattern as `sweepDueRefunds`; skipped entirely
   * when Stripe isn't configured (see `onModuleInit`).
   */
  private async sweepPendingStripePurchases(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - PENDING_PURCHASE_GRACE_MS);
      const pending = await this.prisma.walletTransaction.findMany({
        where: {
          type: 'purchase',
          status: 'pending',
          provider: STRIPE_PROVIDER,
          createdAt: { lte: cutoff },
        },
        select: { id: true, wallet: { select: { userId: true } } },
      });
      for (const txn of pending) {
        await this.reconcilePendingPurchase(txn.id, txn.wallet.userId).catch((err) => {
          this.logger.error(
            `Pending purchase ${txn.id} reconciliation failed`,
            err instanceof Error ? err.stack : err,
          );
        });
      }
      if (pending.length > 0) {
        this.logger.log(`Reconciled ${pending.length} pending Stripe purchase(s)`);
      }
    } catch (err) {
      this.logger.error('Pending-purchase sweep failed', err instanceof Error ? err.stack : err);
    }
  }

  /**
   * Ask Stripe what actually happened to one pending purchase's Checkout
   * Session and settle it: paid ⇒ run it through the exact same
   * `confirmPurchase` path the client's own return-to-success-page call
   * uses (so it's one credited-and-invoiced code path, not two); a Session
   * Stripe now reports `expired` (its own ~24h unpaid TTL) ⇒ nothing to ever
   * reconcile toward, so it's marked `canceled` instead of sitting pending
   * forever. Anything else (still `open`) is left alone — too soon to tell.
   */
  private async reconcilePendingPurchase(transactionId: string, userId: string): Promise<void> {
    const txn = await this.prisma.walletTransaction.findUnique({ where: { id: transactionId } });
    if (!txn || txn.status !== 'pending' || !txn.providerRef) return;

    const session = await this.stripe.retrieveCheckoutSession(txn.providerRef);
    if (session.payment_status === 'paid') {
      // A billing-profile gap etc. would also block the customer's own
      // confirm — leave the transaction pending for support to look at
      // rather than silently losing a paid purchase.
      await this.confirmPurchase(userId, transactionId).catch((err) => {
        this.logger.warn(
          `Could not auto-confirm paid purchase ${transactionId}: ${err instanceof Error ? err.message : err}`,
        );
      });
      return;
    }
    if (session.status === 'expired') {
      await this.prisma.walletTransaction.updateMany({
        where: { id: transactionId, status: 'pending' },
        data: { status: 'canceled', description: 'Buy credits — checkout session expired unpaid' },
      });
    }
  }
}
