import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { resetDb } from './helpers/db';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});
beforeEach(() => resetDb(prisma, app));
afterAll(() => app.close());

it('lists public pages, active categories and active businesses at their SEO paths', async () => {
  const group = await prisma.category.create({ data: { slug: 'casa', nameI18n: { ro: 'Casă' } } });
  const niche = await prisma.category.create({
    data: { slug: 'instalatori', parentId: group.id, nameI18n: { ro: 'Instalatori' } },
  });
  await prisma.category.create({
    data: { slug: 'ascunsa', isActive: false, nameI18n: { ro: 'x' } },
  });
  const owner = await prisma.user.create({
    data: { email: 'o@example.com', name: 'O', passwordHash: 'x' },
  });
  for (const [slug, status] of [
    ['ion-instal', 'active'],
    ['ciorna', 'draft'],
  ] as const)
    await prisma.company.create({
      data: { slug, status, displayName: slug, ownerUserId: owner.id, categoryId: niche.id },
    });
  const r = await request(app.getHttpServer()).get('/api/v1/sitemap.xml').expect(200);
  expect(r.headers['content-type']).toContain('application/xml');
  const origin = process.env.FRONTEND_ORIGIN;
  for (const p of ['/start', '/casa', '/casa/instalatori', '/casa/instalatori/ion-instal'])
    expect(r.text).toContain(`<loc>${origin}${p}</loc>`);
  expect(r.text).not.toContain('ciorna');
  expect(r.text).not.toContain('ascunsa');
});
