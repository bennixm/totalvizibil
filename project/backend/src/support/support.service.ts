import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OPEN_STATUSES, SUPPORT_STAFF_ROLES } from './support.constants';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQuery } from './dto/list-tickets.query';
import { PostMessageDto } from './dto/post-message.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import {
  ticketDetailInclude,
  ticketDetailView,
  ticketListInclude,
  ticketListView,
} from './support.view';

/** The signed-in caller, resolved to "is this person support staff?". */
export interface SupportActor {
  id: string;
  staff: boolean;
}

const LIST_LIMIT = 100;

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
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

    const tickets = await this.prisma.supportTicket.findMany({
      where,
      orderBy: { lastActivityAt: 'desc' },
      take: LIST_LIMIT,
      include: ticketListInclude,
    });
    return { items: tickets.map(ticketListView) };
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
    // ticket has no assignee yet, so the whole staff queue gets it.
    void this.notifyStaff(
      null,
      'ticket_created',
      `Ticket nou: #${ticket.number}`,
      `${ticket.subject}`,
      ticket.id,
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
    // The customer answering a resolved ticket reopens it.
    if (requesterReply && !actor.staff && ticket.status === 'resolved') {
      ticketData.status = 'open';
      ticketData.resolvedAt = null;
    }

    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: {
          ticketId: id,
          authorId: actor.id,
          kind: internal ? 'note' : 'reply',
          body: dto.body,
        },
      }),
      this.prisma.supportTicket.update({ where: { id }, data: ticketData }),
    ]);

    if (staffReply) {
      void this.notifyRequester(
        ticket.requesterId,
        ticket.id,
        ticket.number,
        ticket.subject,
        'A support agent replied to your ticket.',
      );
    } else if (requesterReply && !actor.staff) {
      // Already committed — a notification hiccup must never mask this.
      void this.notifyStaff(
        ticket.assigneeId,
        'ticket_reply',
        `Răspuns nou pe ticketul #${ticket.number}`,
        ticket.subject,
        ticket.id,
      );
    }
    return this.get(actor, id);
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
      if (dto.status && dto.status !== 'closed' && dto.status !== 'open') {
        throw new ForbiddenException('staff_only');
      }
    }

    const data: Prisma.SupportTicketUpdateInput = {};
    const events: string[] = [];
    const now = new Date();
    let newAssigneeId: string | null | undefined;

    if (dto.status && dto.status !== ticket.status) {
      data.status = dto.status;
      data.resolvedAt = dto.status === 'resolved' ? now : null;
      data.closedAt = dto.status === 'closed' ? now : null;
      events.push(`status:${dto.status}`);
    }
    if (actor.staff && dto.priority && dto.priority !== ticket.priority) {
      data.priority = dto.priority;
      events.push(`priority:${dto.priority}`);
    }
    if (actor.staff && dto.category && dto.category !== ticket.category) {
      data.category = dto.category;
    }
    if (actor.staff && dto.assigneeId !== undefined) {
      const next = dto.assigneeId === 'me' ? actor.id : dto.assigneeId || null;
      if (next !== ticket.assigneeId) {
        if (next) {
          const ok = await this.prisma.platformRoleAssignment.findFirst({
            where: { userId: next, role: { in: SUPPORT_STAFF_ROLES } },
            select: { id: true },
          });
          if (!ok) throw new BadRequestException('assignee_not_staff');
          data.assignee = { connect: { id: next } };
          const who = await this.prisma.user.findUnique({
            where: { id: next },
            select: { name: true },
          });
          events.push(`assigned:${who?.name ?? ''}`);
          newAssigneeId = next;
        } else {
          data.assignee = { disconnect: true };
          events.push('unassigned');
        }
      }
    }

    if (Object.keys(data).length === 0) return this.get(actor, id);
    data.lastActivityAt = now;

    await this.prisma.supportTicket.update({ where: { id }, data });
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

    if (dto.status === 'resolved' || dto.status === 'closed') {
      void this.notifyRequester(
        ticket.requesterId,
        ticket.id,
        ticket.number,
        ticket.subject,
        `Your ticket was marked ${dto.status}.`,
      );
    }
    // Already committed — a notification hiccup must never mask this. Only
    // fires when the NEW assignee is someone other than the actor doing the
    // assigning (no need to notify yourself that you picked up a ticket).
    if (newAssigneeId && newAssigneeId !== actor.id) {
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
    return this.get(actor, id);
  }

  /** Panel + email — migrated off a raw `MailService.send` so ticket updates
   *  go through the same central system as every other notification. */
  private async notifyRequester(
    requesterId: string,
    ticketId: string,
    ticketNumber: number,
    subject: string,
    line: string,
  ): Promise<void> {
    await this.notifications
      .notify({
        userId: requesterId,
        type: 'support_ticket_update',
        title: `[#${ticketNumber}] ${subject}`,
        body: line,
        channels: { panel: true, email: true },
        data: { ticketId },
        email: {
          text: `${line}\n\nOpen the ticket in your Totalvizibil support inbox to reply.`,
        },
      })
      .catch((err) =>
        this.logger.error(
          'Support-ticket-update notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
  }

  /** Notify one staff member (the ticket's assignee) or, if unassigned, every
   *  support/admin staff member — the whole queue owns an unassigned ticket. */
  private async notifyStaff(
    assigneeId: string | null,
    type: string,
    title: string,
    body: string,
    ticketId: string,
  ): Promise<void> {
    try {
      let staffIds: string[];
      if (assigneeId) {
        staffIds = [assigneeId];
      } else {
        const rows = await this.prisma.platformRoleAssignment.findMany({
          where: { role: { in: SUPPORT_STAFF_ROLES } },
          select: { userId: true },
          distinct: ['userId'],
        });
        staffIds = rows.map((r) => r.userId);
      }
      for (const userId of staffIds) {
        await this.notifications
          .notify({
            userId,
            type,
            title,
            body,
            channels: { panel: true },
            data: { ticketId },
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
