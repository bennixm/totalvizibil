import { NotificationsSweepService } from 'src/notifications/notifications-sweep.service';

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function fakeAnalytics() {
  return {
    feedRanksFor: jest.fn().mockResolvedValue([]),
    recommendedCpcFor: jest.fn().mockResolvedValue(null),
  };
}

function fakeCampaign(overrides = {}) {
  return {
    id: 'c1',
    status: 'depleted',
    dailyBudgetMinor: 10000,
    spendDay: new Date('2024-01-01'),
    depletedNotifiedForDay: null,
    positionAlertNotifiedAt: null,
    company: { id: 'co1', displayName: 'Acme', ownerUserId: 'u1' },
    ...overrides,
  };
}

function fakeWallet(overrides = {}) {
  return {
    id: 'w1',
    userId: 'u1',
    balanceMinor: 0,
    blockedAt: null,
    lowBalanceNotifiedAt: null,
    ...overrides,
  };
}

function fakePrisma() {
  return {
    campaign: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    wallet: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    lead: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

/** Finds a `NOT: { field: ... }` anywhere directly on a where-clause object —
 *  the regression shape this suite guards against: Prisma compiles a
 *  top-level `NOT` into a bare SQL negation with no null guard, so if `field`
 *  is nullable, `NOT (field = x)` silently excludes every row where it's
 *  NULL instead of including them. A null-safe filter must use
 *  `OR: [{ field: null }, { field: { not: x } }]` instead. */
function hasUnsafeNot(where: Record<string, unknown>): boolean {
  return 'NOT' in where;
}

describe('NotificationsSweepService', () => {
  describe('onModuleInit', () => {
    it('does not set timers when NODE_ENV=test', () => {
      const spy = jest.spyOn(global, 'setInterval');
      const svc = new NotificationsSweepService(
        fakePrisma() as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      svc.onModuleInit();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('sweepDepletedCampaigns', () => {
    it('notifies owner when updateMany claims the slot', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      prisma.campaign.findMany.mockResolvedValue([fakeCampaign()]);
      prisma.campaign.updateMany.mockResolvedValue({ count: 1 });

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepDepletedCampaigns();

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'campaign_depleted', userId: 'u1' }),
      );
    });

    it('regression: the candidate query and the claim are null-safe, not a bare NOT (this is the bug that made the notification never fire for anyone)', async () => {
      const prisma = fakePrisma();
      prisma.campaign.findMany.mockResolvedValue([fakeCampaign()]);
      prisma.campaign.updateMany.mockResolvedValue({ count: 1 });

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepDepletedCampaigns();

      const selectWhere = prisma.campaign.findMany.mock.calls[0][0].where;
      const claimWhere = prisma.campaign.updateMany.mock.calls[0][0].where;
      expect(hasUnsafeNot(selectWhere)).toBe(false);
      expect(hasUnsafeNot(claimWhere)).toBe(false);
      expect(selectWhere.OR).toEqual(
        expect.arrayContaining([expect.objectContaining({ depletedNotifiedForDay: null })]),
      );
      expect(claimWhere.OR).toEqual(
        expect.arrayContaining([expect.objectContaining({ depletedNotifiedForDay: null })]),
      );
    });

    it('skips notification when updateMany returns count=0 (race)', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      prisma.campaign.findMany.mockResolvedValue([fakeCampaign()]);
      prisma.campaign.updateMany.mockResolvedValue({ count: 0 });

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepDepletedCampaigns();

      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('sweepLowBalances', () => {
    it('returns early when no active campaigns', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      prisma.campaign.findMany.mockResolvedValue([]);

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepLowBalances();

      expect(prisma.wallet.findMany).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('notifies when balance below needed and no cooldown', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      prisma.campaign.findMany.mockResolvedValue([
        { dailyBudgetMinor: 5000, company: { ownerUserId: 'u1' } },
      ]);
      prisma.wallet.findMany.mockResolvedValue([
        fakeWallet({ balanceMinor: 100, lowBalanceNotifiedAt: null }),
      ]);
      prisma.wallet.updateMany.mockResolvedValue({ count: 1 });

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepLowBalances();

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'wallet_low_balance' }),
      );
    });

    it('skips when cooldown is still active', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      prisma.campaign.findMany.mockResolvedValue([
        { dailyBudgetMinor: 5000, company: { ownerUserId: 'u1' } },
      ]);
      prisma.wallet.findMany.mockResolvedValue([
        fakeWallet({ balanceMinor: 100, lowBalanceNotifiedAt: new Date() }),
      ]);

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepLowBalances();

      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('sweepFeedPositionUpgrades', () => {
    it('returns early when no active campaigns', async () => {
      const prisma = fakePrisma();
      const analytics = fakeAnalytics();
      prisma.campaign.findMany.mockResolvedValue([]);

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        analytics as any,
      );
      await (svc as any).sweepFeedPositionUpgrades();

      expect(analytics.feedRanksFor).not.toHaveBeenCalled();
    });

    it('skips when all positions are 1', async () => {
      const prisma = fakePrisma();
      const analytics = fakeAnalytics();
      const notifications = fakeNotifications();
      prisma.campaign.findMany.mockResolvedValue([fakeCampaign({ status: 'active' })]);
      analytics.feedRanksFor.mockResolvedValue([{ position: 1, feedId: 'f1' }]);

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        analytics as any,
      );
      await (svc as any).sweepFeedPositionUpgrades();

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('notifies when position > 1 and CPC available', async () => {
      const prisma = fakePrisma();
      const analytics = fakeAnalytics();
      const notifications = fakeNotifications();
      prisma.campaign.findMany.mockResolvedValue([
        fakeCampaign({ status: 'active', positionAlertNotifiedAt: null }),
      ]);
      analytics.feedRanksFor.mockResolvedValue([{ position: 2, feedId: 'f1' }]);
      analytics.recommendedCpcFor.mockResolvedValue({ cpcMinor: 200 });
      prisma.campaign.updateMany.mockResolvedValue({ count: 1 });

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        analytics as any,
      );
      await (svc as any).sweepFeedPositionUpgrades();

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'campaign_position_upgrade' }),
      );
    });
  });

  describe('sweepStaleLeads', () => {
    it('sends one digest per company, not one per lead', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      prisma.lead.findMany.mockResolvedValue([
        { id: 'l1', companyId: 'co1', company: { displayName: 'Acme', ownerUserId: 'u1' } },
        { id: 'l2', companyId: 'co1', company: { displayName: 'Acme', ownerUserId: 'u1' } },
      ]);
      prisma.lead.updateMany.mockResolvedValue({ count: 2 });

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleLeads();

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'leads_stale', userId: 'u1' }),
      );
    });

    it('skips a company whose claim lost the race (count=0)', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      prisma.lead.findMany.mockResolvedValue([
        { id: 'l1', companyId: 'co1', company: { displayName: 'Acme', ownerUserId: 'u1' } },
      ]);
      prisma.lead.updateMany.mockResolvedValue({ count: 0 });

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleLeads();

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('is null-safe on staleNotifiedAt, same as the depleted-campaign fix', async () => {
      const prisma = fakePrisma();
      prisma.lead.findMany.mockResolvedValue([
        { id: 'l1', companyId: 'co1', company: { displayName: 'Acme', ownerUserId: 'u1' } },
      ]);
      prisma.lead.updateMany.mockResolvedValue({ count: 1 });

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleLeads();

      const selectWhere = prisma.lead.findMany.mock.calls[0][0].where;
      const claimWhere = prisma.lead.updateMany.mock.calls[0][0].where;
      expect(hasUnsafeNot(selectWhere)).toBe(false);
      expect(hasUnsafeNot(claimWhere)).toBe(false);
    });
  });

  describe('sweep() re-entrancy guard', () => {
    it('a tick already in flight skips a concurrent call instead of stacking', async () => {
      const prisma = fakePrisma();
      // Only the FIRST call hangs (simulating a sweep that's still running);
      // every later call (sweepLowBalances/sweepFeedPositionUpgrades/
      // sweepStaleLeads also query `campaign.findMany`, inside the SAME
      // `first` sweep once this unblocks) falls through to the default
      // resolved-`[]` mock — otherwise each of those would hang too and the
      // test would never reach `await first`.
      let release!: () => void;
      prisma.campaign.findMany.mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve([]))),
      );

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      const first = (svc as any).sweep();
      const second = (svc as any).sweep(); // must return immediately, not queue behind `first`

      await Promise.race([second, new Promise((r) => setTimeout(r, 50))]);
      // `findMany` called only once so far — the second call was skipped
      // entirely rather than waiting to run after the first finishes.
      expect(prisma.campaign.findMany).toHaveBeenCalledTimes(1);

      release();
      await first;
    });
  });
});
