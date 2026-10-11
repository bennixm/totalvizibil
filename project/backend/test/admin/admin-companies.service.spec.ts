import { NotFoundException } from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';
import { AdminCompaniesService } from 'src/admin/admin-companies.service';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCampaign(overrides: Record<string, any> = {}) {
  return {
    id: 'camp-1',
    companyId: 'company-1',
    status: CampaignStatus.active,
    dailyBudgetMinor: 1000,
    cpcMinor: 50,
    autoOptimize: false,
    activatedAt: new Date(Date.now() - 60_000),
    pausedAt: null,
    activeSecondsAccrued: 0,
    ...overrides,
  };
}

function makeCompany(overrides: Record<string, any> = {}) {
  return {
    id: 'company-1',
    displayName: 'Test Biz',
    legalName: null,
    slug: 'test-biz',
    status: 'active' as const,
    country: 'RO',
    description: null,
    createdAt: new Date('2024-01-01'),
    advancedUnlockedAt: null,
    ownerUserId: 'user-1',
    featured: false,
    campaign: null as ReturnType<typeof makeCampaign> | null,
    category: null as any,
    locations: [] as any[],
    website: null as any,
    owner: { id: 'user-1', name: 'Owner', email: 'owner@test.com', status: 'active' },
    _count: { services: 0, contacts: 0, leads: 0, adClicks: 0 },
    ...overrides,
  };
}

function fakePrisma() {
  const companies = new Map<string, ReturnType<typeof makeCompany>>();

  const prisma = {
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    company: {
      findUnique: jest.fn(async ({ where }: any) => companies.get(where.id) ?? null),
      findMany: jest.fn(async () => [...companies.values()]),
      count: jest.fn(async () => companies.size),
      update: jest.fn(async ({ where, data }: any) => {
        const c = companies.get(where.id);
        if (c) Object.assign(c, data);
        return c ?? null;
      }),
    },
    campaign: {
      findUnique: jest.fn(async ({ where }: any) => {
        const c = companies.get(where.companyId);
        return c?.campaign ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = companies.get(where.companyId);
        if (c?.campaign) Object.assign(c.campaign, data);
        return c?.campaign ?? null;
      }),
      delete: jest.fn(async () => null),
    },
    website: {
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    companyLocation: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      createMany: jest.fn(async () => ({ count: 0 })),
    },
    category: {
      findUnique: jest.fn(async () => null),
    },
    // helpers not part of the real Prisma interface
    __seed: (data: Record<string, any> = {}) => {
      const c = makeCompany(data);
      companies.set(c.id, c);
      return c;
    },
    __companies: companies,
  };

  return prisma;
}

function fakeWallet() {
  return {
    consumedByCompanies: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, 0]))),
    blockInfo: jest.fn(async () => ({ blocked: false })),
    canAfford: jest.fn(async () => true),
  };
}

function fakeCampaigns() {
  return {
    saveFor: jest.fn(async () => {}),
    getFor: jest.fn(async () => null),
    isListingWebsiteReady: jest.fn(async () => true),
  };
}

function fakeLeads() {
  return {
    listFor: jest.fn(async () => ({ items: [], nextCursor: null })),
    summaryFor: jest.fn(async () => ({})),
    updateFor: jest.fn(async () => {}),
  };
}

function fakeAnalytics() {
  return {
    companyAnalytics: jest.fn(async () => ({})),
  };
}

function fakeBuilder() {
  return {
    unlockForAdmin: jest.fn(async () => {}),
  };
}

function fakeSettings() {
  return {
    advancedBuilderPriceCredits: jest.fn(async () => 0),
  };
}

function fakeNotifications() {
  return {
    notify: jest.fn(async () => {}),
  };
}

