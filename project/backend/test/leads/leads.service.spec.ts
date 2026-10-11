import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LeadsService } from 'src/leads/leads.service';

function fakeConfig(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = { frontendOrigin: 'http://localhost:5173' };
  return { get: jest.fn((k: string) => ({ ...defaults, ...overrides })[k]) };
}

function fakeMail() {
  return { send: jest.fn().mockResolvedValue({ dispatched: true }) };
}

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function makeLead(overrides = {}) {
  return {
    id: 'l1',
    companyId: 'co1',
    channel: 'form',
    status: 'new',
    name: 'Ion',
    email: 'ion@example.com',
    phone: null,
    message: 'Hello',
    visitorHash: 'hash',
    firstResponseAt: null,
    respondedVia: null,
    replyText: null,
    repliedAt: null,
    resolvedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function fakePrisma() {
  const members = new Map<string, any>();
  const companies = new Map<string, any>();
  const leads = new Map<string, any>();

  return {
    companyUser: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          members.get(`${where.companyId_userId.companyId}:${where.companyId_userId.userId}`) ??
          null,
      ),
    },
    company: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const c of companies.values()) {
          if (c.slug === where.slug && c.status === where.status) return c;
        }
        return null;
      }),
      findUnique: jest.fn(async ({ where }: any) => companies.get(where.id) ?? null),
    },
    lead: {
      create: jest.fn(async ({ data }: any) => {
        const l = makeLead({ id: 'l1', ...data });
        leads.set(l.id, l);
        return l;
      }),
      findMany: jest.fn(async () => [...leads.values()]),
      findFirst: jest.fn(async ({ where }: any) => leads.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const l = leads.get(where.id);
        if (l) Object.assign(l, data);
        return l;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const exists = leads.has(where.id);
        if (exists) leads.delete(where.id);
        return { count: exists ? 1 : 0 };
      }),
      groupBy: jest.fn(async () => []),
    },
    __seedMember: (companyId: string, userId: string) => {
      members.set(`${companyId}:${userId}`, { companyId, userId, status: 'active' });
    },
    __seedCompany: (data = {}) => {
      const c = {
        id: 'co1',
        slug: 'acme',
        status: 'active',
        displayName: 'Acme',
        owner: { id: 'owner1', email: 'owner@acme.com' },
        contacts: [],
        ...data,
      };
      companies.set(c.id, c);
      companies.set(c.slug, c);
      return c;
    },
    __seedLead: (data = {}) => {
      const l = makeLead(data);
      leads.set(l.id, l);
      return l;
    },
  };
}

function makeService() {
  const prisma = fakePrisma();
  const mail = fakeMail();
  const notifications = fakeNotifications();
  const config = fakeConfig();
  const svc = new LeadsService(prisma as any, mail as any, notifications as any, config as any);
  return { svc, prisma, mail, notifications };
}

describe('LeadsService', () => {
  describe('submitPublic', () => {
    it('throws NotFoundException for unknown slug', async () => {
      const { svc } = makeService();
      await expect(
        svc.submitPublic('unknown', 'form', {}, '127.0.0.1', 'Mozilla/5.0'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns { ok: true } without creating lead for bot user-agent', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany({ slug: 'acme' });
      const result = await svc.submitPublic(
        'acme',
        'form',
        { name: 'Bot', email: 'b@b.com' },
        '1.2.3.4',
        'Googlebot/2.1',
      );
      expect(result).toEqual({ ok: true });
      expect(prisma.lead.create).not.toHaveBeenCalled();
    });

    it('returns { ok: true } silently on P2002 (duplicate)', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedCompany({ slug: 'acme' });
      prisma.lead.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5',
        }),
      );
      const result = await svc.submitPublic(
        'acme',
        'form',
        { name: 'Ion', email: 'i@example.com', message: 'test' },
        '1.2.3.4',
        'Mozilla/5.0',
      );
      expect(result).toEqual({ ok: true });
    });

    it('happy path creates lead and fires notification', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedCompany({ slug: 'acme' });
      const result = await svc.submitPublic(
        'acme',
        'form',
        { name: 'Ion', email: 'ion@example.com', message: 'Buna' },
        '1.2.3.4',
        'Mozilla/5.0',
      );
      expect(result).toEqual({ ok: true });
      expect(prisma.lead.create).toHaveBeenCalled();
      // notification fired async — wait a tick
      await new Promise((r) => setTimeout(r, 10));
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'lead_received' }),
      );
    });
  });

  describe('list', () => {
    it('throws NotFoundException when user is not a member', async () => {
      const { svc } = makeService();
      await expect(svc.list('u1', 'co1')).rejects.toThrow(NotFoundException);
    });

    it('returns items list for a valid member', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.__seedLead({ id: 'l1', companyId: 'co1' });
      const result = await svc.list('u1', 'co1');
      expect(Array.isArray(result.items)).toBe(true);
    });
  });

  describe('get', () => {
    it('updates status new -> seen on first open', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.__seedLead({ id: 'l1', companyId: 'co1', status: 'new' });
      await svc.get('u1', 'co1', 'l1');
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'seen' } }),
      );
    });

    it('does not update when status is already seen', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.__seedLead({ id: 'l1', companyId: 'co1', status: 'seen' });
      await svc.get('u1', 'co1', 'l1');
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown lead', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      await expect(svc.get('u1', 'co1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reply', () => {
    it('throws BadRequestException when lead has no email', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.__seedLead({ id: 'l1', companyId: 'co1', email: null, channel: 'form' });
      await expect(svc.reply('u1', 'co1', 'l1', 'Hi')).rejects.toThrow(BadRequestException);
    });

    it('sends mail and stamps firstResponseAt on happy path', async () => {
      const { svc, prisma, mail } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.__seedLead({
        id: 'l1',
        companyId: 'co1',
        email: 'v@example.com',
        channel: 'form',
        firstResponseAt: null,
      });
      prisma.__seedCompany({ id: 'co1', displayName: 'Acme', owner: { email: 'owner@acme.com' } });
      await svc.reply('u1', 'co1', 'l1', 'Mulțumim pentru mesaj!');
      expect(mail.send).toHaveBeenCalled();
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ firstResponseAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when deleteMany count is 0', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      prisma.lead.deleteMany.mockResolvedValue({ count: 0 });
      await expect(svc.remove('u1', 'co1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
