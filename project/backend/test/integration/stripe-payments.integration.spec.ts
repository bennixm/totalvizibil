import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { StripeService } from 'src/stripe/stripe.service';
import { resetDb } from './helpers/db';
import { createAndLoginUser, TestUser } from './helpers/auth';

/**
 * Top-ups end to end against the real database, with Stripe replaced by an
 * in-memory double that keeps Stripe's own state rules (a session is paid or
 * not, cards belong to one customer, a declined card fails, 3-D Secure needs
 * the customer, webhooks must be signed). Covers what the wallet must
 * guarantee whatever Stripe does: credited exactly once, failures never
 * credited, cards only usable by their owner.
 */
class FakeStripe {
  configured = true;
  webhookConfigured = true;
  customers = new Map<string, string>(); // customerId -> userId
  cards = new Map<
    string,
    { customer: string; last4: string; behaviour: 'ok' | 'decline' | '3ds' }
  >();
  sessions = new Map<
    string,
    {
      amount: number;
      metadata: Record<string, string>;
      customer?: string;
      saveCard: boolean;
      status: 'open' | 'complete' | 'expired';
      paid: boolean;
      pi: string;
    }
  >();
  intents = new Map<string, { amount: number; metadata: Record<string, string>; status: string }>();
  private seq = 0;
  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}_test${this.seq}`;
  }

  async createCustomer(opts: { userId: string }) {
    for (const [id, user] of this.customers) if (user === opts.userId) return id;
    const id = this.id('cus');
    this.customers.set(id, opts.userId);
    return id;
  }
  async createCheckoutSession(opts: {
    amountMinor: number;
    metadata: Record<string, string>;
    customerId?: string;
    saveCard?: boolean;
  }) {
    const id = this.id('cs');
    const pi = this.id('pi');
    this.sessions.set(id, {
      amount: opts.amountMinor,
      metadata: opts.metadata,
      customer: opts.customerId,
      saveCard: !!opts.saveCard,
      status: 'open',
      paid: false,
      pi,
    });
    this.intents.set(pi, {
      amount: opts.amountMinor,
      metadata: opts.metadata,
      status: 'requires_payment_method',
    });
    return { id, url: `https://checkout.stripe.test/${id}` };
  }
  /** The customer completes the hosted Checkout page with a card. */
  payCheckout(sessionId: string, last4 = '4242') {
    const s = this.sessions.get(sessionId)!;
    s.paid = true;
    s.status = 'complete';
    this.intents.get(s.pi)!.status = 'succeeded';
    if (s.saveCard && s.customer) {
      this.cards.set(this.id('pm'), { customer: s.customer, last4, behaviour: 'ok' });
    }
  }
  async retrieveCheckoutSession(id: string) {
    const s = this.sessions.get(id)!;
    return {
      id,
      status: s.status,
      payment_status: s.paid ? 'paid' : 'unpaid',
      amount_total: s.amount,
      metadata: s.metadata,
      payment_intent: s.paid ? s.pi : null,
    };
  }
  async expireCheckoutSession(id: string) {
    const s = this.sessions.get(id)!;
    if (s.status === 'open') s.status = 'expired';
    return this.retrieveCheckoutSession(id);
  }
  async listCards(customerId: string) {
    return [...this.cards]
      .filter(([, c]) => c.customer === customerId)
      .map(([id, c]) => ({ id, brand: 'visa', last4: c.last4, expMonth: 12, expYear: 2030 }));
  }
  async paymentMethodCustomer(id: string) {
    return this.cards.get(id)?.customer ?? null;
  }
  async detachPaymentMethod(id: string) {
    this.cards.delete(id);
  }
  async chargeSavedCard(opts: {
    customerId: string;
    paymentMethodId: string;
    amountMinor: number;
    metadata: Record<string, string>;
  }) {
    const card = this.cards.get(opts.paymentMethodId)!;
    const pi = this.id('pi');
    if (card.behaviour === 'decline') {
      this.intents.set(pi, {
        amount: opts.amountMinor,
        metadata: opts.metadata,
        status: 'requires_payment_method',
      });
      return {
        status: 'failed' as const,
        paymentIntentId: pi,
        code: 'card_declined',
        message: 'Your card was declined.',
      };
    }
    if (card.behaviour === '3ds') {
      this.intents.set(pi, {
        amount: opts.amountMinor,
        metadata: opts.metadata,
        status: 'requires_action',
      });
      return {
        status: 'requires_action' as const,
        paymentIntentId: pi,
        redirectUrl: `https://hooks.stripe.test/3ds/${pi}`,
      };
    }
    this.intents.set(pi, {
      amount: opts.amountMinor,
      metadata: opts.metadata,
      status: 'succeeded',
    });
    return { status: 'succeeded' as const, paymentIntentId: pi };
  }
  async retrievePaymentIntent(id: string) {
    const p = this.intents.get(id)!;
    return { id, ...p, last_payment_error: null };
  }
  async cancelPaymentIntent(id: string) {
    const p = this.intents.get(id)!;
    if (p.status !== 'succeeded') p.status = 'canceled';
    return { id, ...p };
  }
  async retrievePaymentIntentFee() {
    return null;
  }
  constructWebhookEvent(raw: Buffer, signature: string) {
    if (signature !== 'valid-signature')
      throw new Error('No signatures found matching the expected signature');
    return JSON.parse(raw.toString('utf8'));
  }
}

