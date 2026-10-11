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

async function createAdminUser(prismaClient: PrismaService) {
  const user = await createAndLoginUser(app, prismaClient, {
    email: 'admin@example.com',
    password: 'password123',
    name: 'Admin',
  });
  await prismaClient.platformRoleAssignment.create({
    data: { userId: user.id, role: 'admin' },
  });
  // Re-login so the session includes the new role
  const loginRes = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: 'admin@example.com', password: 'password123' });
  const cookie = (loginRes.headers['set-cookie'] as unknown as string[])[0];
  return { ...user, cookie };
}

describe('Admin', () => {
  describe('GET /admin/stats', () => {
    it('returns 401 without auth', async () => {
      await request(app.getHttpServer()).get('/api/v1/admin/stats').expect(401);
    });

    it('returns 403 for regular user', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      await request(app.getHttpServer())
        .get('/api/v1/admin/stats')
        .set('Cookie', user.cookie)
        .expect(403);
    });

    it('returns stats for admin user', async () => {
      const admin = await createAdminUser(prisma);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/stats')
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('companies');
    });
  });

  describe('GET /admin/users', () => {
    it('returns 403 for regular user', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Cookie', user.cookie)
        .expect(403);
    });

    it('returns paginated user list for admin', async () => {
      const admin = await createAdminUser(prisma);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(res.body).toHaveProperty('items');
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe('GET /admin/settings', () => {
    it('returns platform settings for admin', async () => {
      const admin = await createAdminUser(prisma);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/settings')
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(typeof res.body).toBe('object');
    });
  });
});
