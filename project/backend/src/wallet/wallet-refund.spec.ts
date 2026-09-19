import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CREDIT_MINOR } from './money';

/** A minimal in-memory Prisma double covering exactly the calls the refund
 *  flow makes (`wallet` + `walletTransaction`, plus a `$transaction` that
 *  just runs its callback against this same store — every refund code path
 *  validates BEFORE mutating, so no real rollback semantics are exercised). */
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
      findUnique: jest.fn(
        async ({ where, include }: { where: { id: string }; include?: { refundOf?: boolean } }) => {
          const t = txns.get(where.id);
          if (!t) return null;
          const result = cloneTxn(t);
          if (include?.refundOf && t.refundOfId) {
            result.refundOf = cloneTxn(txns.get(t.refundOfId as string)!);
          }
          return result;
        },
      ),
      findFirst: jest.fn(
        async ({ where }: { where: { refundOfId?: string; status?: { in: string[] } } }) => {
          for (const t of txns.values()) {
            if (where.refundOfId != null && t.refundOfId !== where.refundOfId) continue;
            if (where.status?.in && !where.status.in.includes(t.status as string)) continue;
            return cloneTxn(t);
          }
          return null;
        },
      ),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { type?: string; status?: string; processAt?: { lte: Date } };
        }) => {
          return [...txns.values()]
            .filter((t) => {
              if (where.type && t.type !== where.type) return false;
              if (where.status && t.status !== where.status) return false;
              if (where.processAt?.lte) {
                const p = t.processAt as Date | null;
                if (!p || p.getTime() > where.processAt.lte.getTime()) return false;
              }
              return true;
            })
            .map(cloneTxn);
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
          Object.assign(t, data);
          return cloneTxn(t);
        },
      ),
      aggregate: jest.fn(async () => ({ _sum: { amountMinor: 0, eurCents: 0 } })),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(client)),
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
        providerRef: 'pi_test_123',
        description: 'Buy 100 credits',
        refundOfId: null,
        feePct: null,
        feeMinor: null,
        processAt: null,
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
    createRefund: jest.fn(async () => ({ id: 're_test_1' })),
    createCheckoutSession: jest.fn(),
    retrieveCheckoutSession: jest.fn(),
  };
}
function fakeConfig() {
  return { get: jest.fn(() => 'http://localhost:5173') };
}

function makeService(opts: { refundFeePct?: number; stripeConfigured?: boolean } = {}) {
  const prisma = fakePrisma();
  const settings = fakeSettings(opts.refundFeePct);
  const billing = fakeBilling();
  const affiliate = fakeAffiliate();
  const stripe = fakeStripe(opts.stripeConfigured ?? true);
  const config = fakeConfig();

  const service = new WalletService(
    prisma as any,
    settings as any,
    billing as any,
    affiliate as any,
    stripe as any,
    config as any,
  );
  return { service, prisma, settings, stripe };
}

