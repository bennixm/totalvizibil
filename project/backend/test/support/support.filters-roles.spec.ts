import { SupportController } from 'src/support/support.controller';
import { primaryRole } from 'src/support/support.constants';
import { SupportService } from 'src/support/support.service';
import { ticketDetailView, ticketListView } from 'src/support/support.view';

/**
 * The Support page rework: queue filters (status groups, category, sort,
 * staff-wide search), the tab counters, the role badge next to every person
 * in a ticket, and the requester/staff perspective split between the normal
 * panel and the admin panel.
 */

function makeService() {
  const prisma: any = {
    supportTicket: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
  };
  const svc = new SupportService(prisma, { notify: jest.fn() } as any, { get: jest.fn() } as any);
  return { svc, prisma };
}

const staff = { id: 'staff1', staff: true };
const customer = { id: 'u1', staff: false };

const whereOf = (prisma: any) => prisma.supportTicket.findMany.mock.calls[0][0].where;
const orderOf = (prisma: any) => prisma.supportTicket.findMany.mock.calls[0][0].orderBy;

describe('support list filters', () => {
  it('statusGroup=active means open/in progress/waiting', async () => {
    const { svc, prisma } = makeService();
    await svc.list(staff, { statusGroup: 'active' });
    expect(whereOf(prisma).status).toEqual({ in: ['open', 'in_progress', 'waiting'] });
  });

  it('statusGroup=done means resolved/closed', async () => {
    const { svc, prisma } = makeService();
    await svc.list(staff, { statusGroup: 'done' });
    expect(whereOf(prisma).status).toEqual({ in: ['resolved', 'closed'] });
  });

  it('a specific status wins over the group', async () => {
    const { svc, prisma } = makeService();
    await svc.list(staff, { statusGroup: 'active', status: 'waiting' });
    expect(whereOf(prisma).status).toBe('waiting');
  });

  it('filters by category', async () => {
    const { svc, prisma } = makeService();
    await svc.list(staff, { category: 'billing' });
    expect(whereOf(prisma).category).toBe('billing');
  });

  it('staff search also matches requester name/email and business name', async () => {
    const { svc, prisma } = makeService();
    await svc.list(staff, { q: 'popescu' });
    const or = whereOf(prisma).OR;
    expect(or).toEqual(
      expect.arrayContaining([
        { subject: { contains: 'popescu', mode: 'insensitive' } },
        { requester: { name: { contains: 'popescu', mode: 'insensitive' } } },
        { requester: { email: { contains: 'popescu', mode: 'insensitive' } } },
        { company: { displayName: { contains: 'popescu', mode: 'insensitive' } } },
      ]),
    );
  });

  it('a customer search stays on subject/number (their own tickets only)', async () => {
    const { svc, prisma } = makeService();
    await svc.list(customer, { q: '#12' });
    const where = whereOf(prisma);
    expect(where.requesterId).toBe('u1');
    expect(where.OR).toEqual([
      { subject: { contains: '#12', mode: 'insensitive' } },
      { number: 12 },
    ]);
  });

  it('a word that merely starts with digits is not treated as a ticket number', async () => {
    const { svc, prisma } = makeService();
    await svc.list(customer, { q: '404 error' });
    expect(whereOf(prisma).OR).toEqual([
      { subject: { contains: '404 error', mode: 'insensitive' } },
    ]);
  });

  it.each([
    [undefined, [{ lastActivityAt: 'desc' }, { id: 'desc' }]],
    ['newest', [{ createdAt: 'desc' }, { id: 'desc' }]],
    ['oldest', [{ createdAt: 'asc' }, { id: 'asc' }]],
    ['priority', [{ priority: 'desc' }, { lastActivityAt: 'desc' }, { id: 'desc' }]],
  ] as const)(
    'sort=%s orders deterministically (ends on id for the cursor)',
    async (sort, order) => {
      const { svc, prisma } = makeService();
      await svc.list(staff, { sort: sort as any });
      expect(orderOf(prisma)).toEqual(order);
    },
  );
});

describe('support counts', () => {
  it('a customer only gets counts over their own tickets', async () => {
    const { svc, prisma } = makeService();
    const res = await svc.counts(customer);
    expect(Object.keys(res).sort()).toEqual(['active', 'all', 'done', 'waiting']);
    for (const [arg] of prisma.supportTicket.count.mock.calls) {
      expect(arg.where.requesterId).toBe('u1');
    }
  });

  it('staff get the whole-queue triage counters', async () => {
    const { svc, prisma } = makeService();
    const res = await svc.counts(staff);
    expect(Object.keys(res).sort()).toEqual(
      ['active', 'all', 'done', 'mine', 'resolvedToday', 'unassigned', 'urgent', 'waiting'].sort(),
    );
    const wheres = prisma.supportTicket.count.mock.calls.map(([a]: any) => a.where);
    expect(wheres).toContainEqual({
      status: { in: ['open', 'in_progress', 'waiting'] },
      assigneeId: 'staff1',
    });
    expect(wheres.some((w: any) => 'requesterId' in w)).toBe(false);
  });
});

