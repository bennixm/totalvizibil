import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadChannel, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AppConfig } from '../config/env';
import { isLikelyBot } from '../campaigns/ad-click';
import { cleanLeadInput, leadFingerprint, type LeadChannelName, type RawLeadInput } from './lead.util';

const PAGE_MAX = 50;

type LeadRow = Prisma.LeadGetPayload<Record<string, never>>;

@Injectable()
export class LeadsService {
  private readonly logger = new Logger('Leads');
  private readonly frontendOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
  }

  // --- membership -----------------------------------------------------

  private async assertMember(companyId: string, userId: string): Promise<void> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') throw new NotFoundException('Company not found');
  }

  // --- public submission --------------------------------------------

  /**
   * A visitor sent a request from a company's site. De-duplicated per visitor
   * per window (see `lead.util`), bot-filtered, and — for a form — emailed to
   * the owner. Always resolves `{ ok: true }` so the site never leaks whether a
   * submission was deduped or dropped.
   */
  async submitPublic(
    slug: string,
    rawChannel: string,
    input: RawLeadInput,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<{ ok: true }> {
    const channel: LeadChannelName = rawChannel === 'call' ? 'call' : 'form';

    const company = await this.prisma.company.findFirst({
      where: { slug, status: 'active' },
      select: {
        id: true,
        displayName: true,
        owner: { select: { email: true } },
        contacts: { where: { isPublic: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    if (isLikelyBot(userAgent)) return { ok: true };

    const cleaned = cleanLeadInput(channel, input);
    if (!cleaned.ok) throw new BadRequestException(cleaned.error);

    const dialedPhone =
      channel === 'call'
        ? (company.contacts.find((c) => c.type === 'phone')?.value ?? null)
        : cleaned.value.phone;

    const visitorHash = leadFingerprint(ip, userAgent, company.id, channel);

    let lead: LeadRow;
    try {
      lead = await this.prisma.lead.create({
        data: {
          companyId: company.id,
          channel: channel as LeadChannel,
          name: cleaned.value.name,
          email: cleaned.value.email,
          phone: dialedPhone,
          message: cleaned.value.message,
          visitorHash,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true }; // repeat within the window — silently ignored
      }
      throw e;
    }

    if (channel === 'form') {
      await this.notifyOwner(company.owner.email, company.displayName, company.id, lead);
    }
    return { ok: true };
  }

  private async notifyOwner(
    to: string,
    companyName: string,
    companyId: string,
    lead: LeadRow,
  ): Promise<void> {
    const link = `${this.frontendOrigin}/leads?c=${companyId}`;
    const who = lead.name || lead.email || lead.phone || 'un vizitator';
    await this.mail
      .send({
        to,
        replyTo: lead.email ?? undefined,
        subject: `Cerere nouă pentru ${companyName} — de la ${who}`,
        text: [
          `Ai o cerere nouă din formularul de contact al site-ului "${companyName}".`,
          '',
          `De la:     ${lead.name ?? '—'}`,
          `Email:     ${lead.email ?? '—'}`,
          `Telefon:   ${lead.phone ?? '—'}`,
          '',
          'Mesaj:',
          lead.message ?? '',
          '',
          `Deschide în panou: ${link}`,
        ].join('\n'),
      })
      .catch((err) => this.logger.error(`lead email failed: ${String(err)}`));
  }

  // --- panel: list / detail ---------------------------------------

  async list(
    userId: string,
    companyId: string,
    opts: { status?: string; channel?: string; cursor?: string; limit?: number } = {},
  ) {
    await this.assertMember(companyId, userId);
    const take = Math.min(Math.max(opts.limit ?? 20, 1), PAGE_MAX);

    const where: Prisma.LeadWhereInput = { companyId };
    if (opts.status && ['new', 'seen', 'resolved'].includes(opts.status)) {
      where.status = opts.status as LeadStatus;
    }
    if (opts.channel === 'form' || opts.channel === 'call') {
      where.channel = opts.channel as LeadChannel;
    }

    const rows = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const items = (hasMore ? rows.slice(0, take) : rows).map((l) => this.view(l));
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  /** Panel summary. Public to companies.service for the dashboard card. */
  async summaryFor(companyId: string) {
    const [byStatus, byChannel, responded] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['channel'],
        where: { companyId },
        _count: { _all: true },
      }),
      this.prisma.lead.findMany({
        where: { companyId, firstResponseAt: { not: null } },
        select: { createdAt: true, firstResponseAt: true },
      }),
    ]);

    const statusCount = (s: LeadStatus) =>
      byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const channelCount = (c: LeadChannel) =>
      byChannel.find((r) => r.channel === c)?._count._all ?? 0;

    const responseMs = responded.map((r) => r.firstResponseAt!.getTime() - r.createdAt.getTime());
    const avgResponseMinutes = responseMs.length
      ? Math.round(responseMs.reduce((a, b) => a + b, 0) / responseMs.length / 60000)
      : null;

    return {
      total: byStatus.reduce((a, r) => a + r._count._all, 0),
      new: statusCount('new'),
      resolved: statusCount('resolved'),
      form: channelCount('form'),
      call: channelCount('call'),
      responded: responded.length,
      avgResponseMinutes,
    };
  }

  async summary(userId: string, companyId: string) {
    await this.assertMember(companyId, userId);
    return this.summaryFor(companyId);
  }

  /** Detail view — marks a `new` lead `seen` on open. */
  async get(userId: string, companyId: string, leadId: string) {
    await this.assertMember(companyId, userId);
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    if (lead.status === 'new') {
      const updated = await this.prisma.lead.update({
        where: { id: lead.id },
        data: { status: 'seen' },
      });
      return this.view(updated);
    }
    return this.view(lead);
  }

  // --- panel: mutate --------------------------------------------

  async update(
    userId: string,
    companyId: string,
    leadId: string,
    dto: { status?: string; responded?: boolean },
  ) {
    await this.assertMember(companyId, userId);
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId } });
    if (!lead) throw new NotFoundException('Lead not found');

    const data: Prisma.LeadUpdateInput = {};
    const now = new Date();

    if (dto.responded && !lead.firstResponseAt) {
      data.firstResponseAt = now;
      if (lead.status === 'new') data.status = 'seen';
    }

    if (dto.status === 'resolved') {
      data.status = 'resolved';
      data.resolvedAt = lead.resolvedAt ?? now;
      if (!lead.firstResponseAt && !data.firstResponseAt) data.firstResponseAt = now;
    } else if (dto.status === 'seen' && lead.status === 'new') {
      data.status = 'seen';
    } else if (dto.status === 'new') {
      data.status = 'new';
      data.resolvedAt = null;
    }

    if (Object.keys(data).length === 0) return this.view(lead);
    const updated = await this.prisma.lead.update({ where: { id: lead.id }, data });
    return this.view(updated);
  }

  async remove(userId: string, companyId: string, leadId: string): Promise<void> {
    await this.assertMember(companyId, userId);
    const { count } = await this.prisma.lead.deleteMany({ where: { id: leadId, companyId } });
    if (count === 0) throw new NotFoundException('Lead not found');
  }

  // --- view ----------------------------------------------------

  private view(l: LeadRow) {
    const responseMinutes = l.firstResponseAt
      ? Math.round((l.firstResponseAt.getTime() - l.createdAt.getTime()) / 60000)
      : null;
    return {
      id: l.id,
      channel: l.channel,
      status: l.status,
      name: l.name,
      email: l.email,
      phone: l.phone,
      message: l.message,
      firstResponseAt: l.firstResponseAt,
      resolvedAt: l.resolvedAt,
      responseMinutes,
      createdAt: l.createdAt,
    };
  }
}
