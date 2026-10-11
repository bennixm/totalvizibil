jest.mock('src/billing/invoice-pdf', () => ({
  generateInvoicePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));

import { Prisma } from '@prisma/client';
import { AffiliateService } from 'src/affiliate/affiliate.service';

// ─── Fakes ───────────────────────────────────────────────────────────────────

function fakePrisma() {
  const users = new Map<string, any>();
  const usersByCode = new Map<string, any>();
  const referrals = new Map<string, any>(); // key: referredUserId

  const fakeTx = {
    referral: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
    wallet: {
      upsert: jest.fn(async () => ({ id: 'wallet1', balanceMinor: 0 })),
      update: jest.fn(async () => ({ id: 'wallet1', balanceMinor: 5000 })),
    },
    walletTransaction: {
      create: jest.fn(async () => ({ id: 'txn1' })),
    },
  };

  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id !== undefined) return users.get(where.id) ?? null;
        if (where.referralCode !== undefined) return usersByCode.get(where.referralCode) ?? null;
        return null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = users.get(where.id) ?? {};
        const updated = { ...existing, ...data };
        users.set(where.id, updated);
        return updated;
      }),
    },
    referral: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'ref1',
        status: 'pending',
        rewardCredits: null,
        rewardedAt: null,
        rewardInvoiceId: null,
        createdAt: new Date(),
        ...data,
      })),
      findUnique: jest.fn(async ({ where }: any) => referrals.get(where.referredUserId) ?? null),
      findMany: jest.fn(async () => [...referrals.values()]),
    },
    campaign: {
      findFirst: jest.fn(async (): Promise<any> => null),
    },
    walletTransaction: {
      aggregate: jest.fn(async (): Promise<any> => ({ _sum: { amountMinor: 0 } })),
    },
    $transaction: jest.fn(async (cb: any) => cb(fakeTx)),
    __fakeTx: fakeTx,
    __seedUser: (overrides: Record<string, any> = {}) => {
      const u = {
        id: 'u1',
        name: 'Test User',
        email: 'test@example.com',
        referralCode: null as string | null,
        createdAt: new Date(),
        referralReceived: null as any,
        status: 'active',
        ...overrides,
      };
      users.set(u.id, u);
      if (u.referralCode) usersByCode.set(u.referralCode, u);
      return u;
    },
    __seedReferral: (overrides: Record<string, any> = {}) => {
      const r = {
        id: 'ref1',
        referrerId: 'referrer1',
        referredUserId: 'u2',
        status: 'pending' as 'pending' | 'rewarded',
        rewardCredits: null as number | null,
        rewardedAt: null as Date | null,
        rewardInvoiceId: null as string | null,
        createdAt: new Date(),
        ...overrides,
      };
      referrals.set(r.referredUserId, r);
      return r;
    },
  };
}

function fakeSettings(overrides: {
  affiliateEnabled?: boolean;
  affiliateRewardCredits?: number;
  affiliateMinDepositCredits?: number;
} = {}) {
  return {
    affiliateEnabled: jest.fn().mockResolvedValue(overrides.affiliateEnabled ?? true),
    affiliateRewardCredits: jest.fn().mockResolvedValue(overrides.affiliateRewardCredits ?? 50),
    affiliateMinDepositCredits: jest.fn().mockResolvedValue(overrides.affiliateMinDepositCredits ?? 100),
  };
}

function fakeBilling() {
  return {
    issueAffiliateRewardInvoice: jest.fn(async () => ({
      id: 'inv1',
      number: 'INV-001',
      userId: 'referrer1',
    })),
  };
}

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function fakeConfig() {
  return { get: jest.fn(() => 'http://localhost:5173') };
}

type SettingsOverrides = Parameters<typeof fakeSettings>[0];

