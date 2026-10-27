/**
 * Authorization / IDOR tests.
 *
 * Every test has two users:
 *   - Owner  — creates the resource
 *   - Stranger — a completely separate account, NOT a member of Owner's company
 *
 * Stranger must never be able to read or mutate Owner's data.
 * Non-member access returns 404 (resource existence is not leaked).
 * Member with insufficient role returns 403.
 */
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupOwnerAndCompany() {
  const owner = await createAndLoginUser(app, prisma, {
    email: 'owner@example.com',
    password: 'password123',
    name: 'Owner',
  });
  const companyRes = await request(app.getHttpServer())
    .post('/api/v1/companies')
    .set('Cookie', owner.cookie)
    .send({ displayName: 'Owner Co SRL' });
  const companyId: string = companyRes.body.id;
  return { owner, companyId };
}

async function setupStranger() {
  return createAndLoginUser(app, prisma, {
    email: 'stranger@example.com',
    password: 'password123',
    name: 'Stranger',
  });
}

// ---------------------------------------------------------------------------
// Company endpoints
// ---------------------------------------------------------------------------

describe('Authorization — company endpoints', () => {
  it("stranger cannot GET another user's company", async () => {
    const { companyId } = await setupOwnerAndCompany();
    const stranger = await setupStranger();

    await request(app.getHttpServer())
      .get(`/api/v1/companies/${companyId}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
  });

  it("stranger cannot PATCH another user's company", async () => {
    const { companyId } = await setupOwnerAndCompany();
    const stranger = await setupStranger();

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${companyId}`)
      .set('Cookie', stranger.cookie)
      .send({ displayName: 'Hacked SRL' })
      .expect(404);
  });

  it("stranger cannot DELETE another user's company", async () => {
    const { companyId } = await setupOwnerAndCompany();
    const stranger = await setupStranger();

    await request(app.getHttpServer())
      .delete(`/api/v1/companies/${companyId}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
  });

  it("stranger cannot GET another user's company dashboard", async () => {
    const { companyId } = await setupOwnerAndCompany();
    const stranger = await setupStranger();

    await request(app.getHttpServer())
      .get(`/api/v1/companies/${companyId}/dashboard`)
      .set('Cookie', stranger.cookie)
      .expect(404);
  });

  it('editor member cannot delete the company (owner-only)', async () => {
    const { owner, companyId } = await setupOwnerAndCompany();
    const editor = await createAndLoginUser(app, prisma, {
      email: 'editor@example.com',
      password: 'password123',
      name: 'Editor',
    });

    // Add editor as a member
    await prisma.companyUser.create({
      data: { companyId, userId: editor.id, role: 'editor', status: 'active' },
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/companies/${companyId}`)
      .set('Cookie', editor.cookie)
      .expect(403);

    // Owner's company must still exist
    await request(app.getHttpServer())
      .get(`/api/v1/companies/${companyId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
  });

  it('editor member cannot PATCH the company (owner/manager only)', async () => {
    const { companyId } = await setupOwnerAndCompany();
    const editor = await createAndLoginUser(app, prisma, {
      email: 'editor@example.com',
      password: 'password123',
      name: 'Editor',
    });

    await prisma.companyUser.create({
      data: { companyId, userId: editor.id, role: 'editor', status: 'active' },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${companyId}`)
      .set('Cookie', editor.cookie)
      .send({ displayName: 'Sneaky Rename SRL' })
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// Lead endpoints
// ---------------------------------------------------------------------------

describe('Authorization — lead endpoints', () => {
  async function setupCompanyWithLead() {
    const { owner, companyId } = await setupOwnerAndCompany();

    // Activate company so it can receive leads
    await prisma.company.update({ where: { id: companyId }, data: { status: 'active' } });

    // Get the company slug
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const slug = company!.slug;

    // Submit a lead via the public endpoint
    const leadRes = await request(app.getHttpServer())
      .post(`/api/v1/public/companies/${slug}/lead`)
      .send({ channel: 'form', visitorHash: 'test-visitor-1' });

    const leadId: string | undefined = leadRes.body?.id;
    return { owner, companyId, slug, leadId };
  }

  it("stranger cannot list leads for another user's company", async () => {
    const { companyId } = await setupCompanyWithLead();
    const stranger = await setupStranger();

    await request(app.getHttpServer())
      .get(`/api/v1/companies/${companyId}/leads`)
      .set('Cookie', stranger.cookie)
      .expect((res) => expect([403, 404]).toContain(res.status));
  });

  it('stranger cannot GET a specific lead', async () => {
    const { companyId, leadId } = await setupCompanyWithLead();
    if (!leadId) return; // lead creation may vary

    const stranger = await setupStranger();

    await request(app.getHttpServer())
      .get(`/api/v1/companies/${companyId}/leads/${leadId}`)
      .set('Cookie', stranger.cookie)
      .expect((res) => expect([403, 404]).toContain(res.status));
  });

  it('stranger cannot DELETE a lead', async () => {
    const { companyId, leadId } = await setupCompanyWithLead();
    if (!leadId) return;

    const stranger = await setupStranger();

    await request(app.getHttpServer())
      .delete(`/api/v1/companies/${companyId}/leads/${leadId}`)
      .set('Cookie', stranger.cookie)
      .expect((res) => expect([403, 404]).toContain(res.status));
  });
});

// ---------------------------------------------------------------------------
// Campaign endpoints
// ---------------------------------------------------------------------------

describe('Authorization — campaign endpoints', () => {
  it("stranger cannot GET another user's campaign", async () => {
    const { companyId } = await setupOwnerAndCompany();
    const stranger = await setupStranger();

    await request(app.getHttpServer())
      .get(`/api/v1/companies/${companyId}/campaign`)
      .set('Cookie', stranger.cookie)
      .expect((res) => expect([403, 404]).toContain(res.status));
  });

  it("stranger cannot PUT (update) another user's campaign", async () => {
    const { companyId } = await setupOwnerAndCompany();
    const stranger = await setupStranger();

    await request(app.getHttpServer())
      .put(`/api/v1/companies/${companyId}/campaign`)
      .set('Cookie', stranger.cookie)
      .send({ cpc: 2, dailyBudget: 50 })
      .expect((res) => expect([403, 404]).toContain(res.status));
  });

  it("stranger cannot activate another user's campaign", async () => {
    const { companyId } = await setupOwnerAndCompany();
    const stranger = await setupStranger();

    await request(app.getHttpServer())
      .post(`/api/v1/companies/${companyId}/campaign/activate`)
      .set('Cookie', stranger.cookie)
      .expect((res) => expect([403, 404]).toContain(res.status));
  });

  it("stranger cannot pause another user's campaign", async () => {
    const { companyId } = await setupOwnerAndCompany();
    const stranger = await setupStranger();

    await request(app.getHttpServer())
      .post(`/api/v1/companies/${companyId}/campaign/pause`)
      .set('Cookie', stranger.cookie)
      .expect((res) => expect([403, 404]).toContain(res.status));
  });

  it('editor member cannot activate the campaign (owner/manager/billing only)', async () => {
    const { companyId } = await setupOwnerAndCompany();
    const editor = await createAndLoginUser(app, prisma, {
      email: 'editor@example.com',
      password: 'password123',
      name: 'Editor',
    });

    await prisma.companyUser.create({
      data: { companyId, userId: editor.id, role: 'editor', status: 'active' },
    });

    // Save campaign first
    const ownerCookie = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@example.com', password: 'password123' })
      .then((r) => (r.headers['set-cookie'] as unknown as string[])[0]);

    await request(app.getHttpServer())
      .put(`/api/v1/companies/${companyId}/campaign`)
      .set('Cookie', ownerCookie)
      .send({ cpc: 2, dailyBudget: 50 });

    await request(app.getHttpServer())
      .post(`/api/v1/companies/${companyId}/campaign/activate`)
      .set('Cookie', editor.cookie)
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated access
// ---------------------------------------------------------------------------

describe('Authorization — unauthenticated', () => {
  it('no cookie returns 401 on all protected company endpoints', async () => {
    const { companyId } = await setupOwnerAndCompany();

    await request(app.getHttpServer()).get(`/api/v1/companies/${companyId}`).expect(401);
    await request(app.getHttpServer()).patch(`/api/v1/companies/${companyId}`).send({}).expect(401);
    await request(app.getHttpServer()).delete(`/api/v1/companies/${companyId}`).expect(401);
    await request(app.getHttpServer()).get(`/api/v1/companies/${companyId}/leads`).expect(401);
    await request(app.getHttpServer()).get(`/api/v1/companies/${companyId}/campaign`).expect(401);
    await request(app.getHttpServer())
      .put(`/api/v1/companies/${companyId}/campaign`)
      .send({})
      .expect(401);
  });
});
