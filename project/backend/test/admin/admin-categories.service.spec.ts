import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminCategoriesService } from 'src/admin/admin-categories.service';

function makeCategory(overrides: Record<string, any> = {}) {
  return {
    id: 'cat1',
    slug: 'services',
    nameI18n: { ro: 'Servicii' },
    icon: null,
    parentId: null,
    isActive: true,
    position: 0,
    _count: { companies: 0, children: 0 },
    ...overrides,
  };
}

function fakePrisma() {
  const cats = new Map<string, ReturnType<typeof makeCategory>>();
  const bySlug = new Map<string, ReturnType<typeof makeCategory>>();

  return {
    category: {
      findMany: jest.fn(async () => [...cats.values()]),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return cats.get(where.id) ?? null;
        if (where.slug) return bySlug.get(where.slug) ?? null;
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const c = makeCategory({ id: 'cat-new', ...data });
        cats.set(c.id, c);
        bySlug.set(c.slug, c);
        return c;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = cats.get(where.id);
        if (!c) return null;
        Object.assign(c, data);
        return c;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const c = cats.get(where.id);
        cats.delete(where.id);
        return c;
      }),
    },
    __cats: cats,
    __seedCat: (data = {}) => {
      const c = makeCategory(data);
      cats.set(c.id, c);
      bySlug.set(c.slug, c);
      return c;
    },
  };
}

describe('AdminCategoriesService', () => {
  describe('create', () => {
    it('throws BadRequestException for invalid slug', async () => {
      const prisma = fakePrisma();
      const svc = new AdminCategoriesService(prisma as any);
      await expect(svc.create({ slug: 'BAD SLUG', name: { ro: 'X' } } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for duplicate slug', async () => {
      const prisma = fakePrisma();
      prisma.__seedCat({ id: 'p1', slug: 'services' });
      const svc = new AdminCategoriesService(prisma as any);
      await expect(svc.create({ slug: 'services', name: { ro: 'X' } } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for three-level nesting', async () => {
      const prisma = fakePrisma();
      const grandparent = prisma.__seedCat({ id: 'gp', slug: 'gp', parentId: 'root' });
      const svc = new AdminCategoriesService(prisma as any);
      await expect(
        svc.create({ slug: 'child', name: { ro: 'X' }, parentId: grandparent.id } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates category on happy path', async () => {
      const prisma = fakePrisma();
      const svc = new AdminCategoriesService(prisma as any);
      const result = await svc.create({ slug: 'new-cat', name: { ro: 'Nou' } } as any);
      expect(result.createdId).toBeTruthy();
      expect(prisma.category.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('throws NotFoundException when category not found', async () => {
      const prisma = fakePrisma();
      const svc = new AdminCategoriesService(prisma as any);
      await expect(svc.update('missing', { slug: 'ok' } as any)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for self-parent', async () => {
      const prisma = fakePrisma();
      prisma.__seedCat({ id: 'c1', slug: 'cat' });
      const svc = new AdminCategoriesService(prisma as any);
      await expect(svc.update('c1', { parentId: 'c1' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when nesting a parent that has children', async () => {
      const prisma = fakePrisma();
      prisma.__seedCat({ id: 'p1', slug: 'parent', _count: { companies: 0, children: 2 } });
      const parent2 = prisma.__seedCat({ id: 'p2', slug: 'parent2' });
      const svc = new AdminCategoriesService(prisma as any);
      await expect(svc.update('p1', { parentId: parent2.id } as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when category not found', async () => {
      const prisma = fakePrisma();
      const svc = new AdminCategoriesService(prisma as any);
      await expect(svc.remove('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when category has companies', async () => {
      const prisma = fakePrisma();
      prisma.__seedCat({ id: 'c1', slug: 'cat', _count: { companies: 3, children: 0 } });
      const svc = new AdminCategoriesService(prisma as any);
      await expect(svc.remove('c1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when category has children', async () => {
      const prisma = fakePrisma();
      prisma.__seedCat({ id: 'c1', slug: 'cat', _count: { companies: 0, children: 2 } });
      const svc = new AdminCategoriesService(prisma as any);
      await expect(svc.remove('c1')).rejects.toThrow(BadRequestException);
    });

    it('deletes category on happy path', async () => {
      const prisma = fakePrisma();
      prisma.__seedCat({ id: 'c1', slug: 'cat', _count: { companies: 0, children: 0 } });
      const svc = new AdminCategoriesService(prisma as any);
      await svc.remove('c1');
      expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });
  });
});
