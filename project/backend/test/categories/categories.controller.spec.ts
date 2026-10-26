import { CategoriesController } from 'src/categories/categories.controller';

function makeCategory(overrides = {}) {
  return {
    id: 'cat1',
    slug: 'services',
    nameI18n: { ro: 'Servicii' },
    icon: null,
    parentId: null,
    isActive: true,
    position: 1,
    ...overrides,
  };
}

function fakePrisma(categories: ReturnType<typeof makeCategory>[] = []) {
  return {
    category: {
      findMany: jest.fn().mockResolvedValue(categories),
    },
  };
}

describe('CategoriesController', () => {
  describe('list', () => {
    it('returns two-level tree for parents with children', async () => {
      const parent = makeCategory({ id: 'p1', slug: 'services', parentId: null });
      const child = makeCategory({ id: 'c1', slug: 'cleaning', parentId: 'p1', position: 1 });
      const prisma = fakePrisma([parent, child]);
      const ctrl = new CategoriesController(prisma as any);

      const result = await ctrl.list();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].slug).toBe('services');
      expect(result.data[0].children).toHaveLength(1);
      expect(result.data[0].children[0].slug).toBe('cleaning');
    });

    it('returns empty children array for parent with no children', async () => {
      const parent = makeCategory({ id: 'p1', parentId: null });
      const prisma = fakePrisma([parent]);
      const ctrl = new CategoriesController(prisma as any);

      const result = await ctrl.list();

      expect(result.data[0].children).toEqual([]);
    });

    it('returns empty data when no categories', async () => {
      const prisma = fakePrisma([]);
      const ctrl = new CategoriesController(prisma as any);
      const result = await ctrl.list();
      expect(result.data).toEqual([]);
    });

    it('only returns parents at top level (excludes orphan children)', async () => {
      const parent = makeCategory({ id: 'p1', parentId: null });
      const child = makeCategory({ id: 'c1', parentId: 'p1' });
      const prisma = fakePrisma([parent, child]);
      const ctrl = new CategoriesController(prisma as any);

      const result = await ctrl.list();

      expect(result.data).toHaveLength(1);
      expect(result.data.find((d: any) => d.id === 'c1')).toBeUndefined();
    });
  });
});
