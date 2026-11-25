import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UserActivityItem {
  id: string;
  createdAt: Date;
  /** Where it comes from; decides the icon and the wording in the panel. */
  source: 'owner' | 'staff' | 'google_ads' | 'google_ads_cycle' | 'session' | 'ticket';
  /** Machine code (audit/business log code, agent action, cycle status…). */
  action: string;
  status: string | null;
  /** What it is about: business, campaign, ticket subject, device. */
  subject: string | null;
  /** Staff member for `staff` items. */
  actor: string | null;
  reason: string | null;
}

const PAGE = 25;

/**
 * Everything that happened around one user, newest first: what they did in
 * their businesses, what staff did to their account, their Google Ads agent,
 * sign-ins and support tickets. Money has its own list (transactions).
 */
@Injectable()
export class AdminUserActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    before?: Date,
  ): Promise<{ items: UserActivityItem[]; next: string | null }> {
    const when = before ? { lt: before } : undefined;
    // One more than a page from every source, so the merged page is exact.
    const q = { orderBy: { createdAt: 'desc' as const }, take: PAGE + 1 };
    const [wallet, campaigns] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.googleAdsUserCampaign.findMany({
        where: { userId },
        select: { id: true, name: true },
      }),
    ]);
    const names = new Map(campaigns.map((c) => [c.id, c.name]));
    const targets = [userId, ...(wallet ? [wallet.id] : []), ...names.keys()];
    const [owner, staff, actions, cycles, sessions, tickets] = await Promise.all([
      this.prisma.businessActionLog.findMany({
        ...q,
        where: { actorId: userId, createdAt: when },
        include: { company: { select: { displayName: true } } },
      }),
      this.prisma.adminAuditLog.findMany({
        ...q,
        where: { targetId: { in: targets }, createdAt: when },
        include: { actor: { select: { name: true, email: true } } },
      }),
      this.prisma.googleAdsUserAction.findMany({
        ...q,
        where: { userCampaignId: { in: [...names.keys()] }, createdAt: when },
        select: { id: true, createdAt: true, action: true, status: true, userCampaignId: true },
      }),
      this.prisma.googleAdsOptimizationCycle.findMany({
        where: { userId, startedAt: when },
        orderBy: { startedAt: 'desc' },
        take: PAGE + 1,
        select: { id: true, startedAt: true, trigger: true, status: true, userCampaignId: true },
      }),
      this.prisma.session.findMany({
        ...q,
        where: { userId, createdAt: when },
        select: { id: true, createdAt: true, userAgent: true, ip: true },
      }),
      this.prisma.supportTicket.findMany({
        ...q,
        where: { requesterId: userId, createdAt: when },
        select: { id: true, createdAt: true, subject: true, status: true },
      }),
    ]);
    const item = (
      x: Partial<UserActivityItem> &
        Pick<UserActivityItem, 'id' | 'createdAt' | 'source' | 'action'>,
    ): UserActivityItem => ({
      status: null,
      subject: null,
      actor: null,
      reason: null,
      ...x,
    });
    const all = [
      ...owner.map((r) =>
        item({
          id: r.id,
          createdAt: r.createdAt,
          source: 'owner',
          action: r.action,
          subject: r.company?.displayName ?? ((r.targetId && names.get(r.targetId)) || null),
        }),
      ),
      ...staff.map((r) =>
        item({
          id: r.id,
          createdAt: r.createdAt,
          source: 'staff',
          action: r.action,
          subject: (r.targetId && names.get(r.targetId)) || null,
          actor: r.actor.name || r.actor.email,
          reason: r.reason,
        }),
      ),
      ...actions.map((r) =>
        item({
          id: r.id,
          createdAt: r.createdAt,
          source: 'google_ads',
          action: r.action,
          status: r.status,
          subject: names.get(r.userCampaignId) ?? null,
        }),
      ),
      ...cycles.map((r) =>
        item({
          id: r.id,
          createdAt: r.startedAt,
          source: 'google_ads_cycle',
          action: r.trigger,
          status: r.status,
          subject: names.get(r.userCampaignId) ?? null,
        }),
      ),
      ...sessions.map((r) =>
        item({
          id: r.id,
          createdAt: r.createdAt,
          source: 'session',
          action: 'session.create',
          subject: [r.userAgent?.slice(0, 80), r.ip].filter(Boolean).join(' · ') || null,
        }),
      ),
      ...tickets.map((r) =>
        item({
          id: r.id,
          createdAt: r.createdAt,
          source: 'ticket',
          action: 'ticket.create',
          status: r.status,
          subject: r.subject,
        }),
      ),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (all.length <= PAGE) return { items: all, next: null };
    // The cursor is a moment: never cut between rows of the same moment.
    let end = PAGE;
    while (end < all.length && +all[end].createdAt === +all[end - 1].createdAt) end++;
    const items = all.slice(0, end);
    return { items, next: end < all.length ? items[end - 1].createdAt.toISOString() : null };
  }
}
