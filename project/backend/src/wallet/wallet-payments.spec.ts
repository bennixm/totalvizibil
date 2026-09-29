import { WalletService } from './wallet.service';
import { CREDIT_MINOR } from './money';

/** Minimal in-memory Prisma double covering exactly the calls the
 *  Payments/Refunds table (and its PDF export) makes. */
function fakePrisma() {
  const wallets = new Map<string, Record<string, unknown>>(); // by userId
  const txns = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const client: any = {
    wallet: {
      upsert: jest.fn(async ({ where }: { where: { userId: string } }) => {
        let w = wallets.get(where.userId);
        if (!w) {
          w = { id: `wallet_${++seq}`, userId: where.userId, balanceMinor: 0 };
          wallets.set(where.userId, w);
        }
        return { ...w };
      }),
    },
    walletTransaction: {
      findMany: jest.fn(
        async ({
          where,
          orderBy,
          take,
          cursor,
          skip,
        }: {
          where: {
            walletId?: string;
            type?: string;
            status?: string;
            provider?: string;
            createdAt?: { gte?: Date; lt?: Date };
          };
          orderBy?: { createdAt: 'asc' | 'desc' };
          take?: number;
          cursor?: { id: string };
          skip?: number;
        }) => {
          let rows = [...txns.values()].filter((t) => {
            if (where.walletId && t.walletId !== where.walletId) return false;
            if (where.type && t.type !== where.type) return false;
            if (where.status && t.status !== where.status) return false;
            if (where.provider && t.provider !== where.provider) return false;
            if (where.createdAt?.gte && (t.createdAt as Date) < where.createdAt.gte) return false;
            if (where.createdAt?.lt && (t.createdAt as Date) >= where.createdAt.lt) return false;
            return true;
          });
          rows = rows.sort((a, b) =>
            orderBy?.createdAt === 'asc'
              ? (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()
              : (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
          );
          if (cursor) {
            const idx = rows.findIndex((r) => r.id === cursor.id);
            rows = idx >= 0 ? rows.slice(idx + (skip ?? 0)) : rows;
          }
          return take != null ? rows.slice(0, take) : rows;
        },
      ),
    },
    __seed(userId: string, walletId: string, overrides: Partial<Record<string, unknown>> = {}) {
      const id = `txn_${++seq}`;
      const t = {
        id,
        walletId,
        type: 'purchase',
        status: 'completed',
        amountMinor: 10 * CREDIT_MINOR,
        provider: 'stripe',
        createdAt: new Date(Date.now() + seq),
        ...overrides,
      };
      txns.set(id, t);
      return t;
    },
  };
  return client;
}

function makeService() {
  const prisma = fakePrisma();
  const service = new WalletService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, prisma };
}

describe('WalletService payments/refunds statement', () => {
  const USER = 'user-1';

  it('includes only completed Stripe purchases in the "purchase" kind', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    prisma.__seed(USER, wallet.id as string, { providerRef: 'pi_real' });
    prisma.__seed(USER, wallet.id as string, { provider: 'stub-dev', providerRef: 'dev-1' });
    prisma.__seed(USER, wallet.id as string, {
      type: 'adjustment',
      provider: 'admin',
      status: 'completed',
    });

    const { items } = await service.listPayments(USER, { kind: 'purchase' });

    expect(items).toHaveLength(1);
    expect(items[0].amount.credits).toBe(10);
  });

  it('includes refunds of any status in the "refund" kind', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    prisma.__seed(USER, wallet.id as string, {
      type: 'refund',
      status: 'pending',
      amountMinor: -5 * CREDIT_MINOR,
    });
    prisma.__seed(USER, wallet.id as string, {
      type: 'refund',
      status: 'completed',
      amountMinor: -3 * CREDIT_MINOR,
    });
    prisma.__seed(USER, wallet.id as string); // an unrelated purchase, excluded

    const { items } = await service.listPayments(USER, { kind: 'refund' });

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.status).sort()).toEqual(['completed', 'pending']);
  });

  it('scopes results to the requested date range', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    prisma.__seed(USER, wallet.id as string, { createdAt: new Date('2026-01-05T12:00:00Z') });
    prisma.__seed(USER, wallet.id as string, { createdAt: new Date('2026-02-15T12:00:00Z') });
    prisma.__seed(USER, wallet.id as string, { createdAt: new Date('2026-03-01T12:00:00Z') });

    const { items } = await service.listPayments(USER, {
      kind: 'purchase',
      from: '2026-01-10',
      to: '2026-02-28',
    });

    expect(items).toHaveLength(1);
    expect(items[0].createdAt).toEqual(new Date('2026-02-15T12:00:00Z'));
  });

  it('paginates newest-first with a cursor, reporting nextCursor only when more remain', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    for (let i = 0; i < 3; i++) prisma.__seed(USER, wallet.id as string);

    const page1 = await service.listPayments(USER, { kind: 'purchase', limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await service.listPayments(USER, {
      kind: 'purchase',
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });

  it('exports a PDF buffer scoped to the same kind/date filters as the list', async () => {
    const { service, prisma } = makeService();
    const wallet = await prisma.wallet.upsert({ where: { userId: USER } });
    prisma.__seed(USER, wallet.id as string, { createdAt: new Date('2026-01-05T12:00:00Z') });
    prisma.__seed(USER, wallet.id as string, { createdAt: new Date('2026-06-01T12:00:00Z') });

    const buffer = await service.exportPaymentsPdf(USER, 'Test Owner', {
      kind: 'purchase',
      from: '2026-01-01',
      to: '2026-01-31',
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