describe('WalletService refunds', () => {
  const USER = 'user-1';

  it('requestRefund holds the full purchase amount and snapshots the fee', async () => {
    const { service, prisma } = makeService({ refundFeePct: 5 });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string);

    await service.requestRefund(USER, purchase.id as string);

    const refund = [...prisma.__txns.values()].find((t) => t.type === 'refund')!;
    expect(refund.status).toBe('pending');
    expect(refund.amountMinor).toBe(-100 * CREDIT_MINOR);
    expect(refund.feePct).toBe(5);
    expect(refund.feeMinor).toBe(5 * CREDIT_MINOR);
    expect(refund.refundOfId).toBe(purchase.id);
    expect((refund.processAt as Date).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    const w = await prisma.wallet.findUnique({ where: { id: wallet.id } });
    expect(w!.balanceMinor).toBe(100 * CREDIT_MINOR); // 200 - 100 held
  });

  it('rejects a refund on a non-Stripe purchase', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string, {
      provider: 'stub-dev',
      providerRef: 'dev-123',
    });

    await expect(service.requestRefund(USER, purchase.id as string)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a second refund request on an already-refunded purchase', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string);

    await service.requestRefund(USER, purchase.id as string);
    await expect(service.requestRefund(USER, purchase.id as string)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a refund when the remaining balance cannot cover it', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    // Balance is 0 — the 100-credit purchase was already spent elsewhere.
    const purchase = prisma.__seedPurchase(USER, wallet.id as string);

    await expect(service.requestRefund(USER, purchase.id as string)).rejects.toThrow(
      /insufficient_balance_for_refund/,
    );
  });

  it('rejects requestRefund for an unknown transaction', async () => {
    const { service } = makeService();
    await expect(service.requestRefund(USER, 'does-not-exist')).rejects.toThrow(NotFoundException);
  });

  it('cancelRefund releases the hold and restores the balance', async () => {
    const { service, prisma } = makeService({ refundFeePct: 5 });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string);
    await service.requestRefund(USER, purchase.id as string);
    const refund = [...prisma.__txns.values()].find((t) => t.type === 'refund')!;

    await service.cancelRefund(USER, refund.id as string);

    expect(refund.status).toBe('canceled');
    const w = await prisma.wallet.findUnique({ where: { id: wallet.id } });
    expect(w!.balanceMinor).toBe(200 * CREDIT_MINOR); // fully restored
  });

  it('rejects canceling a refund whose hold has already elapsed', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string);
    await service.requestRefund(USER, purchase.id as string);
    const refund = [...prisma.__txns.values()].find((t) => t.type === 'refund')!;
    refund.processAt = new Date(Date.now() - 1000); // force-expire the window

    await expect(service.cancelRefund(USER, refund.id as string)).rejects.toThrow(
      /refund_hold_expired/,
    );
  });

  it('sweep executes a due refund via Stripe and records the refund id', async () => {
    const { service, prisma, stripe } = makeService({ refundFeePct: 10 });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string);
    await service.requestRefund(USER, purchase.id as string);
    const refund = [...prisma.__txns.values()].find((t) => t.type === 'refund')!;
    refund.processAt = new Date(Date.now() - 1000); // due

    // Private method — call it via the same sweep the interval would run.

    await (service as any).sweepDueRefunds();

    expect(stripe.createRefund).toHaveBeenCalledWith({
      paymentIntentId: 'pi_test_123',
      amountMinor: 90 * CREDIT_MINOR, // 100 - 10% fee
    });
    expect(refund.status).toBe('completed');
    expect(refund.providerRef).toBe('re_test_1');
  });

  it('sweep completes a due refund with the dev fallback when Stripe is not configured', async () => {
    const { service, prisma, stripe } = makeService({ stripeConfigured: false });
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string);
    await service.requestRefund(USER, purchase.id as string);
    const refund = [...prisma.__txns.values()].find((t) => t.type === 'refund')!;
    refund.processAt = new Date(Date.now() - 1000);

    await (service as any).sweepDueRefunds();

    expect(stripe.createRefund).not.toHaveBeenCalled();
    expect(refund.status).toBe('completed');
    expect(String(refund.providerRef)).toMatch(/^dev-refund-/);
  });

  it('a failed Stripe refund releases the hold instead of losing the credits', async () => {
    const { service, prisma, stripe } = makeService();
    stripe.createRefund.mockRejectedValueOnce(new Error('charge_already_refunded'));
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceMinor: { increment: 200 * CREDIT_MINOR } },
    });
    const purchase = prisma.__seedPurchase(USER, wallet.id as string);
    await service.requestRefund(USER, purchase.id as string);
    const refund = [...prisma.__txns.values()].find((t) => t.type === 'refund')!;
    refund.processAt = new Date(Date.now() - 1000);
    const balanceBeforeSweep = (await prisma.wallet.findUnique({ where: { id: wallet.id } }))!
      .balanceMinor as number;

    await (service as any).sweepDueRefunds();

    expect(refund.status).toBe('failed');
    const w = await prisma.wallet.findUnique({ where: { id: wallet.id } });
    expect(w!.balanceMinor).toBe(balanceBeforeSweep + 100 * CREDIT_MINOR); // hold released
  });
});
