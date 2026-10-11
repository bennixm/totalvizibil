import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EasySiteService } from 'src/website/easy-site/easy-site.service';

/** A valid website-asset URL that passes the ASSET_URL_RE check. */
const VALID_ASSET_URL = '/api/v1/website-assets/550e8400-e29b-41d4-a716-446655440000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakePrisma() {
  const members = new Map<string, any>();
  const companies = new Map<string, any>();
  const websites = new Map<string, any>();

  return {
    companyUser: {
      findUnique: jest.fn(async ({ where }: any) =>
        members.get(
          `${where.companyId_userId.companyId}:${where.companyId_userId.userId}`,
        ) ?? null,
      ),
    },
    company: {
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const c = companies.get(where.id);
        if (!c) {
          const err: any = new Error('Record not found');
          err.code = 'P2025';
          throw err;
        }
        return c;
      }),
    },
    website: {
      update: jest.fn(async ({ where, data }: any) => {
        const existing = websites.get(where.id) ?? {};
        const updated = { ...existing, ...data };
        websites.set(where.id, updated);
        return updated;
      }),
    },

    // --- seed helpers ---

    __seedMember(companyId: string, userId: string, overrides: any = {}) {
      const m = { companyId, userId, status: 'active', role: 'owner', ...overrides };
      members.set(`${companyId}:${userId}`, m);
      return m;
    },

    __seedCompanyWithWebsite(companyId: string, websiteOverrides: any = {}) {
      const website = {
        id: 'w1',
        mode: 'easy',
        status: 'draft',
        easyConfig: {},
        theme: null,
        content: null,
        generator: null,
        ...websiteOverrides,
      };
      const company = { id: companyId, deletionScheduledAt: null, website };
      companies.set(companyId, company);
      websites.set(website.id, website);
      return { company, website };
    },
  };
}

function fakeAssets() {
  return {
    addCompanyAsset: jest.fn().mockResolvedValue({ id: 'asset1', url: VALID_ASSET_URL }),
  };
}

function fakeAi() {
  return {
    serviceCopy: jest
      .fn()
      .mockResolvedValue([{ name: 'Plumbing', description: 'Pipes done right.' }]),
  };
}

function makeService() {
  const prisma = fakePrisma();
  const assets = fakeAssets();
  const ai = fakeAi();
  const svc = new EasySiteService(prisma as any, assets as any, ai as any);
  return { svc, prisma, assets, ai };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EasySiteService', () => {
  describe('load guard — not a member', () => {
    it('throws NotFoundException when user has no membership record', async () => {
      const { svc } = makeService();
      await expect(svc.get('co1', 'u1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('load guard — website mode', () => {
    it('throws BadRequestException(not_a_simple_site) when website mode is not easy', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.__seedCompanyWithWebsite('co1', { mode: 'advanced' });
      await expect(svc.get('co1', 'u1')).rejects.toThrow(BadRequestException);
      await expect(svc.get('co1', 'u1')).rejects.toMatchObject({ message: 'not_a_simple_site' });
    });
  });

  describe('patch', () => {
    it('throws BadRequestException when landingImage is not a valid asset URL', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.__seedCompanyWithWebsite('co1');
      await expect(
        svc.patch('co1', 'u1', { landingImage: 'https://evil.com/img.jpg' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('calls website.update when patch carries a valid asset URL', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.__seedCompanyWithWebsite('co1');
      await svc.patch('co1', 'u1', { landingImage: VALID_ASSET_URL });
      expect(prisma.website.update).toHaveBeenCalled();
    });

    it('website.update receives easyConfig containing the patched landingImage', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.__seedCompanyWithWebsite('co1');
      await svc.patch('co1', 'u1', { landingImage: VALID_ASSET_URL });
      const [[{ data }]] = (prisma.website.update as jest.Mock).mock.calls;
      expect((data.easyConfig as any).landingImage).toBe(VALID_ASSET_URL);
    });
  });

  describe('regenerateServices', () => {
    it('does not call ai.serviceCopy when aiCalls has reached the cap (4)', async () => {
      const { svc, prisma, ai } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.__seedCompanyWithWebsite('co1', { easyConfig: { aiCalls: 4 } });
      await svc.regenerateServices('co1', 'u1', ['plumbing']);
      expect(ai.serviceCopy).not.toHaveBeenCalled();
    });

    it('calls ai.serviceCopy when aiCalls is below the cap', async () => {
      const { svc, prisma, ai } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.__seedCompanyWithWebsite('co1', { easyConfig: { aiCalls: 0 } });
      await svc.regenerateServices('co1', 'u1', ['plumbing']);
      expect(ai.serviceCopy).toHaveBeenCalledWith(
        expect.objectContaining({ services: ['plumbing'] }),
      );
    });
  });
});
