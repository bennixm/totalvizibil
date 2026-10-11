import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from 'src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { resetDb } from './helpers/db';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => resetDb(prisma, app));

afterAll(async () => app.close());

describe('Categories', () => {
  describe('GET /categories', () => {
    it('returns 200 with data array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .expect(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty data when no categories seeded', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('returns nested category tree when categories exist', async () => {
      const parent = await prisma.category.create({
        data: { slug: 'services', nameI18n: { ro: 'Servicii' }, isActive: true, position: 0 },
      });
      await prisma.category.create({
        data: { slug: 'cleaning', nameI18n: { ro: 'Curățenie' }, isActive: true, position: 0, parentId: parent.id },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].children).toHaveLength(1);
      expect(res.body.data[0].slug).toBe('services');
    });
  });
});
