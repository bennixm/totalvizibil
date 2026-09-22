import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailAttachment, MailService } from '../mail/mail.service';
import { ctaButton, detailsTable, renderEmailLayout, textToHtml } from '../mail/templates/layout';
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
  /** Override the email's own subject/text/reply-to, and add the richer
   *  content the shared HTML layout knows how to render — a receipt table,
   *  a single call-to-action button, file attachments (e.g. an invoice PDF).
   *  Ignored unless `channels.email` is set. Every email — this or the plain
   *  title/body default — renders through the same branded layout
   *  (mail/templates/layout.ts), so "custom" only ever means "extra
   *  content", never a one-off template. */
  email?: {
    subject?: string;
    text?: string;
    replyTo?: string;
    details?: { label: string; value: string }[];
    cta?: { label: string; url: string };
    attachments?: MailAttachment[];
  };
}

/** Builds the HTML alternative for one notification — shared by notify() and
 *  notifyAll() so a broadcast renders through the exact same layout as a
 *  per-user email, never a second code path. */
function buildHtml(heading: string, text: string, email: NotifyInput['email']): string {
  const parts = [textToHtml(text)];
  if (email?.details?.length) parts.push(detailsTable(email.details));
  if (email?.cta) parts.push(ctaButton(email.cta.label, email.cta.url));
  return renderEmailLayout({ heading, preheader: text.slice(0, 140), bodyHtml: parts.join('') });
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
        const text = input.email?.text ?? input.body;
        const { dispatched } = await this.mail.send({
          to: user.email,
          subject: input.email?.subject ?? input.title,
          text,
          html: buildHtml(input.email?.subject ?? input.title, text, input.email),
          replyTo: input.email?.replyTo,
          attachments: input.email?.attachments,
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
      const html = buildHtml(subject, text, input.email);
      // Backgrounded, not awaited: the DB rows + panel push above are
      // already committed by the time this starts, so a slow or failing
      // email leg can never undo or mask that. Without this, a broadcast to
      // thousands of active users would hold the caller's HTTP request open
      // for as long as the sequential email loop below takes to finish.
      void this.sendBroadcastEmails(users, subject, text, html);
    }

    return users.length;
  }

  /** Sequential, deliberately — a burst of concurrent SMTP connections to
   *  Gmail is exactly the kind of thing that gets a dev account throttled.
   *  Called fire-and-forget from `notifyAll` once its DB/panel work is
   *  already committed. */
  private async sendBroadcastEmails(
    users: { email: string }[],
    subject: string,
    text: string,
    html: string,
  ): Promise<void> {
    for (const u of users) {
      await this.mail.send({ to: u.email, subject, text, html }).catch(() => undefined);
    }
  }

  /** Panel history — only rows sent to the panel, and not dismissed, show here. */
  async list(userId: string, opts: { limit?: number; cursor?: string } = {}) {
    const take = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const rows = await this.prisma.notification.findMany({
      where: { userId, channels: { has: NotificationChannel.panel }, dismissedAt: null },
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
      where: {
        userId,
        channels: { has: NotificationChannel.panel },
        readAt: null,
        dismissedAt: null,
      },
    });
  }

  async markRead(userId: string, id: string): Promise<void> {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Notification not found');
    if (!row.readAt) {
      await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    }
    // Every open tab/device — including this one, harmlessly, since the
    // client applies this idempotently — hears about it.
    this.gateway.syncUser(userId, { kind: 'read', id });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, channels: { has: NotificationChannel.panel }, readAt: null },
      data: { readAt: new Date() },
    });
    this.gateway.syncUser(userId, { kind: 'read-all' });
  }

  /** Removes one notification from the user's OWN panel — the row itself is
   *  kept (the audit trail this whole system is built around), just excluded
   *  from `list()`/`unreadCount()` from here on. */
  async dismiss(userId: string, id: string): Promise<void> {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Notification not found');
    if (!row.dismissedAt) {
      await this.prisma.notification.update({ where: { id }, data: { dismissedAt: new Date() } });
    }
    this.gateway.syncUser(userId, { kind: 'dismissed', id });
  }
}
