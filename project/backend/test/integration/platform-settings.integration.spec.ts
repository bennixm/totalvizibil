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

describe('Platform Settings', () => {
  describe('GET /platform/pricing', () => {
    it('returns 200 without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/platform/pricing').expect(200);
    });

    it('returns pricing shape with expected keys', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/platform/pricing').expect(200);
      expect(res.body).toHaveProperty('creditsDiscountEnabled');
      expect(res.body).toHaveProperty('creditsDiscountPct');
    });
  });
});
