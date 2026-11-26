import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { AppConfig } from '../config/env';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

/**
 * Stripe's processing fee for one payment, normalised to the unit the
 * platform's own books are kept in (EUR cents — see wallet/money.ts).
 *
 * The distinction matters because `BalanceTransaction.fee` is denominated in
 * the SETTLEMENT currency of the Stripe account, which is not necessarily
 * EUR. On a RON-settling account a 5 RON fee arrives as `fee: 500` (bani);
 * booking that straight as 500 EUR cents overstates a real cost by ~5x and
 * corrupts every downstream P&L figure that sums it.
 */
export interface StripeFeeBreakdown {
  /** The fee exactly as Stripe reports it, in `nativeCurrency`'s minor units. */
  nativeMinor: number;
  /** Lowercase ISO code of the balance transaction's own currency. */
  nativeCurrency: string;
  /** The same fee in EUR cents — the only figure safe to book as a cost. */
  eurCentsMinor: number;
  /** How `eurCentsMinor` was derived, so the expense row can say so. */
  conversion: 'none' | 'stripe_exchange_rate' | 'platform_eur_ron_rate';
}

/** A card saved on the customer's Stripe account, display data only.
 *  Never the number: Stripe keeps the card, we keep nothing but this view. */
export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** Outcome of charging a saved card (a PaymentIntent confirmed server-side). */
export type SavedCardCharge =
  | { status: 'succeeded'; paymentIntentId: string }
  | { status: 'requires_action'; paymentIntentId: string; redirectUrl: string }
  | { status: 'failed'; paymentIntentId: string | null; code: string; message: string };

