import { Prisma } from '@prisma/client';
import { isSupportStaff } from './support.constants';

const userMini = { select: { id: true, name: true } } as const;

export const ticketListInclude = {
  requester: userMini,
  assignee: userMini,
  company: { select: { id: true, displayName: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.SupportTicketInclude;

export const ticketDetailInclude = {
  requester: userMini,
  assignee: userMini,
  company: { select: { id: true, displayName: true } },
  messages: {
    orderBy: { createdAt: 'asc' },
    include: {
      author: {
        select: { id: true, name: true, platformRoles: { select: { role: true } } },
      },
    },
  },
} satisfies Prisma.SupportTicketInclude;

type TicketListRow = Prisma.SupportTicketGetPayload<{ include: typeof ticketListInclude }>;
type TicketDetailRow = Prisma.SupportTicketGetPayload<{ include: typeof ticketDetailInclude }>;

export function ticketListView(t: TicketListRow) {
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    category: t.category,
    requester: t.requester,
    assignee: t.assignee ?? null,
    company: t.company ? { id: t.company.id, name: t.company.displayName } : null,
    messageCount: t._count.messages,
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt,
  };
}

export type TicketListView = ReturnType<typeof ticketListView>;

export function ticketDetailView(t: TicketDetailRow, viewer: { id: string; staff: boolean }) {
  const messages = t.messages
    .filter((m) => viewer.staff || m.kind !== 'note')
    .map((m) => ({
      id: m.id,
      kind: m.kind,
      body: m.body,
      author: m.author
        ? {
            id: m.author.id,
            name: m.author.name,
            staff: isSupportStaff(m.author.platformRoles.map((r) => r.role)),
          }
        : null,
      mine: m.authorId === viewer.id,
      createdAt: m.createdAt,
    }));

  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    category: t.category,
    requester: t.requester,
    assignee: t.assignee ?? null,
    company: t.company ? { id: t.company.id, name: t.company.displayName } : null,
    firstResponseAt: t.firstResponseAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastActivityAt: t.lastActivityAt,
    messages,
    viewerIsStaff: viewer.staff,
    viewerIsRequester: t.requesterId === viewer.id,
  };
}

export type TicketDetailViewResult = ReturnType<typeof ticketDetailView>;
