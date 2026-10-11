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

describe('Affiliate', () => {
  describe('GET /affiliate/me', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/affiliate/me').expect(401);
    });

    it('returns affiliate stats for authenticated user', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/affiliate/me')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('POST /affiliate/claim', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/affiliate/claim')
        .send({ code: 'TESTCODE' })
        .expect(401);
    });

    it('returns claimed false for invalid code', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/affiliate/claim')
        .set('Cookie', user.cookie)
        .send({ code: 'NONEXISTENT123' })
        .expect(201);
      expect(res.body).toMatchObject({ claimed: false });
    });
  });
});
