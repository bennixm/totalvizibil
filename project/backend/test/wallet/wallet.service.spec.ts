import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WalletService } from 'src/wallet/wallet.service';

// ---------------------------------------------------------------------------
// Fakes — just enough of each collaborator for the admin-controls paths.
// ---------------------------------------------------------------------------

interface FakeWalletRow {
  id: string;
  userId: string;
  balanceMinor: number;
  currency: string;
  blockedAt: Date | null;
  blockedReason: string | null;
  lowBalanceNotifiedAt: Date | null;
}

function fakePrisma() {
  const wallets = new Map<string, FakeWalletRow>();
  const expenses: Record<string, unknown>[] = [];
  const txns: Record<string, unknown>[] = [];

  const walletFor = (userId: string): FakeWalletRow => {
    const existing = wallets.get(userId);
    if (existing) return existing;
    const row: FakeWalletRow = {
      id: `w-${userId}`,
      userId,
      balanceMinor: 0,
      currency: 'EUR',
      blockedAt: null,
      blockedReason: null,
      lowBalanceNotifiedAt: null,
    };
    wallets.set(userId, row);
    return row;
  };

  const prisma: any = {
    wallet: {
      upsert: jest.fn(async ({ where }: { where: { userId: string } }) => ({
        ...walletFor(where.userId),
      })),
      findUnique: jest.fn(async ({ where }: { where: { userId: string } }) => {
        const row = wallets.get(where.userId);
        return row ? { ...row } : null;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = [...wallets.values()].find((w) => w.id === where.id);
          if (!row) throw new Error(`no wallet ${where.id}`);
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && 'increment' in (v as object)) {
              (row as unknown as Record<string, number>)[k] += (
                v as { increment: number }
              ).increment;
            } else {
              (row as unknown as Record<string, unknown>)[k] = v;
            }
          }
          return { ...row };
        },
      ),
    },
    walletTransaction: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `t${txns.length + 1}`, ...data };
        txns.push(row);
        return row;
      }),
    },
    platformExpense: {
      upsert: jest.fn(
        async ({
          where,
          create,
        }: {
          where: { externalRef: string };
          create: Record<string, unknown>;
        }) => {
          const hit = expenses.find((e) => e.externalRef === where.externalRef);
          if (hit) return hit;
          const row = { id: `e${expenses.length + 1}`, ...create };
          expenses.push(row);
          return row;
        },
      ),
    },
    $queryRaw: jest.fn(async () => [{ balanceMinor: 0, before: 0 }]),
    // `tx` is this same object — every write above is already in-memory, so
    // there's nothing to isolate.
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      fn(prisma),
    ),
    __wallets: wallets,
    __expenses: expenses,
    __txns: txns,
    __seedWallet: (userId: string, overrides: Partial<FakeWalletRow> = {}) => {
      const row = walletFor(userId);
      Object.assign(row, overrides);
      return row;
    },
  };
  return prisma;
}

function fakeNotifications() {
  return { notify: jest.fn(async () => undefined), notifyAll: jest.fn(async () => 0) };
}

function fakeAudit() {
  return { log: jest.fn(async () => undefined) };
}

function fakeConfig() {
  return { get: jest.fn(() => 'http://localhost:5173') };
}

function fakeStripe() {
  return { configured: true, retrievePaymentIntentFee: jest.fn() };
}

