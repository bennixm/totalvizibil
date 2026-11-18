import { PlatformRole } from '@prisma/client';

export const TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_CATEGORIES = [
  'bug',
  'problem',
  'question',
  'billing',
  'feedback',
  'other',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** Platform roles that may work the support queue. */
export const SUPPORT_STAFF_ROLES: PlatformRole[] = ['admin', 'support'];

export function isSupportStaff(roles: readonly PlatformRole[]): boolean {
  return roles.some((r) => SUPPORT_STAFF_ROLES.includes(r));
}

/** Statuses that count as "needs work" for queue counters. */
export const OPEN_STATUSES: TicketStatus[] = ['open', 'in_progress', 'waiting'];

/** Statuses a ticket is "done" in — the complement of `OPEN_STATUSES`. */
export const DONE_STATUSES: TicketStatus[] = ['resolved', 'closed'];

export const STATUS_GROUPS = { active: OPEN_STATUSES, done: DONE_STATUSES } as const;
export type StatusGroup = keyof typeof STATUS_GROUPS;

export const TICKET_SORTS = ['activity', 'newest', 'oldest', 'priority'] as const;
export type TicketSort = (typeof TICKET_SORTS)[number];

/**
 * The one role shown next to a person's name in a ticket (requester,
 * assignee, message author). An account can hold several platform roles;
 * the most privileged one wins. `user` = no platform role at all, i.e. an
 * ordinary customer account.
 */
export type SupportPersonRole = PlatformRole | 'user';
const ROLE_PRECEDENCE: PlatformRole[] = ['admin', 'support', 'finance', 'moderator'];

export function primaryRole(roles: readonly PlatformRole[] | undefined): SupportPersonRole {
  if (!roles?.length) return 'user';
  return ROLE_PRECEDENCE.find((r) => roles.includes(r)) ?? 'user';
}

/**
 * Which side of the ticketing system a request is made from. The same
 * account can be both: a `support` agent works the queue in the admin panel
 * AND files their own tickets from the normal panel. `requester` forces the
 * customer view (own tickets only, no internal notes, no staff controls)
 * even for staff; it can only ever narrow access, never widen it.
 */
export type SupportPerspective = 'staff' | 'requester';
