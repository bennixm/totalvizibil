jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => mockStripeClient);
});

const mockStripeClient = {
  checkout: {
    sessions: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  },
  refunds: {
    create: jest.fn(),
  },
  paymentIntents: {
    retrieve: jest.fn(),
  },
};

import { StripeService } from 'src/stripe/stripe.service';

function fakeSettings(eurRonRate = 5) {
  return { eurRonRate: jest.fn(async () => eurRonRate) };
}

function fakeConfig(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = { stripeSecretKey: '' };
  return { get: jest.fn((k: string) => ({ ...defaults, ...overrides })[k]) };
}

describe('StripeService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('configured', () => {
    it('is false when stripeSecretKey is empty', () => {
      const svc = new StripeService(fakeConfig() as any, fakeSettings() as any);
      expect(svc.configured).toBe(false);
    });

    it('is true when stripeSecretKey is set', () => {
      const svc = new StripeService(
        fakeConfig({ stripeSecretKey: 'sk_test_abc' }) as any,
        fakeSettings() as any,
      );
      expect(svc.configured).toBe(true);
    });
  });

  describe('without key', () => {
    it('createCheckoutSession throws Error', async () => {
      const svc = new StripeService(fakeConfig() as any, fakeSettings() as any);
      await expect(
        svc.createCheckoutSession({
          amountMinor: 100,
          credits: 1,
          successUrl: 'https://x.com/ok',
          cancelUrl: 'https://x.com/cancel',
          metadata: {},
        }),
      ).rejects.toThrow('Stripe is not configured');
    });

    it('createRefund throws Error', () => {
      const svc = new StripeService(fakeConfig() as any, fakeSettings() as any);
      expect(() => svc.createRefund({ paymentIntentId: 'pi_1', amountMinor: 100 })).toThrow(
        'Stripe is not configured',
      );
    });
  });

  describe('with key', () => {
    it('createCheckoutSession delegates to stripe and returns id+url', async () => {
      mockStripeClient.checkout.sessions.create.mockResolvedValue({
        id: 'cs_1',
        url: 'https://checkout.stripe.com/pay/cs_1',
      });
      const svc = new StripeService(
        fakeConfig({ stripeSecretKey: 'sk_test_abc' }) as any,
        fakeSettings() as any,
      );
      const result = await svc.createCheckoutSession({
        amountMinor: 500,
        credits: 5,
        successUrl: 'https://x.com/ok',
        cancelUrl: 'https://x.com/cancel',
        metadata: { userId: 'u1' },
      });
      expect(result).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.com/pay/cs_1' });
    });

    it('createCheckoutSession throws when Stripe returns no url', async () => {
      mockStripeClient.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: null });
      const svc = new StripeService(
        fakeConfig({ stripeSecretKey: 'sk_test_abc' }) as any,
        fakeSettings() as any,
      );
      await expect(
        svc.createCheckoutSession({
          amountMinor: 100,
          credits: 1,
          successUrl: 'https://x.com/ok',
          cancelUrl: 'https://x.com/cancel',
          metadata: {},
        }),
      ).rejects.toThrow('checkout URL');
    });

    it('createRefund delegates to stripe', async () => {
      mockStripeClient.refunds.create.mockResolvedValue({ id: 're_1', status: 'succeeded' });
      const svc = new StripeService(
        fakeConfig({ stripeSecretKey: 'sk_test_abc' }) as any,
        fakeSettings() as any,
      );
      const result = await svc.createRefund({ paymentIntentId: 'pi_1', amountMinor: 200 });
      expect(result).toMatchObject({ id: 're_1' });
      expect(mockStripeClient.refunds.create).toHaveBeenCalledWith({
        payment_intent: 'pi_1',
        amount: 200,
      });
    });
  });

  // -------------------------------------------------------------------------
  // retrievePaymentIntentFee — the fee's CURRENCY, not just its number.
  //
  // `BalanceTransaction.fee` is denominated in the account's settlement
  // currency. Returning it raw booked a 5 RON (500 bani) fee as 500 EUR
  // cents, overstating a real cost ~5x and poisoning every P&L figure that
  // sums `stripe_fees`.
  // -------------------------------------------------------------------------
  describe('retrievePaymentIntentFee', () => {
    function withBalanceTransaction(bt: unknown) {
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        latest_charge: { balance_transaction: bt },
      });
      return new StripeService(
        fakeConfig({ stripeSecretKey: 'sk_test_abc' }) as any,
        fakeSettings(5) as any,
      );
    }

    it('passes a EUR-settled fee straight through — it is already EUR cents', async () => {
      const svc = withBalanceTransaction({ fee: 137, currency: 'eur', exchange_rate: null });

      await expect(svc.retrievePaymentIntentFee('pi_1')).resolves.toEqual({
        nativeMinor: 137,
        nativeCurrency: 'eur',
        eurCentsMinor: 137,
        conversion: 'none',
      });
    });

    it("converts with Stripe's own exchange_rate when the settlement currency isn't EUR (fee / rate, since the rate is presentment->settlement)", async () => {
      const svc = withBalanceTransaction({ fee: 500, currency: 'ron', exchange_rate: 4.9 });

      await expect(svc.retrievePaymentIntentFee('pi_1')).resolves.toEqual({
        nativeMinor: 500,
        nativeCurrency: 'ron',
        eurCentsMinor: 102, // round(500 / 4.9)
        conversion: 'stripe_exchange_rate',
      });
    });

    it("falls back to the platform's EUR->RON setting for a RON fee with no exchange_rate (a RON-presented, RON-settled charge)", async () => {
      const settings = fakeSettings(5);
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        latest_charge: { balance_transaction: { fee: 500, currency: 'ron', exchange_rate: null } },
      });
      const svc = new StripeService(
        fakeConfig({ stripeSecretKey: 'sk_test_abc' }) as any,
        settings as any,
      );

      const fee = await svc.retrievePaymentIntentFee('pi_1');

      // The whole bug in one assertion: 500 bani is 100 EUR cents, not 500.
      expect(fee?.eurCentsMinor).toBe(100);
      expect(fee?.conversion).toBe('platform_eur_ron_rate');
      expect(settings.eurRonRate).toHaveBeenCalled();
    });

    it('matches the currency case-insensitively, so an upper-case "EUR" is still recognised as EUR', async () => {
      const svc = withBalanceTransaction({ fee: 42, currency: 'EUR', exchange_rate: null });

      await expect(svc.retrievePaymentIntentFee('pi_1')).resolves.toMatchObject({
        nativeCurrency: 'eur',
        eurCentsMinor: 42,
        conversion: 'none',
      });
    });

    it('returns null for a settlement currency it has no rate for, rather than booking a wrong-unit number', async () => {
      const svc = withBalanceTransaction({ fee: 300, currency: 'huf', exchange_rate: null });

      await expect(svc.retrievePaymentIntentFee('pi_1')).resolves.toBeNull();
    });

    it('ignores a zero exchange_rate instead of dividing by it', async () => {
      const svc = withBalanceTransaction({ fee: 500, currency: 'ron', exchange_rate: 0 });

      // Falls through to the platform EUR->RON rate (5), not Infinity/NaN.
      await expect(svc.retrievePaymentIntentFee('pi_1')).resolves.toMatchObject({
        eurCentsMinor: 100,
        conversion: 'platform_eur_ron_rate',
      });
    });

    it('returns null when the balance transaction has not settled/expanded yet', async () => {
      const svc = withBalanceTransaction('txn_unexpanded');
      await expect(svc.retrievePaymentIntentFee('pi_1')).resolves.toBeNull();

      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({ latest_charge: null });
      await expect(svc.retrievePaymentIntentFee('pi_1')).resolves.toBeNull();
    });
  });
});
