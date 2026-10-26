import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupportService } from 'src/support/support.service';

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function fakeConfig(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = { frontendOrigin: 'http://localhost:5173' };
  return { get: jest.fn((k: string) => ({ ...defaults, ...overrides })[k]) };
}

function makeMessage(overrides = {}) {
  return {
    id: 'm1',
    ticketId: 't1',
    authorId: 'u1',
    kind: 'reply',
    body: 'Hello',
    createdAt: new Date(),
    author: { id: 'u1', name: 'Ion', platformRoles: [] },
    attachments: [],
    ...overrides,
  };
}

function makeTicketDetail(overrides: Record<string, any> = {}) {
  return {
    id: 't1',
    number: 1,
    subject: 'Test ticket',
    status: 'open',
    priority: 'normal',
    category: 'billing',
    requesterId: 'u1',
    assigneeId: null,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActivityAt: new Date(),
    requester: { id: 'u1', name: 'Ion' },
    assignee: null,
    company: null,
    messages: [makeMessage()],
    ...overrides,
  };
}

function makeTicketList(overrides: Record<string, any> = {}) {
  return {
    id: 't1',
    number: 1,
    subject: 'Test ticket',
    status: 'open',
    priority: 'normal',
    category: 'billing',
    requesterId: 'u1',
    assigneeId: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    requester: { id: 'u1', name: 'Ion' },
    assignee: null,
    company: null,
    _count: { messages: 1 },
    ...overrides,
  };
}

function fakePrisma() {
  const tickets = new Map<string, any>();
  const messages: any[] = [];
  const members = new Map<string, any>();
  const staffRoles: any[] = [];
  const attachments = new Map<string, any>();
  let attachmentSeq = 0;

  const prisma: any = {
    supportTicket: {
      findMany: jest.fn(async ({ where }: any) => {
        const all = [...tickets.values()].map(makeTicketList);
        if (where?.requesterId) return all.filter((t) => t.requesterId === where.requesterId);
        return all;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const t = tickets.get(where.id);
        return t ? makeTicketDetail(t) : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const t = makeTicketDetail({
          id: 't1',
          requesterId: data.requesterId,
          subject: data.subject,
          status: 'open',
        });
        tickets.set(t.id, t);
        return t;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const t = tickets.get(where.id);
        if (t) Object.assign(t, data);
        return makeTicketDetail(t ?? {});
      }),
      count: jest.fn(async () => 0),
    },
    supportMessage: {
      create: jest.fn(async ({ data }: any) => {
        const m = makeMessage({ ...data });
        messages.push(m);
        return m;
      }),
      createMany: jest.fn(async () => ({ count: 1 })),
    },
    companyUser: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          members.get(`${where.companyId_userId.companyId}:${where.companyId_userId.userId}`) ??
          null,
      ),
    },
    platformRoleAssignment: {
      findMany: jest.fn(async () => staffRoles),
      findFirst: jest.fn(
        async ({ where }: any) => staffRoles.find((r) => r.userId === where.userId) ?? null,
      ),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, name: 'Staff' })),
    },
    supportAttachment: {
      count: jest.fn(
        async ({ where }: any) =>
          [...attachments.values()].filter(
            (a) =>
              a.ticketId === where.ticketId &&
              a.uploaderId === where.uploaderId &&
              a.messageId === where.messageId,
          ).length,
      ),
      create: jest.fn(async ({ data }: any) => {
        attachmentSeq += 1;
        const a = { id: `att${attachmentSeq}`, messageId: null, ...data };
        attachments.set(a.id, a);
        return { id: a.id, filename: a.filename, mime: a.mime, size: a.size };
      }),
      findUnique: jest.fn(async ({ where }: any) => attachments.get(where.id) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const ids: string[] = where.id?.in ?? [];
        let count = 0;
        for (const id of ids) {
          const a = attachments.get(id);
          if (
            a &&
            a.ticketId === where.ticketId &&
            a.uploaderId === where.uploaderId &&
            a.messageId === where.messageId
          ) {
            Object.assign(a, data);
            count += 1;
          }
        }
        return { count };
      }),
    },
    // Both forms the real client supports: the array-of-promises shorthand,
    // and the interactive callback — `postMessage` uses the latter so it can
    // roll back the whole reply if claiming its attachments fails.
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
    __seedTicket: (data: Record<string, any> = {}) => {
      const t = { id: 't1', requesterId: 'u1', status: 'open', subject: 'Test', ...data };
      tickets.set(t.id, t);
      return t;
    },
    __seedMember: (companyId: string, userId: string) => {
      members.set(`${companyId}:${userId}`, { companyId, userId, status: 'active' });
    },
    __seedStaff: (userId: string, role = 'support') => {
      staffRoles.push({ userId, role });
    },
    __seedAttachment: (data: Record<string, any>) => {
      attachmentSeq += 1;
      const a = { id: `att${attachmentSeq}`, messageId: null, ...data };
      attachments.set(a.id, a);
      return a;
    },
  };

  return prisma;
}

