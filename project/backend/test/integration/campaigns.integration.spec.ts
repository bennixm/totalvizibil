import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from 'src/prisma/prisma.service';
import { createTestApp } from './helpers/app';
import { resetDb } from './helpers/db';
import { createAndLoginUser } from './helpers/auth';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => resetDb(prisma, app));

afterAll(async () => app.close());

describe('Campaigns', () => {
  describe('PUT /companies/:id/campaign', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/companies/fake/campaign')
        .send({ cpc: 2, dailyBudget: 50 })
        .expect(401);
    });

    it('saves campaign config and returns 200', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'owner@example.com',
        password: 'password123',
        name: 'Owner',
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Cookie', user.cookie)
        .send({ displayName: 'Acme SRL' });
      const companyId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .put(`/api/v1/companies/${companyId}/campaign`)
        .set('Cookie', user.cookie)
        .send({ cpc: 2, dailyBudget: 50 })
        .expect(200);
      expect(res.body).toHaveProperty('campaign');
      expect(res.body.campaign.cpc.minor).toBe(200);
    });
  });

  describe('POST /companies/:id/campaign/activate', () => {
    it('returns 400 when wallet has insufficient balance', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'owner@example.com',
        password: 'password123',
        name: 'Owner',
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Cookie', user.cookie)
        .send({ displayName: 'Acme SRL' });
      const companyId = createRes.body.id;

      // Save a campaign first
      await request(app.getHttpServer())
        .put(`/api/v1/companies/${companyId}/campaign`)
        .set('Cookie', user.cookie)
        .send({ cpc: 2, dailyBudget: 50 });

      // Seed website so it passes that check
      await prisma.website.upsert({
        where: { companyId },
        create: {
          companyId,
          mode: 'easy',
          status: 'published',
          publishedAt: new Date(),
          theme: {},
          content: {},
        },
        update: { status: 'published', publishedAt: new Date() },
      });

      // Wallet has 0 balance — should fail
      await request(app.getHttpServer())
        .post(`/api/v1/companies/${companyId}/campaign/activate`)
        .set('Cookie', user.cookie)
        .expect(400);
    });
  });

  describe('POST /feed/click', () => {
    it('returns { billed: false, reason: "bot" } for bot user-agent', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'owner@example.com',
        password: 'password123',
        name: 'Owner',
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Cookie', user.cookie)
        .send({ displayName: 'Acme SRL' });
      const companyId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .post('/api/v1/feed/click')
        .set('User-Agent', 'Googlebot/2.1')
        .send({ companyId })
        .expect(201);
      expect(res.body).toMatchObject({ billed: false, reason: 'bot' });
    });
  });
});