function makeService() {
  const prisma = fakePrisma();
  const wallet = fakeWallet();
  const campaigns = fakeCampaigns();
  const leads = fakeLeads();
  const analytics = fakeAnalytics();
  const builder = fakeBuilder();
  const settings = fakeSettings();
  const notifications = fakeNotifications();

  const svc = new AdminCompaniesService(
    prisma as any,
    wallet as any,
    campaigns as any,
    leads as any,
    analytics as any,
    builder as any,
    settings as any,
    notifications as any,
  );

  return { svc, prisma, wallet, campaigns, leads, analytics, builder, settings, notifications };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminCompaniesService', () => {
  // ---- list() ------------------------------------------------------------

  describe('list()', () => {
    it('passes status filter into the where clause', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({ id: 'c1' });

      await svc.list({ status: 'active', page: 1, pageSize: 20 });

      const [findManyCall] = (prisma.company.findMany as jest.Mock).mock.calls;
      expect(findManyCall[0].where).toMatchObject({ status: 'active' });
    });

    it('omits status from where when not provided', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({ id: 'c1' });

      await svc.list({ page: 1, pageSize: 20 });

      const [findManyCall] = (prisma.company.findMany as jest.Mock).mock.calls;
      expect(findManyCall[0].where).not.toHaveProperty('status');
    });

    it('returns paginated shape with items, page, pageSize, total', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({ id: 'c1' });

      const result = await svc.list({ page: 2, pageSize: 10 });

      expect(result).toMatchObject({
        items: expect.any(Array),
        page: 2,
        pageSize: 10,
        total: expect.any(Number),
      });
    });

    it('maps campaign money fields when campaign exists', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({
        id: 'c1',
        campaign: makeCampaign({ dailyBudgetMinor: 500, cpcMinor: 25 }),
        _count: { leads: 0, adClicks: 0 },
      });

      const result = await svc.list({ page: 1, pageSize: 20 });

      expect(result.items[0].campaign).toMatchObject({
        dailyBudget: { minor: 500, credits: 5 },
        cpc: { minor: 25, credits: 0.25 },
      });
    });
  });

  // ---- loadCompany (tested indirectly via setStatus) --------------------

  describe('get (via setStatus)', () => {
    it('throws NotFoundException when company does not exist', async () => {
      const { svc } = makeService();

      await expect(svc.setStatus('nonexistent', { status: 'suspended' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns a result on the happy path', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({ id: 'company-1', status: 'active', campaign: null });

      const result = await svc.setStatus('company-1', { status: 'suspended' });

      expect(result).toMatchObject({ ok: true });
    });
  });

  // ---- setStatus() -------------------------------------------------------

  describe('setStatus()', () => {
    it('suspending pauses an active campaign and stores accrued seconds', async () => {
      const { svc, prisma } = makeService();
      const activatedAt = new Date(Date.now() - 60_000);
      prisma.__seed({
        id: 'company-1',
        displayName: 'My Biz',
        ownerUserId: 'user-1',
        status: 'active',
        campaign: makeCampaign({
          status: CampaignStatus.active,
          activatedAt,
          activeSecondsAccrued: 0,
          autoOptimize: false,
        }),
      });

      const result = await svc.setStatus('company-1', { status: 'suspended' });

      expect(result).toEqual({ ok: true, status: 'suspended' });
      expect(prisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1' },
          data: expect.objectContaining({
            status: CampaignStatus.paused,
            autoOptimize: false,
          }),
        }),
      );
    });

    it('suspending notifies the company owner', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seed({
        id: 'company-1',
        displayName: 'My Biz',
        ownerUserId: 'user-1',
        status: 'active',
        campaign: null,
      });

      await svc.setStatus('company-1', { status: 'suspended' });

      // The notification is fired via void — flush the microtask queue.
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'business_suspended',
        }),
      );
    });

    it('suspending a company without a campaign skips campaign update', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({
        id: 'company-1',
        ownerUserId: 'user-1',
        status: 'active',
        campaign: null,
      });

      const result = await svc.setStatus('company-1', { status: 'suspended' });

      expect(result).toEqual({ ok: true, status: 'suspended' });
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });

    it('lifting suspension sets company status to draft', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({
        id: 'company-1',
        displayName: 'My Biz',
        ownerUserId: 'user-1',
        status: 'suspended',
        campaign: null,
      });

      const result = await svc.setStatus('company-1', { status: 'active' });

      expect(result).toEqual({ ok: true, status: 'draft' });
      expect(prisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'draft' } }),
      );
    });

    it('lifting suspension notifies the owner with reactivated type', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seed({
        id: 'company-1',
        displayName: 'My Biz',
        ownerUserId: 'user-1',
        status: 'suspended',
        campaign: null,
      });

      await svc.setStatus('company-1', { status: 'active' });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'business_reactivated',
        }),
      );
    });
  });

  // ---- saveCampaign() (delegation) ---------------------------------------

  describe('saveCampaign()', () => {
    it('delegates to campaigns.saveFor with the provided dto', async () => {
      const { svc, prisma, campaigns } = makeService();
      prisma.__seed({ id: 'company-1', status: 'active' });
      const dto = { dailyBudgetMinor: 500, cpcMinor: 25 } as any;

      await svc.saveCampaign('company-1', dto);

      expect(campaigns.saveFor).toHaveBeenCalledWith('company-1', dto);
    });

    it('throws NotFoundException before saving when company does not exist', async () => {
      const { svc, campaigns } = makeService();

      await expect(svc.saveCampaign('nonexistent', {} as any)).rejects.toThrow(NotFoundException);
      expect(campaigns.saveFor).not.toHaveBeenCalled();
    });
  });
});
