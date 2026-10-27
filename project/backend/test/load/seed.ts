/**
 * Load test seed — creates stable fixtures in tvz_load so k6 scenarios have
 * real data to hit.
 *
 * Run once before starting the server:
 *   npm run test:load:seed
 *
 * Idempotent: drops existing load data first via TRUNCATE … CASCADE.
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const HASH_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function main() {
  console.log('[seed] Cleaning load DB...');

  const TABLES = [
    'ad_clicks',
    'leads',
    'campaigns',
    'company_locations',
    'company_contacts',
    'company_categories',
    'company_users',
    'wallet_transactions',
    'wallets',
    'websites',
    'website_drafts',
    'companies',
    'users',
    'categories',
  ];
  for (const t of TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  }

  // ---------------------------------------------------------------------------
  // Categories — 1 parent + 5 leaf subcategories
  // ---------------------------------------------------------------------------
  console.log('[seed] Creating categories...');

  const parentCat = await prisma.category.create({
    data: {
      slug: 'load-servicii',
      nameI18n: { ro: 'Servicii Load', en: 'Load Services' },
      isActive: true,
    },
  });

  const leafSlugs = ['curatenie', 'instalatii', 'constructii', 'gradinarit', 'transport'];
  const leafCats = await Promise.all(
    leafSlugs.map((slug, i) =>
      prisma.category.create({
        data: {
          slug,
          parentId: parentCat.id,
          nameI18n: { ro: slug, en: slug },
          isActive: true,
          position: i,
        },
      }),
    ),
  );

  // ---------------------------------------------------------------------------
  // Test user (for authenticated dashboard scenario)
  // ---------------------------------------------------------------------------
  console.log('[seed] Creating test user...');

  const passwordHash = await argon2.hash('password123', HASH_OPTS);
  const testUser = await prisma.user.create({
    data: {
      email: 'load@test.com',
      passwordHash,
      name: 'Load Test User',
      emailVerifiedAt: new Date(),
      wallet: {
        create: { balanceMinor: 1_000_000, currency: 'EUR' },
      },
    },
  });

  // ---------------------------------------------------------------------------
  // 20 active companies with campaigns + wallet
  // ---------------------------------------------------------------------------
  console.log('[seed] Creating 20 companies with campaigns...');

  const slugsCreated: string[] = [];

  for (let i = 0; i < 20; i++) {
    const slug = `load-company-${i + 1}`;
    const category = leafCats[i % leafCats.length];

    // Vary CPC and budget to exercise ranking logic
    const cpcMinor = 100 + i * 10; // 100..290 (minor units = hundredths)
    const dailyBudgetMinor = 5000 + i * 500; // 5000..14500

    const company = await prisma.company.create({
      data: {
        displayName: `Load Company ${i + 1}`,
        slug,
        status: 'active',
        categoryId: category.id,
        ownerUserId: testUser.id,
        qualityScore: 0.5,
        country: 'RO',
      },
    });

    // Primary category assignment
    await prisma.companyCategory.create({
      data: { companyId: company.id, categoryId: category.id, isPrimary: true },
    });

    // Nationwide location so every feed county query can match
    await prisma.companyLocation.create({
      data: { companyId: company.id, nationwide: true, isPrimary: true },
    });

    // Active campaign
    await prisma.campaign.create({
      data: {
        companyId: company.id,
        status: 'active',
        cpcMinor,
        dailyBudgetMinor,
        activatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        activeSecondsAccrued: 7 * 24 * 3600,
      },
    });

    slugsCreated.push(slug);
  }

  // ---------------------------------------------------------------------------
  // Owner membership for testUser (first company only, for dashboard scenario)
  // ---------------------------------------------------------------------------
  const firstCompany = await prisma.company.findUnique({
    where: { slug: slugsCreated[0] },
  });

  console.log('\n[seed] Done!');
  console.log('[seed] Test user: load@test.com / password123');
  console.log(`[seed] Dashboard company ID: ${firstCompany?.id}`);
  console.log('[seed] Category slugs:', leafSlugs.join(', '));
  console.log('[seed] Company slugs:', slugsCreated.slice(0, 3).join(', '), '...');
  console.log('\n[seed] Save these for k6 scenarios — or query them at runtime via /api/v1/feed');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
