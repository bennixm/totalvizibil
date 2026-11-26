import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { StripeService } from '../stripe/stripe.service';
import { WalletService } from './wallet.service';

/**
 * `POST /api/v1/stripe/webhook`: Stripe telling us a top-up was paid,
 * expired or failed. Not behind the session guard (Stripe has no session);
 * authenticity comes from the `Stripe-Signature` header, verified over the
 * RAW request body (kept by the JSON parser in main.ts) with the endpoint's
 * signing secret. Anything unsigned or badly signed is rejected with 400.
 *
 * The handler only ever reconciles a wallet transaction the platform itself
 * created (matched by `metadata.walletTransactionId`), and every path is
 * idempotent, so Stripe's automatic retries can't credit anything twice.
 */
@SkipThrottle()
@Controller('stripe')
export class StripeWebhookController {
  private readonly logger = new Logger('StripeWebhook');

  constructor(
    private readonly stripe: StripeService,
    private readonly wallet: WalletService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: true }> {
    if (!this.stripe.webhookConfigured) {
      throw new ServiceUnavailableException('stripe_webhook_not_configured');
    }
    if (!signature || !req.rawBody) throw new BadRequestException('missing_signature');

    let event;
    try {
      event = this.stripe.constructWebhookEvent(req.rawBody, signature);
    } catch (err) {
      this.logger.warn(`Rejected webhook: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('invalid_signature');
    }

    // A processing error is returned as 500 on purpose: Stripe then retries
    // the event later, and every handler path is safe to run again.
    await this.wallet.handleStripeEvent(event);
    return { received: true };
  }
}
