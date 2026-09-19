import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { AppConfig } from '../config/env';

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

  constructor(config: ConfigService<AppConfig, true>) {
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
}
