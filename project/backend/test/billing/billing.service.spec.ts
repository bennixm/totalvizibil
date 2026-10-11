import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingService } from 'src/billing/billing.service';
import { BillingProfileDto } from 'src/billing/dto/billing-profile.dto';

// ─── Fakes ───────────────────────────────────────────────────────────────────

function fakePrisma() {
  const profiles = new Map<string, any>();
  const invoices = new Map<string, any>();
  const counters = new Map<string, any>();

  // Shared transaction client — reads/writes the same Maps as the outer prisma.
  const fakeTx = {
    billingProfile: {
      findUnique: jest.fn(async ({ where }: any) => profiles.get(where.userId) ?? null),
    },
    invoiceCounter: {
      findUnique: jest.fn(async ({ where }: any) => counters.get(where.series) ?? null),
      upsert: jest.fn(async ({ where, create }: any) => {
        const row = { series: where.series, ...create };
        counters.set(where.series, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = counters.get(where.series) ?? { nextSeq: 1 };
        const nextSeq = existing.nextSeq + (data.nextSeq?.increment ?? 0);
        const updated = { ...existing, nextSeq };
        counters.set(where.series, updated);
        return updated;
      }),
    },
    invoice: {
      create: jest.fn(async ({ data }: any) => {
        const inv = {
          id: `inv-${Date.now()}-${Math.random()}`,
          issuedAt: new Date(),
          voidedAt: null,
          ...data,
        };
        invoices.set(inv.id, inv);
        return inv;
      }),
    },
  };

  return {
    billingProfile: {
      findUnique: jest.fn(async ({ where }: any) => profiles.get(where.userId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = profiles.get(where.userId);
        const rowData = existing ? update : create;
        const row = { id: `profile-${where.userId}`, userId: where.userId, ...rowData };
        profiles.set(where.userId, row);
        return row;
      }),
    },
    invoice: {
      findUnique: jest.fn(async ({ where }: any) => invoices.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = invoices.get(where.id);
        if (!existing) return null;
        const updated = { ...existing, ...data };
        invoices.set(where.id, updated);
        return updated;
      }),
      findMany: jest.fn(async () => [...invoices.values()]),
      create: jest.fn(async ({ data }: any) => {
        const inv = {
          id: `inv-${Date.now()}-${Math.random()}`,
          issuedAt: new Date(),
          voidedAt: null,
          ...data,
        };
        invoices.set(inv.id, inv);
        return inv;
      }),
    },
    wallet: {
      findUnique: jest.fn(async () => null),
    },
    walletTransaction: {
      findMany: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (cbOrArray: any) => {
      if (typeof cbOrArray === 'function') return cbOrArray(fakeTx);
      if (Array.isArray(cbOrArray)) return Promise.all(cbOrArray);
      return cbOrArray;
    }),
    // Exposed for direct use in issueInvoice tests.
    __fakeTx: fakeTx,
    __profiles: profiles,
    __invoices: invoices,
    __counters: counters,
    __seedProfile: (overrides: Record<string, any> = {}) => {
      const p = {
        id: 'profile-u1',
        userId: 'u1',
        kind: 'individual' as const,
        name: 'Ion Popescu',
        taxId: null as string | null,
        regCom: null as string | null,
        vatPayer: false,
        address: 'Str. Victoriei 1',
        city: 'Bucharest',
        county: null as string | null,
        postalCode: null as string | null,
        country: 'RO',
        billingEmail: null as string | null,
        iban: null as string | null,
        bankName: null as string | null,
        ...overrides,
      };
      profiles.set(p.userId, p);
      return p;
    },
    __seedInvoice: (overrides: Record<string, any> = {}) => {
      const inv = {
        id: 'inv-1',
        number: 'TVZ-2025-000001',
        userId: 'u1',
        voidedAt: null as Date | null,
        issuedAt: new Date(),
        ...overrides,
      };
      invoices.set(inv.id, inv);
      return inv;
    },
  };
}

