import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Public: the category list that powers the company-create form and the feed. */
  @Get()
  async list() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ position: 'asc' }, { slug: 'asc' }],
    });
    return {
      data: categories.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.nameI18n,
        icon: c.icon,
      })),
    };
  }
}
