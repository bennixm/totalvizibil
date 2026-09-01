import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CampaignStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { CampaignService } from '../campaigns/campaign.service';
import { LeadsService } from '../leads/leads.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { RUN_SCORE_GRACE_MS } from '../analytics/visibility';
import { money } from '../wallet/money';
import { SaveCampaignDto } from '../campaigns/dto/save-campaign.dto';
import { CampaignActionDto } from './dto/campaign-action.dto';
import { SetCompanyStatusDto } from './dto/set-company-status.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { LeadsQueryDto } from './dto/leads-query.dto';
import { ListCompaniesQuery } from './dto/list-companies.query';

/**
 * Admin-side controls over a single business: a full detail payload (profile,
 * campaign editor, analytics, leads) plus the levers to run its campaign and
 * freeze/unfreeze the listing. These bypass the owner-membership checks the
 * normal endpoints run — the platform-admin guard is the gate.
 */
@Injectable()
export class AdminCompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly campaigns: CampaignService,
    private readonly leads: LeadsService,
    private readonly analytics: AnalyticsService,
  ) {}

  private async loadCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { campaign: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  // --- list / browse --------------------------------------------

  async list(query: ListCompaniesQuery) {
    const { search, status, campaign, page = 1, pageSize = 20 } = query;

    const where: Prisma.CompanyWhereInput = {
      ...(status ? { status } : {}),
      ...(campaign === 'none' ? { campaign: { is: null } } : {}),
      ...(campaign && campaign !== 'none' ? { campaign: { status: campaign } } : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
              { owner: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          campaign: {
            select: { status: true, dailyBudgetMinor: true, cpcMinor: true, autoOptimize: true },
          },
          category: { select: { nameI18n: true } },
          locations: { where: { isPrimary: true }, take: 1, select: { city: true } },
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { leads: true, adClicks: true } },
        },
      }),
      this.prisma.company.count({ where }),
    ]);

    const consumed = await this.wallet.consumedByCompanies(rows.map((r) => r.id));

    return {
      items: rows.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        slug: c.slug,
        status: c.status,
        country: c.country,
        city: c.locations[0]?.city ?? null,
        category: (c.category?.nameI18n as Record<string, string> | undefined) ?? null,
        owner: c.owner,
        createdAt: c.createdAt,
        campaign: c.campaign
          ? {
              status: c.campaign.status,
              dailyBudget: money(c.campaign.dailyBudgetMinor),
              cpc: money(c.campaign.cpcMinor),
              autoOptimize: c.campaign.autoOptimize,
            }
          : null,
        leadCount: c._count.leads,
        clickCount: c._count.adClicks,
        consumed: money(consumed.get(c.id) ?? 0),
      })),
      page,
      pageSize,
      total,
    };
  }

  // --- full detail ------------------------------------------------

  async detail(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        category: { include: { parent: { select: { slug: true, nameI18n: true } } } },
        locations: { orderBy: { isPrimary: 'desc' }, take: 1 },
        website: { select: { mode: true, status: true, updatedAt: true } },
        owner: { select: { id: true, name: true, email: true, status: true } },
        _count: { select: { services: true, contacts: true, leads: true, adClicks: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    const [campaign, analytics, leadItems, leadSummary] = await Promise.all([
      this.campaigns.getFor(companyId),
      this.analytics.companyAnalytics(companyId),
      this.leads.listFor(companyId, { limit: 30 }),
      this.leads.summaryFor(companyId),
    ]);

    const loc = company.locations[0] ?? null;
    return {
      company: {
        id: company.id,
        displayName: company.displayName,
        legalName: company.legalName,
        slug: company.slug,
        description: company.description,
        status: company.status,
        country: company.country,
        createdAt: company.createdAt,
        advancedUnlockedAt: company.advancedUnlockedAt,
        category: company.category
          ? {
              slug: company.category.slug,
              name: company.category.nameI18n,
              parent: company.category.parent
                ? { slug: company.category.parent.slug, name: company.category.parent.nameI18n }
                : null,
            }
          : null,
        location: loc
          ? {
              city: loc.city,
              region: loc.region,
              radiusKm: loc.serviceRadiusKm ?? null,
              nationwide: loc.nationwide,
              lat: loc.lat,
              lng: loc.lng,
            }
          : null,
        website: company.website
          ? {
              mode: company.website.mode,
              status: company.website.status,
              updatedAt: company.website.updatedAt,
            }
          : null,
        owner: company.owner,
        counts: {
          services: company._count.services,
          contacts: company._count.contacts,
          leads: company._count.leads,
          clicks: company._count.adClicks,
        },
      },
      campaign,
      analytics,
      leads: { summary: leadSummary, items: leadItems.items, nextCursor: leadItems.nextCursor },
    };
  }

  async leadsPage(companyId: string, query: LeadsQueryDto) {
    await this.loadCompany(companyId);
    return this.leads.listFor(companyId, {
      status: query.status,
      channel: query.channel,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  // --- profile edit ---------------------------------------------

  async updateCompany(companyId: string, dto: UpdateCompanyDto) {
    await this.loadCompany(companyId);
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.legalName !== undefined ? { legalName: dto.legalName || null } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
      },
    });
    return this.detail(companyId);
  }

  // --- campaign editing ---------------------------------------

  async saveCampaign(companyId: string, dto: SaveCampaignDto) {
    await this.loadCompany(companyId);
    await this.campaigns.saveFor(companyId, dto);
    return this.detail(companyId);
  }

  // --- lifecycle levers -------------------------------------

  /** Flip campaign + company + website together (mirrors CampaignService.setLive). */
  private async setLive(companyId: string, live: boolean, wasLive: boolean) {
    const now = new Date();
    const camp = await this.prisma.campaign.findUnique({ where: { companyId } });
    let activatedAt = camp?.activatedAt ?? null;
    let activeSecondsAccrued = camp?.activeSecondsAccrued ?? 0;
    if (camp) {
      if (live && !wasLive) {
        activatedAt = now;
        if (camp.pausedAt && now.getTime() - camp.pausedAt.getTime() > RUN_SCORE_GRACE_MS) {
          activeSecondsAccrued = 0;
        }
      } else if (!live && wasLive && camp.activatedAt) {
        const runMs = now.getTime() - camp.activatedAt.getTime();
        if (runMs > 0) activeSecondsAccrued += Math.floor(runMs / 1000);
      }
    }
    await this.prisma.$transaction([
      this.prisma.campaign.update({
        where: { companyId },
        data: {
          status: live ? CampaignStatus.active : CampaignStatus.paused,
          activatedAt,
          activeSecondsAccrued,
          pausedAt: live ? null : now,
        },
      }),
      this.prisma.company.update({
        where: { id: companyId },
        data: { status: live ? 'active' : 'draft', featured: live },
      }),
      this.prisma.website.updateMany({
        where: { companyId },
        data: { status: live ? 'published' : 'unpublished' },
      }),
    ]);
  }

  async campaignAction(companyId: string, dto: CampaignActionDto) {
    const company = await this.loadCompany(companyId);
    if (!company.campaign) throw new BadRequestException('This business has no campaign');
    const wasLive = company.campaign.status === CampaignStatus.active;

    if (dto.action === 'delete') {
      await this.prisma.$transaction([
        this.prisma.campaign.delete({ where: { companyId } }),
        this.prisma.company.update({
          where: { id: companyId },
          data: { status: 'draft', featured: false },
        }),
        this.prisma.website.updateMany({
          where: { companyId },
          data: { status: 'unpublished' },
        }),
      ]);
      return { ok: true as const, action: 'delete' as const };
    }

    if (dto.action === 'pause') {
      // Kill AUTO too, else the owner's next page load would revive it.
      if (company.campaign.autoOptimize) {
        await this.prisma.campaign.update({
          where: { companyId },
          data: { autoOptimize: false },
        });
      }
      if (wasLive || company.campaign.status === CampaignStatus.depleted) {
        await this.setLive(companyId, false, wasLive);
      }
      return { ok: true as const, action: 'pause' as const };
    }

    // activate
    if (company.status === 'suspended') {
      throw new BadRequestException('Unsuspend the business before activating its campaign');
    }
    if (!(await this.campaigns.isListingWebsiteReady(companyId))) {
      throw new BadRequestException(
        'Finish the advanced website builder before activating this campaign',
      );
    }
    const owner = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { ownerUserId: true },
    });
    if (!owner) throw new BadRequestException('Company has no owner');
    const block = await this.wallet.blockInfo(owner.ownerUserId);
    if (block.blocked) {
      throw new BadRequestException(
        block.reason
          ? `Owner wallet is frozen: ${block.reason}`
          : 'Owner wallet is frozen — unblock it first',
      );
    }
    if (!(await this.wallet.canAfford(owner.ownerUserId, company.campaign.dailyBudgetMinor))) {
      throw new BadRequestException('Owner wallet cannot fund one day of budget');
    }
    await this.setLive(companyId, true, wasLive);
    return { ok: true as const, action: 'activate' as const };
  }

  async setStatus(companyId: string, dto: SetCompanyStatusDto) {
    const company = await this.loadCompany(companyId);

    if (dto.status === 'suspended') {
      const now = new Date();
      // Bank the run that a suspend interrupts, so run time isn't silently lost.
      let bankedSeconds = company.campaign?.activeSecondsAccrued ?? 0;
      if (company.campaign?.status === CampaignStatus.active && company.campaign.activatedAt) {
        const runMs = now.getTime() - company.campaign.activatedAt.getTime();
        if (runMs > 0) bankedSeconds += Math.floor(runMs / 1000);
      }
      await this.prisma.$transaction([
        this.prisma.company.update({
          where: { id: companyId },
          data: { status: 'suspended', featured: false },
        }),
        ...(company.campaign
          ? [
              this.prisma.campaign.update({
                where: { companyId },
                data: {
                  status: CampaignStatus.paused,
                  activeSecondsAccrued: bankedSeconds,
                  pausedAt: now,
                  autoOptimize: false,
                },
              }),
            ]
          : []),
        this.prisma.website.updateMany({
          where: { companyId },
          data: { status: 'unpublished' },
        }),
      ]);
      return { ok: true as const, status: 'suspended' as const };
    }

    // Lift the suspension — the listing returns to `draft`; the owner
    // re-activates the campaign to go back into the feed.
    await this.prisma.company.update({
      where: { id: companyId },
      data: { status: 'draft' },
    });
    return { ok: true as const, status: 'draft' as const };
  }
}
