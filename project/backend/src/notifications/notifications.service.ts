import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsGateway } from './notifications.gateway';

export interface NotifyChannels {
  /** Show in the bell/panel + push a real-time pop-up over the socket. */
  panel?: boolean;
  /** Send an email. */
  email?: boolean;
}

export interface NotifyInput {
  userId: string;
  /** Machine key, e.g. "lead_received" — lets the panel pick an icon and any
   *  future feature filter by kind. Not used to decide routing. */
  type: string;
  /** Panel title / default email subject. */
  title: string;
  /** Panel body / default email text. */
  body: string;
  channels: NotifyChannels;
  /** Structured extra for the panel to build a "go there" link. */
  data?: Record<string, unknown>;
  /** Override the email's own subject/text/reply-to when it needs more detail
   *  than the terse panel copy (e.g. a full receipt). Ignored unless
   *  `channels.email` is set. */
  email?: { subject?: string; text?: string; replyTo?: string };
}

/**
 * Every other feature in this app calls `notify`/`notifyAll` instead of
 * touching MailService or a socket directly — "which channels" is decided
 * once per call site, here, so the actual dispatch mechanics (DB row, socket
 * push, email send) live in exactly one place.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly gateway: NotificationsGateway,
  ) {}

  private channelList(channels: NotifyChannels): NotificationChannel[] {
    const list: NotificationChannel[] = [];
    if (channels.panel) list.push(NotificationChannel.panel);
    if (channels.email) list.push(NotificationChannel.email);
    return list;
  }

  /** Notify one user. No-ops if neither channel is requested. */
  async notify(input: NotifyInput): Promise<void> {
    const channels = this.channelList(input.channels);
    if (!channels.length) return;

    const row = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data as Prisma.InputJsonValue | undefined,
        channels,
      },
    });

    if (input.channels.panel) {
      this.gateway.pushToUser(input.userId, {
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        data: row.data,
        createdAt: row.createdAt,
      });
    }

    if (input.channels.email) {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true },
      });
      if (user?.email) {
        const { dispatched } = await this.mail.send({
          to: user.email,
          subject: input.email?.subject ?? input.title,
          text: input.email?.text ?? input.body,
          replyTo: input.email?.replyTo,
        });
        if (dispatched) {
          await this.prisma.notification.update({
            where: { id: row.id },
            data: { emailSentAt: new Date() },
          });
        }
      }
    }
  }

  /** Notify every active user — the discount and maintenance broadcasts. */
  async notifyAll(input: Omit<NotifyInput, 'userId'>): Promise<number> {
    const channels = this.channelList(input.channels);
    if (!channels.length) return 0;

    const users = await this.prisma.user.findMany({
      where: { status: 'active' },
      select: { id: true, email: true },
    });
    if (!users.length) return 0;

    await this.prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data as Prisma.InputJsonValue | undefined,
        channels,
      })),
    });

    if (input.channels.panel) {
      this.gateway.broadcast({
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
      });
    }

    if (input.channels.email) {
      const subject = input.email?.subject ?? input.title;
      const text = input.email?.text ?? input.body;
      // Sequential, deliberately — a burst of concurrent SMTP connections to
      // Gmail is exactly the kind of thing that gets a dev account throttled.
      for (const u of users) {
        await this.mail.send({ to: u.email, subject, text }).catch(() => undefined);
      }
    }

    return users.length;
  }

  /** Panel history — only rows sent to the panel show here. */
  async list(userId: string, opts: { limit?: number; cursor?: string } = {}) {
    const take = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const rows = await this.prisma.notification.findMany({
      where: { userId, channels: { has: NotificationChannel.panel } },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, channels: { has: NotificationChannel.panel }, readAt: null },
    });
  }

  async markRead(userId: string, id: string): Promise<void> {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Notification not found');
    if (!row.readAt) {
      await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, channels: { has: NotificationChannel.panel }, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
