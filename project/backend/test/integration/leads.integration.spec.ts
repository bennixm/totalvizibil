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

describe('Leads', () => {
  describe('POST /public/companies/:slug/lead', () => {
    it('returns 202 for valid form submission', async () => {
      // Create a company with active status
      const user = await createAndLoginUser(app, prisma, {
        email: 'owner@example.com',
        password: 'password123',
        name: 'Owner',
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Cookie', user.cookie)
        .send({ displayName: 'Acme SRL' });
      const company = await prisma.company.findUnique({
        where: { id: createRes.body.id },
        select: { slug: true },
      });
      // Leads endpoint only accepts active companies
      await prisma.company.update({ where: { id: createRes.body.id }, data: { status: 'active' } });

      await request(app.getHttpServer())
        .post(`/api/v1/public/companies/${company!.slug}/lead`)
        .send({ channel: 'form', name: 'Ion', email: 'ion@example.com', message: 'Hello' })
        .expect(202);
    });

    it('returns 404 for unknown slug', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/public/companies/nonexistent-slug/lead')
        .send({ channel: 'form', name: 'Ion', message: 'Hi' })
        .expect(404);
    });
  });

  describe('GET /companies/:id/leads', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/companies/fake-id/leads')
        .expect(401);
    });

    it('returns 200 with paginated list for member', async () => {
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
        .get(`/api/v1/companies/${companyId}/leads`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });
});
