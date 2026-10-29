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

describe('Auth', () => {
  describe('POST /auth/register', () => {
    it('creates account and returns 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'ion@example.com', password: 'password123', name: 'Ion' })
        .expect(201);
      expect(res.body).toMatchObject({ user: { email: 'ion@example.com', name: 'Ion' } });
    });

    it('allows the SAME browser to resubmit a still-unverified email (onboarding email-edit step)', async () => {
      const body = { email: 'ion@example.com', password: 'password123', name: 'Ion' };
      const first = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(body)
        .expect(201);
      // The browser replays the pending-registration cookie it was issued.
      const pendingCookie = (first.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith('tvz_pending_reg='))
        ?.split(';')[0];
      expect(pendingCookie).toBeDefined();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Cookie', pendingCookie as string)
        .send({ ...body, name: 'Ion Updated' })
        .expect(201);
      expect(res.body).toMatchObject({ user: { email: 'ion@example.com', name: 'Ion Updated' } });
    });

    it('ignores a resubmit from a browser without the pending-registration cookie', async () => {
      const body = { email: 'ion@example.com', password: 'password123', name: 'Ion' };
      await request(app.getHttpServer()).post('/api/v1/auth/register').send(body).expect(201);
      const before = await prisma.user.findUniqueOrThrow({
        where: { email: 'ion@example.com' },
        select: { name: true, passwordHash: true },
      });

      // No cookie — indistinguishable from an attacker probing a pending email.
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...body, password: 'attackerpass', name: 'Attacker' })
        .expect(201);

      expect(res.body).toMatchObject({ user: { email: 'ion@example.com', name: 'Ion' } });
      const after = await prisma.user.findUniqueOrThrow({
        where: { email: 'ion@example.com' },
        select: { name: true, passwordHash: true },
      });
      expect(after).toEqual(before);
    });

    it('returns 409 when the email already belongs to a verified account', async () => {
      const body = { email: 'ion@example.com', password: 'password123', name: 'Ion' };
      await request(app.getHttpServer()).post('/api/v1/auth/register').send(body).expect(201);
      await prisma.user.update({
        where: { email: 'ion@example.com' },
        data: { emailVerifiedAt: new Date() },
      });
      await request(app.getHttpServer()).post('/api/v1/auth/register').send(body).expect(409);
    });

    it('returns 400 when password is too short', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'a@b.com', password: 'short', name: 'Ion' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('returns 401 for wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'ion@example.com', password: 'password123', name: 'Ion' });
      await prisma.user.update({
        where: { email: 'ion@example.com' },
        data: { emailVerifiedAt: new Date() },
      });
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ion@example.com', password: 'wrongpass' })
        .expect(401);
    });

    it('returns 200 and sets session cookie on valid credentials', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'ion@example.com', password: 'password123', name: 'Ion' });
      await prisma.user.update({
        where: { email: 'ion@example.com' },
        data: { emailVerifiedAt: new Date() },
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ion@example.com', password: 'password123' })
        .expect(200);
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'][0]).toMatch(/tvz_session=/);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 401 without cookie', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('returns user when authenticated', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body.user).toMatchObject({ email: 'ion@example.com', name: 'Ion' });
    });
  });

  describe('POST /auth/logout', () => {
    it('returns 200 and clears cookie', async () => {
      const user = await createAndLoginUser(app, prisma, {
        email: 'ion@example.com',
        password: 'password123',
        name: 'Ion',
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', user.cookie)
        .expect(200);
      const setCookie = res.headers['set-cookie'] as unknown as string[];
      expect(setCookie?.some((c: string) => c.includes('tvz_session=;'))).toBe(true);
    });
  });
});
