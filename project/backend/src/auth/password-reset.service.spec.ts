import { BadRequestException } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';

/** Minimal in-memory Prisma double — just the User/PasswordResetToken calls
 *  this service actually makes. `$transaction` here only ever receives an
 *  array of pre-built operations (this service never uses the callback
 *  form), so it just resolves them in order like Prisma would. */
function fakePrisma() {
  const users = new Map<string, Record<string, unknown>>();
  const tokens = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const client: any = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        const u = where.id
          ? users.get(where.id)
          : [...users.values()].find((u) => u.email === where.email);
        return u ? { ...u } : null;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const u = users.get(where.id) as Record<string, unknown>;
          Object.assign(u, data);
          return { ...u };
        },
      ),
    },
    passwordResetToken: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const t = { id: `token_${++seq}`, usedAt: null, createdAt: new Date(), ...data };
        tokens.set(t.id, t);
        return { ...t };
      }),
      findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const t = [...tokens.values()].find((t) => t.tokenHash === where.tokenHash);
        return t ? { ...t } : null;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const t = tokens.get(where.id) as Record<string, unknown>;
          Object.assign(t, data);
          return { ...t };
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { userId: string; usedAt: null };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const t of tokens.values()) {
            if (t.userId === where.userId && t.usedAt === null) {
              Object.assign(t, data);
              count++;
            }
          }
          return { count };
        },
      ),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    __users: users,
    __tokens: tokens,
    __seedUser(overrides: Partial<Record<string, unknown>> = {}) {
      const id = `user_${++seq}`;
      const u = {
        id,
        email: `user${seq}@example.com`,
        status: 'active',
        passwordHash: 'old-hash',
        ...overrides,
      };
      users.set(id, u);
      return u;
    },
  };
  return client;
}

function fakePasswords() {
  return {
    hash: jest.fn(async (plain: string) => `hashed(${plain})`),
    verify: jest.fn(async () => true),
  };
}
function fakeSessions() {
  return { revokeAllForUser: jest.fn(async () => 0) };
}
function fakeMail() {
  return {
    send: jest.fn(async (_msg: { to: string; subject: string; text: string; html?: string }) => ({
      dispatched: true,
    })),
  };
}
function fakeConfig() {
  return { get: jest.fn(() => 'https://totalvizibil.ro') };
}

function makeService() {
  const prisma = fakePrisma();
  const passwords = fakePasswords();
  const sessions = fakeSessions();
  const mail = fakeMail();
  const config = fakeConfig();
  const service = new PasswordResetService(
    prisma as any,
    passwords as any,
    sessions as any,
    mail as any,
    config as any,
  );
  return { service, prisma, passwords, sessions, mail };
}

function tokenFromMailCall(mail: ReturnType<typeof fakeMail>): string {
  const call = mail.send.mock.calls[0][0] as { text: string };
  const match = call.text.match(/token=([^\s&]+)/);
  if (!match) throw new Error('no token found in mail text');
  return match[1];
}

describe('PasswordResetService', () => {
  it('does nothing observable for an email with no account (anti-enumeration)', async () => {
    const { service, prisma, mail } = makeService();
    const result = await service.request('nobody@example.com');
    expect(result).toEqual({ ok: true });
    expect(mail.send).not.toHaveBeenCalled();
    expect(prisma.__tokens.size).toBe(0);
  });

  it('does nothing observable for a suspended account', async () => {
    const { service, prisma, mail } = makeService();
    prisma.__seedUser({ status: 'suspended' });
    const result = await service.request(prisma.__seedUser({ status: 'suspended' }).email);
    expect(result).toEqual({ ok: true });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('creates a token and emails a real platform link — never localhost, never in the response', async () => {
    const { service, prisma, mail } = makeService();
    const user = prisma.__seedUser();

    const result = await service.request(user.email as string);

    expect(result).toEqual({ ok: true }); // no devResetUrl — production has one real path
    expect(mail.send).toHaveBeenCalledTimes(1);
    const call = mail.send.mock.calls[0][0] as { to: string; text: string; html: string };
    expect(call.to).toBe(user.email);
    expect(call.text).toContain('https://totalvizibil.ro/reset-password?token=');
    expect(call.text).not.toContain('localhost');
    expect(call.html).toContain('https://totalvizibil.ro/reset-password?token=');
    expect(prisma.__tokens.size).toBe(1);
  });

  it('a second request invalidates the first token', async () => {
    const { service, prisma, mail } = makeService();
    const user = prisma.__seedUser();

    await service.request(user.email as string);
    const firstToken = tokenFromMailCall(mail);
    mail.send.mockClear();
    await service.request(user.email as string);
    const secondToken = tokenFromMailCall(mail);

    expect(firstToken).not.toBe(secondToken);
    await expect(service.reset(firstToken, 'newPassword123')).rejects.toThrow(
      /invalid or has expired/,
    );
    // The second (current) token still works.
    await expect(service.reset(secondToken, 'newPassword123')).resolves.toEqual({ ok: true });
  });

  it('a valid token resets the password and revokes every session', async () => {
    const { service, prisma, passwords, sessions, mail } = makeService();
    const user = prisma.__seedUser();
    await service.request(user.email as string);
    const token = tokenFromMailCall(mail);

    const result = await service.reset(token, 'brandNewPassword!23');

    expect(result).toEqual({ ok: true });
    expect(passwords.hash).toHaveBeenCalledWith('brandNewPassword!23');
    const updatedUser = prisma.__users.get(user.id as string) as { passwordHash: string };
    expect(updatedUser.passwordHash).toBe('hashed(brandNewPassword!23)');
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(user.id);
  });

  it('rejects reusing an already-used token', async () => {
    const { service, prisma, mail } = makeService();
    const user = prisma.__seedUser();
    await service.request(user.email as string);
    const token = tokenFromMailCall(mail);

    await service.reset(token, 'firstNewPassword!23');

    await expect(service.reset(token, 'secondAttempt!23')).rejects.toThrow(BadRequestException);
    await expect(service.reset(token, 'secondAttempt!23')).rejects.toThrow(
      /invalid or has expired/,
    );
  });

  it('rejects an expired token', async () => {
    const { service, prisma, mail } = makeService();
    const user = prisma.__seedUser();
    await service.request(user.email as string);
    const token = tokenFromMailCall(mail);
    const row = [...prisma.__tokens.values()][0] as { expiresAt: Date };
    row.expiresAt = new Date(Date.now() - 1000); // already expired

    await expect(service.reset(token, 'newPassword!23')).rejects.toThrow(BadRequestException);
  });

  it('rejects a garbage/unknown token', async () => {
    const { service } = makeService();
    await expect(service.reset('not-a-real-token', 'newPassword!23')).rejects.toThrow(
      BadRequestException,
    );
  });
});
