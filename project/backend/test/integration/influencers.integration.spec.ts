import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from 'src/prisma/prisma.service';
import { PlatformSettingsService } from 'src/platform-settings/platform-settings.service';
import { createTestApp } from './helpers/app';
import { resetDb } from './helpers/db';
import { createAndLoginUser, TestUser } from './helpers/auth';
import { MailService } from 'src/mail/mail.service';

/**
 * Influencers end to end on the real database (top-ups through the dev-stub
 * provider: the test env has no Stripe key, and the influencer logic sits
 * on the same purchase/confirm path a Stripe payment goes through).
 */
let app: INestApplication;
let prisma: PrismaService;
let settings: PlatformSettingsService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  settings = app.get(PlatformSettingsService);
});
beforeEach(async () => {
  await resetDb(prisma, app);
  await settings.set('credits_discount_enabled', 'false');
  await settings.set('affiliate_enabled', 'true');
});
afterAll(async () => app.close());

const http = () => request(app.getHttpServer());

async function admin(): Promise<TestUser> {
  const u = await createAndLoginUser(app, prisma, {
    email: 'admin@example.com',
    password: 'password123',
    name: 'Admin',
  });
  await prisma.platformRoleAssignment.create({ data: { userId: u.id, role: 'admin' } });
  return u;
}
async function customer(email: string): Promise<TestUser> {
  const u = await createAndLoginUser(app, prisma, {
    email,
    password: 'password123',
    name: 'Client ' + email.split('@')[0],
  });
  await http()
    .put('/api/v1/account/billing/profile')
    .set('Cookie', u.cookie)
    .send({
      kind: 'individual',
      name: 'Client',
      address: 'Str. 1',
      city: 'Cluj',
      county: 'Cluj',
      country: 'RO',
    })
    .expect(200);
  return u;
}
async function deposit(u: TestUser, credits: number) {
  const start = await http()
    .post('/api/v1/wallet/purchases')
    .set('Cookie', u.cookie)
    .send({ credits })
    .expect(201);
  await http()
    .post(`/api/v1/wallet/purchases/${start.body.transactionId}/confirm`)
    .set('Cookie', u.cookie)
    .expect(201);
  return prisma.walletTransaction.findUniqueOrThrow({ where: { id: start.body.transactionId } });
}
/** Admin creates influencer ANDREI15 (15% off, 20% commission) and the
 *  influencer account is logged in (its password set directly here). */
async function setupInfluencer(adm: TestUser) {
  const res = await http()
    .post('/api/v1/admin/influencers')
    .set('Cookie', adm.cookie)
    .send({
      email: 'andrei@example.com',
      name: 'Andrei',
      code: 'andrei15',
      discountPct: 15,
      commissionPct: 20,
    })
    .expect(201);
  return res.body;
}

