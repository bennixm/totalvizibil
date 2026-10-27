import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PlatformRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppConfig } from '../config/env';
import { OPEN_STATUSES, SUPPORT_STAFF_ROLES } from './support.constants';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQuery } from './dto/list-tickets.query';
import { PostMessageDto } from './dto/post-message.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { decodeAttachment } from './attachment-validation';
import {
  ticketDetailInclude,
  ticketDetailView,
  ticketListInclude,
  ticketListView,
} from './support.view';

/** A requester can have at most this many uploaded-but-not-yet-sent
 *  attachments on one ticket at a time — keeps an abandoned upload flow
 *  from silently accumulating unbounded rows (there is no sweep for
 *  never-sent attachments, same as this app's other "upload now, reference
 *  later" flows). */
const MAX_PENDING_ATTACHMENTS = 10;

/** The signed-in caller, resolved to "is this person support staff?". */
export interface SupportActor {
  id: string;
  staff: boolean;
}

const LIST_LIMIT = 100;

/**
 * Every id in this schema is a UUID, and Postgres rejects a malformed one at
 * the driver level (Prisma P2023) — which surfaces as an uncaught 500 rather
 * than the 400 a bad client input deserves. Client-supplied ids that are NOT
 * route params (those already go through `ParseUUIDPipe`) get shape-checked
 * here first. Deliberately version-agnostic, same as `ParseUUIDPipe`'s
 * default: the point is "can Postgres parse this", not "which RFC variant".
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses that mean "someone still has to work this" — entering any of them
 *  clears `resolvedAt`, since the ticket is demonstrably not resolved. */
