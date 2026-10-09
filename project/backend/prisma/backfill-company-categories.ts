import { PrismaClient } from '@prisma/client';

/**
 * One-time (but idempotent) data migration: mirrors every pre-existing
 * `Company.categoryId` into the new many-to-many `company_categories` table
 * as that company's primary assignment. Safe to re-run — upserts on the
 * (companyId, categoryId) unique constraint.
 */
const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany({
    where: { categoryId: { not: null } },
    select: { id: true, categoryId: true },
  });

  let count = 0;
  for (const c of companies) {
    await prisma.companyCategory.upsert({
      where: { companyId_categoryId: { companyId: c.id, categoryId: c.categoryId! } },
      update: { isPrimary: true },
      create: { companyId: c.id, categoryId: c.categoryId!, isPrimary: true },
    });
    count += 1;
  }

  console.log(`Backfilled ${count} company -> primary category assignment(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
