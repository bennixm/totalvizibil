import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebsiteContent, WebsiteTheme } from '../website/website.types';

@Injectable()
export class PublicCompanyService {
  constructor(private readonly prisma: PrismaService) {}

  /** The company's public identity / website (PRD §2). Only active companies. */
  async bySlug(slug: string) {
    const company = await this.prisma.company.findFirst({
      where: { slug, status: 'active' },
      include: {
        category: { include: { parent: true } },
        locations: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        contacts: { where: { isPublic: true } },
        services: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        website: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    return {
      id: company.id,
      slug: company.slug,
      displayName: company.displayName,
      description: company.description,
      logoUrl: company.logoUrl,
      // `parent` lets the client build the SEO URL /c/{group}/{niche}/{slug}.
      category: company.category
        ? {
            slug: company.category.slug,
            name: company.category.nameI18n,
            parent: company.category.parent
              ? { slug: company.category.parent.slug, name: company.category.parent.nameI18n }
              : null,
          }
        : null,
      locations: company.locations.map((l) => ({
        city: l.city,
        region: l.region,
        address: l.address,
        country: l.country,
        isPrimary: l.isPrimary,
        serviceRadiusKm: l.serviceRadiusKm,
        nationwide: l.nationwide,
      })),
      contacts: company.contacts.map((c) => ({ type: c.type, value: c.value })),
      services: company.services.map((s) => ({ name: s.name, description: s.description })),
      website:
        company.website && company.website.status !== 'draft'
          ? {
              mode: company.website.mode,
              theme: company.website.theme as unknown as WebsiteTheme,
              content: company.website.content as unknown as WebsiteContent,
            }
          : null,
    };
  }
}
