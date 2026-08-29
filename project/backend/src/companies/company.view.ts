import { Prisma } from '@prisma/client';

export const companyInclude = {
  category: true,
  locations: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
  contacts: { orderBy: { createdAt: 'asc' } },
  services: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.CompanyInclude;

type CompanyWithRelations = Prisma.CompanyGetPayload<{ include: typeof companyInclude }>;

/** API-facing shape for a company. */
export function toCompanyView(c: CompanyWithRelations, viewerRole: string | null) {
  return {
    id: c.id,
    displayName: c.displayName,
    legalName: c.legalName,
    slug: c.slug,
    description: c.description,
    logoUrl: c.logoUrl,
    status: c.status,
    country: c.country,
    defaultLocale: c.defaultLocale,
    currency: c.currency,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    viewerRole,
    category: c.category
      ? { id: c.category.id, slug: c.category.slug, name: c.category.nameI18n }
      : null,
    locations: c.locations.map((l) => ({
      id: l.id,
      city: l.city,
      address: l.address,
      region: l.region,
      country: l.country,
      isPrimary: l.isPrimary,
      serviceRadiusKm: l.serviceRadiusKm,
    })),
    contacts: c.contacts.map((ct) => ({
      id: ct.id,
      type: ct.type,
      value: ct.value,
      isPublic: ct.isPublic,
    })),
    services: c.services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      position: s.position,
    })),
  };
}

export type CompanyView = ReturnType<typeof toCompanyView>;
