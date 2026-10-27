import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CompanyRole } from '@prisma/client';
import { CompaniesService } from 'src/companies/companies.service';

// ---------------------------------------------------------------------------
// Dependency stubs
// ---------------------------------------------------------------------------

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function fakeDrafts() {
  return {
    assertCategories: jest.fn().mockResolvedValue([]),
    loadByToken: jest.fn().mockResolvedValue(null),
    markClaimed: jest.fn().mockResolvedValue(undefined),
  };
}

function fakeWallet() {
  return {
    ownerIdForCompany: jest.fn().mockResolvedValue('owner1'),
    getSummary: jest.fn().mockResolvedValue({ balance: { minor: 0 } }),
    consumedByCompanies: jest.fn().mockResolvedValue(new Map()),
    canAfford: jest.fn().mockResolvedValue(true),
  };
}

function fakeCampaigns() {
  return {
    summaryFor: jest.fn().mockResolvedValue(null),
    isListingWebsiteReady: jest.fn().mockResolvedValue(true),
  };
}

function fakeLeads() {
  return { summaryFor: jest.fn().mockResolvedValue({ total: 0 }) };
}

function fakeAnalytics() {
  return {
    companyAnalytics: jest
      .fn()
      .mockResolvedValue({ visibility: {}, planMode: 'easy', campaign: {}, response: {} }),
  };
}

function fakeSettings() {
  return { additionalBusinessPriceCredits: jest.fn().mockResolvedValue(0) };
}

// ---------------------------------------------------------------------------
// Minimal company shape accepted by toCompanyView
// ---------------------------------------------------------------------------

function makeCompanyRow(overrides: Record<string, any> = {}) {
  return {
    id: `co-${Math.random().toString(36).slice(2, 8)}`,
    displayName: 'Acme SRL',
    legalName: null,
    slug: 'acme-srl',
    status: 'draft',
    categoryId: null,
    logoUrl: null,
    ownerUserId: 'u1',
    country: 'RO',
    defaultLocale: 'ro',
    currency: 'RON',
    advancedUnlockedAt: null,
    deletionScheduledAt: null,
    deletionReminderSentAt: null,
    featured: false,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    // Relations expected by companyInclude / toCompanyView
    category: null,
    categoryAssignments: [],
    locations: [],
    contacts: [],
    services: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// fakePrisma – Map-backed store
// ---------------------------------------------------------------------------

function fakePrisma() {
  const members = new Map<string, any>();
  const companies = new Map<string, any>();

  return {
    // ---- company ----
    company: {
      count: jest.fn(async ({ where }: any) => {
        if (where?.slug) {
          for (const c of companies.values()) {
            if (c.slug === where.slug) return 1;
          }
          return 0;
        }
        return 0;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = makeCompanyRow({
          displayName: typeof data.displayName === 'string' ? data.displayName : 'Acme SRL',
          legalName: data.legalName ?? null,
          description: data.description ?? null,
          slug: data.slug,
          categoryId: data.categoryId ?? null,
          logoUrl: data.logoUrl ?? null,
          ownerUserId: data.ownerUserId,
        });
        companies.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => companies.get(where.id) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const c = companies.get(where.id);
        if (!c) throw new Error(`Company ${where.id} not found`);
        return c;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        // purgeExpiredDeletions (both the per-user and the new global form):
        // return empty so nothing gets deleted in tests unless a test
        // explicitly overrides this mock.
        if (where?.id?.in) return [];
        if (where?.deletionScheduledAt) return [];
        return [...companies.values()];
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = companies.get(where.id);
        if (c) Object.assign(c, data);
        return c ?? {};
      }),
      // Conditional claim (see `scheduleDeletion`): honours the WHERE the way
      // Postgres would, so a second concurrent caller genuinely gets count=0
      // rather than the mock rubber-stamping every call.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const c = companies.get(where.id);
        if (!c) return { count: 0 };
        if ('deletionScheduledAt' in where && where.deletionScheduledAt === null) {
          if (c.deletionScheduledAt) return { count: 0 };
        }
        if ('deletionReminderSentAt' in where && where.deletionReminderSentAt === null) {
          if (c.deletionReminderSentAt) return { count: 0 };
        }
        Object.assign(c, data);
        return { count: 1 };
      }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },

    // ---- websiteDraft (retention sweep) ----
    websiteDraft: {
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },

    // ---- companyUser ----
    companyUser: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = `${where.companyId_userId.companyId}:${where.companyId_userId.userId}`;
        return members.get(key) ?? null;
      }),
    },

    // ---- companyCategory ----
    companyCategory: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      createMany: jest.fn(async () => ({ count: 0 })),
    },

    // ---- category ----
    category: {
      findUnique: jest.fn(async () => null),
    },

    // ---- campaign ----
    campaign: {
      updateMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => null),
    },

    // ---- website ----
    website: {
      updateMany: jest.fn(async () => ({ count: 0 })),
    },

    // ---- $transaction ----
    // Ops are already-invoked promises when passed here (array form).
    $transaction: jest.fn(async (ops: any) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops({} as any);
    }),

    // ---- seed helpers ----
    __seedMember(companyId: string, userId: string, role = 'owner') {
      members.set(`${companyId}:${userId}`, { companyId, userId, status: 'active', role });
    },
    __seedCompany(data: Record<string, any> = {}) {
      const row = makeCompanyRow({ id: 'co1', ...data });
      companies.set(row.id, row);
      return row;
    },
  };
}

