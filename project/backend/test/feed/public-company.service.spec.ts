import { NotFoundException } from '@nestjs/common';
import { PublicCompanyService } from 'src/feed/public-company.service';

function makeCompany(overrides: Record<string, any> = {}) {
  return {
    id: 'co1',
    slug: 'test-co',
    status: 'active',
    displayName: 'Test Co',
    description: 'A test company',
    logoUrl: null,
    category: null,
    locations: [],
    contacts: [],
    services: [],
    website: null,
    ...overrides,
  };
}

function fakePrisma() {
  const companies = new Map<string, ReturnType<typeof makeCompany>>();
  const websites = new Map<string, any>();
  const bundleFiles = new Map<string, any>();

  return {
    company: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const c of companies.values()) {
          if (c.slug === where.slug && c.status === where.status) return c;
        }
        return null;
      }),
    },
    website: {
      findUnique: jest.fn(async ({ where }: any) => websites.get(where.companyId) ?? null),
    },
    websiteBundleFile: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = `${where.websiteId_path.websiteId}:${where.websiteId_path.path}`;
        return bundleFiles.get(key) ?? null;
      }),
    },
    __seedCompany: (data = {}) => {
      const c = { ...makeCompany(data), status: 'active' };
      companies.set(c.slug, c);
      return c;
    },
    __seedWebsite: (companyId: string, data: any) => {
      const w = { id: 'w1', companyId, publishedAt: null, ...data };
      websites.set(companyId, w);
      return w;
    },
    __seedBundleFile: (websiteId: string, path: string, data: any) => {
      const f = { websiteId, path, mime: 'text/html', bytes: Buffer.from('<html/>'), ...data };
      bundleFiles.set(`${websiteId}:${path}`, f);
      return f;
    },
  };
}

describe('PublicCompanyService', () => {
  describe('bySlug', () => {
    it('returns mapped view for active company', async () => {
      const prisma = fakePrisma();
      prisma.__seedCompany({ id: 'co1', slug: 'acme' });
      const svc = new PublicCompanyService(prisma as any);
      const result = await svc.bySlug('acme');
      expect(result.slug).toBe('acme');
      expect(result.id).toBe('co1');
    });

    it('throws NotFoundException for unknown slug', async () => {
      const prisma = fakePrisma();
      const svc = new PublicCompanyService(prisma as any);
      await expect(svc.bySlug('unknown')).rejects.toThrow(NotFoundException);
    });

    it('returns website: null when website status is draft', async () => {
      const prisma = fakePrisma();
      prisma.__seedCompany({
        id: 'co1',
        slug: 'acme',
        website: { id: 'w1', status: 'draft', mode: 'easy', theme: {}, content: {}, publishedAt: null },
      });
      const svc = new PublicCompanyService(prisma as any);
      const result = await svc.bySlug('acme');
      expect(result.website).toBeNull();
    });

    it('returns website with hasBundle=true when publishedAt is set', async () => {
      const prisma = fakePrisma();
      prisma.__seedCompany({
        id: 'co1',
        slug: 'acme',
        website: {
          id: 'w1',
          status: 'active',
          mode: 'pro',
          theme: {},
          content: {},
          publishedAt: new Date(),
        },
      });
      const svc = new PublicCompanyService(prisma as any);
      const result = await svc.bySlug('acme');
      expect(result.website?.hasBundle).toBe(true);
    });
  });

  describe('bundleFile', () => {
    it('throws NotFoundException when no website', async () => {
      const prisma = fakePrisma();
      const svc = new PublicCompanyService(prisma as any);
      await expect(svc.bundleFile('co1', 'index.html')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when publishedAt is null', async () => {
      const prisma = fakePrisma();
      prisma.__seedWebsite('co1', { publishedAt: null });
      const svc = new PublicCompanyService(prisma as any);
      await expect(svc.bundleFile('co1', 'index.html')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when file not in bundle', async () => {
      const prisma = fakePrisma();
      prisma.__seedWebsite('co1', { publishedAt: new Date() });
      const svc = new PublicCompanyService(prisma as any);
      await expect(svc.bundleFile('co1', 'missing.js')).rejects.toThrow(NotFoundException);
    });

    it('returns mime and bytes for a valid bundle file', async () => {
      const prisma = fakePrisma();
      const website = prisma.__seedWebsite('co1', { publishedAt: new Date() });
      prisma.__seedBundleFile(website.id, 'index.html', {
        mime: 'text/html',
        bytes: Buffer.from('<html/>'),
      });
      const svc = new PublicCompanyService(prisma as any);
      const result = await svc.bundleFile('co1', 'index.html');
      expect(result.mime).toBe('text/html');
      expect(Buffer.isBuffer(result.bytes)).toBe(true);
    });
  });
});
