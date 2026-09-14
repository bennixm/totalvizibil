/* eslint-disable */
// Disposable local-only fixture for the PRO live test — creates a fresh
// throwaway company on the advanced plan (unlocked) with a real starter
// BuilderDoc, plus a real DB-backed session so a browser can be authenticated
// via cookie without going through the signup/login UI.
import { randomBytes, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { starterAdvancedDoc, composeAdvancedDoc } from '../src/website/builder/compose-advanced';
import type { SeedCtx } from '../src/website/builder/section-catalog';

const prisma = new PrismaClient();

async function main() {
  const stamp = Date.now();
  const email = `pro-live-test-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      name: 'PRO Live Test',
      passwordHash: await argon2.hash('throwaway-' + stamp),
      passwordChangedAt: new Date(),
    },
  });

  const category = await prisma.category.findFirstOrThrow({ where: { slug: 'acoperisuri' } });

  const ctx: SeedCtx = {
    businessName: 'Nova Analytics',
    businessType: 'AI analytics SaaS',
    city: 'Cluj-Napoca',
    services: ['Analytics dashboards', 'Reporting', 'Alerts'],
    phone: '',
    email: '',
    locale: 'ro',
  };
  const doc = starterAdvancedDoc(ctx);
  const g = composeAdvancedDoc(doc, ctx);

  const company = await prisma.company.create({
    data: {
      slug: `nova-analytics-${stamp}`,
      displayName: 'Nova Analytics',
      description: 'AI-powered analytics platform',
      categoryId: category.id,
      ownerUserId: user.id,
      status: 'active',
      country: 'RO',
      defaultLocale: 'ro',
      currency: 'RON',
      advancedUnlockedAt: new Date(),
      members: { create: { userId: user.id, role: 'owner', status: 'active' } },
      locations: { create: { city: ctx.city, country: 'RO', isPrimary: true } },
      website: {
        create: {
          mode: 'advanced',
          status: 'published',
          theme: g.theme as any,
          content: g.content as any,
          generator: g.generator,
          builderSpec: doc as any,
        },
      },
    },
    select: { id: true, slug: true },
  });

  const token = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  console.log(JSON.stringify({ companyId: company.id, userId: user.id, email, token }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
