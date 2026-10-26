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

describe('Appointments', () => {
  describe('GET /companies/:companyId/appointments/settings', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/companies/fake-id/appointments/settings')
        .expect(401);
    });

    it('returns default settings for company owner', async () => {
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
        .get(`/api/v1/companies/${companyId}/appointments/settings`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body).toHaveProperty('enabled');
    });
  });

  describe('PUT /companies/:companyId/appointments/settings', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/companies/fake-id/appointments/settings')
        .send({ enabled: true })
        .expect(401);
    });

    it('saves appointment settings', async () => {
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
        .put(`/api/v1/companies/${companyId}/appointments/settings`)
        .set('Cookie', user.cookie)
        .send({ enabled: true })
        .expect(200);
      expect(res.body).toHaveProperty('enabled', true);
    });
  });

  describe('GET /companies/:companyId/appointments', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/companies/fake-id/appointments').expect(401);
    });

    it('returns paginated list for company owner', async () => {
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
        .get(`/api/v1/companies/${companyId}/appointments`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });
});