function makeService(settingsOverrides: SettingsOverrides = {}) {
  const prisma = fakePrisma();
  const settings = fakeSettings(settingsOverrides);
  const billing = fakeBilling();
  const notifications = fakeNotifications();
  const config = fakeConfig();
  const svc = new AffiliateService(
    prisma as any,
    settings as any,
    billing as any,
    notifications as any,
    config as any,
  );
  return { svc, prisma, settings, billing, notifications, config };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AffiliateService', () => {
  describe('ensureCode', () => {
    it('returns existing code without calling user.update', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', referralCode: 'ABCD1234' });
      const code = await svc.ensureCode('u1');
      expect(code).toBe('ABCD1234');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('generates 8-char code and calls user.update when no code exists', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', referralCode: null });
      const code = await svc.ensureCode('u1');
      expect(code).toHaveLength(8);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { referralCode: code },
        }),
      );
    });
  });

  describe('claim', () => {
    it('returns { claimed: false } for self-referral', async () => {
      const { svc, prisma } = makeService();
      // same user owns the code — referrer.id === referredUserId
      prisma.__seedUser({
        id: 'u1',
        referralCode: 'CODE1234',
        createdAt: new Date(),
        referralReceived: null,
        status: 'active',
      });
      const result = await svc.claim('u1', 'CODE1234');
      expect(result).toEqual({ claimed: false });
    });

    it('returns { claimed: false } for account older than 24h', async () => {
      const { svc, prisma } = makeService();
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      prisma.__seedUser({ id: 'u1', createdAt: oldDate, referralCode: null, referralReceived: null });
      prisma.__seedUser({ id: 'referrer1', referralCode: 'CODE1234', status: 'active' });
      const result = await svc.claim('u1', 'CODE1234');
      expect(result).toEqual({ claimed: false });
    });

    it('returns { claimed: false } when no matching referral code', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', createdAt: new Date(), referralCode: null, referralReceived: null });
      const result = await svc.claim('u1', 'BADCODE1');
      expect(result).toEqual({ claimed: false });
    });

    it('happy path returns { claimed: true }', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', createdAt: new Date(), referralCode: null, referralReceived: null });
      prisma.__seedUser({ id: 'referrer1', referralCode: 'CODE1234', status: 'active' });
      const result = await svc.claim('u1', 'CODE1234');
      expect(result).toEqual({ claimed: true });
      expect(prisma.referral.create).toHaveBeenCalled();
    });

    it('returns { claimed: true } silently on P2002', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', createdAt: new Date(), referralCode: null, referralReceived: null });
      prisma.__seedUser({ id: 'referrer1', referralCode: 'CODE1234', status: 'active' });
      prisma.referral.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5',
        }),
      );
      const result = await svc.claim('u1', 'CODE1234');
      expect(result).toEqual({ claimed: true });
    });
  });

  describe('maybeReward', () => {
    it('returns early when no referral row', async () => {
      const { svc, prisma } = makeService();
      // no referral seeded — findUnique returns null
      await svc.maybeReward('u1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns early when referral is already rewarded', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedReferral({ referredUserId: 'u1', status: 'rewarded' });
      await svc.maybeReward('u1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns early when program is disabled', async () => {
      const { svc, prisma } = makeService({ affiliateEnabled: false });
      prisma.__seedReferral({ referredUserId: 'u1', status: 'pending' });
      await svc.maybeReward('u1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns early when deposit is below minimum', async () => {
      const { svc, prisma } = makeService();
      // default: affiliateEnabled=true, affiliateMinDepositCredits=100
      prisma.__seedReferral({ referredUserId: 'u1', status: 'pending' });
      prisma.campaign.findFirst.mockResolvedValue({ id: 'camp1' });
      // default walletTransaction.aggregate → { _sum: { amountMinor: 0 } } → 0 credits < 100
      await svc.maybeReward('u1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('credits wallet and issues notification on happy path', async () => {
      const { svc, prisma, billing, notifications } = makeService({
        affiliateMinDepositCredits: 100,
        affiliateRewardCredits: 50,
      });
      prisma.__seedReferral({ referredUserId: 'u1', referrerId: 'referrer1', status: 'pending' });
      prisma.__seedUser({ id: 'u1', name: 'Test User' });
      prisma.campaign.findFirst.mockResolvedValue({ id: 'camp1' });
      // 10000 minor = 100 credits >= 100 minimum
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amountMinor: 10000 } });

      await svc.maybeReward('u1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(billing.issueAffiliateRewardInvoice).toHaveBeenCalled();
      // notification is void fire-and-forget — wait one event-loop tick
      await new Promise((r) => setTimeout(r, 10));
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'referral_rewarded' }),
      );
    });
  });

  describe('myStats', () => {
    it('masks email — andrei@gmail.com → an•••@gmail.com', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', referralCode: 'CODE1234' });
      prisma.referral.findMany.mockResolvedValue([
        {
          id: 'ref1',
          status: 'pending',
          rewardCredits: null,
          rewardedAt: null,
          createdAt: new Date(),
          rewardInvoiceId: null,
          referredUser: { name: 'Andrei', email: 'andrei@gmail.com' },
        },
      ]);
      const stats = await svc.myStats('u1');
      expect(stats.items[0].emailMasked).toBe('an•••@gmail.com');
    });
  });
});