describe('Influencers', () => {
  it('admin creates an influencer: new verified account, uppercase code, invite sent', async () => {
    const adm = await admin();
    const body = await setupInfluencer(adm);
    expect(body.invited).toBe(true);
    expect(body.influencer.code).toBe('ANDREI15');
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'andrei@example.com' },
      include: { platformRoles: true },
    });
    expect(user.emailVerifiedAt).not.toBeNull();
    // An influencer is NOT staff.
    expect(user.platformRoles).toHaveLength(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it("codes are unique across influencers and users' referral codes, and validated", async () => {
    const adm = await admin();
    await setupInfluencer(adm);
    await http()
      .post('/api/v1/admin/influencers')
      .set('Cookie', adm.cookie)
      .send({
        email: 'x@example.com',
        name: 'Xavi',
        code: 'ANDREI15',
        discountPct: 5,
        commissionPct: 5,
      })
      .expect(409);
    const someone = await customer('someone@example.com');
    await prisma.user.update({ where: { id: someone.id }, data: { referralCode: 'TAKEN123' } });
    await http()
      .post('/api/v1/admin/influencers')
      .set('Cookie', adm.cookie)
      .send({
        email: 'y@example.com',
        name: 'Yana',
        code: 'taken123',
        discountPct: 5,
        commissionPct: 5,
      })
      .expect(409);
    await http()
      .post('/api/v1/admin/influencers')
      .set('Cookie', adm.cookie)
      .send({ email: 'z@example.com', name: 'Zoe', code: 'a b', discountPct: 5, commissionPct: 5 })
      .expect(400);
    await http()
      .post('/api/v1/admin/influencers')
      .set('Cookie', adm.cookie)
      .send({
        email: 'z@example.com',
        name: 'Zoe',
        code: 'OKCODE',
        discountPct: 95,
        commissionPct: 5,
      })
      .expect(400);
  });

  it('first deposit: discount applied, influencer credited the commission with an invoice; later deposits at normal price', async () => {
    const adm = await admin();
    const { influencer } = await setupInfluencer(adm);
    const client = await customer('ana@example.com');

    const claim = await http()
      .post('/api/v1/affiliate/claim')
      .set('Cookie', client.cookie)
      .send({ code: 'andrei15' })
      .expect(201);
    expect(claim.body).toEqual({
      claimed: true,
      influencer: { code: 'ANDREI15', discountPct: 15 },
    });
    const summary = await http().get('/api/v1/wallet').set('Cookie', client.cookie).expect(200);
    expect(summary.body.firstDepositDiscount).toMatchObject({ pct: 15, code: 'ANDREI15' });

    const first = await deposit(client, 100);
    expect(first.eurCents).toBe(8500); // 15% off
    expect(first.amountMinor).toBe(10000); // full credits
    expect(first.discountPct).toBe(15);

    const commission = await prisma.influencerCommission.findUniqueOrThrow({
      where: { referredUserId: client.id },
    });
    expect(commission.commissionMinor).toBe(1700); // 20% of 85.00 EUR paid
    const infWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: influencer.userId },
    });
    expect(infWallet.balanceMinor).toBe(1700);
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: commission.invoiceId! },
    });
    expect(invoice.kind).toBe('affiliate_reward');

    const second = await deposit(client, 50);
    expect(second.eurCents).toBe(5000);
    expect(second.influencerId).toBeNull();
    expect(await prisma.influencerCommission.count()).toBe(1);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { userId: influencer.userId } }))
        .balanceMinor,
    ).toBe(1700);
    const after = await http().get('/api/v1/wallet').set('Cookie', client.cookie).expect(200);
    expect(after.body.firstDepositDiscount).toBeNull();
  });

  it('stacks with an active global discount', async () => {
    const adm = await admin();
    await setupInfluencer(adm);
    await settings.set('credits_discount_enabled', 'true');
    await settings.set('credits_discount_pct', '10');
    const client = await customer('bia@example.com');
    await http()
      .post('/api/v1/affiliate/claim')
      .set('Cookie', client.cookie)
      .send({ code: 'ANDREI15' })
      .expect(201);
    const first = await deposit(client, 100);
    expect(first.discountPct).toBe(25);
    expect(first.eurCents).toBe(7500);
  });

  it('a code is refused after the first deposit, for the influencer themself, and when inactive', async () => {
    const adm = await admin();
    const { influencer } = await setupInfluencer(adm);
    const late = await customer('late@example.com');
    await deposit(late, 10);
    const r1 = await http()
      .post('/api/v1/affiliate/claim')
      .set('Cookie', late.cookie)
      .send({ code: 'ANDREI15' })
      .expect(201);
    expect(r1.body.claimed).toBe(false);

    await http()
      .patch(`/api/v1/admin/influencers/${influencer.id}`)
      .set('Cookie', adm.cookie)
      .send({ active: false })
      .expect(200);
    const fresh = await customer('fresh@example.com');
    const r2 = await http()
      .post('/api/v1/affiliate/claim')
      .set('Cookie', fresh.cookie)
      .send({ code: 'ANDREI15' })
      .expect(201);
    expect(r2.body.claimed).toBe(false);
  });

  it('the regular affiliate reward is never paid for an influencer referral', async () => {
    const adm = await admin();
    await setupInfluencer(adm);
    const client = await customer('cris@example.com');
    await http()
      .post('/api/v1/affiliate/claim')
      .set('Cookie', client.cookie)
      .send({ code: 'ANDREI15' })
      .expect(201);
    await deposit(client, 200);
    const referral = await prisma.referral.findUniqueOrThrow({
      where: { referredUserId: client.id },
    });
    expect(referral.status).toBe('pending');
    const list = await http().get('/api/v1/admin/referrals').set('Cookie', adm.cookie).expect(200);
    expect(list.body.totalAll).toBe(0); // influencer referrals have their own page
  });

  it("influencer panel: own stats only, read-only, customers' emails masked", async () => {
    const adm = await admin();
    const { influencer } = await setupInfluencer(adm);
    const client = await customer('dana.pop@example.com');
    await http()
      .post('/api/v1/affiliate/claim')
      .set('Cookie', client.cookie)
      .send({ code: 'ANDREI15' })
      .expect(201);
    await deposit(client, 100);
    await deposit(client, 20);
    await customer('noclaim@example.com');

    // Log the influencer in (password set directly; the real flow is the invite email).
    const infUser = await prisma.user.findUniqueOrThrow({ where: { id: influencer.userId } });
    const { PasswordService } = await import('src/auth/password.service');
    await prisma.user.update({
      where: { id: infUser.id },
      data: { passwordHash: await app.get(PasswordService).hash('password123') },
    });
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: infUser.email, password: 'password123' })
      .expect(200);
    const cookie = login.headers['set-cookie'];
    expect(login.body.user.isInfluencer).toBe(true);

    const me = await http().get('/api/v1/influencer/me').set('Cookie', cookie).expect(200);
    expect(me.body.influencer.code).toBe('ANDREI15');
    expect(me.body.totals).toMatchObject({
      users: 1,
      depositors: 1,
      deposits: 2,
      conversionPct: 100,
    });
    expect(me.body.totals.depositsPaid.minor).toBe(8500 + 2000);
    expect(me.body.totals.commissions.minor).toBe(1700);
    expect(me.body.users[0].email).toBe('da•••@example.com');
    expect(me.body.deposits.filter((d: { first: boolean }) => d.first)).toHaveLength(1);

    // No write access anywhere.
    await http()
      .patch(`/api/v1/admin/influencers/${influencer.id}`)
      .set('Cookie', cookie)
      .send({ discountPct: 90 })
      .expect(403);
    await http().get('/api/v1/admin/influencers').set('Cookie', cookie).expect(403);
    await http()
      .patch('/api/v1/influencer/me')
      .set('Cookie', cookie)
      .send({ code: 'X' })
      .expect(404);
    expect(
      (await prisma.influencer.findUniqueOrThrow({ where: { id: influencer.id } })).discountPct,
    ).toBe(15);
  });

  it('a regular user has no influencer panel', async () => {
    const u = await customer('plain@example.com');
    await http().get('/api/v1/influencer/me').set('Cookie', u.cookie).expect(404);
  });

  it('admin can change code and percentages; finance can only read', async () => {
    const adm = await admin();
    const { influencer } = await setupInfluencer(adm);
    const res = await http()
      .patch(`/api/v1/admin/influencers/${influencer.id}`)
      .set('Cookie', adm.cookie)
      .send({ code: 'andrei20', discountPct: 20, commissionPct: 25 })
      .expect(200);
    expect(res.body.influencer).toMatchObject({
      code: 'ANDREI20',
      discountPct: 20,
      commissionPct: 25,
    });
    expect(await prisma.adminAuditLog.count({ where: { action: 'influencer.update' } })).toBe(1);

    const fin = await createAndLoginUser(app, prisma, {
      email: 'fin@example.com',
      password: 'password123',
      name: 'Fin',
    });
    await prisma.platformRoleAssignment.create({ data: { userId: fin.id, role: 'finance' } });
    await http().get('/api/v1/admin/influencers').set('Cookie', fin.cookie).expect(200);
    await http()
      .patch(`/api/v1/admin/influencers/${influencer.id}`)
      .set('Cookie', fin.cookie)
      .send({ active: false })
      .expect(403);
  });

  it('a new influencer gets the dedicated welcome email with a 7-day set-password link, not the reset email', async () => {
    const mail = app.get(MailService);
    const spy = jest.spyOn(mail, 'send');
    const adm = await admin();
    await setupInfluencer(adm);
    const sent = spy.mock.calls.map((c) => c[0]).filter((m) => m.to === 'andrei@example.com');
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('ANDREI15');
    expect(sent[0].subject).not.toMatch(/Resetează/);
    expect(sent[0].html).toContain('/set-password?token=');
    expect(sent[0].html).toContain('Setează-ți parola');
    const token = await prisma.passwordResetToken.findFirstOrThrow({
      where: { user: { email: 'andrei@example.com' } },
    });
    expect(token.expiresAt.getTime() - Date.now()).toBeGreaterThan(6 * 24 * 3600 * 1000);
    spy.mockRestore();
  });

  it('admin › user: shows the influencer profile, who brought a user in, and the influencer filter', async () => {
    const adm = await admin();
    const { influencer } = await setupInfluencer(adm);
    const client = await customer('eva@example.com');
    await http()
      .post('/api/v1/affiliate/claim')
      .set('Cookie', client.cookie)
      .send({ code: 'ANDREI15' })
      .expect(201);
    await deposit(client, 100);

    const infDetail = await http()
      .get(`/api/v1/admin/users/${influencer.userId}`)
      .set('Cookie', adm.cookie)
      .expect(200);
    expect(infDetail.body.influencer).toMatchObject({ code: 'ANDREI15', users: 1, depositors: 1 });
    expect(infDetail.body.influencer.commissions.minor).toBe(1700);

    const clientDetail = await http()
      .get(`/api/v1/admin/users/${client.id}`)
      .set('Cookie', adm.cookie)
      .expect(200);
    expect(clientDetail.body.referredBy).toMatchObject({
      kind: 'influencer',
      influencer: { code: 'ANDREI15' },
    });
    expect(clientDetail.body.referredBy.commission.commission.minor).toBe(1700);
    expect(clientDetail.body.canChangeReferral).toBe(false);

    const list = await http()
      .get('/api/v1/admin/users?role=influencer')
      .set('Cookie', adm.cookie)
      .expect(200);
    expect(list.body.items.map((u: { id: string }) => u.id)).toEqual([influencer.userId]);
    expect(list.body.items[0].influencer).toMatchObject({ code: 'ANDREI15', active: true });
    const byCode = await http()
      .get('/api/v1/admin/users?search=andrei15')
      .set('Cookie', adm.cookie)
      .expect(200);
    expect(byCode.body.items.map((u: { id: string }) => u.id)).toContain(influencer.userId);
  });

  it('admin can attach / detach a code before the first deposit, never after', async () => {
    const adm = await admin();
    await setupInfluencer(adm);
    const client = await customer('fane@example.com');
    await http()
      .post(`/api/v1/admin/users/${client.id}/referral`)
      .set('Cookie', adm.cookie)
      .send({ code: 'nope' })
      .expect(400);
    await http()
      .post(`/api/v1/admin/users/${client.id}/referral`)
      .set('Cookie', adm.cookie)
      .send({ code: 'andrei15' })
      .expect(201);
    await http()
      .post(`/api/v1/admin/users/${client.id}/referral`)
      .set('Cookie', adm.cookie)
      .send({ code: 'ANDREI15' })
      .expect(409);
    let w = await http().get('/api/v1/wallet').set('Cookie', client.cookie).expect(200);
    expect(w.body.firstDepositDiscount?.pct).toBe(15);
    await http()
      .delete(`/api/v1/admin/users/${client.id}/referral`)
      .set('Cookie', adm.cookie)
      .expect(200);
    w = await http().get('/api/v1/wallet').set('Cookie', client.cookie).expect(200);
    expect(w.body.firstDepositDiscount).toBeNull();

    await http()
      .post(`/api/v1/admin/users/${client.id}/referral`)
      .set('Cookie', adm.cookie)
      .send({ code: 'ANDREI15' })
      .expect(201);
    await deposit(client, 10);
    await http()
      .delete(`/api/v1/admin/users/${client.id}/referral`)
      .set('Cookie', adm.cookie)
      .expect(400);
    expect(
      await prisma.adminAuditLog.count({
        where: { action: { startsWith: 'influencer.referral.' } },
      }),
    ).toBe(3);

    // Finance can read the user but not change the link.
    const fin = await createAndLoginUser(app, prisma, {
      email: 'fin2@example.com',
      password: 'password123',
      name: 'Fin',
    });
    await prisma.platformRoleAssignment.create({ data: { userId: fin.id, role: 'finance' } });
    await http()
      .delete(`/api/v1/admin/users/${client.id}/referral`)
      .set('Cookie', fin.cookie)
      .expect(403);
  });
});
