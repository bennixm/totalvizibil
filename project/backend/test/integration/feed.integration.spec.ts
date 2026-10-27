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

describe('GET /feed/facets', () => {
  it('returns 200 with categories array and counties array', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/feed/facets').expect(200);
    expect(res.body).toHaveProperty('categories');
    expect(res.body).toHaveProperty('counties');
    expect(Array.isArray(res.body.counties)).toBe(true);
  });
});

describe('GET /feed', () => {
  it('returns requiresCategory: true when no category param given', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/feed').expect(200);
    expect(res.body).toMatchObject({ requiresCategory: true });
  });

  it('returns empty list for unknown category slug', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/feed?category=nonexistent-slug')
      .expect(200);
    expect(res.body).toMatchObject({ items: [], total: 0 });
  });
});