function makeService() {
  const prisma = fakePrisma();
  const settings = { eurRonRate: jest.fn(async () => 5) };
  const stripe = fakeStripe();
  const notifications = fakeNotifications();
  const audit = fakeAudit();
  const service = new WalletService(
    prisma as any,
    settings as any,
    {} as any,
    {} as any,
    stripe as any,
    fakeConfig() as any,
    notifications as any,
    audit as any,
  );
  return { service, prisma, settings, stripe, notifications, audit };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletService admin controls', () => {
  describe('adjust — self-adjustment guard (E4)', () => {
    it('refuses an adjustment whose initiating staff member IS the wallet owner', async () => {
      const { service, prisma } = makeService();
      prisma.__seedWallet('u1');

      await expect(
        service.adjust('u1', 100, 'bonus', { initiatedByAdminId: 'u1' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.adjust('u1', 100, 'bonus', { initiatedByAdminId: 'u1' }),
      ).rejects.toThrow('cannot_adjust_own_wallet');
    });

    it('refuses before touching the ledger — no transaction, no wallet write', async () => {
      const { service, prisma } = makeService();
      prisma.__seedWallet('u1');

      await expect(
        service.adjust('u1', 100, 'bonus', { initiatedByAdminId: 'u1' }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it("refuses a self claw-back too, not just a self credit (the direction doesn't matter)", async () => {
      const { service, prisma } = makeService();
      prisma.__seedWallet('u1', { balanceMinor: 50_000 });

      await expect(
        service.adjust('u1', -100, 'oops', { initiatedByAdminId: 'u1' }),
      ).rejects.toThrow('cannot_adjust_own_wallet');
    });

    it('still allows adjusting SOMEONE ELSE and audit-logs it with the actor role snapshot', async () => {
      const { service, prisma, audit } = makeService();
      prisma.__seedWallet('u1');

      const result = await service.adjust('u1', 25, 'goodwill', {
        initiatedByAdminId: 'staff1',
        actorRoles: ['finance'],
      });

      expect(result).toEqual({ requestedCredits: 25, appliedCredits: 25 });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'staff1',
          actorRoles: ['finance'],
          action: 'wallet.adjust',
          targetType: 'wallet',
          targetId: 'u1',
          reason: 'goodwill',
        }),
      );
      const entry = (audit.log as jest.Mock).mock.calls[0][0];
      expect(entry.before).toEqual({ balanceMinor: 0 });
      expect(entry.after).toEqual({ balanceMinor: 2_500, appliedDeltaMinor: 2_500 });
    });

    it('does not audit-log an unattributed adjustment (an internal/system credit, not a staff action)', async () => {
      const { service, prisma, audit } = makeService();
      prisma.__seedWallet('u1');

      await service.adjust('u1', 10, 'referral reward');

      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('setBlocked — audit log', () => {
    it('records wallet.block with a before/after of the block state', async () => {
      const { service, prisma, audit } = makeService();
      prisma.__seedWallet('u1');
      // setBlocked returns the full wallet summary; not what's under test.
      jest.spyOn(service, 'getSummary').mockResolvedValue({} as any);

      await service.setBlocked('u1', true, 'chargeback risk', {
        id: 'staff1',
        roles: ['finance'],
      });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'staff1',
          actorRoles: ['finance'],
          action: 'wallet.block',
          targetType: 'wallet',
          targetId: 'w-u1',
          reason: 'chargeback risk',
        }),
      );
      const entry = (audit.log as jest.Mock).mock.calls[0][0];
      expect(entry.before).toEqual({ blockedAt: null, blockedReason: null });
      expect(entry.after.blockedAt).toBeInstanceOf(Date);
      expect(entry.after.blockedReason).toBe('chargeback risk');
    });

    it('records wallet.unblock as the reverse transition', async () => {
      const { service, prisma, audit } = makeService();
      const blockedAt = new Date('2026-01-01T00:00:00.000Z');
      prisma.__seedWallet('u1', { blockedAt, blockedReason: 'chargeback risk' });
      jest.spyOn(service, 'getSummary').mockResolvedValue({} as any);

      await service.setBlocked('u1', false, null, { id: 'staff1', roles: ['admin'] });

      const entry = (audit.log as jest.Mock).mock.calls[0][0];
      expect(entry.action).toBe('wallet.unblock');
      expect(entry.before).toEqual({ blockedAt, blockedReason: 'chargeback risk' });
      expect(entry.after).toEqual({ blockedAt: null, blockedReason: null });
    });

    it('skips the audit log when no actor is given (no staff member to attribute it to)', async () => {
      const { service, prisma, audit } = makeService();
      prisma.__seedWallet('u1');
      jest.spyOn(service, 'getSummary').mockResolvedValue({} as any);

      await service.setBlocked('u1', true, 'reason');

      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('cancelRefund — actor wiring', () => {
    it('audit-logs refund.cancel when an admin cancels, with the role snapshot', async () => {
      const { service, prisma, audit } = makeService();
      prisma.__seedWallet('u1', { balanceMinor: 0 });
      const refund = {
        id: 'r1',
        walletId: 'w-u1',
        type: 'refund',
        status: 'pending',
        amountMinor: -5_000,
        processAt: new Date(Date.now() + 86_400_000),
        refundSources: [],
      };
      (prisma as any).walletTransaction.findUnique = jest.fn(async () => refund);
      (prisma as any).walletTransaction.update = jest.fn(async () => refund);
      jest.spyOn(service, 'getSummary').mockResolvedValue({} as any);

      await service.cancelRefund('u1', 'r1', 'staff1', ['finance']);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'staff1',
          actorRoles: ['finance'],
          action: 'refund.cancel',
          targetType: 'wallet_transaction',
          targetId: 'r1',
          after: { status: 'canceled', creditsReturnedMinor: 5_000 },
        }),
      );
    });

    it("writes no audit row when the CUSTOMER cancels their own refund — it's not a staff action", async () => {
      const { service, prisma, audit } = makeService();
      prisma.__seedWallet('u1');
      const refund = {
        id: 'r1',
        walletId: 'w-u1',
        type: 'refund',
        status: 'pending',
        amountMinor: -5_000,
        processAt: new Date(Date.now() + 86_400_000),
        refundSources: [],
      };
      (prisma as any).walletTransaction.findUnique = jest.fn(async () => refund);
      (prisma as any).walletTransaction.update = jest.fn(async () => refund);
      jest.spyOn(service, 'getSummary').mockResolvedValue({} as any);

      await service.cancelRefund('u1', 'r1');

      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // captureStripeFee is private: it's only ever reached as a fire-and-forget
  // tail of `confirmPurchase`, so driving it through that method would mean
  // standing up the entire Stripe-session + invoice-issuing happy path to
  // assert on one expense row. Called directly here instead.
  // -------------------------------------------------------------------------
  describe('captureStripeFee — B8 currency + B9 idempotency', () => {
    const capture = (service: WalletService, pi: string) =>
      (service as unknown as { captureStripeFee(id: string): Promise<void> }).captureStripeFee(pi);

    it("books the CONVERTED EUR-cents figure, never Stripe's raw settlement-currency fee", async () => {
      const { service, prisma, stripe } = makeService();
      stripe.retrievePaymentIntentFee.mockResolvedValue({
        nativeMinor: 500,
        nativeCurrency: 'ron',
        eurCentsMinor: 99,
        conversion: 'platform_eur_ron_rate',
      });

      await capture(service, 'pi_1');

      expect(prisma.__expenses).toHaveLength(1);
      expect(prisma.__expenses[0]).toMatchObject({
        category: 'stripe_fees',
        amountMinor: 99,
        currency: 'EUR',
        source: 'stripe_api',
        externalRef: 'stripe_fee:pi_1',
      });
      // The native amount is kept in the note so the conversion is auditable.
      expect(String(prisma.__expenses[0].note)).toContain('500 RON');
    });

    it('is idempotent: re-entering the same payment intent books exactly one expense', async () => {
      const { service, prisma, stripe } = makeService();
      stripe.retrievePaymentIntentFee.mockResolvedValue({
        nativeMinor: 137,
        nativeCurrency: 'eur',
        eurCentsMinor: 137,
        conversion: 'none',
      });

      await capture(service, 'pi_dup');
      await capture(service, 'pi_dup');
      await capture(service, 'pi_dup');

      expect(prisma.__expenses).toHaveLength(1);
      expect(prisma.platformExpense.upsert).toHaveBeenCalledTimes(3);
      // Keyed on the payment intent, so the DB (not a read-then-write race)
      // is what enforces the single row.
      for (const call of (prisma.platformExpense.upsert as jest.Mock).mock.calls) {
        expect(call[0].where).toEqual({ externalRef: 'stripe_fee:pi_dup' });
      }
    });

    it('never rewrites an already-captured amount (upsert update is a no-op)', async () => {
      const { service, prisma, stripe } = makeService();
      stripe.retrievePaymentIntentFee.mockResolvedValue({
        nativeMinor: 500,
        nativeCurrency: 'ron',
        eurCentsMinor: 99,
        conversion: 'platform_eur_ron_rate',
      });
      await capture(service, 'pi_1');

      // A later capture sees a different FX rate — the first write must win,
      // or a cost already in a closed reporting period would silently move.
      stripe.retrievePaymentIntentFee.mockResolvedValue({
        nativeMinor: 500,
        nativeCurrency: 'ron',
        eurCentsMinor: 123,
        conversion: 'platform_eur_ron_rate',
      });
      await capture(service, 'pi_1');

      expect(prisma.__expenses).toHaveLength(1);
      expect(prisma.__expenses[0].amountMinor).toBe(99);
      expect((prisma.platformExpense.upsert as jest.Mock).mock.calls[1][0].update).toEqual({});
    });

    it('swallows a unique-constraint violation from a concurrent first capture — that is the guard working', async () => {
      const { service, prisma, stripe } = makeService();
      stripe.retrievePaymentIntentFee.mockResolvedValue({
        nativeMinor: 137,
        nativeCurrency: 'eur',
        eurCentsMinor: 137,
        conversion: 'none',
      });
      (prisma.platformExpense.upsert as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(capture(service, 'pi_race')).resolves.toBeUndefined();
    });

    it('rethrows any other DB error so the caller can log it', async () => {
      const { service, prisma, stripe } = makeService();
      stripe.retrievePaymentIntentFee.mockResolvedValue({
        nativeMinor: 137,
        nativeCurrency: 'eur',
        eurCentsMinor: 137,
        conversion: 'none',
      });
      (prisma.platformExpense.upsert as jest.Mock).mockRejectedValue(new Error('connection lost'));

      await expect(capture(service, 'pi_boom')).rejects.toThrow('connection lost');
    });

    it('books nothing when the fee could not be expressed in EUR', async () => {
      const { service, prisma, stripe } = makeService();
      stripe.retrievePaymentIntentFee.mockResolvedValue(null);

      await capture(service, 'pi_unknown');

      expect(prisma.platformExpense.upsert).not.toHaveBeenCalled();
    });
  });
});
