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
  };
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
      prisma.campaign.findMany.mockResolvedValue([
        fakeCampaign({ status: 'active' }),
      ]);
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
});
