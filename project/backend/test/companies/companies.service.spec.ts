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
  return { companyAnalytics: jest.fn().mockResolvedValue({ visibility: {}, planMode: 'easy', campaign: {}, response: {} }) };
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
  const members  = new Map<string, any>();
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
        // purgeExpiredDeletions: return empty so nothing gets deleted in tests
        if (where?.id?.in) return [];
        return [...companies.values()];
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = companies.get(where.id);
        if (c) Object.assign(c, data);
        return c ?? {};
      }),
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

function makeService() {
  const prisma        = fakePrisma();
  const drafts        = fakeDrafts();
  const wallet        = fakeWallet();
  const campaigns     = fakeCampaigns();
  const leads         = fakeLeads();
  const analytics     = fakeAnalytics();
  const settings      = fakeSettings();
  const notifications = fakeNotifications();

  const svc = new CompaniesService(
    prisma        as any,
    drafts        as any,
    wallet        as any,
    campaigns     as any,
    leads         as any,
    analytics     as any,
    settings      as any,
    notifications as any,
  );

  return { svc, prisma, notifications };
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

      await expect(svc.update('u1', 'co1', { displayName: 'New' })).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the company is pending deletion', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1', 'owner');
      prisma.__seedCompany({ id: 'co1', deletionScheduledAt: new Date() });

      await expect(svc.update('u1', 'co1', { displayName: 'New' })).rejects.toThrow(ForbiddenException);
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

      expect(prisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
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
  });
});