let app: INestApplication;
let prisma: PrismaService;
let stripe: FakeStripe;

beforeAll(async () => {
  stripe = new FakeStripe();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .overrideProvider(StripeService)
    .useValue(stripe)
    .compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  prisma = app.get(PrismaService);
});

beforeEach(async () => resetDb(prisma, app));
afterAll(async () => app.close());

const http = () => request(app.getHttpServer());

async function payingUser(email: string): Promise<TestUser> {
  const user = await createAndLoginUser(app, prisma, {
    email,
    password: 'password123',
    name: 'Ion Pop',
  });
  await http()
    .put('/api/v1/account/billing/profile')
    .set('Cookie', user.cookie)
    .send({
      kind: 'individual',
      name: 'Ion Pop',
      address: 'Str. Test 1',
      city: 'Brașov',
      county: 'Brașov',
      country: 'RO',
    })
    .expect(200);
  return user;
}
const balance = async (u: TestUser) =>
  (await http().get('/api/v1/wallet').set('Cookie', u.cookie)).body.balance.credits;
const txnRow = (id: string) => prisma.walletTransaction.findUniqueOrThrow({ where: { id } });

/** First deposit through Checkout, card saved; returns the user + its card id. */
async function firstDepositWithSavedCard(email: string) {
  const user = await payingUser(email);
  const start = await http()
    .post('/api/v1/wallet/purchases')
    .set('Cookie', user.cookie)
    .send({ credits: 50, saveCard: true })
    .expect(201);
  const txn = await txnRow(start.body.transactionId);
  stripe.payCheckout(txn.providerRef!);
  await http()
    .post(`/api/v1/wallet/purchases/${txn.id}/confirm`)
    .set('Cookie', user.cookie)
    .expect(201);
  const methods = await http()
    .get('/api/v1/wallet/payment-methods')
    .set('Cookie', user.cookie)
    .expect(200);
  return { user, txnId: txn.id, cardId: methods.body.cards[0]?.id as string };
}

