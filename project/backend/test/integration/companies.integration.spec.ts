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

describe('Companies', () => {
  describe('POST /companies', () => {
    it('returns 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/companies')
        .send({ displayName: 'Acme SRL' })
        .expect(401);
    });

    it('creates company and returns 201', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Cookie', user.cookie)
        .send({ displayName: 'Acme SRL' })
        .expect(201);
      expect(res.body).toMatchObject({ displayName: 'Acme SRL' });
    });
  });

  describe('GET /companies/:id', () => {
    it('returns 404 when not a member', async () => {
      const owner = await createAndLoginUser(app, prisma, {
        email: 'owner@example.com',
        password: 'password123',
        name: 'Owner',
      });
      const stranger = await createAndLoginUser(app, prisma, {
        email: 'stranger@example.com',
        password: 'password123',
        name: 'Stranger',
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Cookie', owner.cookie)
        .send({ displayName: 'Owner Corp' });
      const companyId = createRes.body.id;

      await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyId}`)
        .set('Cookie', stranger.cookie)
        .expect(404);
    });

    it('returns 200 for company member', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Cookie', user.cookie)
        .send({ displayName: 'My Corp' });
      const companyId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyId}`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body).toMatchObject({ id: companyId, displayName: 'My Corp' });
    });
  });

  describe('PATCH /companies/:id', () => {
    it('returns 403 for viewer role member', async () => {
      const owner = await createAndLoginUser(app, prisma, {
        email: 'owner@example.com',
        password: 'password123',
        name: 'Owner',
      });
      const viewer = await createAndLoginUser(app, prisma, {
        email: 'viewer@example.com',
        password: 'password123',
        name: 'Viewer',
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Cookie', owner.cookie)
        .send({ displayName: 'Corp' });
      const companyId = createRes.body.id;

      // Add editor (non-manager) directly in DB — editor cannot patch company settings
      await prisma.companyUser.create({
        data: { companyId, userId: viewer.id, role: 'editor', status: 'active' },
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyId}`)
        .set('Cookie', viewer.cookie)
        .send({ displayName: 'New Name' })
        .expect(403);
    });

    it('updates company for owner', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Cookie', user.cookie)
        .send({ displayName: 'Old Name' });
      const companyId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyId}`)
        .set('Cookie', user.cookie)
        .send({ displayName: 'New Name' })
        .expect(200);
      expect(res.body).toMatchObject({ displayName: 'New Name' });
    });
  });

  describe('DELETE /companies/:id', () => {
    it('schedules deletion and returns 204', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Cookie', user.cookie)
        .send({ displayName: 'Doomed Corp' });
      const companyId = createRes.body.id;

      await request(app.getHttpServer())
        .delete(`/api/v1/companies/${companyId}`)
        .set('Cookie', user.cookie)
        .expect(204);

      const company = await prisma.company.findUnique({ where: { id: companyId } });
      expect(company?.deletionScheduledAt).not.toBeNull();
    });
  });
});
