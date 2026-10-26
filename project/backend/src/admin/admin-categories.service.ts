import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
export class AdminCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Full two-level tree including inactive nodes, with per-category company counts. */
  async tree() {
    const all = await this.prisma.category.findMany({
      orderBy: [{ position: 'asc' }, { slug: 'asc' }],
      include: {
        _count: { select: { companies: true, companyCategories: true, children: true } },
      },
    });

    const view = (c: (typeof all)[number]) => ({
      id: c.id,
      parentId: c.parentId,
      slug: c.slug,
      name: c.nameI18n as Record<string, string>,
      icon: c.icon,
      isActive: c.isActive,
      position: c.position,
      // `companies` is only the legacy primary-FK mirror; `companyCategories`
      // is the authoritative multi-category join table (every tagged
      // company — primary or secondary — gets a row there). They SHOULD
      // agree, but an admin company-edit that writes `Company.categoryId`
      // directly without re-syncing the join table can leave the FK ahead of
      // it — take the max so a still-in-use category never reads as 0.
      companyCount: Math.max(c._count.companies, c._count.companyCategories),
      childCount: c._count.children,
    });

    const children = new Map<string, ReturnType<typeof view>[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const list = children.get(c.parentId) ?? [];
      list.push(view(c));
      children.set(c.parentId, list);
    }

    return {
      data: all
        .filter((c) => !c.parentId)
        .map((p) => ({ ...view(p), children: children.get(p.id) ?? [] })),
    };
  }

  private assertSlug(slug: string) {
    if (!SLUG_RE.test(slug)) {
      throw new BadRequestException('slug must be lowercase words joined by single hyphens');
    }
  }

  async create(dto: CreateCategoryDto) {
    this.assertSlug(dto.slug);

    const existing = await this.prisma.category.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new BadRequestException('That slug is already taken');

    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new BadRequestException('Parent category not found');
      if (parent.parentId) {
        throw new BadRequestException('Categories are only two levels deep');
      }
    }

    const created = await this.prisma.category.create({
      data: {
        parentId: dto.parentId ?? null,
        slug: dto.slug,
        nameI18n: { ...dto.name } as Prisma.InputJsonObject,
        icon: dto.icon ?? null,
        isActive: dto.isActive ?? true,
        position: dto.position ?? 0,
      },
    });
    return this.tree().then((t) => ({ tree: t.data, createdId: created.id }));
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const cat = await this.prisma.category.findUnique({
      where: { id },
      include: {
        _count: { select: { children: true, companies: true, companyCategories: true } },
      },
    });
    if (!cat) throw new NotFoundException('Category not found');

    if (dto.slug && dto.slug !== cat.slug) {
      this.assertSlug(dto.slug);
      const taken = await this.prisma.category.findUnique({ where: { slug: dto.slug } });
      if (taken) throw new BadRequestException('That slug is already taken');
      // The slug is a path segment in this app's flat, indexed SEO URLs
      // (/group/subcategory/slug) — renaming it out from under companies
      // that are live under it 404s every indexed link with no redirect.
      // Only allow a slug change while the category is still empty.
      const inUse = Math.max(cat._count.companies, cat._count.companyCategories);
      if (inUse > 0) {
        throw new BadRequestException(
          `${inUse} business(es) use this category — reassign them before changing its slug (changing it would break their live URLs)`,
        );
      }
    }

    if (dto.parentId !== undefined) {
      if (dto.parentId === id) throw new BadRequestException('A category cannot be its own parent');
      if (dto.parentId && cat._count.children > 0) {
        throw new BadRequestException('Move the subcategories out before nesting this group');
      }
      if (dto.parentId) {
        const parent = await this.prisma.category.findUnique({ where: { id: dto.parentId } });
        if (!parent) throw new BadRequestException('Parent category not found');
        if (parent.parentId) throw new BadRequestException('Categories are only two levels deep');
      }
    }

    await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
        ...(dto.name !== undefined ? { nameI18n: { ...dto.name } as Prisma.InputJsonObject } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId || null } : {}),
      },
    });
    return this.tree();
  }

  async remove(id: string) {
    const cat = await this.prisma.category.findUnique({
      where: { id },
      include: {
        _count: { select: { companies: true, companyCategories: true, children: true } },
      },
    });
    if (!cat) throw new NotFoundException('Category not found');
    // `companies` is only the legacy primary-FK mirror — a company tagged to
    // this category ONLY as a secondary niche has no row there, but does
    // have one in `companyCategories` (the real, authoritative join table),
    // which Prisma's `onDelete: Cascade` would otherwise silently destroy
    // along with the category, pulling that company out of a Feed it's
    // still ranking and paying CPC in.
    const inUse = Math.max(cat._count.companies, cat._count.companyCategories);
    if (inUse > 0) {
      throw new BadRequestException(
        `${inUse} business(es) use this category — reassign them first`,
      );
    }
    if (cat._count.children > 0) {
      throw new BadRequestException('Delete or move the subcategories first');
    }
    await this.prisma.category.delete({ where: { id } });
    return this.tree();
  }
}
