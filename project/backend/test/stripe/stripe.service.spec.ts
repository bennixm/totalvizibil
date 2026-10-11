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
};

import { StripeService } from 'src/stripe/stripe.service';

function fakeConfig(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = { stripeSecretKey: '' };
  return { get: jest.fn((k: string) => ({ ...defaults, ...overrides }[k])) };
}

describe('StripeService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('configured', () => {
    it('is false when stripeSecretKey is empty', () => {
      const svc = new StripeService(fakeConfig() as any);
      expect(svc.configured).toBe(false);
    });

    it('is true when stripeSecretKey is set', () => {
      const svc = new StripeService(fakeConfig({ stripeSecretKey: 'sk_test_abc' }) as any);
      expect(svc.configured).toBe(true);
    });
  });

  describe('without key', () => {
    it('createCheckoutSession throws Error', async () => {
      const svc = new StripeService(fakeConfig() as any);
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
      const svc = new StripeService(fakeConfig() as any);
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
      const svc = new StripeService(fakeConfig({ stripeSecretKey: 'sk_test_abc' }) as any);
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
      const svc = new StripeService(fakeConfig({ stripeSecretKey: 'sk_test_abc' }) as any);
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
      const svc = new StripeService(fakeConfig({ stripeSecretKey: 'sk_test_abc' }) as any);
      const result = await svc.createRefund({ paymentIntentId: 'pi_1', amountMinor: 200 });
      expect(result).toMatchObject({ id: 're_1' });
      expect(mockStripeClient.refunds.create).toHaveBeenCalledWith({
        payment_intent: 'pi_1',
        amount: 200,
      });
    });
  });
});
