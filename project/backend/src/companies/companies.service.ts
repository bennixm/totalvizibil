import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { uniqueSlug } from '../common/slug';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { companyInclude, toCompanyView, CompanyView } from './company.view';

const ROLES_THAT_CAN_EDIT: CompanyRole[] = [CompanyRole.owner, CompanyRole.manager];

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Membership role of a user in a company, or null if not a member. */
  private async membershipRole(companyId: string, userId: string): Promise<CompanyRole | null> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') return null;
    return member.role;
  }

  async create(userId: string, dto: CreateCompanyDto): Promise<CompanyView> {
    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!category || !category.isActive) {
        throw new BadRequestException('Unknown category');
      }
    }

    const slug = await uniqueSlug(
      dto.displayName,
      async (candidate) => (await this.prisma.company.count({ where: { slug: candidate } })) > 0,
    );

    const contacts: Prisma.CompanyContactCreateManyCompanyInput[] = [];
    if (dto.phone) contacts.push({ type: 'phone', value: dto.phone.trim() });
    if (dto.email) contacts.push({ type: 'email', value: dto.email.trim().toLowerCase() });

    const company = await this.prisma.company.create({
      data: {
        displayName: dto.displayName.trim(),
        legalName: dto.legalName?.trim() || null,
        description: dto.description?.trim() || null,
        categoryId: dto.categoryId ?? null,
        logoUrl: dto.logoUrl?.trim() || null,
        ownerUserId: userId,
        slug,
        members: {
          create: { userId, role: CompanyRole.owner, status: 'active' },
        },
        contacts: contacts.length ? { createMany: { data: contacts } } : undefined,
        locations: dto.location
          ? {
              create: {
                city: dto.location.city.trim(),
                address: dto.location.address?.trim() || null,
                region: dto.location.region?.trim() || null,
                country: (dto.location.country || 'RO').toUpperCase().slice(0, 2),
                isPrimary: true,
              },
            }
          : undefined,
        services: dto.services?.length
          ? {
              createMany: {
                data: dto.services.map((s, i) => ({
                  name: s.name.trim(),
                  description: s.description?.trim() || null,
                  position: i,
                })),
              },
            }
          : undefined,
      },
      include: companyInclude,
    });

    return toCompanyView(company, CompanyRole.owner);
  }

  async listForUser(userId: string): Promise<CompanyView[]> {
    const companies = await this.prisma.company.findMany({
      where: { members: { some: { userId, status: 'active' } } },
      include: companyInclude,
      orderBy: { createdAt: 'desc' },
    });
    // Resolve each viewer role in one extra query rather than N.
    const roles = await this.prisma.companyUser.findMany({
      where: { userId, status: 'active', companyId: { in: companies.map((c) => c.id) } },
      select: { companyId: true, role: true },
    });
    const roleByCompany = new Map(roles.map((r) => [r.companyId, r.role]));
    return companies.map((c) => toCompanyView(c, roleByCompany.get(c.id) ?? null));
  }

  async getForUser(userId: string, companyId: string): Promise<CompanyView> {
    const role = await this.membershipRole(companyId, userId);
    if (!role) throw new NotFoundException('Company not found');

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: companyInclude,
    });
    return toCompanyView(company, role);
  }

  async update(userId: string, companyId: string, dto: UpdateCompanyDto): Promise<CompanyView> {
    const role = await this.membershipRole(companyId, userId);
    if (!role) throw new NotFoundException('Company not found');
    if (!ROLES_THAT_CAN_EDIT.includes(role)) {
      throw new ForbiddenException('Your role cannot edit this company');
    }

    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!category || !category.isActive) throw new BadRequestException('Unknown category');
    }

    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        displayName: dto.displayName?.trim(),
        legalName: dto.legalName?.trim(),
        description: dto.description?.trim(),
        categoryId: dto.categoryId,
        logoUrl: dto.logoUrl?.trim(),
        status: dto.status,
        claimedAt: dto.status === 'active' ? new Date() : undefined,
      },
      include: companyInclude,
    });
    return toCompanyView(company, role);
  }

  /**
   * Dashboard payload. The website block is real (created by the "Create your
   * business" flow); advertising / analytics metrics are still explicit `null`
   * with a status marker rather than faked (PRD §12, §19; later milestones).
   */
  async dashboard(userId: string, companyId: string) {
    const company = await this.getForUser(userId, companyId);
    const primaryLocation =
      company.locations.find((l) => l.isPrimary) ?? company.locations[0] ?? null;

    const website = await this.prisma.website.findUnique({ where: { companyId } });

    return {
      company: {
        id: company.id,
        displayName: company.displayName,
        slug: company.slug,
        status: company.status,
        category: company.category,
        primaryLocation,
        contactsCount: company.contacts.length,
        servicesCount: company.services.length,
        createdAt: company.createdAt,
        viewerRole: company.viewerRole,
      },
      profileCompleteness: this.profileCompleteness(company),
      website: website
        ? {
            status: website.status,
            mode: website.mode,
            generator: website.generator,
            updatedAt: website.updatedAt,
            isLive: website.status === 'published' && company.status === 'active',
          }
        : { status: 'none' as const },
      metrics: {
        _status: 'not_implemented' as const,
        note: 'Advertising & analytics metrics arrive with later milestones (PRD §12, §19).',
        impressions: null,
        clicks: null,
        ctr: null,
        averageCpc: null,
        totalSpent: null,
        remainingBalance: null,
        websiteVisitors: null,
        leads: null,
      },
    };
  }

  /** Make the company + its website publicly visible in the feed (PRD §11). */
  async setPublished(userId: string, companyId: string, live: boolean) {
    const role = await this.membershipRole(companyId, userId);
    if (!role) throw new NotFoundException('Company not found');
    if (!ROLES_THAT_CAN_EDIT.includes(role)) {
      throw new ForbiddenException('Your role cannot publish this company');
    }

    await this.prisma.$transaction([
      this.prisma.company.update({
        where: { id: companyId },
        data: {
          status: live ? 'active' : 'draft',
          claimedAt: live ? new Date() : undefined,
        },
      }),
      this.prisma.website.updateMany({
        where: { companyId },
        data: { status: live ? 'published' : 'unpublished' },
      }),
    ]);

    return this.dashboard(userId, companyId);
  }

  private profileCompleteness(company: CompanyView): { score: number; missing: string[] } {
    const checks: [string, boolean][] = [
      ['description', !!company.description],
      ['category', !!company.category],
      ['location', company.locations.length > 0],
      ['contact', company.contacts.length > 0],
      ['services', company.services.length > 0],
      ['logo', !!company.logoUrl],
    ];
    const done = checks.filter(([, ok]) => ok).length;
    return {
      score: Math.round((done / checks.length) * 100),
      missing: checks.filter(([, ok]) => !ok).map(([k]) => k),
    };
  }
}
