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

describe('Billing', () => {
  describe('GET /account/billing/profile', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/account/billing/profile').expect(401);
    });

    it('returns profile and isComplete flag', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/account/billing/profile')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body).toHaveProperty('isComplete');
    });
  });

  describe('PUT /account/billing/profile', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/account/billing/profile')
        .send({ kind: 'individual', name: 'Ion', address: '123 St', city: 'Cluj' })
        .expect(401);
    });

    it('saves profile and returns updated data', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .put('/api/v1/account/billing/profile')
        .set('Cookie', user.cookie)
        .send({
          kind: 'individual',
          name: 'Ion Popescu',
          address: 'Str. Unirii 1',
          city: 'Cluj-Napoca',
        })
        .expect(200);
      expect(res.body.profile).toHaveProperty('name', 'Ion Popescu');
    });
  });

  describe('GET /account/billing/invoices', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/account/billing/invoices').expect(401);
    });

    it('returns empty list for new user', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/account/billing/invoices')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