/**
 * Thin wrapper around the Stripe SDK, test-mode only (whatever key is
 * configured). `STRIPE_SECRET_KEY` empty ⇒ `client` stays null and every
 * caller falls back to its existing non-Stripe behaviour — same "empty key ⇒
 * deterministic fallback" idiom as `AiService`/Pexels/DeepSeek elsewhere in
 * this app, so local dev and CI never need real Stripe credentials.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger('StripeService');
  private readonly client: Stripe | null;
  private readonly webhookSecret: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly settings: PlatformSettingsService,
  ) {
    const key = config.get('stripeSecretKey', { infer: true });
    this.webhookSecret = config.get('stripeWebhookSecret', { infer: true }) ?? '';
    this.client = key ? new Stripe(key) : null;
    if (!this.client) {
      this.logger.log(
        'STRIPE_SECRET_KEY not set — wallet top-ups use the dev stub confirm flow, refunds are unavailable',
      );
    }
  }

  get configured(): boolean {
    return this.client != null;
  }

  /** True when the webhook endpoint can verify Stripe's signature. */
  get webhookConfigured(): boolean {
    return this.client != null && !!this.webhookSecret;
  }

  private req(): Stripe {
    if (!this.client) throw new Error('Stripe is not configured');
    return this.client;
  }

  /**
   * A one-time Checkout Session for a credit top-up. `amountMinor` is EUR
   * cents (1 credit = 1 EUR = 1 minor unit, see wallet/money.ts).
   */
  async createCheckoutSession(opts: {
    amountMinor: number;
    credits: number;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    /** The wallet's Stripe Customer: the payment (and a saved card) is
     *  recorded under it, so the card can be offered again next time. */
    customerId?: string;
    /** The customer ticked "save this card": Stripe attaches the card to
     *  the customer for future, customer-present payments. */
    saveCard?: boolean;
    /** Same key on a retried call returns the SAME session (no duplicate). */
    idempotencyKey?: string;
  }): Promise<{ id: string; url: string }> {
    const session = await this.req().checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        ...(opts.customerId ? { customer: opts.customerId } : {}),
        // The PaymentIntent carries the same metadata as the session, so a
        // `payment_intent.*` webhook can be matched to the wallet transaction.
        payment_intent_data: {
          metadata: opts.metadata,
          ...(opts.saveCard && opts.customerId
            ? { setup_future_usage: 'on_session' as const }
            : {}),
        },
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: opts.amountMinor,
              product_data: { name: `${opts.credits} Totalvizibil credits` },
            },
            quantity: 1,
          },
        ],
        success_url: opts.successUrl,
        cancel_url: opts.cancelUrl,
        metadata: opts.metadata,
      },
      opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
    );
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { id: session.id, url: session.url };
  }

  /** Close a still-open Checkout Session so it can no longer be paid. A
   *  session that is already complete/expired is returned as it is (the
   *  caller reads it to decide what really happened). */
  async expireCheckoutSession(id: string): Promise<Stripe.Checkout.Session> {
    const session = await this.req().checkout.sessions.retrieve(id);
    if (session.status !== 'open') return session;
    return this.req().checkout.sessions.expire(id);
  }

  /** Create the Stripe Customer a wallet's payments and saved cards live under. */
  async createCustomer(opts: {
    email: string;
    name?: string | null;
    userId: string;
  }): Promise<string> {
    const customer = await this.req().customers.create(
      {
        email: opts.email,
        ...(opts.name ? { name: opts.name } : {}),
        metadata: { userId: opts.userId },
      },
      // One customer per user even if two first top-ups race each other.
      { idempotencyKey: `customer-${opts.userId}` },
    );
    return customer.id;
  }

  /** The cards saved on a customer: display data only (brand, last 4, expiry). */
  async listCards(customerId: string): Promise<SavedCard[]> {
    const list = await this.req().customers.listPaymentMethods(customerId, {
      type: 'card',
      limit: 20,
    });
    return list.data
      .filter((pm) => pm.card)
      .map((pm) => ({
        id: pm.id,
        brand: pm.card!.brand,
        last4: pm.card!.last4,
        expMonth: pm.card!.exp_month,
        expYear: pm.card!.exp_year,
      }));
  }

  /** The customer a saved payment method belongs to (null = none / unknown). */
  async paymentMethodCustomer(paymentMethodId: string): Promise<string | null> {
    try {
      const pm = await this.req().paymentMethods.retrieve(paymentMethodId);
      return typeof pm.customer === 'string' ? pm.customer : (pm.customer?.id ?? null);
    } catch (err) {
      if (err instanceof Stripe.errors.StripeInvalidRequestError) return null;
      throw err;
    }
  }

  /** Remove a saved card from the customer (Stripe forgets it for reuse). */
  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    await this.req().paymentMethods.detach(paymentMethodId);
  }

  /**
   * Charge a saved card for a top-up, with the customer present (they just
   * pressed "Pay"). Confirmed server-side; when the bank asks for 3-D Secure,
   * Stripe returns a redirect URL the customer completes, then comes back to
   * `returnUrl` where the payment is verified like any other.
   * `idempotencyKey` (the wallet transaction id) makes a retried request
   * return the same PaymentIntent instead of charging twice.
   */
  async chargeSavedCard(opts: {
    customerId: string;
    paymentMethodId: string;
    amountMinor: number;
    credits: number;
    returnUrl: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<SavedCardCharge> {
    let pi: Stripe.PaymentIntent;
    try {
      pi = await this.req().paymentIntents.create(
        {
          amount: opts.amountMinor,
          currency: 'eur',
          customer: opts.customerId,
          payment_method: opts.paymentMethodId,
          payment_method_types: ['card'],
          confirm: true,
          return_url: opts.returnUrl,
          description: `${opts.credits} Totalvizibil credits`,
          metadata: opts.metadata,
        },
        { idempotencyKey: opts.idempotencyKey },
      );
    } catch (err) {
      if (err instanceof Stripe.errors.StripeCardError) {
        const raw = err.raw as { payment_intent?: { id?: string } } | undefined;
        return {
          status: 'failed',
          paymentIntentId: raw?.payment_intent?.id ?? null,
          code: err.decline_code ?? err.code ?? 'card_declined',
          message: err.message,
        };
      }
      throw err;
    }
    if (pi.status === 'succeeded') return { status: 'succeeded', paymentIntentId: pi.id };
    if (pi.status === 'requires_action' && pi.next_action?.redirect_to_url?.url) {
      return {
        status: 'requires_action',
        paymentIntentId: pi.id,
        redirectUrl: pi.next_action.redirect_to_url.url,
      };
    }
    return {
      status: 'failed',
      paymentIntentId: pi.id,
      code: pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? pi.status,
      message: pi.last_payment_error?.message ?? `Payment ${pi.status}`,
    };
  }

  retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    return this.req().paymentIntents.retrieve(id);
  }

  /** Cancel a PaymentIntent that never completed (abandoned 3-D Secure). */
  async cancelPaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    const pi = await this.req().paymentIntents.retrieve(id);
    if (['succeeded', 'canceled', 'processing'].includes(pi.status)) return pi;
    return this.req().paymentIntents.cancel(id);
  }

  /** Verify a webhook call really comes from Stripe (signature over the raw
   *  body) and parse it. Throws on a bad or missing signature. */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.webhookConfigured) throw new Error('Stripe webhook is not configured');
    return this.req().webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  /** Retrieve a Checkout Session, expanding the payment intent so its id is
   *  available for a later refund without a second round trip. */
  retrieveCheckoutSession(id: string): Promise<Stripe.Checkout.Session> {
    return this.req().checkout.sessions.retrieve(id, { expand: ['payment_intent'] });
  }

  /** Refund part or all of a completed payment. `amountMinor` is EUR cents. */
  createRefund(opts: { paymentIntentId: string; amountMinor: number }): Promise<Stripe.Refund> {
    return this.req().refunds.create({
      payment_intent: opts.paymentIntentId,
      amount: opts.amountMinor,
    });
  }

  /**
   * Stripe's own processing fee for a completed payment, normalised to EUR
   * cents — null if it can't be determined yet (e.g. the balance transaction
   * hasn't settled) or can't be expressed in EUR at all. Used to log the real
   * cost of accepting the payment, never to gate the payment itself.
   *
   * `bt.fee` is in the balance transaction's OWN currency (`bt.currency`,
   * i.e. the account's settlement currency), so it is only EUR cents when
   * that currency is EUR. Three cases, in order:
   *
   *  1. `bt.currency === 'eur'` — already EUR cents, nothing to do.
   *  2. Stripe gave an `exchange_rate` for this transaction — that's the rate
   *     from the charge's presentment currency (EUR here, see
   *     `createCheckoutSession`) to the settlement currency, i.e.
   *     `settlement = presentment × rate`. So the presentment-side (EUR) fee
   *     is `fee / exchange_rate`.
   *  3. Settlement is RON with no exchange rate (a RON-presented, RON-settled
   *     charge) — fall back to the platform's own EUR->RON rate, the same
   *     setting every other RON figure in the app is derived from.
   *
   * Anything else (a settlement currency we have no rate for) returns null
   * rather than booking a number that is silently in the wrong unit — a
   * missing cost is recoverable, a 5x-overstated one quietly poisons the P&L.
   */
  async retrievePaymentIntentFee(paymentIntentId: string): Promise<StripeFeeBreakdown | null> {
    const pi = await this.req().paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.balance_transaction'],
    });
    const charge = pi.latest_charge;
    if (!charge || typeof charge === 'string') return null;
    const bt = charge.balance_transaction;
    if (!bt || typeof bt === 'string') return null;

    const nativeMinor = bt.fee;
    const nativeCurrency = (bt.currency ?? 'eur').toLowerCase();

    if (nativeCurrency === 'eur') {
      return { nativeMinor, nativeCurrency, eurCentsMinor: nativeMinor, conversion: 'none' };
    }

    const exchangeRate = bt.exchange_rate;
    if (typeof exchangeRate === 'number' && Number.isFinite(exchangeRate) && exchangeRate > 0) {
      return {
        nativeMinor,
        nativeCurrency,
        eurCentsMinor: Math.round(nativeMinor / exchangeRate),
        conversion: 'stripe_exchange_rate',
      };
    }

    if (nativeCurrency === 'ron') {
      const eurRonRate = await this.settings.eurRonRate();
      return {
        nativeMinor,
        nativeCurrency,
        eurCentsMinor: Math.round(nativeMinor / eurRonRate),
        conversion: 'platform_eur_ron_rate',
      };
    }

    this.logger.warn(
      `Stripe fee for ${paymentIntentId} is ${nativeMinor} ${nativeCurrency} with no usable ` +
        'exchange rate — skipping the expense row rather than booking a wrong-currency amount',
    );
    return null;
  }
}