describe('Stripe top-ups', () => {
  it("first deposit: Checkout runs under the user's customer, the card is saved, credited once with an invoice", async () => {
    const { user, txnId, cardId } = await firstDepositWithSavedCard('a@example.com');
    const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId: user.id } });
    const session = [...stripe.sessions.values()][0];
    expect(session.customer).toBe(wallet.stripeCustomerId);
    expect(session.saveCard).toBe(true);
    expect(await balance(user)).toBe(50);
    expect((await txnRow(txnId)).status).toBe('completed');
    expect(await prisma.invoice.count({ where: { walletTransactionId: txnId } })).toBe(1);
    expect(cardId).toMatch(/^pm_/);
  });

  it('without "save card" nothing is attached to the customer', async () => {
    const user = await payingUser('b@example.com');
    const start = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 10 })
      .expect(201);
    stripe.payCheckout((await txnRow(start.body.transactionId)).providerRef!);
    await http()
      .post(`/api/v1/wallet/purchases/${start.body.transactionId}/confirm`)
      .set('Cookie', user.cookie)
      .expect(201);
    const methods = await http()
      .get('/api/v1/wallet/payment-methods')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(methods.body).toEqual({ enabled: true, cards: [] });
  });

  it('confirm is refused until Stripe says the session is paid', async () => {
    const user = await payingUser('c@example.com');
    const start = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 10 })
      .expect(201);
    const res = await http()
      .post(`/api/v1/wallet/purchases/${start.body.transactionId}/confirm`)
      .set('Cookie', user.cookie)
      .expect(400);
    expect(res.body.message).toBe('payment_not_completed');
    expect(await balance(user)).toBe(0);
  });

  it('success page + webhook + repeat confirm at the same time credit the payment exactly once', async () => {
    const user = await payingUser('d@example.com');
    const start = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 30 })
      .expect(201);
    const txn = await txnRow(start.body.transactionId);
    stripe.payCheckout(txn.providerRef!);
    const event = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: txn.providerRef, metadata: { walletTransactionId: txn.id } } },
    };
    const results = await Promise.all([
      http().post(`/api/v1/wallet/purchases/${txn.id}/confirm`).set('Cookie', user.cookie),
      http().post(`/api/v1/wallet/purchases/${txn.id}/confirm`).set('Cookie', user.cookie),
      http().post('/api/v1/stripe/webhook').set('stripe-signature', 'valid-signature').send(event),
      http().post('/api/v1/stripe/webhook').set('stripe-signature', 'valid-signature').send(event),
    ]);
    for (const r of results) expect(r.status).toBeLessThan(300);
    expect(await balance(user)).toBe(30);
    expect(await prisma.invoice.count({ where: { walletTransactionId: txn.id } })).toBe(1);
    expect(
      await prisma.walletTransaction.count({ where: { type: 'purchase', status: 'completed' } }),
    ).toBe(1);
  });

  it('the webhook alone credits a paid top-up (customer never came back)', async () => {
    const user = await payingUser('e@example.com');
    const start = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 20 })
      .expect(201);
    const txn = await txnRow(start.body.transactionId);
    stripe.payCheckout(txn.providerRef!);
    await http()
      .post('/api/v1/stripe/webhook')
      .set('stripe-signature', 'valid-signature')
      .send({
        id: 'evt_2',
        type: 'checkout.session.completed',
        data: { object: { id: txn.providerRef, metadata: { walletTransactionId: txn.id } } },
      })
      .expect(200);
    expect(await balance(user)).toBe(20);
  });

  it('an unsigned or badly signed webhook is rejected and changes nothing', async () => {
    const user = await payingUser('f@example.com');
    const start = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 20 })
      .expect(201);
    const txn = await txnRow(start.body.transactionId);
    stripe.payCheckout(txn.providerRef!);
    const body = {
      id: 'evt_3',
      type: 'checkout.session.completed',
      data: { object: { id: txn.providerRef, metadata: { walletTransactionId: txn.id } } },
    };
    await http().post('/api/v1/stripe/webhook').send(body).expect(400);
    await http()
      .post('/api/v1/stripe/webhook')
      .set('stripe-signature', 'forged')
      .send(body)
      .expect(400);
    expect(await balance(user)).toBe(0);
  });

  it('second deposit with the saved card: no card form, credited immediately', async () => {
    const { user, cardId } = await firstDepositWithSavedCard('g@example.com');
    const res = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 25, paymentMethodId: cardId })
      .expect(201);
    expect(res.body.status).toBe('completed');
    expect(res.body.checkoutUrl).toBeNull();
    expect(res.body.invoice?.number).toBeTruthy();
    expect(await balance(user)).toBe(75);
    const txn = await txnRow(res.body.transactionId);
    expect(txn.status).toBe('completed');
    expect(txn.providerRef).toMatch(/^pi_/);
  });

  it('a declined saved card is recorded as failed and never credited', async () => {
    const { user, cardId } = await firstDepositWithSavedCard('h@example.com');
    stripe.cards.get(cardId)!.behaviour = 'decline';
    const res = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 25, paymentMethodId: cardId })
      .expect(400);
    expect(res.body.message).toBe('card_declined');
    expect(res.body.reason).toBe('Your card was declined.');
    expect(await balance(user)).toBe(50);
    const failed = await prisma.walletTransaction.findFirstOrThrow({ where: { status: 'failed' } });
    expect(failed.description).toContain('declined');
  });

  it('3-D Secure: the bank page is returned, the payment is credited only after it succeeds', async () => {
    const { user, cardId } = await firstDepositWithSavedCard('i@example.com');
    stripe.cards.get(cardId)!.behaviour = '3ds';
    const res = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 15, paymentMethodId: cardId })
      .expect(201);
    expect(res.body.status).toBe('requires_action');
    expect(res.body.redirectUrl).toContain('3ds');
    const txn = await txnRow(res.body.transactionId);
    await http()
      .post(`/api/v1/wallet/purchases/${txn.id}/confirm`)
      .set('Cookie', user.cookie)
      .expect(400);
    expect(await balance(user)).toBe(50);
    stripe.intents.get(txn.providerRef!)!.status = 'succeeded';
    await http()
      .post(`/api/v1/wallet/purchases/${txn.id}/confirm`)
      .set('Cookie', user.cookie)
      .expect(201);
    expect(await balance(user)).toBe(65);
  });

  it("another user's saved card can be neither charged nor removed", async () => {
    const { cardId } = await firstDepositWithSavedCard('j@example.com');
    const other = await payingUser('k@example.com');
    const pay = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', other.cookie)
      .send({ credits: 10, paymentMethodId: cardId })
      .expect(400);
    expect(pay.body.message).toBe('payment_method_not_found');
    await http()
      .delete(`/api/v1/wallet/payment-methods/${cardId}`)
      .set('Cookie', other.cookie)
      .expect(404);
    expect(stripe.cards.has(cardId)).toBe(true);
  });

  it('the owner can remove a saved card', async () => {
    const { user, cardId } = await firstDepositWithSavedCard('l@example.com');
    const res = await http()
      .delete(`/api/v1/wallet/payment-methods/${cardId}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body.cards).toEqual([]);
  });

  it('canceling closes the Checkout session at Stripe and the transaction here', async () => {
    const user = await payingUser('m@example.com');
    const start = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 10 })
      .expect(201);
    const txn = await txnRow(start.body.transactionId);
    const res = await http()
      .post(`/api/v1/wallet/purchases/${txn.id}/cancel`)
      .set('Cookie', user.cookie)
      .expect(201);
    expect(res.body.status).toBe('canceled');
    expect(stripe.sessions.get(txn.providerRef!)!.status).toBe('expired');
    expect((await txnRow(txn.id)).status).toBe('canceled');
  });

  it('a cancel that arrives after the payment went through credits it instead', async () => {
    const user = await payingUser('n@example.com');
    const start = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 10 })
      .expect(201);
    const txn = await txnRow(start.body.transactionId);
    stripe.payCheckout(txn.providerRef!);
    const res = await http()
      .post(`/api/v1/wallet/purchases/${txn.id}/cancel`)
      .set('Cookie', user.cookie)
      .expect(201);
    expect(res.body.status).toBe('completed');
    expect(await balance(user)).toBe(10);
  });

  it('an expired Checkout session reported by webhook closes the transaction', async () => {
    const user = await payingUser('o@example.com');
    const start = await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 10 })
      .expect(201);
    const txn = await txnRow(start.body.transactionId);
    await http()
      .post('/api/v1/stripe/webhook')
      .set('stripe-signature', 'valid-signature')
      .send({
        id: 'evt_4',
        type: 'checkout.session.expired',
        data: { object: { id: txn.providerRef, metadata: { walletTransactionId: txn.id } } },
      })
      .expect(200);
    expect((await txnRow(txn.id)).status).toBe('canceled');
    expect(await balance(user)).toBe(0);
  });

  it('the stored Stripe customer is reused for every later payment', async () => {
    const { user } = await firstDepositWithSavedCard('p@example.com');
    await http()
      .post('/api/v1/wallet/purchases')
      .set('Cookie', user.cookie)
      .send({ credits: 5 })
      .expect(201);
    const mine = [...stripe.sessions.values()].filter((s) => s.metadata.userId === user.id);
    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((s) => s.customer)).size).toBe(1);
  });
});