function fakeSettings() {
  return {
    invoiceIssuer: jest.fn().mockResolvedValue({
      name: 'Totalvizibil SRL',
      taxId: 'RO12345678',
      regCom: 'J40/1234/2020',
      address: 'Str. Test 1',
      iban: 'RO49AAAA1B31007593840000',
      bank: 'Test Bank',
    }),
    invoiceVatRatePct: jest.fn().mockResolvedValue(19),
  };
}

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function makeService() {
  const prisma = fakePrisma();
  const settings = fakeSettings();
  const notifications = fakeNotifications();
  const svc = new BillingService(prisma as any, settings as any, notifications as any);
  return { svc, prisma, settings, notifications };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BillingService', () => {
  // ── upsertProfile ──────────────────────────────────────────────────────────

  describe('upsertProfile', () => {
    it('creates profile when absent', async () => {
      const { svc, prisma } = makeService();
      // No profile seeded — billingProfile.findUnique returns null.
      const dto = {
        kind: 'individual',
        name: 'Ion Popescu',
        address: 'Str. Victoriei 1',
        city: 'Bucharest',
        country: 'RO',
      } as BillingProfileDto;

      const result = await svc.upsertProfile('u1', dto);

      expect(result.profile.userId).toBe('u1');
      expect(result.profile.name).toBe('Ion Popescu');
      expect(result.isComplete).toBe(true);
      expect(prisma.billingProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
    });

    it('updates profile when present', async () => {
      const { svc, prisma } = makeService();
      // Seed an already-complete profile so backfill is not triggered.
      prisma.__seedProfile({ name: 'Old Name' });

      const dto = {
        kind: 'individual',
        name: 'New Name',
        address: 'Str. Victoriei 1',
        city: 'Bucharest',
        country: 'RO',
      } as BillingProfileDto;

      const result = await svc.upsertProfile('u1', dto);

      expect(result.profile.name).toBe('New Name');
      expect(result.isComplete).toBe(true);
      expect(prisma.billingProfile.upsert).toHaveBeenCalled();
    });
  });

  // ── issueInvoice ───────────────────────────────────────────────────────────

  describe('issueInvoice', () => {
    const baseParams = {
      userId: 'u1',
      walletTransactionId: 'txn-1',
      ronBani: 1190,
      eurCents: 100,
      fxRate: null,
      credits: 10,
    };

    it('throws BadRequestException when billing profile is missing', async () => {
      const { svc, prisma } = makeService();
      // No profile seeded — tx.billingProfile.findUnique returns null.

      await expect(svc.issueInvoice(prisma.__fakeTx as any, baseParams)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when billing profile is incomplete', async () => {
      const { svc, prisma } = makeService();
      // Seed profile with missing address so isProfileComplete returns false.
      prisma.__seedProfile({ name: 'Ion Popescu', address: '', city: 'Bucharest', country: 'RO' });

      await expect(svc.issueInvoice(prisma.__fakeTx as any, baseParams)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('happy path creates invoice row with TVZ series and numeric sequence', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedProfile({
        name: 'Ion Popescu',
        address: 'Str. Victoriei 1',
        city: 'Bucharest',
        country: 'RO',
      });

      const invoice = await svc.issueInvoice(prisma.__fakeTx as any, baseParams);

      expect(invoice.number).toMatch(/^TVZ-\d{4}-\d{6}$/);
      expect(invoice.userId).toBe('u1');
      expect(prisma.__fakeTx.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            number: expect.stringMatching(/^TVZ-/),
            userId: 'u1',
            walletTransactionId: 'txn-1',
            totalMinor: 1190,
          }),
        }),
      );
    });
  });

  // ── voidInvoice ────────────────────────────────────────────────────────────

  describe('voidInvoice', () => {
    it('throws NotFoundException when invoice does not exist', async () => {
      const { svc } = makeService();

      await expect(svc.voidInvoice('nonexistent-id', 'reason')).rejects.toThrow(NotFoundException);
    });

    it('returns existing invoice without calling update when already voided', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedInvoice({ id: 'inv-1', voidedAt: new Date() });

      const result = await svc.voidInvoice('inv-1', 'reason');

      expect(prisma.invoice.update).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('happy path sets voidedAt and voidReason', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedInvoice({ id: 'inv-1', number: 'TVZ-2025-000001', voidedAt: null });

      await svc.voidInvoice('inv-1', 'test reason');

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: expect.objectContaining({ voidReason: 'test reason' }),
        }),
      );
      const updateArg = (prisma.invoice.update as jest.Mock).mock.calls[0][0];
      expect(updateArg.data.voidedAt).toBeInstanceOf(Date);
    });
  });
});
