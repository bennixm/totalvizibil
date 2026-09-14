/* eslint-disable */
import { PrismaClient } from '@prisma/client';
import { docFromLegacy, composeAdvancedDoc } from '../src/website/builder/compose-advanced';
import type { SeedCtx } from '../src/website/builder/section-catalog';

const prisma = new PrismaClient();

async function main() {
  const companyId = process.argv[2];
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    include: { website: true, locations: true, services: true, contacts: true },
  });
  const loc = company.locations.find((l) => l.isPrimary) ?? company.locations[0];
  const ctx: SeedCtx = {
    businessName: (company.displayName ?? '').trim(),
    businessType: (company.description ?? '').trim().slice(0, 48),
    city: loc?.city ?? '',
    services: company.services.slice().sort((a, b) => a.position - b.position).map((s) => s.name.trim()).filter(Boolean).slice(0, 8),
    locale: 'ro',
  };
  console.log('ctx ok');
  const doc = docFromLegacy(company.website!.builderSpec, company.website!.content, company.website!.theme, ctx);
  console.log('docFromLegacy ok, pages:', doc.pages.length);
  const g = composeAdvancedDoc(doc, ctx);
  console.log('composeAdvancedDoc ok, pages:', g.content.pages.length);
}
main()
  .catch((e) => console.error('ERROR:', e))
  .finally(() => prisma.$disconnect());
