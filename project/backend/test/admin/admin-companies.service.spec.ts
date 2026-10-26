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
  const companyCategoryRows: { companyId: string; categoryId: string; isPrimary: boolean }[] = [];
  let primaryLocation: { city: string | null; lat: number | null; lng: number | null } | null =
    null;

  const prisma: any = {
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
      // Only the single row `setLocation` reads back (the existing primary's
      // city/lat/lng to carry forward) — set via `__seedPrimaryLocation`.
      findFirst: jest.fn(async () => primaryLocation),
    },
    companyCategory: {
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = companyCategoryRows.length;
        const kept = companyCategoryRows.filter((r) => r.companyId !== where.companyId);
        companyCategoryRows.length = 0;
        companyCategoryRows.push(...kept);
        return { count: before - companyCategoryRows.length };
      }),
      create: jest.fn(async ({ data }: any) => {
        companyCategoryRows.push(data);
        return data;
      }),
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
    __seedPrimaryLocation: (loc: { city: string | null; lat: number | null; lng: number | null }) => {
      primaryLocation = loc;
    },
    __companies: companies,
    __companyCategoryRows: companyCategoryRows,
  };

  // Supports both call shapes actually used in the service: the array form
  // `$transaction([...])` and the interactive-callback form
  // `$transaction(async (tx) => {...})` (used by `updateCompany`'s
  // category-sync fix) — the callback just gets the same fake client, since
  // none of these fakes need real row-level isolation.
  prisma.$transaction = jest.fn(async (arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  );

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
    // Mirrors the real `CampaignService.getFor()` contract — it always
    // returns this full editor payload, even for a company with no
    // Campaign row yet (only the nested `campaign` field goes null then).
    getFor: jest.fn(async () => ({
      campaign: null,
      suggestions: {
        standard: { cpc: { minor: 110, credits: 1.1 }, dailyBudget: { minor: 2000, credits: 20 } },
        appearFirst: {
          cpc: { minor: 110, credits: 1.1 },
          dailyBudget: { minor: 2000, credits: 20 },
        },
      },
      marketCpc: { minor: 0, credits: 0 },
      requiresWebsiteBuilder: false,
      canActivate: true,
      wallet: { balance: { minor: 0, credits: 0 }, currency: 'EUR', eurRonRate: 5 },
      consumed: { minor: 0, credits: 0 },
      required: { minor: 0, credits: 0 },
      autoBudgetLimited: false,
      runnable: true,
    })),
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
    feedRanksFor: jest.fn(async () => []),
    // Floor = costPromovareMinor + marjaProfitMinor = 20 — `makeCampaign`'s
    // default `cpcMinor: 50` clears it; tests that need to fail the check
    // seed a campaign with a lower `cpcMinor`.
    marginConfig: jest.fn(async () => ({
      costPromovareMinor: 10,
      marjaProfitMinor: 10,
      marjaPozitionareMinor: 0,
    })),
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
    it('delegates to campaigns.saveFor with the provided dto, tagged as an admin-initiated save', async () => {
      const { svc, prisma, campaigns } = makeService();
      prisma.__seed({ id: 'company-1', status: 'active' });
      const dto = { dailyBudgetMinor: 500, cpcMinor: 25 } as any;

      await svc.saveCampaign('company-1', dto);

      expect(campaigns.saveFor).toHaveBeenCalledWith('company-1', dto, 'admin');
    });

    it('throws NotFoundException before saving when company does not exist', async () => {
      const { svc, campaigns } = makeService();

      await expect(svc.saveCampaign('nonexistent', {} as any)).rejects.toThrow(NotFoundException);
      expect(campaigns.saveFor).not.toHaveBeenCalled();
    });
  });

  // ---- pending-deletion freeze (regression) ------------------------------

  describe('pending-deletion freeze', () => {
    const PENDING_METHODS: [string, (svc: AdminCompaniesService) => Promise<unknown>][] = [
      ['updateCompany', (svc) => svc.updateCompany('company-1', { displayName: 'New' } as any)],
      [
        'setLocation',
        (svc) => svc.setLocation('company-1', { nationwide: true } as any),
      ],
      ['setWebsitePublished', (svc) => svc.setWebsitePublished('company-1', false)],
      ['saveCampaign', (svc) => svc.saveCampaign('company-1', {} as any)],
      [
        'campaignAction',
        (svc) => svc.campaignAction('company-1', { action: 'pause' } as any),
      ],
      ['setStatus', (svc) => svc.setStatus('company-1', { status: 'suspended' } as any)],
      ['upgradeToAdvanced', (svc) => svc.upgradeToAdvanced('company-1')],
    ];

    it.each(PENDING_METHODS)(
      '%s rejects a company with a deletion scheduled',
      async (_name, call) => {
        const { svc, prisma } = makeService();
        prisma.__seed({
          id: 'company-1',
          status: 'active',
          deletionScheduledAt: new Date(),
          campaign: makeCampaign(),
        });

        await expect(call(svc)).rejects.toThrow('company_pending_deletion');
      },
    );

    it('cancelDeletion is NOT blocked — it is the one way out of this state', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({
        id: 'company-1',
        status: 'draft',
        deletionScheduledAt: new Date(),
        ownerUserId: 'user-1',
      });

      const result = await svc.cancelDeletion('company-1');

      expect(result).toBeDefined();
      expect(prisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletionScheduledAt: null }) }),
      );
    });
  });

  // ---- campaignAction() ---------------------------------------------------

  describe('campaignAction()', () => {
    it('delete preserves a suspended status instead of lifting it to draft', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({
        id: 'company-1',
        status: 'suspended',
        campaign: makeCampaign({ status: CampaignStatus.paused }),
      });

      await svc.campaignAction('company-1', { action: 'delete' } as any);

      expect(prisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { featured: false } }),
      );
      expect(prisma.__companies.get('company-1')?.status).toBe('suspended');
    });

    it('delete demotes a non-suspended company to draft as before', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({
        id: 'company-1',
        status: 'active',
        campaign: makeCampaign({ status: CampaignStatus.active }),
      });

      await svc.campaignAction('company-1', { action: 'delete' } as any);

      expect(prisma.__companies.get('company-1')?.status).toBe('draft');
    });

    it('activate rejects a manual CPC below the Feed CPC minim instead of self-reverting later', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({
        id: 'company-1',
        status: 'draft',
        campaign: makeCampaign({ status: CampaignStatus.paused, cpcMinor: 10, autoOptimize: false }),
      });

      await expect(svc.campaignAction('company-1', { action: 'activate' } as any)).rejects.toThrow(
        'cpc_below_feed_minimum',
      );
    });

    it('activate succeeds when CPC clears the Feed minim', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({
        id: 'company-1',
        status: 'draft',
        campaign: makeCampaign({ status: CampaignStatus.paused, cpcMinor: 50, autoOptimize: false }),
      });

      const result = await svc.campaignAction('company-1', { action: 'activate' } as any);

      expect(result).toEqual({ ok: true, action: 'activate' });
    });

    it('pause on a live campaign notifies the owner (admin-initiated, emailed)', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seed({
        id: 'company-1',
        status: 'active',
        ownerUserId: 'user-1',
        campaign: makeCampaign({ status: CampaignStatus.active }),
      });

      await svc.campaignAction('company-1', { action: 'pause' } as any);
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'campaign_paused_by_admin',
          channels: { panel: true, email: true },
        }),
      );
    });
  });

  // ---- updateCompany() — category sync ------------------------------------

  describe('updateCompany()', () => {
    it('syncs the company_categories join table alongside the categoryId scalar', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({ id: 'company-1', status: 'active', categoryId: 'old-cat' });
      prisma.category.findUnique.mockResolvedValueOnce({
        id: 'new-cat',
        isActive: true,
        parentId: 'parent-1',
      });

      await svc.updateCompany('company-1', { categoryId: 'new-cat' } as any);

      expect(prisma.__companyCategoryRows).toEqual([
        { companyId: 'company-1', categoryId: 'new-cat', isPrimary: true },
      ]);
      expect(prisma.__companies.get('company-1')?.categoryId).toBe('new-cat');
    });

    it('leaves category_categories untouched when no categoryId is sent', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({ id: 'company-1', status: 'active' });

      await svc.updateCompany('company-1', { displayName: 'Renamed' } as any);

      expect(prisma.companyCategory.deleteMany).not.toHaveBeenCalled();
      expect(prisma.companyCategory.create).not.toHaveBeenCalled();
    });
  });

  // ---- setLocation() — pin carry-forward -----------------------------------

  describe('setLocation()', () => {
    it('carries the existing primary city/lat/lng forward onto the new primary row', async () => {
      const { svc, prisma } = makeService();
      prisma.__seed({ id: 'company-1', status: 'active' });
      prisma.__seedPrimaryLocation({ city: 'Cluj-Napoca', lat: 46.77, lng: 23.59 });

      await svc.setLocation('company-1', { counties: ['Cluj', 'Sibiu'] } as any);

      const [createManyCall] = (prisma.companyLocation.createMany as jest.Mock).mock.calls;
      const rows = createManyCall[0].data as any[];
      expect(rows[0]).toMatchObject({ city: 'Cluj-Napoca', lat: 46.77, lng: 23.59, isPrimary: true });
      expect(rows[1]).toMatchObject({ city: null, lat: null, lng: null, isPrimary: false });
    });
  });
});
