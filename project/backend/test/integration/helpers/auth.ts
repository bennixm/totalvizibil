import { INestApplication } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import request from 'supertest';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  password: string;
  cookie: string;
}

export interface TestUserMinimal {
  id: string;
  email: string;
  name: string;
}

/** Register a user, verify their email directly in the DB, then log in. Returns session cookie. */
export async function createAndLoginUser(
  app: INestApplication,
  prisma: PrismaService,
  data: { email: string; password: string; name: string },
): Promise<TestUser> {
  // Register
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email: data.email, password: data.password, name: data.name })
    .expect(201);

  // Bypass email verification (no SMTP in tests)
  const user = await prisma.user.update({
    where: { email: data.email },
    data: { emailVerifiedAt: new Date() },
  });

  // Log in
  const loginRes = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: data.email, password: data.password })
    .expect(200);

  const cookie = (loginRes.headers['set-cookie'] as unknown as string[])[0];

  return { id: user.id, email: data.email, name: data.name, password: data.password, cookie };
}

/**
 * Create a user directly via Prisma — no HTTP calls, no throttle hits.
 * Use in tests that only need the user ID (e.g., as ownerUserId for company seeding)
 * and never need an authenticated cookie.
 */
export async function createUserDirect(
  prisma: PrismaService,
  data: { email: string; name: string },
): Promise<TestUserMinimal> {
  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash: 'test-placeholder-not-for-login',
      name: data.name,
      emailVerifiedAt: new Date(),
    },
  });
  return { id: user.id, email: data.email, name: data.name };
}
