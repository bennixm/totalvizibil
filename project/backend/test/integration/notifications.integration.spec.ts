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

describe('Notifications', () => {
  describe('GET /notifications', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
    });

    it('returns paginated list for authenticated user', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe('GET /notifications/unread-count', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/notifications/unread-count').expect(401);
    });

    it('returns count 0 for new user', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body).toMatchObject({ count: 0 });
    });
  });

  describe('POST /notifications/read-all', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer()).post('/api/v1/notifications/read-all').expect(401);
    });

    it('returns ok true', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/notifications/read-all')
        .set('Cookie', user.cookie)
        .expect(201);
      expect(res.body).toMatchObject({ ok: true });
    });
  });
});
