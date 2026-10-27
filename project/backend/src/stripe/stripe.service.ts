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

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly settings: PlatformSettingsService,
  ) {
    const key = config.get('stripeSecretKey', { infer: true });
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
  }): Promise<{ id: string; url: string }> {
    const session = await this.req().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
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
    });
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { id: session.id, url: session.url };
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
