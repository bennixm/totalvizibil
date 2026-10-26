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

describe('Wallet', () => {
  describe('GET /wallet', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/wallet').expect(401);
    });

    it('returns wallet summary with balance shape', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/wallet')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body).toHaveProperty('balance');
      expect(res.body.balance).toHaveProperty('credits');
      expect(res.body).toHaveProperty('currency');
    });
  });

  describe('GET /wallet/transactions', () => {
    it('returns paginated transaction list', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/wallet/transactions')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe('POST /wallet/purchases', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/wallet/purchases')
        .send({ credits: 10 })
        .expect(401);
    });

    it('starts purchase and returns txnId', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/wallet/purchases')
        .set('Cookie', user.cookie)
        .send({ credits: 10 })
        .expect(201);
      expect(res.body).toHaveProperty('transactionId');
    });
  });
});