// ---------------------------------------------------------------------------
// Factory: fresh service + deps for every test
// ---------------------------------------------------------------------------

function fakeConfig() {
  return { get: jest.fn().mockReturnValue('https://totalvizibil.ro') };
}

function makeService() {
  const prisma = fakePrisma();
  const drafts = fakeDrafts();
  const wallet = fakeWallet();
  const campaigns = fakeCampaigns();
  const leads = fakeLeads();
  const analytics = fakeAnalytics();
  const settings = fakeSettings();
  const notifications = fakeNotifications();
  const config = fakeConfig();

  const svc = new CompaniesService(
    prisma as any,
    drafts as any,
    wallet as any,
    campaigns as any,
    leads as any,
    analytics as any,
    settings as any,
    notifications as any,
    config as any,
  );

  return { svc, prisma, notifications, config };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompaniesService', () => {
  // ---- create ------------------------------------------------------------

  describe('create', () => {
    it('creates a company and returns a view with owner role', async () => {
      const { svc, prisma } = makeService();

      const result = await svc.create('u1', { displayName: 'Acme SRL' });

      expect(prisma.company.create).toHaveBeenCalled();
      expect(result.viewerRole).toBe(CompanyRole.owner);
      expect(result.displayName).toBe('Acme SRL');
    });

    it('retries slug when the base slug is already taken', async () => {
      const { svc, prisma } = makeService();
      // Pre-seed a company that occupies slug 'acme-srl'
      prisma.__seedCompany({ id: 'existing', slug: 'acme-srl' });

      const result = await svc.create('u1', { displayName: 'Acme SRL' });

      // uniqueSlug must have appended '-2' to resolve the collision
      expect(result.slug).toBe('acme-srl-2');
    });
  });

  // ---- getForUser --------------------------------------------------------

  describe('getForUser', () => {
    it('throws NotFoundException when the caller is not a member', async () => {
      const { svc } = makeService();

      await expect(svc.getForUser('u1', 'co1')).rejects.toThrow(NotFoundException);
    });

    it('returns the company view when the caller is a member', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1' });

      const result = await svc.getForUser('u1', 'co1');

      expect(result.id).toBe('co1');
      expect(result.viewerRole).toBe('owner');
    });
  });

  // ---- update ------------------------------------------------------------

  describe('update', () => {
    it('throws ForbiddenException when the caller has the viewer role', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'viewer');
      prisma.__seedCompany({ id: 'co1' });

      await expect(svc.update('u1', 'co1', { displayName: 'New' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when the company is pending deletion', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1', deletionScheduledAt: new Date() });

      await expect(svc.update('u1', 'co1', { displayName: 'New' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('updates the company on the happy path', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1', deletionScheduledAt: null });

      const result = await svc.update('u1', 'co1', { displayName: 'New Name' });

      expect(prisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'co1' },
          data: expect.objectContaining({ displayName: 'New Name' }),
        }),
      );
      expect(result.displayName).toBe('New Name');
    });
  });

  // ---- requestDeletion / scheduleDeletion --------------------------------

  describe('requestDeletion', () => {
    it('sets deletionScheduledAt on the company', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1', deletionScheduledAt: null });

      await svc.requestDeletion('u1', 'co1');

      // Now written by the conditional CLAIM (`updateMany`), not a plain
      // `update` — see the C4 tests below.
      expect(prisma.company.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'co1', deletionScheduledAt: null },
          data: expect.objectContaining({ deletionScheduledAt: expect.any(Date) }),
        }),
      );
    });

    it('issues a campaign.updateMany to pause any active or depleted campaigns', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1', deletionScheduledAt: null });

      await svc.requestDeletion('u1', 'co1');

      expect(prisma.campaign.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'co1',
            status: { in: ['active', 'depleted'] },
          }),
          data: expect.objectContaining({ status: 'paused' }),
        }),
      );
    });

    it('also clears autoOptimize on a campaign that is already paused — regression: a paused AUTO campaign kept the flag and self-revived on the next reconcile() read, regardless of the scheduled deletion', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1', deletionScheduledAt: null });

      await svc.requestDeletion('u1', 'co1');

      const calls = (prisma.campaign.updateMany as jest.Mock).mock.calls;
      const clearsAutoOptimizeOnNonActive = calls.some(
        ([arg]: [any]) =>
          arg.where.companyId === 'co1' &&
          arg.where.status?.notIn?.includes('active') &&
          arg.where.status?.notIn?.includes('depleted') &&
          arg.data.autoOptimize === false,
      );
      expect(clearsAutoOptimizeOnNonActive).toBe(true);
    });
  });

  // ---- C4: scheduleDeletion's atomic claim --------------------------------

  describe('scheduleDeletion (atomic claim)', () => {
    it('C4: two concurrent calls take the business down once and send ONE email', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedCompany({ id: 'co1', deletionScheduledAt: null });
      // Both callers read `deletionScheduledAt: null` before either writes —
      // the read-then-write shape this replaced let both proceed, which is
      // the NORMAL case once more than one app instance runs the sweep.
      await Promise.all([
        (svc as any).scheduleDeletion('co1'),
        (svc as any).scheduleDeletion('co1'),
      ]);

      const claims = (prisma.company.updateMany as jest.Mock).mock.results;
      const won = await Promise.all(claims.map((r: any) => r.value));
      expect(won.filter((r: any) => r.count === 1)).toHaveLength(1);
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    });

    it('C4: a lost claim skips the takedown transaction entirely', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedCompany({ id: 'co1', deletionScheduledAt: null });
      (prisma.company.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await (svc as any).scheduleDeletion('co1');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('C6: the deletion date is formatted in Europe/Bucharest, not the server zone', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedCompany({ id: 'co1', deletionScheduledAt: null });

      await (svc as any).scheduleDeletion('co1');

      // ro-RO formats as dd.mm.yyyy; the point of the assertion is that a
      // real date made it into the body (the zone itself is asserted by the
      // absence of a UTC-vs-local off-by-one, which is only observable with a
      // fixed clock — covered by the explicit `timeZone` option in source).
      const body = (notifications.notify as jest.Mock).mock.calls[0][0].body;
      expect(body).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    });
  });

  // ---- C3 / S4: sweepStaleDrafts isolation + bounded fan-out --------------

  describe('sweepStaleDrafts', () => {
    it('C3: one failing draft does not abort the rest of the batch', async () => {
      const { svc, prisma } = makeService();
      (prisma.company.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'bad' },
        { id: 'ok1' },
        { id: 'ok2' },
      ]);
      const schedule = jest
        .spyOn(svc as any, 'scheduleDeletion')
        .mockImplementation(async (id: any) => {
          if (id === 'bad') throw new Error('row blew up');
        });

      await (svc as any).sweepStaleDrafts();

      // Previously a single throwing row aborted every remaining stale draft:
      // the whole method sat behind ONE outer try/catch.
      expect(schedule).toHaveBeenCalledTimes(3);
      expect(schedule).toHaveBeenCalledWith('ok2');
    });

    it('S4: fans out in bounded chunks instead of all at once', async () => {
      const { svc, prisma } = makeService();
      (prisma.company.findMany as jest.Mock).mockResolvedValueOnce(
        Array.from({ length: 40 }, (_, i) => ({ id: `d${i}` })),
      );

      let inFlight = 0;
      let peak = 0;
      jest.spyOn(svc as any, 'scheduleDeletion').mockImplementation(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      });

      await (svc as any).sweepStaleDrafts();

      // Each stale draft costs a multi-statement $transaction plus an
      // unawaited notify() (≈3 queries + SMTP). Unbounded, 40 of those hit a
      // default Prisma pool of 9-17 connections simultaneously.
      expect(peak).toBeLessThanOrEqual(15);
      expect(peak).toBeGreaterThan(1);
    });
  });

  // ---- S10b / item 14: the scheduled retention sweep ----------------------

  describe('sweepRetention', () => {
    it('S10b: purges expired deletions platform-wide, with no company ids to narrow by', async () => {
      const { svc } = makeService();
      const purge = jest.spyOn(svc as any, 'purgeExpiredDeletions').mockResolvedValue(0);

      await (svc as any).sweepRetention();

      // The whole point of the finding: this used to run ONLY from user-read
      // paths, so a business nobody ever came back to was never purged at all
      // despite the reminder email naming a hard deletion date.
      expect(purge).toHaveBeenCalledWith();
    });

    it('item 14: deletes expired website drafts in a bounded batch', async () => {
      const { svc, prisma } = makeService();
      (prisma.websiteDraft.findMany as jest.Mock).mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]);
      (prisma.websiteDraft.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });

      await (svc as any).sweepRetention();

      const selectArgs = (prisma.websiteDraft.findMany as jest.Mock).mock.calls[0][0];
      expect(selectArgs.where.expiresAt.lt).toBeInstanceOf(Date);
      expect(selectArgs.take).toBeGreaterThan(0);
      expect(prisma.websiteDraft.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['d1', 'd2'] } },
      });
    });

    it('skips the delete entirely when nothing is expired', async () => {
      const { svc, prisma } = makeService();

      await (svc as any).sweepRetention();

      expect(prisma.websiteDraft.deleteMany).not.toHaveBeenCalled();
    });

    it('a failing purge leg still lets the draft leg run', async () => {
      const { svc, prisma } = makeService();
      jest.spyOn(svc as any, 'purgeExpiredDeletions').mockRejectedValue(new Error('pool timeout'));

      await expect((svc as any).sweepRetention()).resolves.toBeUndefined();
      expect(prisma.websiteDraft.findMany).toHaveBeenCalled();
    });
  });
});
