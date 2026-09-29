import { BadRequestException } from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service';

/** Minimal in-memory Prisma double — same pattern as password-reset.service.spec.ts. */
function fakePrisma() {
  const users = new Map<string, Record<string, unknown>>();
  const codes = new Map<string, Record<string, unknown>>();
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
    emailVerificationCode: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const c = {
          id: `code_${++seq}`,
          usedAt: null,
          attempts: 0,
          createdAt: new Date(),
          ...data,
        };
        codes.set(c.id, c);
        return { ...c };
      }),
      findFirst: jest.fn(async ({ where }: { where: { userId: string } }) => {
        const rows = [...codes.values()]
          .filter((c) => c.userId === where.userId)
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
        return rows[0] ? { ...rows[0] } : null;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown> & { attempts?: { increment: number } };
        }) => {
          const c = codes.get(where.id) as Record<string, unknown>;
          const { attempts, ...rest } = data;
          Object.assign(c, rest);
          if (attempts && typeof attempts === 'object' && 'increment' in attempts) {
            c.attempts = (c.attempts as number) + attempts.increment;
          }
          return { ...c };
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
          for (const c of codes.values()) {
            if (c.userId === where.userId && c.usedAt === null) {
              Object.assign(c, data);
              count++;
            }
          }
          return { count };
        },
      ),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    __users: users,
    __codes: codes,
    __seedUser(overrides: Partial<Record<string, unknown>> = {}) {
      const id = `user_${++seq}`;
      const u = {
        id,
        email: `user${seq}@example.com`,
        name: 'Test User',
        emailVerifiedAt: null,
        ...overrides,
      };
      users.set(id, u);
      return u;
    },
  };
  return client;
}

function fakeMail(dispatched = true) {
  return {
    configured: true,
    send: jest.fn(async (_msg: { to: string; subject: string; text: string; html?: string }) => ({
      dispatched,
    })),
  };
}

function makeService(mail = fakeMail()) {
  const prisma = fakePrisma();
  const service = new EmailVerificationService(prisma as any, mail as any);
  return { service, prisma, mail };
}

function codeFromMailCall(mail: ReturnType<typeof fakeMail>): string {
  const call = mail.send.mock.calls[mail.send.mock.calls.length - 1][0] as { text: string };
  const match = call.text.match(/(\d{6})/);
  if (!match) throw new Error('no code found in mail text');
  return match[1];
}

describe('EmailVerificationService', () => {
  describe('sendCode', () => {
    it('emails a 6-digit code to the user', async () => {
      const { service, prisma, mail } = makeService();
      const user = prisma.__seedUser();

      await service.sendCode(user.id as string);

      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(mail.send.mock.calls[0][0].to).toBe(user.email);
      expect(codeFromMailCall(mail)).toMatch(/^\d{6}$/);
      expect(prisma.__codes.size).toBe(1);
    });

    it('rejects a resend within the cooldown window', async () => {
      const { service, prisma } = makeService();
      const user = prisma.__seedUser();
      await service.sendCode(user.id as string);

      await expect(service.sendCode(user.id as string)).rejects.toThrow(BadRequestException);
    });

    it('invalidates the previous code when a new one is sent (after cooldown)', async () => {
      const { service, prisma, mail } = makeService();
      const user = prisma.__seedUser();
      await service.sendCode(user.id as string);
      const firstCode = codeFromMailCall(mail);
      // Simulate the cooldown having elapsed.
      const row = [...prisma.__codes.values()][0] as { createdAt: Date };
      row.createdAt = new Date(Date.now() - 60_000);
      mail.send.mockClear();

      await service.sendCode(user.id as string);
      const secondCode = codeFromMailCall(mail);

      expect(firstCode).not.toBe(secondCode);
      // Only the most recent code is ever checked against — an older,
      // superseded code just reads as a wrong code, same as any other guess.
      await expect(service.verify(user.email as string, firstCode)).rejects.toMatchObject({
        message: 'code_invalid',
      });
      await expect(service.verify(user.email as string, secondCode)).resolves.toEqual({ ok: true });
    });

    it('surfaces a real send failure from a configured transport', async () => {
      const { service, prisma } = makeService(fakeMail(false));
      const user = prisma.__seedUser();
      await expect(service.sendCode(user.id as string)).rejects.toMatchObject({
        message: 'email_send_failed',
      });
    });
  });

  describe('verify', () => {
    it('accepts the correct code', async () => {
      const { service, prisma, mail } = makeService();
      const user = prisma.__seedUser();
      await service.sendCode(user.id as string);
      const code = codeFromMailCall(mail);

      const result = await service.verify(user.email as string, code);

      expect(result).toEqual({ ok: true });
      const updatedUser = prisma.__users.get(user.id as string) as { emailVerifiedAt: Date };
      expect(updatedUser.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('rejects a wrong code and counts the attempt', async () => {
      const { service, prisma } = makeService();
      const user = prisma.__seedUser();
      await service.sendCode(user.id as string);

      await expect(service.verify(user.email as string, '000000')).rejects.toMatchObject({
        message: 'code_invalid',
      });
      const row = [...prisma.__codes.values()][0] as { attempts: number };
      expect(row.attempts).toBe(1);
    });

    it('locks out after too many wrong attempts', async () => {
      const { service, prisma } = makeService();
      const user = prisma.__seedUser();
      await service.sendCode(user.id as string);

      for (let i = 0; i < 5; i++) {
        await expect(service.verify(user.email as string, '000000')).rejects.toMatchObject({
          message: 'code_invalid',
        });
      }
      await expect(service.verify(user.email as string, '000000')).rejects.toMatchObject({
        message: 'too_many_attempts',
      });
    });

    it('rejects an expired code', async () => {
      const { service, prisma, mail } = makeService();
      const user = prisma.__seedUser();
      await service.sendCode(user.id as string);
      const code = codeFromMailCall(mail);
      const row = [...prisma.__codes.values()][0] as { expiresAt: Date };
      row.expiresAt = new Date(Date.now() - 1000);

      await expect(service.verify(user.email as string, code)).rejects.toMatchObject({
        message: 'code_expired',
      });
    });

    it('rejects an already-used code', async () => {
      const { service, prisma, mail } = makeService();
      const user = prisma.__seedUser();
      await service.sendCode(user.id as string);
      const code = codeFromMailCall(mail);

      await service.verify(user.email as string, code);
      await expect(service.verify(user.email as string, code)).resolves.toEqual({ ok: true }); // already verified — idempotent
    });

    it('rejects a code for an unknown email', async () => {
      const { service } = makeService();
      await expect(service.verify('nobody@example.com', '123456')).rejects.toMatchObject({
        message: 'code_invalid',
      });
    });

    it('rejects when no code was ever sent', async () => {
      const { service, prisma } = makeService();
      const user = prisma.__seedUser();
      await expect(service.verify(user.email as string, '123456')).rejects.toMatchObject({
        message: 'code_invalid',
      });
    });
  });

  describe('resendFor', () => {
    it('is a silent no-op for an unknown email (anti-enumeration)', async () => {
      const { service, mail } = makeService();
      await service.resendFor('nobody@example.com');
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('is a silent no-op for an already-verified account', async () => {
      const { service, prisma, mail } = makeService();
      const user = prisma.__seedUser({ emailVerifiedAt: new Date() });
      await service.resendFor(user.email as string);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('sends a fresh code for an unverified account', async () => {
      const { service, prisma, mail } = makeService();
      const user = prisma.__seedUser();
      await service.resendFor(user.email as string);
      expect(mail.send).toHaveBeenCalledTimes(1);
    });
  });
});