function makeService() {
  const prisma = fakePrisma();
  const notifications = fakeNotifications();
  const config = fakeConfig();
  const svc = new SupportService(prisma as any, notifications as any, config as any);
  return { svc, prisma, notifications };
}

const staffActor = { id: 'staff1', staff: true };
const userActor = { id: 'u1', staff: false };
const otherActor = { id: 'other', staff: false };

describe('SupportService', () => {
  describe('list', () => {
    it('non-staff sees only own tickets', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1' });
      prisma.__seedTicket({ id: 't2', requesterId: 'other' });
      await svc.list(userActor, {});
      const call = (prisma.supportTicket.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where).toMatchObject({ requesterId: 'u1' });
    });

    it('staff sees all tickets by default', async () => {
      const { svc, prisma } = makeService();
      await svc.list(staffActor, {});
      const call = (prisma.supportTicket.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where).not.toHaveProperty('requesterId');
    });

    it('staff with scope=mine sees only own', async () => {
      const { svc, prisma } = makeService();
      await svc.list(staffActor, { scope: 'mine' });
      const call = (prisma.supportTicket.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where).toMatchObject({ requesterId: 'staff1' });
    });
  });

  describe('get', () => {
    it('staff can access any ticket', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1' });
      await expect(svc.get(staffActor, 't1')).resolves.toMatchObject({ id: 't1' });
    });

    it('non-staff can access own ticket', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1' });
      await expect(svc.get(userActor, 't1')).resolves.toMatchObject({ id: 't1' });
    });

    it("non-staff cannot access another user's ticket", async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1' });
      await expect(svc.get(otherActor, 't1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for missing ticket', async () => {
      const { svc } = makeService();
      await expect(svc.get(staffActor, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('throws BadRequestException when user is not company member', async () => {
      const { svc } = makeService();
      await expect(
        svc.create(userActor, {
          subject: 'Help',
          body: 'Please',
          category: 'other',
          companyId: 'co1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates ticket without companyId check when no companyId', async () => {
      const { svc, prisma } = makeService();
      await svc.create(userActor, { subject: 'Help', body: 'Please', category: 'other' });
      expect(prisma.supportTicket.create).toHaveBeenCalled();
    });

    it('creates ticket when user is active company member', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedMember('co1', 'u1');
      await svc.create(userActor, {
        subject: 'Help',
        body: 'Please',
        category: 'other',
        companyId: 'co1',
      });
      expect(prisma.supportTicket.create).toHaveBeenCalled();
    });
  });

  describe('postMessage', () => {
    it('throws BadRequestException on closed ticket', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'closed' });
      await expect(svc.postMessage(userActor, 't1', { body: 'hi' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('staff reply stamps firstResponseAt when not set', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({
        id: 't1',
        requesterId: 'u1',
        status: 'open',
        firstResponseAt: null,
        assigneeId: null,
      });
      await svc.postMessage(staffActor, 't1', { body: 'We are looking into it.' });
      const updateArg = (prisma.supportTicket.update as jest.Mock).mock.calls[0][0];
      expect(updateArg.data).toHaveProperty('firstResponseAt');
    });

    it('customer reply re-opens resolved ticket', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({
        id: 't1',
        requesterId: 'u1',
        status: 'resolved',
        firstResponseAt: new Date(),
      });
      await svc.postMessage(userActor, 't1', { body: 'Still broken.' });
      const updateArg = (prisma.supportTicket.update as jest.Mock).mock.calls[0][0];
      expect(updateArg.data.status).toBe('open');
      expect(updateArg.data.resolvedAt).toBeNull();
    });

    it('throws NotFoundException for missing ticket', async () => {
      const { svc } = makeService();
      await expect(svc.postMessage(userActor, 'missing', { body: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('non-staff setting priority throws ForbiddenException', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'open' });
      await expect(svc.update(userActor, 't1', { priority: 'urgent' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('non-staff setting assigneeId throws ForbiddenException', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'open' });
      await expect(svc.update(userActor, 't1', { assigneeId: 'staff1' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('staff assignee not in staff roles throws BadRequestException', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({
        id: 't1',
        requesterId: 'u1',
        status: 'open',
        assigneeId: null,
        priority: 'normal',
      });
      await expect(svc.update(staffActor, 't1', { assigneeId: 'nobody' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('resolving ticket notifies requester', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedTicket({
        id: 't1',
        requesterId: 'u1',
        status: 'open',
        priority: 'normal',
        assigneeId: null,
      });
      await svc.update(staffActor, 't1', { status: 'resolved' });
      await new Promise((r) => setTimeout(r, 10));
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', type: 'support_ticket_update' }),
      );
    });
  });
});
