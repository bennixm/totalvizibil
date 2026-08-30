import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public: the two-level category tree (parent groups + their exact-niche
   * subcategories) that powers the "create your business" category selector and
   * the feed filters.
   */
  @Get()
  async list() {
    const all = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ position: 'asc' }, { slug: 'asc' }],
    });

    const childrenByParent = new Map<string, typeof all>();
    for (const c of all) {
      if (!c.parentId) continue;
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }

    return {
      data: all
        .filter((c) => !c.parentId)
        .map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.nameI18n,
          icon: p.icon,
          children: (childrenByParent.get(p.id) ?? []).map((c) => ({
            id: c.id,
            slug: c.slug,
            name: c.nameI18n,
            icon: c.icon,
          })),
        })),
    };
  }
}
