import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SupportService } from 'src/support/support.service';

/** Real uuids — `assigneeId` is shape-checked before it can reach Postgres,
 *  so the fixtures have to look like the ids the API actually accepts. */
const STAFF_A = '11111111-1111-4111-8111-111111111111';
const STAFF_B = '22222222-2222-4222-8222-222222222222';
const SOME_UUID = '33333333-3333-4333-8333-333333333333';

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

/** Notifications are deliberately fire-and-forget (a mail hiccup must never
 *  roll back a committed ticket write), so assertions have to let the
 *  dispatch microtasks drain first. */
const settle = () => new Promise((r) => setTimeout(r, 10));

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
      // Conditional-claim semantics: the write only lands when the row still
      // matches every field in `where` — that's the whole point of the
      // atomic assignment claim, so the fake has to honour it.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const t = tickets.get(where.id);
        if (!t) return { count: 0 };
        if ('assigneeId' in where && (t.assigneeId ?? null) !== (where.assigneeId ?? null)) {
          return { count: 0 };
        }
        Object.assign(t, data);
        return { count: 1 };
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
      // Honours `where.role` both as a single value (the support-vs-admin
      // queue scoping) and as `{ in: [...] }` (the is-this-person-staff
      // check), otherwise the two can't be told apart in a test.
      findMany: jest.fn(async ({ where }: any = {}) => {
        const role = where?.role;
        let rows = staffRoles;
        if (typeof role === 'string') rows = rows.filter((r) => r.role === role);
        else if (role?.in) rows = rows.filter((r) => role.in.includes(r.role));
        return rows.map((r) => ({ userId: r.userId, user: { name: r.name } }));
      }),
      findFirst: jest.fn(
        async ({ where }: any) => staffRoles.find((r) => r.userId === where.userId) ?? null,
      ),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) => ({
        id: where.id,
        name: staffRoles.find((r) => r.userId === where.id)?.name ?? 'Staff',
      })),
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
      findUnique: jest.fn(async ({ where }: any) => {
        const a = attachments.get(where.id);
        if (!a) return null;
        // The parent message's kind decides whether a requester may read the
        // bytes, so the relation has to come back with the row.
        return { ...a, message: a.messageId ? { kind: a.messageKind ?? 'reply' } : null };
      }),
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
    __seedStaff: (userId: string, role = 'support', name = 'Staff') => {
      staffRoles.push({ userId, role, name });
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

    it('a reply that reopens a resolved ticket is its own notification', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedTicket({
        id: 't1',
        requesterId: 'u1',
        status: 'resolved',
        assigneeId: STAFF_A,
        firstResponseAt: new Date(),
      });
      await svc.postMessage(userActor, 't1', { body: 'Still broken.' });
      await settle();
      const types = (notifications.notify as jest.Mock).mock.calls.map((c) => c[0].type);
      expect(types).toContain('ticket_reopened');
      expect(types).not.toContain('ticket_reply');
    });

    it('customer reply clears a waiting ticket back to open', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({
        id: 't1',
        requesterId: 'u1',
        status: 'waiting',
        firstResponseAt: new Date(),
      });
      await svc.postMessage(userActor, 't1', { body: 'Here is the info you asked for.' });
      const updateArg = (prisma.supportTicket.update as jest.Mock).mock.calls[0][0];
      expect(updateArg.data.status).toBe('open');
      // `waiting` never had a resolvedAt to clear — touching it here would
      // be the same bug as the status-change stamping one.
      expect(updateArg.data).not.toHaveProperty('resolvedAt');
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
      await settle();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', type: 'support_ticket_update' }),
      );
    });

    it('a uuid-shaped assignee who is not staff is still rejected', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'open', assigneeId: null });
      await expect(svc.update(staffActor, 't1', { assigneeId: SOME_UUID })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.platformRoleAssignment.findFirst).toHaveBeenCalled();
    });

    it('a non-uuid assignee is a 400 and never reaches Postgres', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'open', assigneeId: null });
      await expect(svc.update(staffActor, 't1', { assigneeId: 'abc' })).rejects.toThrow(
        BadRequestException,
      );
      // The point of the guard: a malformed id used to reach a
      // `where: { userId }` and come back as an uncaught P2023 → 500.
      expect(prisma.platformRoleAssignment.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('update — status timestamps', () => {
    it('closing an already-resolved ticket preserves resolvedAt', async () => {
      const { svc, prisma } = makeService();
      const resolvedAt = new Date('2026-01-01T10:00:00Z');
      prisma.__seedTicket({
        id: 't1',
        requesterId: 'u1',
        status: 'resolved',
        priority: 'normal',
        assigneeId: null,
        resolvedAt,
      });
      await svc.update(staffActor, 't1', { status: 'closed' });
      const arg = (prisma.supportTicket.update as jest.Mock).mock.calls[0][0];
      // Not merely "still the old value" — the update must not mention the
      // column at all, or the resolved-today counter loses the ticket.
      expect(arg.data).not.toHaveProperty('resolvedAt');
      expect(arg.data.closedAt).toBeInstanceOf(Date);
    });

    it('resolving stamps resolvedAt', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'open', assigneeId: null });
      await svc.update(staffActor, 't1', { status: 'resolved' });
      const arg = (prisma.supportTicket.update as jest.Mock).mock.calls[0][0];
      expect(arg.data.resolvedAt).toBeInstanceOf(Date);
      expect(arg.data).not.toHaveProperty('closedAt');
    });

    it('reopening a closed ticket clears both stamps', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({
        id: 't1',
        requesterId: 'u1',
        status: 'closed',
        assigneeId: null,
        resolvedAt: new Date(),
        closedAt: new Date(),
      });
      await svc.update(staffActor, 't1', { status: 'open' });
      const arg = (prisma.supportTicket.update as jest.Mock).mock.calls[0][0];
      expect(arg.data.resolvedAt).toBeNull();
      expect(arg.data.closedAt).toBeNull();
    });

    it('a status that the ticket already has writes nothing and notifies nobody', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'resolved', assigneeId: null });
      await svc.update(staffActor, 't1', { status: 'resolved' });
      await settle();
      expect(prisma.supportTicket.update).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('update — assignment', () => {
    it('two concurrent claims: one wins, the loser gets a 409', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedStaff(STAFF_A);
      prisma.__seedStaff(STAFF_B);
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'open', assigneeId: null });

      const results = await Promise.allSettled([
        svc.update({ id: STAFF_A, staff: true }, 't1', { assigneeId: 'me' }),
        svc.update({ id: STAFF_B, staff: true }, 't1', { assigneeId: 'me' }),
      ]);
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(rejected[0].reason.message).toBe('already_claimed');
    });

    it('assigning notifies the new assignee and the requester', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedStaff(STAFF_A, 'support', 'Ana');
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'open', assigneeId: null });
      await svc.update(staffActor, 't1', { assigneeId: STAFF_A });
      await settle();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: STAFF_A, type: 'ticket_assigned' }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          type: 'ticket_assigned_requester',
          body: expect.stringContaining('Ana'),
        }),
      );
    });

    it('reassigning tells the previous assignee who has it now', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedStaff(STAFF_A, 'support', 'Ana');
      prisma.__seedStaff(STAFF_B, 'support', 'Bogdan');
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'open', assigneeId: STAFF_A });
      await svc.update(staffActor, 't1', { assigneeId: STAFF_B });
      await settle();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: STAFF_A,
          type: 'ticket_unassigned',
          body: expect.stringContaining('Bogdan'),
        }),
      );
    });

    it('unassigning tells the previous assignee', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedStaff(STAFF_A, 'support', 'Ana');
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'open', assigneeId: STAFF_A });
      await svc.update(staffActor, 't1', { assigneeId: '' });
      await settle();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: STAFF_A, type: 'ticket_unassigned' }),
      );
    });

    it('self-assigning an unassigned ticket notifies no staff member', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedStaff(STAFF_A, 'support', 'Ana');
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'open', assigneeId: null });
      await svc.update({ id: STAFF_A, staff: true }, 't1', { assigneeId: 'me' });
      await settle();
      const types = (notifications.notify as jest.Mock).mock.calls.map((c) => c[0].type);
      expect(types).not.toContain('ticket_assigned');
      expect(types).not.toContain('ticket_unassigned');
      expect(types).toContain('ticket_assigned_requester');
    });
  });

  describe('update — customer-driven status changes', () => {
    it('a customer closing their own ticket is not notified about it', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1', status: 'open', assigneeId: STAFF_A });
      await svc.update(userActor, 't1', { status: 'closed' });
      await settle();
      const types = (notifications.notify as jest.Mock).mock.calls.map((c) => c[0].type);
      expect(types).not.toContain('support_ticket_update');
      // …the assignee is, though — they should stop working it.
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: STAFF_A, type: 'ticket_closed_by_user' }),
      );
    });

    it('a customer reopening a resolved ticket emails the assignee', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedTicket({
        id: 't1',
        requesterId: 'u1',
        status: 'resolved',
        assigneeId: STAFF_A,
        resolvedAt: new Date(),
      });
      await svc.update(userActor, 't1', { status: 'open' });
      await settle();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: STAFF_A,
          type: 'ticket_reopened',
          channels: { panel: true, email: true },
        }),
      );
    });

    it('a reopen on an unassigned ticket reaches the support queue, not every admin', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedStaff(STAFF_A, 'support', 'Ana');
      prisma.__seedStaff(STAFF_B, 'admin', 'Admin');
      prisma.__seedTicket({
        id: 't1',
        requesterId: 'u1',
        status: 'closed',
        assigneeId: null,
        closedAt: new Date(),
      });
      await svc.update(userActor, 't1', { status: 'open' });
      await settle();
      const recipients = (notifications.notify as jest.Mock).mock.calls
        .filter((c) => c[0].type === 'ticket_reopened')
        .map((c) => c[0].userId);
      expect(recipients).toEqual([STAFF_A]);
    });
  });

  describe('create — staff fan-out', () => {
    it('only the support role is notified when one exists', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedStaff(STAFF_A, 'support', 'Ana');
      prisma.__seedStaff(STAFF_B, 'admin', 'Admin');
      await svc.create(userActor, { subject: 'Help', body: 'Please', category: 'other' });
      await settle();
      const recipients = (notifications.notify as jest.Mock).mock.calls
        .filter((c) => c[0].type === 'ticket_created')
        .map((c) => c[0].userId);
      expect(recipients).toEqual([STAFF_A]);
    });

    it('falls back to admins when nobody holds the support role', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedStaff(STAFF_B, 'admin', 'Admin');
      await svc.create(userActor, { subject: 'Help', body: 'Please', category: 'other' });
      await settle();
      const recipients = (notifications.notify as jest.Mock).mock.calls
        .filter((c) => c[0].type === 'ticket_created')
        .map((c) => c[0].userId);
      expect(recipients).toEqual([STAFF_B]);
    });

    it('a staff member opening their own ticket is not notified about it', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedStaff(STAFF_A, 'support', 'Ana');
      await svc.create(
        { id: STAFF_A, staff: true },
        { subject: 'Help', body: 'Please', category: 'other' },
      );
      await settle();
      const recipients = (notifications.notify as jest.Mock).mock.calls
        .filter((c) => c[0].type === 'ticket_created')
        .map((c) => c[0].userId);
      expect(recipients).toEqual([]);
    });
  });

  describe('getAttachment', () => {
    const file = { filename: 'x.pdf', mime: 'application/pdf', bytes: Buffer.from('x'), size: 1 };

    it('the requester cannot download an internal note’s attachment', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1' });
      const att = prisma.__seedAttachment({
        ticketId: 't1',
        uploaderId: 'staff1',
        messageId: 'm9',
        messageKind: 'note',
        ...file,
      });
      await expect(svc.getAttachment(userActor, 't1', att.id)).rejects.toThrow(NotFoundException);
      await expect(svc.getAttachment(staffActor, 't1', att.id)).resolves.toMatchObject({
        id: att.id,
      });
    });

    it('the requester can download a reply attachment', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1' });
      const att = prisma.__seedAttachment({
        ticketId: 't1',
        uploaderId: 'u1',
        messageId: 'm1',
        messageKind: 'reply',
        ...file,
      });
      await expect(svc.getAttachment(userActor, 't1', att.id)).resolves.toMatchObject({
        id: att.id,
      });
    });

    it('a still-unsent upload is not downloadable by the requester', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1' });
      const att = prisma.__seedAttachment({
        ticketId: 't1',
        uploaderId: 'u1',
        messageId: null,
        ...file,
      });
      await expect(svc.getAttachment(userActor, 't1', att.id)).rejects.toThrow(NotFoundException);
    });
  });

  describe('list — pagination', () => {
    it('asks for one row past the page so it can tell whether more exist', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedTicket({ id: 't1', requesterId: 'u1' });
      const res = await svc.list(userActor, {});
      const call = (prisma.supportTicket.findMany as jest.Mock).mock.calls[0][0];
      expect(call.take).toBe(101);
      expect(call).not.toHaveProperty('cursor');
      expect(res.nextCursor).toBeNull();
    });

    it('returns a nextCursor once the page is full', async () => {
      const { svc, prisma } = makeService();
      for (let i = 0; i < 101; i += 1) prisma.__seedTicket({ id: `t${i}`, requesterId: 'u1' });
      const res = await svc.list(userActor, {});
      expect(res.items).toHaveLength(100);
      expect(res.nextCursor).toBe('t99');
    });

    it('passes a cursor through as a skip-the-cursor-row seek', async () => {
      const { svc, prisma } = makeService();
      await svc.list(userActor, { cursor: SOME_UUID });
      const call = (prisma.supportTicket.findMany as jest.Mock).mock.calls[0][0];
      expect(call.cursor).toEqual({ id: SOME_UUID });
      expect(call.skip).toBe(1);
    });

    it('rejects a malformed cursor instead of letting Postgres throw', async () => {
      const { svc } = makeService();
      await expect(svc.list(userActor, { cursor: 'nope' })).rejects.toThrow(BadRequestException);
    });
  });
});
