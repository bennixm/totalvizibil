import { NotificationsSweepService } from 'src/notifications/notifications-sweep.service';

function fakeNotifications() {
  return {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyAll: jest.fn().mockResolvedValue(0),
  };
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

function fakeTicket(overrides = {}) {
  return {
    id: 't1',
    number: 1042,
    subject: 'Nu pot publica site-ul',
    assigneeId: 'staff1',
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
      groupBy: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    company: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    supportTicket: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    platformRoleAssignment: {
      findMany: jest.fn().mockResolvedValue([]),
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

    it('S5: chunks the wallet `in` list at 1000 — unchunked this was a hard Postgres bind-param failure past ~65k owners, silently swallowed by the sub-sweep catch', async () => {
      const prisma = fakePrisma();
      prisma.campaign.findMany.mockResolvedValue(
        Array.from({ length: 2_500 }, (_, i) => ({
          dailyBudgetMinor: 5000,
          company: { ownerUserId: `u${i}` },
        })),
      );
      prisma.wallet.findMany.mockResolvedValue([]);

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepLowBalances();

      expect(prisma.wallet.findMany).toHaveBeenCalledTimes(3);
      for (const [{ where }] of prisma.wallet.findMany.mock.calls) {
        expect(where.userId.in.length).toBeLessThanOrEqual(1_000);
      }
    });

    it('S5: asks for an explicit column set rather than whole wallet rows', async () => {
      const prisma = fakePrisma();
      prisma.campaign.findMany.mockResolvedValue([
        { dailyBudgetMinor: 5000, company: { ownerUserId: 'u1' } },
      ]);

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepLowBalances();

      expect(prisma.wallet.findMany.mock.calls[0][0].select).toEqual(
        expect.objectContaining({ id: true, userId: true, balanceMinor: true }),
      );
    });

    it('accumulates wallets across chunks instead of only seeing the last one', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      prisma.campaign.findMany.mockResolvedValue(
        Array.from({ length: 1_200 }, (_, i) => ({
          dailyBudgetMinor: 5000,
          company: { ownerUserId: `u${i}` },
        })),
      );
      // One underfunded wallet in each of the two chunks.
      prisma.wallet.findMany
        .mockResolvedValueOnce([fakeWallet({ id: 'w1', userId: 'u1', balanceMinor: 1 })])
        .mockResolvedValueOnce([fakeWallet({ id: 'w2', userId: 'u1100', balanceMinor: 1 })]);

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepLowBalances();

      expect(notifications.notify).toHaveBeenCalledTimes(2);
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
    /** Wires the groupBy + company-lookup pair the sweep now runs instead of
     *  loading every stale lead row into memory. */
    function seedStaleLeads(
      prisma: ReturnType<typeof fakePrisma>,
      groups: { companyId: string; _count: number }[],
      companies = [{ id: 'co1', displayName: 'Acme', ownerUserId: 'u1' }],
    ) {
      prisma.lead.groupBy.mockResolvedValue(groups as any);
      prisma.company.findMany.mockResolvedValue(companies as any);
    }

    it('sends one digest per company, not one per lead', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      seedStaleLeads(prisma, [{ companyId: 'co1', _count: 2 }]);
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

    it('S6: counts per company via groupBy — never loads the lead rows themselves', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      seedStaleLeads(prisma, [{ companyId: 'co1', _count: 7 }]);

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleLeads();

      // The old shape was `lead.findMany` + a hand-rolled JS counter over
      // every row of the highest-growth table in the schema.
      expect(prisma.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['companyId'], _count: true }),
      );
      expect(prisma.lead.findMany).not.toHaveBeenCalled();
      // The count reaching the digest is groupBy's, not a length.
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining('7') }),
      );
    });

    it('S6: the groupBy filter is the one the new (status, createdAt) index covers', async () => {
      const prisma = fakePrisma();
      seedStaleLeads(prisma, [{ companyId: 'co1', _count: 1 }]);

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleLeads();

      const where = prisma.lead.groupBy.mock.calls[0][0].where;
      expect(where.status).toBe('new');
      expect(where.createdAt.lt).toBeInstanceOf(Date);
    });

    it('chunks the company lookup so the `in` list cannot blow the bind-param cap', async () => {
      const prisma = fakePrisma();
      const groups = Array.from({ length: 2_500 }, (_, i) => ({
        companyId: `co${i}`,
        _count: 1,
      }));
      // No company rows come back ⇒ nothing to notify, but the chunking of
      // the lookup itself is what's under test.
      seedStaleLeads(prisma, groups, []);

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleLeads();

      expect(prisma.company.findMany).toHaveBeenCalledTimes(3);
      for (const [{ where }] of prisma.company.findMany.mock.calls) {
        expect(where.id.in.length).toBeLessThanOrEqual(1_000);
      }
    });

    it('skips a company whose claim lost the race (count=0)', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      seedStaleLeads(prisma, [{ companyId: 'co1', _count: 1 }]);
      prisma.lead.updateMany.mockResolvedValue({ count: 0 });

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleLeads();

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('one company throwing does not abort the rest of the digest batch', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      seedStaleLeads(
        prisma,
        [
          { companyId: 'co1', _count: 1 },
          { companyId: 'co2', _count: 1 },
        ],
        [
          { id: 'co1', displayName: 'Acme', ownerUserId: 'u1' },
          { id: 'co2', displayName: 'Beta', ownerUserId: 'u2' },
        ],
      );
      prisma.lead.updateMany
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue({ count: 1 });

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleLeads();

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2' }));
    });

    it('is null-safe on staleNotifiedAt, same as the depleted-campaign fix', async () => {
      const prisma = fakePrisma();
      seedStaleLeads(prisma, [{ companyId: 'co1', _count: 1 }]);
      prisma.lead.updateMany.mockResolvedValue({ count: 1 });

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleLeads();

      const selectWhere = prisma.lead.groupBy.mock.calls[0][0].where;
      const claimWhere = prisma.lead.updateMany.mock.calls[0][0].where;
      expect(hasUnsafeNot(selectWhere)).toBe(false);
      expect(hasUnsafeNot(claimWhere)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // N6 — the unanswered-support-ticket escalation. Nothing swept SupportTicket
  // at all before this; `firstResponseAt` was written on every first staff
  // reply and read by nothing.
  // -------------------------------------------------------------------------
  describe('sweepStaleTickets', () => {
    /** Leg 1 (assignee nudge) returns `stale`; leg 2 (admin escalation)
     *  returns `unanswered`. Both come from `supportTicket.findMany`, in that
     *  order. */
    function seedTickets(
      prisma: ReturnType<typeof fakePrisma>,
      stale: any[],
      unanswered: any[],
      adminIds: string[] = ['admin1'],
    ) {
      prisma.supportTicket.findMany
        .mockResolvedValueOnce(stale as any)
        .mockResolvedValueOnce(unanswered as any);
      prisma.platformRoleAssignment.findMany.mockResolvedValue(
        adminIds.map((userId) => ({ userId })) as any,
      );
    }

    it('nudges the assignee of a stale ticket, panel-only', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      seedTickets(prisma, [fakeTicket()], []);

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleTickets();

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ticket_stale_assignee',
          userId: 'staff1',
          channels: { panel: true },
        }),
      );
    });

    it('only considers assigned, already-answered tickets for the nudge leg', async () => {
      const prisma = fakePrisma();
      seedTickets(prisma, [fakeTicket()], []);

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleTickets();

      const where = prisma.supportTicket.findMany.mock.calls[0][0].where;
      expect(where.status.in).toEqual(['open', 'in_progress', 'waiting']);
      expect(where.assigneeId).toEqual({ not: null });
      expect(where.firstResponseAt).toEqual({ not: null });
      expect(where.lastActivityAt.lt).toBeInstanceOf(Date);
    });

    it('escalates an unanswered ticket to every admin, panel AND email', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      seedTickets(prisma, [], [fakeTicket({ id: 't2', number: 1043 })], ['admin1', 'admin2']);

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleTickets();

      expect(notifications.notify).toHaveBeenCalledTimes(2);
      for (const userId of ['admin1', 'admin2']) {
        expect(notifications.notify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'ticket_unanswered_escalation',
            userId,
            channels: { panel: true, email: true },
            data: { ticketId: 't2' },
          }),
        );
      }
    });

    it('resolves admins by role, not via notifyAll() — that broadcasts to every user on the platform', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      seedTickets(prisma, [], [fakeTicket()]);

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleTickets();

      expect(notifications.notifyAll).not.toHaveBeenCalled();
      expect(prisma.platformRoleAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role: 'admin' }, distinct: ['userId'] }),
      );
    });

    it('claims BEFORE notifying, and skips entirely when the claim lost the race', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      seedTickets(prisma, [fakeTicket()], [fakeTicket({ id: 't2' })]);
      prisma.supportTicket.updateMany.mockResolvedValue({ count: 0 });

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleTickets();

      expect(prisma.supportTicket.updateMany).toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('the claim is null-safe on staleNotifiedAt and allows a repeat nudge the next day', async () => {
      const prisma = fakePrisma();
      seedTickets(prisma, [fakeTicket()], []);

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleTickets();

      const claimWhere = prisma.supportTicket.updateMany.mock.calls[0][0].where;
      expect(hasUnsafeNot(claimWhere)).toBe(false);
      expect(claimWhere.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ staleNotifiedAt: null }),
          expect.objectContaining({
            staleNotifiedAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
        ]),
      );
    });

    it('one failing ticket does not abort the rest of the batch', async () => {
      const prisma = fakePrisma();
      const notifications = fakeNotifications();
      seedTickets(prisma, [fakeTicket({ id: 't1' }), fakeTicket({ id: 't2' })], []);
      prisma.supportTicket.updateMany
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue({ count: 1 });

      const svc = new NotificationsSweepService(
        prisma as any,
        notifications as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleTickets();

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ data: { ticketId: 't2' } }),
      );
    });

    it('does not look up admins at all when nothing is unanswered', async () => {
      const prisma = fakePrisma();
      seedTickets(prisma, [], []);

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepStaleTickets();

      expect(prisma.platformRoleAssignment.findMany).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // S3 — the SMTP-bound depleted-campaign sweep used to share one guard with
  // the other three, so a long run of it starved them for the whole tick.
  // -------------------------------------------------------------------------
  describe('sub-sweep decoupling', () => {
    it('sweep() no longer runs the SMTP-bound depleted-campaign sub-sweep', async () => {
      const prisma = fakePrisma();
      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      const depleted = jest.spyOn(svc as any, 'sweepDepletedCampaigns');

      await (svc as any).sweep();

      expect(depleted).not.toHaveBeenCalled();
    });

    it('a depleted-campaign run still in flight does not block sweep()', async () => {
      const prisma = fakePrisma();
      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      let release!: () => void;
      jest
        .spyOn(svc as any, 'sweepDepletedCampaigns')
        .mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));

      const slow = (svc as any).runDepletedCampaignsSweep();
      // The other three must run to completion regardless.
      await (svc as any).sweep();
      expect(prisma.campaign.findMany).toHaveBeenCalled();

      release();
      await slow;
    });

    it('the depleted-campaign sweep has its own re-entrancy guard', async () => {
      const prisma = fakePrisma();
      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      let release!: () => void;
      const depleted = jest
        .spyOn(svc as any, 'sweepDepletedCampaigns')
        .mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));

      const first = (svc as any).runDepletedCampaignsSweep();
      await (svc as any).runDepletedCampaignsSweep();

      expect(depleted).toHaveBeenCalledTimes(1);
      release();
      await first;
    });

    it('a throwing depleted-campaign run releases its guard', async () => {
      const prisma = fakePrisma();
      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      const depleted = jest
        .spyOn(svc as any, 'sweepDepletedCampaigns')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(undefined);

      await (svc as any).runDepletedCampaignsSweep();
      await (svc as any).runDepletedCampaignsSweep();

      expect(depleted).toHaveBeenCalledTimes(2);
    });

    it('the ticket sweep has its own guard too', async () => {
      const prisma = fakePrisma();
      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      let release!: () => void;
      const tickets = jest
        .spyOn(svc as any, 'sweepStaleTickets')
        .mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));

      const first = (svc as any).runStaleTicketsSweep();
      await (svc as any).runStaleTicketsSweep();

      expect(tickets).toHaveBeenCalledTimes(1);
      release();
      await first;
    });
  });

  // -------------------------------------------------------------------------
  // S2c — the feed-position sub-sweep is two analytics fan-outs per campaign,
  // so it walks a bounded slice per tick with a cursor carried between ticks.
  // -------------------------------------------------------------------------
  describe('feed-position batching', () => {
    function page(n: number) {
      return Array.from({ length: n }, (_, i) => fakeCampaign({ id: `c${i}`, status: 'active' }));
    }

    it('takes a bounded page and carries a cursor to the next tick', async () => {
      const prisma = fakePrisma();
      prisma.campaign.findMany.mockResolvedValue(page(500));

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      await (svc as any).sweepFeedPositionUpgrades();

      const args = prisma.campaign.findMany.mock.calls[0][0];
      expect(args.take).toBe(500);
      expect(args.cursor).toBeUndefined();
      expect((svc as any).feedPositionCursor).toBe('c499');

      await (svc as any).sweepFeedPositionUpgrades();
      expect(prisma.campaign.findMany.mock.calls[1][0].cursor).toEqual({ id: 'c499' });
      expect(prisma.campaign.findMany.mock.calls[1][0].skip).toBe(1);
    });

    it('wraps back to the start on a short page', async () => {
      const prisma = fakePrisma();
      prisma.campaign.findMany.mockResolvedValue(page(3));

      const svc = new NotificationsSweepService(
        prisma as any,
        fakeNotifications() as any,
        fakeAnalytics() as any,
      );
      (svc as any).feedPositionCursor = 'c-previous';
      await (svc as any).sweepFeedPositionUpgrades();

      expect((svc as any).feedPositionCursor).toBeNull();
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
