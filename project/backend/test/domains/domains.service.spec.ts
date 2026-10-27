import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DomainsService } from 'src/domains/domains.service';

/** No test coverage existed for this module before — this file is scoped to
 *  the one thing this session added (the purchase-receipt notification),
 *  not a retroactive full suite for the whole service. */

function fakePrisma() {
  const domains = new Map<string, any>();
  return {
    customDomain: {
      findUnique: jest.fn(async ({ where }: any) => domains.get(where.domain) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `d_${domains.size + 1}`, createdAt: new Date(), ...data };
        domains.set(row.domain, row);
        return row;
      }),
      findMany: jest.fn(async () => [...domains.values()]),
    },
  };
}

function fakeWallet() {
  return {
    ownerIdForCompany: jest.fn(async () => 'owner1'),
    spend: jest.fn(async () => ({ balanceMinor: 0, transactionId: 'txn1' })),
  };
}

function fakeSettings() {
  return { domainPurchaseFeeCredits: jest.fn(async () => 10) };
}

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function makeService() {
  const prisma = fakePrisma();
  const wallet = fakeWallet();
  const settings = fakeSettings();
  const notifications = fakeNotifications();
  const svc = new DomainsService(
    prisma as any,
    wallet as any,
    settings as any,
    notifications as any,
  );
  return { svc, prisma, wallet, settings, notifications };
}

describe('DomainsService', () => {
  describe('purchase', () => {
    it('throws ForbiddenException for a non-owner', async () => {
      const { svc, wallet } = makeService();
      wallet.ownerIdForCompany.mockResolvedValue('someone-else');
      await expect(svc.purchase('owner1', 'co1', 'example.ro')).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the domain is already registered', async () => {
      const { svc, prisma } = makeService();
      prisma.customDomain.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(svc.purchase('owner1', 'co1', 'example.ro')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('charges the wallet, records a pending row, and sends a purchase-receipt notification (the gap this session closed — real credits used to be spent with zero confirmation)', async () => {
      const { svc, wallet, notifications } = makeService();

      const result = await svc.purchase('owner1', 'co1', 'example.ro');

      expect(result.status).toBe('pending');
      expect(wallet.spend).toHaveBeenCalledWith(
        'owner1',
        expect.any(Number),
        expect.objectContaining({ companyId: 'co1' }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'owner1',
          type: 'domain_purchased',
          channels: { panel: true, email: true },
        }),
      );
    });

    it('does not create a row or notify when the domain is not available', async () => {
      const { svc, prisma, notifications } = makeService();
      (svc as any).registrar.checkAvailability = jest
        .fn()
        .mockResolvedValue({ available: false, domain: 'taken.ro', priceCreditsMinor: 1000 });

      await expect(svc.purchase('owner1', 'co1', 'taken.ro')).rejects.toThrow(BadRequestException);
      expect(prisma.customDomain.create).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });
});
