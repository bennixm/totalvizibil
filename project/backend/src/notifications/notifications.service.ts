import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
    /** Inbox-preview line — defaults to the message's first line if omitted,
     *  rather than a mid-sentence/mid-word slice of the whole body. Worth
     *  overriding with something the subject doesn't already say. */
    preheader?: string;
    /** Opens the message with "Bună, {name}," when the recipient's name is
     *  available (never applies to notifyAll() — a broadcast has no single
     *  recipient to greet). Off by default so call sites that already greet
     *  inline, or whose first line reads fine without one, aren't
     *  double-greeted. */
    greet?: boolean;
    /** Short line under the footer — why this was sent / what to do if the
     *  recipient didn't expect it. Kept visually and textually separate from
     *  the main message instead of competing with it as just another
     *  sentence in the body. */
    footerNote?: string;
  };
}

/** "Bună, {name}," + the message — the one greeting rule shared by every
 *  email in the system, so `greet` behaves identically everywhere instead of
 *  each call site hand-rolling its own opening line. */
function composeMessage(
  body: string,
  name: string | null | undefined,
  email: NotifyInput['email'],
): string {
  const greetLine = email?.greet && name ? `Bună, ${name},` : null;
  return [greetLine, email?.text ?? body].filter((p): p is string => !!p).join('\n\n');
}

/** The plain-text MIME part — the message, plus `details`/`cta`/`footerNote`
 *  inlined as plain lines. Without this, a text-only client lost the
 *  details table and the call-to-action link entirely (e.g. a lead's
 *  contact info, an invoice link) — they used to exist only in the HTML
 *  alternative built by `buildHtml` below. */
function buildText(message: string, email: NotifyInput['email']): string {
  const parts = [message];
  if (email?.details?.length) {
    parts.push(email.details.map((d) => `${d.label}: ${d.value}`).join('\n'));
  }
  if (email?.cta) parts.push(`${email.cta.label}: ${email.cta.url}`);
  if (email?.footerNote) parts.push(email.footerNote);
  return parts.join('\n\n');
}

/** Builds the HTML alternative for one notification — shared by notify() and
 *  notifyAll() so a broadcast renders through the exact same layout as a
 *  per-user email, never a second code path. `details`/`cta` get their own
 *  styled widgets here, so they're intentionally NOT repeated as text inside
 *  `message` (that duplication is `buildText`'s job, for the plain part). */
function buildHtml(
  heading: string,
  message: string,
  preheader: string,
  email: NotifyInput['email'],
): string {
  const parts = [textToHtml(message)];
  if (email?.details?.length) parts.push(detailsTable(email.details));
  if (email?.cta) parts.push(ctaButton(email.cta.label, email.cta.url));
  return renderEmailLayout({
    heading,
    preheader,
    bodyHtml: parts.join(''),
    footerNote: email?.footerNote,
  });
}

/**
 * Every other feature in this app calls `notify`/`notifyAll` instead of
 * touching MailService or a socket directly — "which channels" is decided
 * once per call site, here, so the actual dispatch mechanics (DB row, socket
 * push, email send) live in exactly one place.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

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
        select: { email: true, name: true },
      });
      if (user?.email) {
        const message = composeMessage(input.body, user.name, input.email);
        const subject = input.email?.subject ?? input.title;
        const preheader = input.email?.preheader ?? message.split('\n')[0].slice(0, 140);
        const { dispatched } = await this.mail.send({
          to: user.email,
          subject,
          text: buildText(message, input.email),
          html: buildHtml(subject, message, preheader, input.email),
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

  /** Notify every active user — the discount and maintenance broadcasts.
   *  Explicit per-recipient row ids (generated here, not left to the DB
   *  default) so the panel push and the email-dispatch tracking below can
   *  both reference the exact row each recipient got, without a second
   *  round-trip to re-look them up after `createMany`. */
  async notifyAll(input: Omit<NotifyInput, 'userId'>): Promise<number> {
    const channels = this.channelList(input.channels);
    if (!channels.length) return 0;

    const users = await this.prisma.user.findMany({
      where: { status: 'active' },
      select: { id: true, email: true },
    });
    if (!users.length) return 0;

    const recipients = users.map((u) => ({ ...u, rowId: randomUUID() }));

    await this.prisma.notification.createMany({
      data: recipients.map((r) => ({
        id: r.rowId,
        userId: r.id,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data as Prisma.InputJsonValue | undefined,
        channels,
      })),
    });

    if (input.channels.panel) {
      // Pushed per-recipient room, not a server-wide emit — a socket
      // belonging to a user who ISN'T in `recipients` (e.g. suspended
      // mid-broadcast — see NotificationsGateway's session handling) must
      // never get a toast/unread bump with no DB row behind it.
      for (const r of recipients) {
        this.gateway.pushToUser(r.id, {
          id: r.rowId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: input.data,
          createdAt: new Date(),
        });
      }
    }

    if (input.channels.email) {
      const subject = input.email?.subject ?? input.title;
      // No name to greet with — a broadcast has no single recipient.
      const message = composeMessage(input.body, null, input.email);
      const preheader = input.email?.preheader ?? message.split('\n')[0].slice(0, 140);
      const text = buildText(message, input.email);
      const html = buildHtml(subject, message, preheader, input.email);
      // Backgrounded, not awaited: the DB rows + panel push above are
      // already committed by the time this starts, so a slow or failing
      // email leg can never undo or mask that. Without this, a broadcast to
      // thousands of active users would hold the caller's HTTP request open
      // for as long as the sequential email loop below takes to finish.
      void this.sendBroadcastEmails(recipients, subject, text, html);
    }

    return recipients.length;
  }

  /** Sequential, deliberately — a burst of concurrent SMTP connections to
   *  Gmail is exactly the kind of thing that gets a dev account throttled.
   *  Called fire-and-forget from `notifyAll` once its DB/panel work is
   *  already committed. Stamps `emailSentAt` per recipient exactly like
   *  `notify()` does, so a broadcast's audit trail is honest about which
   *  emails actually went out instead of claiming success just because rows
   *  were created. */
  private async sendBroadcastEmails(
    recipients: { id: string; email: string; rowId: string }[],
    subject: string,
    text: string,
    html: string,
  ): Promise<void> {
    for (const r of recipients) {
      try {
        const { dispatched } = await this.mail.send({ to: r.email, subject, text, html });
        if (dispatched) {
          await this.prisma.notification.update({
            where: { id: r.rowId },
            data: { emailSentAt: new Date() },
          });
        }
      } catch (err) {
        this.logger.error(
          `Broadcast email failed for user ${r.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }

  /** Panel history — only rows sent to the panel, and not dismissed, show here. */
  async list(userId: string, opts: { limit?: number; cursor?: string } = {}) {
    const take = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const rows = await this.prisma.notification.findMany({
      where: { userId, channels: { has: NotificationChannel.panel }, dismissedAt: null },
      // `id` as a tiebreaker makes the sort total — `createdAt` alone isn't
      // unique, and a cursor sitting on one of several same-timestamp rows
      // could otherwise skip or repeat a neighbour across the page boundary.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
    // Bounded by the moment this request started — a notification that's
    // inserted a moment later (e.g. a lead arriving mid-request) must never
    // be swept up as "read" by a click that happened before it existed.
    const asOf = new Date();
    await this.prisma.notification.updateMany({
      where: {
        userId,
        channels: { has: NotificationChannel.panel },
        readAt: null,
        createdAt: { lte: asOf },
      },
      data: { readAt: asOf },
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
