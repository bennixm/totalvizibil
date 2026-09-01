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
