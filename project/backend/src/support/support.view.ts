import { Prisma, PlatformRole } from '@prisma/client';
import { isSupportStaff, primaryRole, type SupportPersonRole } from './support.constants';

/** A person as shown in a ticket: name + the one role badge next to it. */
const personSelect = {
  select: { id: true, name: true, platformRoles: { select: { role: true } } },
} as const;

interface PersonRow {
  id: string;
  name: string;
  /** Optional so a caller that selected only `{ id, name }` still maps (role `user`). */
  platformRoles?: { role: PlatformRole }[];
}

export interface SupportPerson {
  id: string;
  name: string;
  role: SupportPersonRole;
}

function person(p: PersonRow): SupportPerson {
  return { id: p.id, name: p.name, role: primaryRole(p.platformRoles?.map((r) => r.role)) };
}

export const ticketListInclude = {
  requester: personSelect,
  assignee: personSelect,
  company: { select: { id: true, displayName: true } },
  // Only actual replies count. The raw total also included `system` lines
  // (status/assignment audit entries) and `note` internal notes, so a list
  // row advertised messages the requester can't even see in the detail view
  // — e.g. "4 messages" on a ticket showing two.
  _count: { select: { messages: { where: { kind: 'reply' } } } },
  // The latest public reply only, to tell "whose turn is it" without
  // opening the ticket (the list's "needs your reply" / "customer replied"
  // markers). Internal notes and system lines are never the last word.
  messages: {
    where: { kind: 'reply' },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { authorId: true, createdAt: true },
  },
} satisfies Prisma.SupportTicketInclude;

export const ticketDetailInclude = {
  requester: personSelect,
  assignee: personSelect,
  company: { select: { id: true, displayName: true } },
  messages: {
    orderBy: { createdAt: 'asc' },
    include: {
      author: personSelect,
      attachments: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, filename: true, mime: true, size: true },
      },
    },
  },
} satisfies Prisma.SupportTicketInclude;

type TicketListRow = Prisma.SupportTicketGetPayload<{ include: typeof ticketListInclude }>;
type TicketDetailRow = Prisma.SupportTicketGetPayload<{ include: typeof ticketDetailInclude }>;

export function ticketListView(t: TicketListRow) {
  const last = t.messages?.[0];
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    category: t.category,
    requester: person(t.requester),
    assignee: t.assignee ? person(t.assignee) : null,
    company: t.company ? { id: t.company.id, name: t.company.displayName } : null,
    messageCount: t._count.messages,
    /** Who wrote the latest public reply: the requester, or someone else
     *  (the support team). Null when there are no replies at all. */
    lastReplyBy: last ? (last.authorId === t.requesterId ? 'requester' : 'team') : null,
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt,
  };
}

export type TicketListView = ReturnType<typeof ticketListView>;

export function ticketDetailView(t: TicketDetailRow, viewer: { id: string; staff: boolean }) {
  const messages = t.messages
    .filter((m) => viewer.staff || m.kind !== 'note')
    .map((m) => {
      const roles = m.author?.platformRoles?.map((r) => r.role) ?? [];
      return {
        id: m.id,
        kind: m.kind,
        body: m.body,
        author: m.author
          ? {
              ...person(m.author),
              staff: isSupportStaff(roles),
              /** True when the author is the person who opened the ticket,
               *  so a staff member filing their own ticket still reads as
               *  "the customer" in their own thread. */
              requester: m.author.id === t.requesterId,
            }
          : null,
        mine: m.authorId === viewer.id,
        createdAt: m.createdAt,
        attachments: m.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mime: a.mime,
          size: a.size,
        })),
      };
    });

  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    category: t.category,
    requester: person(t.requester),
    assignee: t.assignee ? person(t.assignee) : null,
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
