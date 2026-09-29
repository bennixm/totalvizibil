import { WalletService } from './wallet.service';
import { CREDIT_MINOR } from './money';

/** Minimal in-memory Prisma double covering exactly what
 *  sweepStalePendingStubPurchases needs: a bulk `updateMany` filtered by
 *  type/status/provider/createdAt (no `id`, unlike the single-row
 *  conditional updates elsewhere in the service). */
function fakePrisma() {
  const txns = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const client: any = {
    walletTransaction: {
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            type?: string;
            status?: string;
            provider?: string;
            createdAt?: { lte: Date };
          };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const t of txns.values()) {
            if (where.type && t.type !== where.type) continue;
            if (where.status && t.status !== where.status) continue;
            if (where.provider && t.provider !== where.provider) continue;
            if (where.createdAt?.lte) {
              const created = t.createdAt as Date;
              if (created.getTime() > where.createdAt.lte.getTime()) continue;
            }
            Object.assign(t, data);
            count += 1;
          }
          return { count };
        },
      ),
    },
    __txns: txns,
    __seed(overrides: Partial<Record<string, unknown>> = {}) {
      const id = `txn_${++seq}`;
      const t = {
        id,
        type: 'purchase',
        status: 'pending',
        provider: 'stub-dev',
        description: 'Buy 10 credits',
        amountMinor: 10 * CREDIT_MINOR,
        createdAt: new Date(),
        ...overrides,
      };
      txns.set(id, t);
      return t;
    },
  };
  return client;
}

function makeService(prisma: ReturnType<typeof fakePrisma>) {
  const stripe = { configured: false };
  return new WalletService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    stripe as any,
    {} as any,
    {} as any,
  );
}

describe('WalletService.sweepStalePendingStubPurchases', () => {
  const STALE = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago > 2h threshold
  const FRESH = new Date(Date.now() - 5 * 60 * 1000); // 5min ago < 2h threshold

  it('cancels a stub purchase that has sat pending past the grace period', async () => {
    const prisma = fakePrisma();
    const stale = prisma.__seed({ createdAt: STALE });
    const service = makeService(prisma);

    await (service as any).sweepStalePendingStubPurchases();

    expect(stale.status).toBe('canceled');
    expect(stale.description).toMatch(/abandoned/i);
  });

  it('leaves a recently-created pending stub purchase alone', async () => {
    const prisma = fakePrisma();
    const fresh = prisma.__seed({ createdAt: FRESH });
    const service = makeService(prisma);

    await (service as any).sweepStalePendingStubPurchases();

    expect(fresh.status).toBe('pending');
  });

  it('never touches a stale Stripe purchase — that is sweepPendingStripePurchases’ job', async () => {
    const prisma = fakePrisma();
    const stripeTxn = prisma.__seed({ provider: 'stripe', createdAt: STALE });
    const service = makeService(prisma);

    await (service as any).sweepStalePendingStubPurchases();

    expect(stripeTxn.status).toBe('pending');
  });

  it('never touches a stale stub row that is already completed', async () => {
    const prisma = fakePrisma();
    const completed = prisma.__seed({ status: 'completed', createdAt: STALE });
    const service = makeService(prisma);

    await (service as any).sweepStalePendingStubPurchases();

    expect(completed.status).toBe('completed');
  });
});