const ACTIVE_STATUSES: readonly string[] = OPEN_STATUSES;

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // --- queries -------------------------------------------------------------

  async list(actor: SupportActor, query: ListTicketsQuery) {
    const mineOnly = !actor.staff || query.scope === 'mine';

    const where: Prisma.SupportTicketWhereInput = {
      ...(mineOnly ? { requesterId: actor.id } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(actor.staff && query.assignee === 'me' ? { assigneeId: actor.id } : {}),
      ...(actor.staff && query.assignee === 'unassigned' ? { assigneeId: null } : {}),
    };

    if (query.q) {
      const asNumber = Number.parseInt(query.q.replace(/^#/, ''), 10);
      where.OR = [
        { subject: { contains: query.q, mode: 'insensitive' } },
        ...(Number.isFinite(asNumber) ? [{ number: asNumber }] : []),
      ];
    }

    if (query.cursor && !UUID_RE.test(query.cursor)) {
      throw new BadRequestException('invalid_cursor');
    }

    // Same cursor contract as `NotificationsService.list` — pass the last
    // item's id back as `cursor`, read the next page off `nextCursor`. The
    // list used to stop dead at 100 tickets with no way to reach the rest.
    const tickets = await this.prisma.supportTicket.findMany({
      where,
      // `id` as a tiebreaker makes the sort total — `lastActivityAt` alone
      // isn't unique, and a cursor sitting on one of several same-timestamp
      // rows could otherwise skip or repeat a neighbour across the boundary.
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: ticketListInclude,
    });
    const hasMore = tickets.length > LIST_LIMIT;
    const items = hasMore ? tickets.slice(0, LIST_LIMIT) : tickets;
    return {
      items: items.map(ticketListView),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  /** Queue counters for the staff dashboard. */
  async overview() {
    const notClosed: Prisma.SupportTicketWhereInput = { status: { not: 'closed' } };
    const [open, unassigned, urgent, resolvedToday] = await Promise.all([
      this.prisma.supportTicket.count({ where: { status: { in: OPEN_STATUSES } } }),
      this.prisma.supportTicket.count({ where: { assigneeId: null, ...notClosed } }),
      this.prisma.supportTicket.count({ where: { priority: 'urgent', ...notClosed } }),
      this.prisma.supportTicket.count({
        where: { resolvedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);
    return { open, unassigned, urgent, resolvedToday };
  }

  /** Staff members who can be assigned a ticket. */
  async assignableStaff() {
    const rows = await this.prisma.platformRoleAssignment.findMany({
      where: { role: { in: SUPPORT_STAFF_ROLES } },
      select: { userId: true, user: { select: { name: true } } },
      // Without an explicit order Postgres is free to hand back a different
      // sequence on every call, so the assignee dropdown reshuffled itself
      // between openings.
      orderBy: { user: { name: 'asc' } },
    });
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.userId)) seen.set(r.userId, r.user.name);
    return { staff: [...seen].map(([id, name]) => ({ id, name })) };
  }

  async get(actor: SupportActor, id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: ticketDetailInclude,
    });
    if (!ticket || (!actor.staff && ticket.requesterId !== actor.id)) {
      throw new NotFoundException('Ticket not found');
    }
    return ticketDetailView(ticket, actor);
  }

  // --- mutations ---------------------------------------------------------

  async create(actor: SupportActor, dto: CreateTicketDto) {
    if (dto.companyId) {
      const member = await this.prisma.companyUser.findUnique({
        where: { companyId_userId: { companyId: dto.companyId, userId: actor.id } },
        select: { status: true },
      });
      if (!member || member.status !== 'active') {
        throw new BadRequestException('not_a_member');
      }
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        subject: dto.subject,
        category: dto.category,
        priority: dto.priority ?? 'normal',
        requesterId: actor.id,
        companyId: dto.companyId ?? null,
        messages: { create: { authorId: actor.id, kind: 'reply', body: dto.body } },
      },
      include: ticketDetailInclude,
    });

    // Already committed — a notification hiccup must never mask this. A new
    // ticket has no assignee yet, so the whole staff queue gets it (see
    // `supportQueueIds` for who that actually is).
    void this.notifyStaff(
      null,
      'ticket_created',
      `Ticket nou: #${ticket.number}`,
      `${ticket.subject}`,
      ticket.id,
      // A staff member opening their own ticket doesn't need to be told
      // about it.
      { excludeUserId: actor.id },
    );

    return ticketDetailView(ticket, actor);
  }

  async postMessage(actor: SupportActor, id: string, dto: PostMessageDto) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: { requester: { select: { email: true, name: true } } },
    });
    if (!ticket || (!actor.staff && ticket.requesterId !== actor.id)) {
      throw new NotFoundException('Ticket not found');
    }
    if (ticket.status === 'closed') throw new BadRequestException('ticket_closed');

    const internal = !!dto.internal && actor.staff;
    const staffReply = actor.staff && !internal;
    const requesterReply = ticket.requesterId === actor.id;
    const now = new Date();

    const ticketData: Prisma.SupportTicketUpdateInput = { lastActivityAt: now };
    if (staffReply && !ticket.firstResponseAt) ticketData.firstResponseAt = now;
    // A staff reply moves a fresh/waiting ticket into active handling.
    if (staffReply && (ticket.status === 'open' || ticket.status === 'waiting')) {
      ticketData.status = 'in_progress';
    }
    // The customer answering reopens a resolved ticket, and clears a
    // `waiting` ticket — "waiting" means waiting ON THE CUSTOMER, so their
    // reply is exactly the thing that ends it. Leaving it `waiting` kept
    // answered tickets parked in a queue nobody looks at.
    const reopenedFromResolved = requesterReply && !actor.staff && ticket.status === 'resolved';
    if (
      requesterReply &&
      !actor.staff &&
      (ticket.status === 'resolved' || ticket.status === 'waiting')
    ) {
      ticketData.status = 'open';
      // Only the resolved case touches `resolvedAt` — a `waiting` ticket
      // never had one to clear.
      if (reopenedFromResolved) ticketData.resolvedAt = null;
    }

    const messageId = randomUUID();
    const attachmentIds = dto.attachmentIds ?? [];

    await this.prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({
        data: {
          id: messageId,
          ticketId: id,
          authorId: actor.id,
          kind: internal ? 'note' : 'reply',
          body: dto.body,
        },
      });
      await tx.supportTicket.update({ where: { id }, data: ticketData });
      if (attachmentIds.length) {
        // Scoped so this can only ever claim attachments this same actor
        // uploaded onto this same ticket and that aren't already linked to a
        // different message — never another user's upload or a stale id
        // from elsewhere, even if the client sent a bogus/foreign id. If
        // any id in the batch doesn't match, the whole transaction rolls
        // back rather than silently sending the message without them.
        const linked = await tx.supportAttachment.updateMany({
          where: { id: { in: attachmentIds }, ticketId: id, uploaderId: actor.id, messageId: null },
          data: { messageId },
        });
        if (linked.count !== attachmentIds.length) {
          throw new BadRequestException('invalid_attachments');
        }
      }
    });

    if (staffReply) {
      void this.notifyRequester(
        ticket.requesterId,
        ticket.id,
        ticket.number,
        ticket.subject,
        'Un agent de suport a răspuns la ticketul tău.',
        dto.body,
      );
    } else if (requesterReply && !actor.staff) {
      // Already committed — a notification hiccup must never mask this. A
      // reply that REOPENS a resolved ticket is its own event: it means the
      // fix didn't hold, which reads very differently from "another reply on
      // an open ticket" in the panel. Sent instead of `ticket_reply` rather
      // than on top of it, so one customer action is one notification.
      void (reopenedFromResolved
        ? this.notifyStaff(
            ticket.assigneeId,
            'ticket_reopened',
            `Ticketul #${ticket.number} a fost redeschis`,
            `Ticketul #${ticket.number} a fost redeschis — clientul a răspuns după rezolvare.`,
            ticket.id,
          )
        : this.notifyStaff(
            ticket.assigneeId,
            'ticket_reply',
            `Răspuns nou pe ticketul #${ticket.number}`,
            ticket.subject,
            ticket.id,
          ));
    }
    return this.get(actor, id);
  }

  /**
   * Upload a file (PDF or image) onto a ticket, not yet attached to any
   * message — same two-step shape as the website builders' own image
   * attach (upload first, get an id back, then reference it). The real
   * type is re-derived from the decoded bytes' magic number in
   * `decodeAttachment`, not trusted from the client's claimed MIME.
   */
  async uploadAttachment(actor: SupportActor, ticketId: string, dto: UploadAttachmentDto) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { requesterId: true, status: true },
    });
    if (!ticket || (!actor.staff && ticket.requesterId !== actor.id)) {
      throw new NotFoundException('Ticket not found');
    }
    if (ticket.status === 'closed') throw new BadRequestException('ticket_closed');

    const pending = await this.prisma.supportAttachment.count({
      where: { ticketId, uploaderId: actor.id, messageId: null },
    });
    if (pending >= MAX_PENDING_ATTACHMENTS) throw new BadRequestException('too_many_attachments');

    const { mime, bytes, filename } = decodeAttachment(dto.dataUri, dto.filename);
    const row = await this.prisma.supportAttachment.create({
      data: { ticketId, uploaderId: actor.id, filename, mime, bytes, size: bytes.length },
      select: { id: true, filename: true, mime: true, size: true },
    });
    return row;
  }

  /** Streamed back to whoever can see the ticket (requester or staff) — same
   *  access rule as everything else on it. */
  async getAttachment(actor: SupportActor, ticketId: string, attachmentId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { requesterId: true },
    });
    if (!ticket || (!actor.staff && ticket.requesterId !== actor.id)) {
      throw new NotFoundException('Ticket not found');
    }
    const att = await this.prisma.supportAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: { select: { kind: true } } },
    });
    if (!att || att.ticketId !== ticketId) throw new NotFoundException('Attachment not found');
    // The detail view already hides internal notes from the requester, but
    // the bytes behind them were still downloadable by anyone who could
    // guess/see an id — the message body was private while its evidence
    // wasn't. A still-unsent upload (`messageId === null`) is nobody's to
    // read yet either. 404, not 403, same as every other access check here:
    // a requester must not learn that an internal note exists.
    if (!actor.staff && (att.messageId === null || att.message?.kind === 'note')) {
      throw new NotFoundException('Attachment not found');
    }
    return att;
  }

  async update(actor: SupportActor, id: string, dto: UpdateTicketDto) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: { requester: { select: { email: true } } },
    });
    if (!ticket || (!actor.staff && ticket.requesterId !== actor.id)) {
      throw new NotFoundException('Ticket not found');
    }

    // The requester can only close or reopen their own ticket — nothing else.
    if (!actor.staff) {
      if (dto.priority || dto.category || dto.assigneeId !== undefined) {
        throw new ForbiddenException('staff_only');
      }
      if (
        dto.status &&
        dto.status !== 'closed' &&
        dto.status !== 'open' &&
        dto.status !== 'resolved'
      ) {
        throw new ForbiddenException('staff_only');
      }
    }

    // Unchecked (scalar-only) shape on purpose: the same object is handed to
    // both `update` and the conditional `updateMany` that claims an
    // assignment below, and `updateMany` only accepts scalars.
    const data: Prisma.SupportTicketUncheckedUpdateManyInput = {};
    const events: string[] = [];
    const now = new Date();
    /** The status this call actually transitions TO — `null` when the client
     *  sent a status the ticket already has (a no-op the whole method, and
     *  every notification below, has to treat as "nothing happened"). */
    const statusChange = dto.status && dto.status !== ticket.status ? dto.status : null;
    let newAssigneeId: string | null = null;
    let newAssigneeName: string | null = null;
    let assignmentChanged = false;

    if (statusChange) {
      data.status = statusChange;
      // Each timestamp is only touched by the transitions that genuinely
      // affect it. Blanket-clearing both on every status change meant
      // closing an ALREADY-RESOLVED ticket wiped its `resolvedAt` back to
      // null — which both lost the real resolution time and silently
      // dropped the ticket out of the "resolved today" counter.
      if (statusChange === 'resolved') data.resolvedAt = now;
      else if (ACTIVE_STATUSES.includes(statusChange)) data.resolvedAt = null;
      if (statusChange === 'closed') data.closedAt = now;
      else if (ticket.status === 'closed') data.closedAt = null;
      events.push(`status:${statusChange}`);
    }
    if (actor.staff && dto.priority && dto.priority !== ticket.priority) {
      data.priority = dto.priority;
      events.push(`priority:${dto.priority}`);
    }
    if (actor.staff && dto.category && dto.category !== ticket.category) {
      data.category = dto.category;
    }
    if (actor.staff && dto.assigneeId !== undefined) {
      // Checked against what the CLIENT sent, not the resolved value:
      // `"me"` is a legal sentinel and `""` means unassign. Anything else
      // has to be a real id before it reaches a `where: { userId }`, or
      // Postgres throws P2023 and the caller gets a 500 for what is plainly
      // a bad request.
      if (dto.assigneeId && dto.assigneeId !== 'me' && !UUID_RE.test(dto.assigneeId)) {
        throw new BadRequestException('assignee_not_staff');
      }
      const next = dto.assigneeId === 'me' ? actor.id : dto.assigneeId || null;
      if (next !== ticket.assigneeId) {
        if (next) {
          const ok = await this.prisma.platformRoleAssignment.findFirst({
            where: { userId: next, role: { in: SUPPORT_STAFF_ROLES } },
            select: { id: true },
          });
          if (!ok) throw new BadRequestException('assignee_not_staff');
          const who = await this.prisma.user.findUnique({
            where: { id: next },
            select: { name: true },
          });
          newAssigneeName = who?.name ?? null;
          events.push(`assigned:${newAssigneeName ?? ''}`);
        } else {
          events.push('unassigned');
        }
        newAssigneeId = next;
        assignmentChanged = true;
      }
    }

    if (Object.keys(data).length === 0 && !assignmentChanged) return this.get(actor, id);
    data.lastActivityAt = now;

    if (assignmentChanged) {
      // Atomic claim, same shape as the campaign sweeps: the write only
      // lands if the assignee is still exactly what we read a moment ago.
      // Read-compare-write let two agents both hit "assign to me" and both
      // "succeed" — last write won and the loser was never told the ticket
      // wasn't theirs. Now the loser gets a 409 and can re-read.
      const claimed = await this.prisma.supportTicket.updateMany({
        where: { id, assigneeId: ticket.assigneeId },
        data: { ...data, assigneeId: newAssigneeId },
      });
      if (claimed.count === 0) throw new ConflictException('already_claimed');
    } else {
      await this.prisma.supportTicket.update({ where: { id }, data });
    }
    if (events.length) {
      await this.prisma.supportMessage.createMany({
        data: events.map((e) => ({
          ticketId: id,
          authorId: actor.id,
          kind: 'system' as const,
          body: e,
        })),
      });
    }

    // --- notifications ---------------------------------------------------
    // All already committed above — a notification hiccup must never mask
    // the write, so every dispatch here is fire-and-forget.
    const statusRo = statusChange === 'resolved' ? 'rezolvat' : 'închis';

    // Gated on `statusChange` (the transition that actually happened) rather
    // than on the raw dto: re-sending the status a ticket already has used to
    // fire a second "marked resolved" email for nothing. And gated on
    // `actor.staff`, because a customer closing their own ticket does not
    // need an email telling them they closed their own ticket.
    if (statusChange && actor.staff && (statusChange === 'resolved' || statusChange === 'closed')) {
      void this.notifyRequester(
        ticket.requesterId,
        ticket.id,
        ticket.number,
        ticket.subject,
        `Ticketul tău a fost marcat ca ${statusRo}.`,
      );
    }

    // The complement: the CUSTOMER resolved/closed it. Whoever is holding the
    // ticket should stop working on it — nobody was told at all before.
    if (
      statusChange &&
      !actor.staff &&
      (statusChange === 'resolved' || statusChange === 'closed') &&
      ticket.assigneeId
    ) {
      void this.notifyStaff(
        ticket.assigneeId,
        'ticket_closed_by_user',
        `Ticketul #${ticket.number} a fost ${statusRo} de client`,
        `Clientul a marcat ticketul #${ticket.number} ca ${statusRo}.`,
        ticket.id,
      );
    }

    // A customer hitting "Reopen" on a resolved/closed ticket is the loudest
    // signal in this whole system — it means the ticket was closed while the
    // problem wasn't solved — and it reached nobody. Email as well as panel,
    // so it lands even when no agent is logged in.
    if (statusChange === 'open' && !actor.staff && !ACTIVE_STATUSES.includes(ticket.status)) {
      void this.notifyStaff(
        ticket.assigneeId,
        'ticket_reopened',
        `Ticketul #${ticket.number} a fost redeschis`,
        `Clientul a redeschis ticketul #${ticket.number} — ${ticket.subject}`,
        ticket.id,
        { email: true },
      );
    }

    if (assignmentChanged && newAssigneeId) {
      // Only fires when the NEW assignee is someone other than the actor
      // doing the assigning (no need to notify yourself that you picked up a
      // ticket).
      if (newAssigneeId !== actor.id) {
        void this.notifications
          .notify({
            userId: newAssigneeId,
            type: 'ticket_assigned',
            title: `Ți-a fost alocat ticketul #${ticket.number}`,
            body: ticket.subject,
            channels: { panel: true },
            data: { ticketId: ticket.id },
          })
          .catch((err) =>
            this.logger.error(
              'Ticket-assigned notification failed',
              err instanceof Error ? err.stack : err,
            ),
          );
      }
      // The requester's side of the same event: "somebody real has this
      // now". Panel only — it's reassurance, not something worth an email.
      if (ticket.requesterId !== newAssigneeId) {
        void this.notifications
          .notify({
            userId: ticket.requesterId,
            type: 'ticket_assigned_requester',
            title: `Ticketul #${ticket.number} a fost preluat`,
            body: newAssigneeName
              ? `Ticketul #${ticket.number} a fost preluat de ${newAssigneeName}.`
              : `Ticketul #${ticket.number} a fost preluat de un agent de suport.`,
            channels: { panel: true },
            data: { ticketId: ticket.id },
          })
          .catch((err) =>
            this.logger.error(
              'Ticket-assigned-requester notification failed',
              err instanceof Error ? err.stack : err,
            ),
          );
      }
    }

    // Losing a ticket off your own queue is news too — a reassignment or an
    // unassignment used to be completely silent for the person who had it,
    // who kept working a ticket that was no longer theirs. Skipped when they
    // did it themselves (handing off / dropping your own ticket).
    if (
      assignmentChanged &&
      ticket.assigneeId &&
      ticket.assigneeId !== newAssigneeId &&
      ticket.assigneeId !== actor.id
    ) {
      void this.notifications
        .notify({
          userId: ticket.assigneeId,
          type: 'ticket_unassigned',
          title: `Ticketul #${ticket.number} nu îți mai este alocat`,
          body: newAssigneeId
            ? `Ticketul #${ticket.number} a fost realocat către ${newAssigneeName ?? 'un alt agent'}.`
            : `Ticketul #${ticket.number} nu îți mai este alocat.`,
          channels: { panel: true },
          data: { ticketId: ticket.id },
        })
        .catch((err) =>
          this.logger.error(
            'Ticket-unassigned notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );
    }
    return this.get(actor, id);
  }

  /** Panel + email — migrated off a raw `MailService.send` so ticket updates
   *  go through the same central system as every other notification.
   *  `replyExcerpt` (the staff reply's own text, only passed for an actual
   *  reply — not for a status-change line like "marked resolved") used to be
   *  dropped entirely: the email said a reply existed without saying what it
   *  said, forcing a login just to read one paragraph. */
  private async notifyRequester(
    requesterId: string,
    ticketId: string,
    ticketNumber: number,
    subject: string,
    line: string,
    replyExcerpt?: string,
  ): Promise<void> {
    const frontendOrigin = this.config.get('frontendOrigin', { infer: true });
    const replyTo = this.supportInboxEmail();
    const quoted = replyExcerpt
      ? `„${replyExcerpt.slice(0, 300)}${replyExcerpt.length > 300 ? '…' : ''}”`
      : null;
    await this.notifications
      .notify({
        userId: requesterId,
        type: 'support_ticket_update',
        title: `[#${ticketNumber}] ${subject}`,
        body: line,
        channels: { panel: true, email: true },
        data: { ticketId },
        email: {
          greet: true,
          ...(replyTo ? { replyTo } : {}),
          text: [
            line,
            quoted,
            'Răspunde direct din ticket — păstrăm tot istoricul conversației într-un singur loc.',
          ]
            .filter((p): p is string => !!p)
            .join('\n\n'),
          details: [
            { label: 'Ticket', value: `#${ticketNumber}` },
            { label: 'Subiect', value: subject },
          ],
          cta: { label: 'Deschide ticketul', url: `${frontendOrigin}/support/${ticketId}` },
        },
      })
      .catch((err) =>
        this.logger.error(
          'Support-ticket-update notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
  }

  /**
   * Optional reply-to for ticket emails, so a customer hitting "Reply" in
   * their mail client reaches a human instead of the no-reply sender. Read
   * straight from the environment rather than through `AppConfig` because it
   * is genuinely optional — unset simply means no reply-to header, never a
   * boot failure or a thrown request.
   */
  private supportInboxEmail(): string | null {
    return process.env.SUPPORT_INBOX_EMAIL?.trim() || null;
  }

  /**
   * Who owns an UNASSIGNED ticket. `support` is the real queue; `admin` is
   * only a fallback for an install that hasn't handed the support role to
   * anyone yet. Notifying both roles unconditionally meant every admin got
   * every single ticket event forever — the fastest way to train people to
   * ignore the bell.
   */
  private async supportQueueIds(excludeUserId?: string): Promise<string[]> {
    const holdersOf = async (role: PlatformRole): Promise<string[]> => {
      const rows = await this.prisma.platformRoleAssignment.findMany({
        where: { role },
        select: { userId: true },
        distinct: ['userId'],
      });
      return rows.map((r) => r.userId);
    };
    let ids = await holdersOf('support');
    if (!ids.length) ids = await holdersOf('admin');
    return excludeUserId ? ids.filter((id) => id !== excludeUserId) : ids;
  }

  /** Notify one staff member (the ticket's assignee) or, if unassigned, the
   *  whole support queue — see `supportQueueIds` for who that is. */
  private async notifyStaff(
    assigneeId: string | null,
    type: string,
    title: string,
    body: string,
    ticketId: string,
    opts: { email?: boolean; excludeUserId?: string } = {},
  ): Promise<void> {
    try {
      const staffIds = assigneeId
        ? [assigneeId].filter((id) => id !== opts.excludeUserId)
        : await this.supportQueueIds(opts.excludeUserId);
      const frontendOrigin = this.config.get('frontendOrigin', { infer: true });
      for (const userId of staffIds) {
        await this.notifications
          .notify({
            userId,
            type,
            title,
            body,
            channels: { panel: true, ...(opts.email ? { email: true } : {}) },
            data: { ticketId },
            ...(opts.email
              ? {
                  email: {
                    greet: true,
                    details: [{ label: 'Ticket', value: title }],
                    cta: {
                      label: 'Deschide ticketul',
                      url: `${frontendOrigin}/support/${ticketId}`,
                    },
                  },
                }
              : {}),
          })
          .catch((err) =>
            this.logger.error(
              `Staff notification (${type}) failed for ${userId}`,
              err instanceof Error ? err.stack : err,
            ),
          );
      }
    } catch (err) {
      this.logger.error(`notifyStaff (${type}) failed`, err instanceof Error ? err.stack : err);
    }
  }
}
