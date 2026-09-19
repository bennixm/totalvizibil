import { WalletService } from './wallet.service';
import { CREDIT_MINOR } from './money';

/** A minimal in-memory Prisma double covering exactly the calls the
 *  balance-based refund flow makes. `$transaction` snapshots the store and
 *  restores it if the callback throws, matching real Postgres rollback
 *  semantics — the allocation loop can partially reserve capacity across
 *  several purchases before discovering it still isn't enough. */
function fakePrisma() {
  const wallets = new Map<string, Record<string, unknown>>(); // by userId
  const walletsById = new Map<string, Record<string, unknown>>();
  const txns = new Map<string, Record<string, unknown>>();
  let seq = 0;

  function cloneTxn(t: Record<string, unknown>): Record<string, unknown> {
    return { ...t };
  }

  const client: any = {
    wallet: {
      upsert: jest.fn(async ({ where }: { where: { userId?: string; id?: string } }) => {
        if (where.id) return { ...walletsById.get(where.id) };
        const userId = where.userId as string;
        let w = wallets.get(userId);
        if (!w) {
          w = { id: `wallet_${++seq}`, userId, balanceMinor: 0, blockedAt: null, currency: 'EUR' };
          wallets.set(userId, w);
          walletsById.set(w.id as string, w);
        }
        return { ...w };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { balanceMinor?: { increment?: number; decrement?: number } };
        }) => {
          const w = walletsById.get(where.id) as Record<string, number>;
          if (data.balanceMinor?.increment != null) w.balanceMinor += data.balanceMinor.increment;
          if (data.balanceMinor?.decrement != null) w.balanceMinor -= data.balanceMinor.decrement;
          return { ...w };
        },
      ),
      findUnique: jest.fn(async ({ where }: { where: { userId?: string; id?: string } }) => {
        const w = where.id ? walletsById.get(where.id) : wallets.get(where.userId as string);
        return w ? { ...w } : null;
      }),
    },
    walletTransaction: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const t = txns.get(where.id);
        return t ? cloneTxn(t) : null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const t = txns.get(where.id);
        if (!t) throw new Error('not found');
        return cloneTxn(t);
      }),
      findMany: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where: {
            walletId?: string;
            type?: string;
            status?: string;
            provider?: string;
            processAt?: { lte: Date };
          };
          orderBy?: { createdAt: 'asc' | 'desc' };
        }) => {
          let rows = [...txns.values()].filter((t) => {
            if (where.walletId && t.walletId !== where.walletId) return false;
            if (where.type && t.type !== where.type) return false;
            if (where.status && t.status !== where.status) return false;
            if (where.provider && t.provider !== where.provider) return false;
            if (where.processAt?.lte) {
              const p = t.processAt as Date | null;
              if (!p || p.getTime() > where.processAt.lte.getTime()) return false;
            }
            return true;
          });
          if (orderBy?.createdAt === 'asc') {
            rows = rows.sort(
              (a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime(),
            );
          }
          return rows.map(cloneTxn);
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const t = { id: `txn_${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        txns.set(t.id, t);
        return cloneTxn(t);
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const t = txns.get(where.id) as Record<string, unknown>;
          const patch = { ...data } as Record<string, unknown>;
          const inc = patch.refundReservedMinor as
            { increment?: number; decrement?: number } | undefined;
          if (inc) {
            const cur = (t.refundReservedMinor as number) ?? 0;
            t.refundReservedMinor = cur + (inc.increment ?? 0) - (inc.decrement ?? 0);
            delete patch.refundReservedMinor;
          }
          Object.assign(t, patch);
          return cloneTxn(t);
        },
      ),
      aggregate: jest.fn(async () => ({ _sum: { amountMinor: 0, eurCents: 0 } })),
    },
    // Real Postgres rolls back everything done via `tx.*` if the callback
    // throws — snapshot + restore here so a fake mid-transaction failure
    // (e.g. "not enough refundable capacity" discovered after a few
    // allocations were already reserved) behaves the same way in tests.
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
      // Clone each wallet ONCE and reuse it for both maps — they reference
      // the same object in normal operation (see `wallet.upsert`), and a
      // restore must preserve that or the two maps silently desync.
      const walletClones = new Map([...walletsById].map(([id, v]) => [id, { ...v }]));
      const walletsSnap = new Map(
        [...wallets].map(([userId, v]) => [userId, walletClones.get(v.id as string)!]),
      );
      const txnsSnap = new Map([...txns].map(([k, v]) => [k, { ...v }]));
      try {
        return await cb(client);
      } catch (err) {
        wallets.clear();
        for (const [k, v] of walletsSnap) wallets.set(k, v);
        walletsById.clear();
        for (const [k, v] of walletClones) walletsById.set(k, v);
        txns.clear();
        for (const [k, v] of txnsSnap) txns.set(k, v);
        throw err;
      }
    }),
    __wallets: wallets,
    __txns: txns,
    __seedPurchase(
      userId: string,
      walletId: string,
      overrides: Partial<Record<string, unknown>> = {},
    ) {
      const id = `txn_${++seq}`;
      const t = {
        id,
        walletId,
        type: 'purchase',
        status: 'completed',
        amountMinor: 100 * CREDIT_MINOR,
        provider: 'stripe',
        providerRef: `pi_test_${id}`,
        description: 'Buy 100 credits',
        refundReservedMinor: 0,
        feePct: null,
        feeMinor: null,
        processAt: null,
        refundSources: null,
        createdAt: new Date(Date.now() + seq), // keeps insertion order stable for oldest-first tests
        ...overrides,
      };
      txns.set(id, t);
      return t;
    },
  };
  return client;
}

function fakeSettings(refundFeePct = 5) {
  return {
    eurRonRate: jest.fn(async () => 5),
    refundFeePct: jest.fn(async () => refundFeePct),
  };
}
function fakeBilling() {
  return {
    getProfile: jest.fn(async () => ({})),
    unbilledPurchases: jest.fn(async () => ({ count: 0 })),
  };
}
function fakeAffiliate() {
  return { maybeReward: jest.fn(async () => undefined) };
}
function fakeStripe(configured = true) {
  return {
    configured,
    createRefund: jest.fn(async () => ({ id: `re_test_${Math.random().toString(36).slice(2)}` })),
    createCheckoutSession: jest.fn(),
    retrieveCheckoutSession: jest.fn(),
  };
}
function fakeConfig() {
  return { get: jest.fn(() => 'http://localhost:5173') };
}
function fakeNotifications() {
  return { notify: jest.fn(async () => undefined), notifyAll: jest.fn(async () => 0) };
}

function makeService(opts: { refundFeePct?: number; stripeConfigured?: boolean } = {}) {
  const prisma = fakePrisma();
  const settings = fakeSettings(opts.refundFeePct);
  const billing = fakeBilling();
  const affiliate = fakeAffiliate();
  const stripe = fakeStripe(opts.stripeConfigured ?? true);
  const config = fakeConfig();
  const notifications = fakeNotifications();

  const service = new WalletService(
    prisma as any,
    settings as any,
    billing as any,
    affiliate as any,
    stripe as any,
    config as any,
    notifications as any,
  );
  return { service, prisma, settings, stripe, notifications };
}

function refundRows(prisma: ReturnType<typeof fakePrisma>) {
  return [...prisma.__txns.values()].filter((t) => t.type === 'refund');
}

describe('WalletService refunds (balance-based)', () => {
  const USER = 'user-1';

  it('refunds up to the current balance from a single eligible purchase', async () => {
    const { service, prisma } = makeService({ refundFeePct: 5 });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string);

    await service.requestRefund(USER, 50);

    const refund = refundRows(prisma)[0];
    expect(refund.status).toBe('pending');
    expect(refund.amountMinor).toBe(-50 * CREDIT_MINOR);
    expect(refund.feeMinor).toBe(Math.round(50 * CREDIT_MINOR * 0.05));
    expect(refund.refundSources).toEqual([
      { purchaseId: purchase.id, amountMinor: 50 * CREDIT_MINOR, moneyMinor: 50 * CREDIT_MINOR },
    ]);

    const w = await prisma.wallet.findUnique({ where: { id: wallet.id } });
    expect(w!.balanceMinor).toBe(150 * CREDIT_MINOR);
    const updatedPurchase = await prisma.walletTransaction.findUnique({
      where: { id: purchase.id },
    });
    expect(updatedPurchase.refundReservedMinor).toBe(50 * CREDIT_MINOR);
  });

  it('allocates across multiple purchases, oldest first, when one alone is not enough', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const older = prisma.__seedPurchase(USER, wallet.id as string, {
      amountMinor: 30 * CREDIT_MINOR,
      createdAt: new Date(1000),
    });
    const newer = prisma.__seedPurchase(USER, wallet.id as string, {
      amountMinor: 100 * CREDIT_MINOR,
      createdAt: new Date(2000),
    });

    await service.requestRefund(USER, 50); // 30 from `older` (fully) + 20 from `newer` (partial)

    const refund = refundRows(prisma)[0];
    expect(refund.refundSources).toEqual([
      { purchaseId: older.id, amountMinor: 30 * CREDIT_MINOR, moneyMinor: 30 * CREDIT_MINOR },
      { purchaseId: newer.id, amountMinor: 20 * CREDIT_MINOR, moneyMinor: 20 * CREDIT_MINOR },
    ]);
  });

  it('rejects a refund larger than the current wallet balance', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    prisma.__seedPurchase(USER, wallet.id as string, { amountMinor: 100 * CREDIT_MINOR });
    // balance was never incremented — stays 0

    await expect(service.requestRefund(USER, 10)).rejects.toThrow(
      /insufficient_balance_for_refund/,
    );
  });

  it('rejects when the balance is real but not backed by any refundable Stripe purchase', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 50 * CREDIT_MINOR } },
    });
    // Only a stub-dev purchase backs this balance — nothing refundable.
    prisma.__seedPurchase(USER, wallet.id as string, {
      provider: 'stub-dev',
      providerRef: 'dev-123',
      amountMinor: 50 * CREDIT_MINOR,
    });

    await expect(service.requestRefund(USER, 20)).rejects.toThrow(
      /insufficient_refundable_purchases/,
    );
  });

  it('only draws from a purchase up to its own remaining (unreserved) capacity', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string, {
      amountMinor: 100 * CREDIT_MINOR,
    });
    await service.requestRefund(USER, 80); // reserves 80 of 100
    await expect(service.requestRefund(USER, 30)).rejects.toThrow(
      /insufficient_refundable_purchases/, // only 20 left on the one eligible purchase
    );
    const updated = await prisma.walletTransaction.findUnique({ where: { id: purchase.id } });
    expect(updated.refundReservedMinor).toBe(80 * CREDIT_MINOR);
  });

  it('cancelRefund releases every source reservation and restores the balance', async () => {
    const { service, prisma } = makeService({ refundFeePct: 5 });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const older = prisma.__seedPurchase(USER, wallet.id as string, {
      amountMinor: 30 * CREDIT_MINOR,
      createdAt: new Date(1000),
    });
    const newer = prisma.__seedPurchase(USER, wallet.id as string, {
      amountMinor: 100 * CREDIT_MINOR,
      createdAt: new Date(2000),
    });
    await service.requestRefund(USER, 50);
    const refund = refundRows(prisma)[0];

    await service.cancelRefund(USER, refund.id as string);

    expect(refund.status).toBe('canceled');
    const w = await prisma.wallet.findUnique({ where: { id: wallet.id } });
    expect(w!.balanceMinor).toBe(200 * CREDIT_MINOR);
    expect(
      (await prisma.walletTransaction.findUnique({ where: { id: older.id } })).refundReservedMinor,
    ).toBe(0);
    expect(
      (await prisma.walletTransaction.findUnique({ where: { id: newer.id } })).refundReservedMinor,
    ).toBe(0);
  });

  it('rejects canceling a refund whose hold has already elapsed', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 100 * CREDIT_MINOR } },
    });
    prisma.__seedPurchase(USER, wallet.id as string);
    await service.requestRefund(USER, 50);
    const refund = refundRows(prisma)[0];
    refund.processAt = new Date(Date.now() - 1000);

    await expect(service.cancelRefund(USER, refund.id as string)).rejects.toThrow(
      /refund_hold_expired/,
    );
  });

  it('sweep executes a due refund via Stripe, splitting across sources and withholding the fee from the first', async () => {
    const { service, prisma, stripe } = makeService({ refundFeePct: 10 });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const older = prisma.__seedPurchase(USER, wallet.id as string, {
      amountMinor: 30 * CREDIT_MINOR,
      providerRef: 'pi_older',
      createdAt: new Date(1000),
    });
    const newer = prisma.__seedPurchase(USER, wallet.id as string, {
      amountMinor: 100 * CREDIT_MINOR,
      providerRef: 'pi_newer',
      createdAt: new Date(2000),
    });
    await service.requestRefund(USER, 50); // fee = 5cr; sources: older 30, newer 20
    const refund = refundRows(prisma)[0];
    refund.processAt = new Date(Date.now() - 1000);

    await (service as any).sweepDueRefunds();

    expect(stripe.createRefund).toHaveBeenNthCalledWith(1, {
      paymentIntentId: 'pi_older',
      amountMinor: 25 * CREDIT_MINOR, // 30 - 5 fee withheld here first
    });
    expect(stripe.createRefund).toHaveBeenNthCalledWith(2, {
      paymentIntentId: 'pi_newer',
      amountMinor: 20 * CREDIT_MINOR, // fee already fully consumed by the first source
    });
    expect(refund.status).toBe('completed');
    void older;
    void newer;
  });

  it('sweep completes a due refund with the dev fallback when Stripe is not configured', async () => {
    const { service, prisma, stripe } = makeService({ stripeConfigured: false });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 100 * CREDIT_MINOR } },
    });
    prisma.__seedPurchase(USER, wallet.id as string);
    await service.requestRefund(USER, 40);
    const refund = refundRows(prisma)[0];
    refund.processAt = new Date(Date.now() - 1000);

    await (service as any).sweepDueRefunds();

    expect(stripe.createRefund).not.toHaveBeenCalled();
    expect(refund.status).toBe('completed');
    expect(String(refund.providerRef)).toMatch(/^dev-refund-/);
  });

  it('a failed Stripe refund releases every reservation instead of losing the credits', async () => {
    const { service, prisma, stripe } = makeService();
    stripe.createRefund.mockRejectedValueOnce(new Error('charge_already_refunded'));
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 100 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string);
    await service.requestRefund(USER, 40);
    const refund = refundRows(prisma)[0];
    refund.processAt = new Date(Date.now() - 1000);
    const balanceBeforeSweep = (await prisma.wallet.findUnique({ where: { id: wallet.id } }))!
      .balanceMinor as number;

    await (service as any).sweepDueRefunds();

    expect(refund.status).toBe('failed');
    const w = await prisma.wallet.findUnique({ where: { id: wallet.id } });
    expect(w!.balanceMinor).toBe(balanceBeforeSweep + 40 * CREDIT_MINOR);
    expect(
      (await prisma.walletTransaction.findUnique({ where: { id: purchase.id } }))
        .refundReservedMinor,
    ).toBe(0);
  });

  it('getSummary reports a refundable ceiling capped by both balance and real charge capacity', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 60 * CREDIT_MINOR } },
    });
    // Only 40 of the 60-credit balance traces back to a real Stripe charge.
    prisma.__seedPurchase(USER, wallet.id as string, { amountMinor: 40 * CREDIT_MINOR });

    const summary = await service.getSummary(USER);
    expect(summary.refundable.credits).toBe(40);
  });

  // --- discount interaction ------------------------------------------
  // A purchase made while a credits discount was active credits the wallet
  // the FULL face value but only actually charged a fraction of it via
  // Stripe (`eurCents < amountMinor`). Refunding the full credit amount must
  // never ask Stripe to refund more than it was actually paid.

  it('refunds a discounted purchase proportionally — real money, not credit face value', async () => {
    const { service, prisma, stripe } = makeService({ refundFeePct: 0 });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 100 * CREDIT_MINOR } },
    });
    // 100 credits credited, but a 20% discount meant only 80 credits'
    // worth of real EUR was ever charged.
    const purchase = prisma.__seedPurchase(USER, wallet.id as string, {
      amountMinor: 100 * CREDIT_MINOR,
      eurCents: 80 * CREDIT_MINOR,
      providerRef: 'pi_discounted',
    });

    await service.requestRefund(USER, 100);
    const refund = refundRows(prisma)[0];
    expect(refund.refundSources).toEqual([
      { purchaseId: purchase.id, amountMinor: 100 * CREDIT_MINOR, moneyMinor: 80 * CREDIT_MINOR },
    ]);

    refund.processAt = new Date(Date.now() - 1000);
    await (service as any).sweepDueRefunds();

    // The wallet gave up the full 100 credits, but Stripe is only ever
    // asked for the 80 it actually holds — never the credit face value.
    expect(stripe.createRefund).toHaveBeenCalledWith({
      paymentIntentId: 'pi_discounted',
      amountMinor: 80 * CREDIT_MINOR,
    });
    expect(refund.status).toBe('completed');
    const w = await prisma.wallet.findUnique({ where: { id: wallet.id } });
    expect(w!.balanceMinor).toBe(0);
  });

  it('withholds the refund fee from the real money, not the discounted credit face value', async () => {
    const { service, prisma, stripe } = makeService({ refundFeePct: 10 });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 100 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string, {
      amountMinor: 100 * CREDIT_MINOR,
      eurCents: 50 * CREDIT_MINOR, // 50% discount at purchase time
      providerRef: 'pi_half_off',
    });

    await service.requestRefund(USER, 100);
    const refund = refundRows(prisma)[0];
    // 10% of the 50-credit real charge, NOT of the 100-credit face value.
    expect(refund.feeMinor).toBe(5 * CREDIT_MINOR);

    refund.processAt = new Date(Date.now() - 1000);
    await (service as any).sweepDueRefunds();

    expect(stripe.createRefund).toHaveBeenCalledWith({
      paymentIntentId: 'pi_half_off',
      amountMinor: 45 * CREDIT_MINOR, // 50 real money - 5 fee
    });
    void purchase;
  });

  it('allocates real money proportionally across a mix of discounted and full-price purchases', async () => {
    const { service, prisma, stripe } = makeService({ refundFeePct: 0 });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 150 * CREDIT_MINOR } },
    });
    const discounted = prisma.__seedPurchase(USER, wallet.id as string, {
      amountMinor: 50 * CREDIT_MINOR,
      eurCents: 25 * CREDIT_MINOR, // 50% off
      providerRef: 'pi_a',
      createdAt: new Date(1000),
    });
    const fullPrice = prisma.__seedPurchase(USER, wallet.id as string, {
      amountMinor: 100 * CREDIT_MINOR,
      eurCents: 100 * CREDIT_MINOR, // no discount
      providerRef: 'pi_b',
      createdAt: new Date(2000),
    });

    await service.requestRefund(USER, 150); // all of both
    const refund = refundRows(prisma)[0];
    expect(refund.refundSources).toEqual([
      { purchaseId: discounted.id, amountMinor: 50 * CREDIT_MINOR, moneyMinor: 25 * CREDIT_MINOR },
      { purchaseId: fullPrice.id, amountMinor: 100 * CREDIT_MINOR, moneyMinor: 100 * CREDIT_MINOR },
    ]);

    refund.processAt = new Date(Date.now() - 1000);
    await (service as any).sweepDueRefunds();

    expect(stripe.createRefund).toHaveBeenNthCalledWith(1, {
      paymentIntentId: 'pi_a',
      amountMinor: 25 * CREDIT_MINOR,
    });
    expect(stripe.createRefund).toHaveBeenNthCalledWith(2, {
      paymentIntentId: 'pi_b',
      amountMinor: 100 * CREDIT_MINOR,
    });
  });

  it('executes a pre-existing refund row with no moneyMinor (created before the discount feature) at full 1:1 value', async () => {
    const { service, prisma, stripe } = makeService({ refundFeePct: 0 });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 100 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string, { providerRef: 'pi_legacy' });
    const refund = prisma.__seedPurchase(USER, wallet.id as string, {
      type: 'refund',
      status: 'pending',
      amountMinor: -40 * CREDIT_MINOR,
      refundSources: [{ purchaseId: purchase.id, amountMinor: 40 * CREDIT_MINOR }], // no moneyMinor
      feeMinor: 0,
      processAt: new Date(Date.now() - 1000),
    });
    void refund;

    await (service as any).sweepDueRefunds();

    expect(stripe.createRefund).toHaveBeenCalledWith({
      paymentIntentId: 'pi_legacy',
      amountMinor: 40 * CREDIT_MINOR,
    });
  });

  it('still completes the refund request even if the notification subsystem throws', async () => {
    const { service, prisma, notifications } = makeService();
    notifications.notify.mockRejectedValueOnce(new Error('notification db hiccup'));
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 100 * CREDIT_MINOR } },
    });
    prisma.__seedPurchase(USER, wallet.id as string);

    // Must resolve (the refund hold is already committed) even though the
    // best-effort "refund requested" email failed — a notification hiccup
    // must never make an already-successful request look like it failed.
    const summary = await service.requestRefund(USER, 40);
    expect(summary.balance.credits).toBe(60);
    expect(refundRows(prisma)[0].status).toBe('pending');
  });
});