describe('role badges', () => {
  it('picks the most privileged role, "user" for none', () => {
    expect(primaryRole([])).toBe('user');
    expect(primaryRole(undefined)).toBe('user');
    expect(primaryRole(['moderator', 'admin'])).toBe('admin');
    expect(primaryRole(['finance', 'support'])).toBe('support');
    expect(primaryRole(['moderator'])).toBe('moderator');
  });

  const roles = (...r: string[]) => r.map((role) => ({ role }));
  const detail = {
    id: 't1',
    number: 7,
    subject: 's',
    status: 'open',
    priority: 'normal',
    category: 'other',
    requesterId: 'u1',
    assigneeId: 'a1',
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActivityAt: new Date(),
    requester: { id: 'u1', name: 'Ion', platformRoles: roles('finance') },
    assignee: { id: 'a1', name: 'Ana', platformRoles: roles('admin') },
    company: null,
    messages: [
      {
        id: 'm1',
        kind: 'reply',
        body: 'hi',
        authorId: 'u1',
        createdAt: new Date(),
        author: { id: 'u1', name: 'Ion', platformRoles: roles('finance') },
        attachments: [],
      },
      {
        id: 'm2',
        kind: 'reply',
        body: 'hello',
        authorId: 'a1',
        createdAt: new Date(),
        author: { id: 'a1', name: 'Ana', platformRoles: roles('admin', 'support') },
        attachments: [],
      },
      {
        id: 'm3',
        kind: 'note',
        body: 'secret',
        authorId: 'a1',
        createdAt: new Date(),
        author: { id: 'a1', name: 'Ana', platformRoles: roles('admin') },
        attachments: [],
      },
    ],
  };

  it('every person in the ticket detail carries a role', () => {
    const v = ticketDetailView(detail as any, { id: 'a1', staff: true });
    expect(v.requester.role).toBe('finance');
    expect(v.assignee?.role).toBe('admin');
    expect(v.messages.map((m) => [m.author?.name, m.author?.role, m.author?.requester])).toEqual([
      ['Ion', 'finance', true],
      ['Ana', 'admin', false],
      ['Ana', 'admin', false],
    ]);
    // A finance account is staff of the platform but not of the support desk.
    expect(v.messages[0].author?.staff).toBe(false);
    expect(v.messages[1].author?.staff).toBe(true);
  });

  it('the requester view never contains internal notes', () => {
    const v = ticketDetailView(detail as any, { id: 'u1', staff: false });
    expect(v.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('a list row says who wrote the last public reply', () => {
    const base = {
      ...detail,
      _count: { messages: 2 },
    };
    const fromTeam = ticketListView({
      ...base,
      messages: [{ authorId: 'a1', createdAt: new Date() }],
    } as any);
    const fromCustomer = ticketListView({
      ...base,
      messages: [{ authorId: 'u1', createdAt: new Date() }],
    } as any);
    const none = ticketListView({ ...base, messages: [] } as any);
    expect(fromTeam.lastReplyBy).toBe('team');
    expect(fromCustomer.lastReplyBy).toBe('requester');
    expect(none.lastReplyBy).toBeNull();
    expect(fromTeam.requester.role).toBe('finance');
    expect(fromTeam.assignee?.role).toBe('admin');
  });
});

describe('perspective (normal panel vs admin panel)', () => {
  function makeController() {
    const support = {
      list: jest.fn(),
      counts: jest.fn(),
      get: jest.fn(),
      postMessage: jest.fn(),
      update: jest.fn(),
    };
    return { ctrl: new SupportController(support as any), support };
  }
  const agent = { id: 'ag', platformRoles: ['support'] } as any;
  const plain = { id: 'pl', platformRoles: [] } as any;

  it('a support agent in the admin panel acts as staff', () => {
    const { ctrl, support } = makeController();
    void ctrl.list(agent, {});
    expect(support.list.mock.calls[0][0]).toEqual({ id: 'ag', staff: true });
  });

  it('the same agent in the normal panel (as=requester) is just a customer', () => {
    const { ctrl, support } = makeController();
    void ctrl.list(agent, { as: 'requester' });
    void ctrl.get(agent, 't1', { as: 'requester' });
    void ctrl.postMessage(agent, 't1', { body: 'x' } as any, { as: 'requester' });
    void ctrl.update(agent, 't1', {} as any, { as: 'requester' });
    for (const fn of [support.list, support.get, support.postMessage, support.update]) {
      expect(fn.mock.calls[0][0]).toEqual({ id: 'ag', staff: false });
    }
  });

  it('as=staff never grants staff powers to a non-staff account', () => {
    const { ctrl, support } = makeController();
    void ctrl.list(plain, { as: 'staff' });
    void ctrl.counts(plain, { as: 'staff' });
    expect(support.list.mock.calls[0][0]).toEqual({ id: 'pl', staff: false });
    expect(support.counts.mock.calls[0][0]).toEqual({ id: 'pl', staff: false });
  });
});
