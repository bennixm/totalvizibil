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

describe('Support', () => {
  describe('POST /support/tickets', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/support/tickets')
        .send({ subject: 'Help', body: 'Please help me', category: 'other' })
        .expect(401);
    });

    it('creates ticket and returns 201', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/support/tickets')
        .set('Cookie', user.cookie)
        .send({ subject: 'Need help', body: 'Something is broken', category: 'other' })
        .expect(201);
      expect(res.body).toMatchObject({ subject: 'Need help', status: 'open' });
    });
  });

  describe('GET /support/tickets', () => {
    it('user sees only own tickets', async () => {
      const u1 = await createAndLoginUser(app, prisma, {
        email: 'u1@example.com',
        password: 'password123',
        name: 'U1',
      });
      const u2 = await createAndLoginUser(app, prisma, {
        email: 'u2@example.com',
        password: 'password123',
        name: 'U2',
      });

      // Create a ticket as u1
      await request(app.getHttpServer())
        .post('/api/v1/support/tickets')
        .set('Cookie', u1.cookie)
        .send({ subject: 'U1 ticket', body: 'From u1', category: 'other' });

      // u2 should see zero tickets
      const res = await request(app.getHttpServer())
        .get('/api/v1/support/tickets')
        .set('Cookie', u2.cookie)
        .expect(200);
      expect(res.body.items.length).toBe(0);
    });
  });

  describe('POST /support/tickets/:id/messages', () => {
    it('returns 400 for closed ticket', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/support/tickets')
        .set('Cookie', user.cookie)
        .send({ subject: 'Help needed', body: 'Please help me with this issue', category: 'other' });
      const ticketId = createRes.body.id;

      // Close the ticket directly in DB
      await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'closed', closedAt: new Date() } });

      await request(app.getHttpServer())
        .post(`/api/v1/support/tickets/${ticketId}/messages`)
        .set('Cookie', user.cookie)
        .send({ body: 'Still need help with this problem' })
        .expect(400);
    });
  });

  describe('PATCH /support/tickets/:id', () => {
    it('returns 403 when non-staff tries to set priority', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/support/tickets')
        .set('Cookie', user.cookie)
        .send({ subject: 'Help needed', body: 'Please help me with this issue', category: 'other' });
      const ticketId = createRes.body.id;

      await request(app.getHttpServer())
        .patch(`/api/v1/support/tickets/${ticketId}`)
        .set('Cookie', user.cookie)
        .send({ priority: 'urgent' })
        .expect(403);
    });
  });
});
