import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { uniqueSlug } from '../common/slug';
import { WebsiteDraftService } from '../website/drafts/website-draft.service';
import { WalletService } from '../wallet/wallet.service';
import { CREDIT_MINOR } from '../wallet/money';
import { CampaignService } from '../campaigns/campaign.service';
import { LeadsService } from '../leads/leads.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { companyInclude, toCompanyView, CompanyView } from './company.view';

const ROLES_THAT_CAN_EDIT: CompanyRole[] = [CompanyRole.owner, CompanyRole.manager];

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drafts: WebsiteDraftService,
    private readonly wallet: WalletService,
    private readonly campaigns: CampaignService,
    private readonly leads: LeadsService,
    private readonly analytics: AnalyticsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Membership role of a user in a company, or null if not a member. */
  private async membershipRole(companyId: string, userId: string): Promise<CompanyRole | null> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') return null;
    return member.role;
  }

  async create(userId: string, dto: CreateCompanyDto): Promise<CompanyView> {
    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!category || !category.isActive) {
        throw new BadRequestException('Unknown category');
      }
    }

    const slug = await uniqueSlug(
      dto.displayName,
      async (candidate) => (await this.prisma.company.count({ where: { slug: candidate } })) > 0,
    );

    const contacts: Prisma.CompanyContactCreateManyCompanyInput[] = [];
    if (dto.phone) contacts.push({ type: 'phone', value: dto.phone.trim() });
    if (dto.email) contacts.push({ type: 'email', value: dto.email.trim().toLowerCase() });

    const company = await this.prisma.company.create({
      data: {
        displayName: dto.displayName.trim(),
        legalName: dto.legalName?.trim() || null,
        description: dto.description?.trim() || null,
        categoryId: dto.categoryId ?? null,
        logoUrl: dto.logoUrl?.trim() || null,
        ownerUserId: userId,
        slug,
        members: {
          create: { userId, role: CompanyRole.owner, status: 'active' },
        },
        contacts: contacts.length ? { createMany: { data: contacts } } : undefined,
        locations: dto.location
          ? {
              create: {
                city: dto.location.city.trim(),
                address: dto.location.address?.trim() || null,
                region: dto.location.region?.trim() || null,
                country: (dto.location.country || 'RO').toUpperCase().slice(0, 2),
                isPrimary: true,
              },
            }
          : undefined,
        services: dto.services?.length
          ? {
              createMany: {
                data: dto.services.map((s, i) => ({
                  name: s.name.trim(),
                  description: s.description?.trim() || null,
                  position: i,
                })),
              },
            }
          : undefined,
      },
      include: companyInclude,
    });

    return toCompanyView(company, CompanyRole.owner);
  }

  /**
   * Turn an anonymous website draft into a real company for the user (end of the
   * "create your business" flow). Creates the company, its `Website` and its
   * primary `CompanyLocation` (if the location step was done), then marks the
   * draft claimed — all in one transaction.
   *
   * The first business is free. Every business after that costs
   * `additional_business_price_credits`, debited from the user's wallet.
   */
  async createFromDraft(userId: string, draftToken: string): Promise<CompanyView> {
    const draft = await this.drafts.loadByToken(draftToken);

    if (draft.status === 'claimed' || draft.claimedCompanyId) {
      throw new ConflictException('draft_already_claimed');
    }
    if (draft.content == null || draft.theme == null) {
      throw new BadRequestException('website_not_generated');
    }
    // Every business must be filed under a category (niche or whole group) to reach the feed.
    if (!draft.categorySlug) {
      throw new BadRequestException('category_required');
    }
    const category = await this.drafts.assertCategory(draft.categorySlug);

    // --- additional-business paywall (charged to the user's single wallet) ---
    // Waived for advanced-plan businesses — they already pay the advanced
    // builder fee, which covers the extra listing.
    const ownedCount = await this.prisma.company.count({ where: { ownerUserId: userId } });
    let feeMinor = 0;
    if (ownedCount >= 1 && draft.mode !== 'advanced') {
      const price = await this.settings.additionalBusinessPriceCredits();
      feeMinor = price * CREDIT_MINOR;
    }

    const answers = (draft.answers ?? {}) as {
      businessName?: string;
      businessType?: string;
      description?: string;
      phone?: string;
      email?: string;
    };
    const displayName =
      answers.businessName?.trim() || answers.businessType?.trim() || 'Afacerea mea';

    const slug = await uniqueSlug(
      displayName,
      async (candidate) => (await this.prisma.company.count({ where: { slug: candidate } })) > 0,
    );

    const contacts: Prisma.CompanyContactCreateManyCompanyInput[] = [];
    if (answers.phone) contacts.push({ type: 'phone', value: answers.phone.trim() });
    if (answers.email) {
      contacts.push({ type: 'email', value: answers.email.trim().toLowerCase() });
    }

    const hasLocation =
      !!draft.locationCity && draft.locationLat != null && draft.locationLng != null;

    const company = await this.prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          displayName,
          description: answers.description?.trim() || null,
          categoryId: category.id,
          ownerUserId: userId,
          slug,
          members: { create: { userId, role: CompanyRole.owner, status: 'active' } },
          contacts: contacts.length ? { createMany: { data: contacts } } : undefined,
          locations: hasLocation
            ? {
                create: {
                  city: draft.locationCity!,
                  region: draft.locationRegion,
                  country: draft.locationCountry ?? 'RO',
                  lat: draft.locationLat,
                  lng: draft.locationLng,
                  serviceRadiusKm: draft.locationRadiusKm,
                  isPrimary: true,
                },
              }
            : undefined,
          website: {
            create: {
              mode: draft.mode === 'advanced' ? 'advanced' : 'easy',
              status: 'draft',
              theme: draft.theme as Prisma.InputJsonValue,
              content: draft.content as Prisma.InputJsonValue,
              generator: draft.generator ?? 'rule-based-v1',
            },
          },
        },
        include: companyInclude,
      });

      if (feeMinor > 0) {
        const wallet = await tx.wallet.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        if (wallet.balanceMinor < feeMinor) {
          throw new BadRequestException('insufficient_credits');
        }
        const uw = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balanceMinor: { decrement: feeMinor } },
        });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            companyId: created.id,
            type: 'spend',
            status: 'completed',
            amountMinor: -feeMinor,
            balanceAfterMinor: uw.balanceMinor,
            description: 'Additional business',
          },
        });
      }

      await this.drafts.markClaimed(tx, draft.id, created.id);
      return created;
    });

    return toCompanyView(company, CompanyRole.owner);
  }

  async listForUser(userId: string): Promise<CompanyView[]> {
    const companies = await this.prisma.company.findMany({
      where: { members: { some: { userId, status: 'active' } } },
      include: companyInclude,
      orderBy: { createdAt: 'desc' },
    });
    // Resolve each viewer role in one extra query rather than N.
    const roles = await this.prisma.companyUser.findMany({
      where: { userId, status: 'active', companyId: { in: companies.map((c) => c.id) } },
      select: { companyId: true, role: true },
    });
    const roleByCompany = new Map(roles.map((r) => [r.companyId, r.role]));
    return companies.map((c) => toCompanyView(c, roleByCompany.get(c.id) ?? null));
  }

  async getForUser(userId: string, companyId: string): Promise<CompanyView> {
    const role = await this.membershipRole(companyId, userId);
    if (!role) throw new NotFoundException('Company not found');

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: companyInclude,
    });
    return toCompanyView(company, role);
  }

  async update(userId: string, companyId: string, dto: UpdateCompanyDto): Promise<CompanyView> {
    const role = await this.membershipRole(companyId, userId);
    if (!role) throw new NotFoundException('Company not found');
    if (!ROLES_THAT_CAN_EDIT.includes(role)) {
      throw new ForbiddenException('Your role cannot edit this company');
    }

    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!category || !category.isActive) throw new BadRequestException('Unknown category');
    }

    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        displayName: dto.displayName?.trim(),
        legalName: dto.legalName?.trim(),
        description: dto.description?.trim(),
        categoryId: dto.categoryId,
        logoUrl: dto.logoUrl?.trim(),
        status: dto.status,
        claimedAt: dto.status === 'active' ? new Date() : undefined,
      },
      include: companyInclude,
    });
    return toCompanyView(company, role);
  }

  /**
   * Dashboard payload: the company + website block, the wallet / campaign / leads
   * summaries, and the `analytics` block (real clicks / calls / messages /
   * response time / Visibility Score — see AnalyticsService).
   */
  async dashboard(userId: string, companyId: string) {
    const company = await this.getForUser(userId, companyId);
    const primaryLocation =
      company.locations.find((l) => l.isPrimary) ?? company.locations[0] ?? null;

    const ownerId = await this.wallet.ownerIdForCompany(companyId);
    const [website, wallet, campaign, leads, analytics] = await Promise.all([
      this.prisma.website.findUnique({ where: { companyId } }),
      this.wallet.getSummary(ownerId),
      this.campaigns.summaryFor(companyId),
      this.leads.summaryFor(companyId),
      this.analytics.companyAnalytics(companyId),
    ]);
    const campaignLive = campaign?.status === 'active';

    return {
      wallet,
      campaign,
      leads,
      analytics,
      company: {
        id: company.id,
        displayName: company.displayName,
        slug: company.slug,
        status: company.status,
        category: company.category,
        primaryLocation,
        contactsCount: company.contacts.length,
        servicesCount: company.services.length,
        createdAt: company.createdAt,
        viewerRole: company.viewerRole,
      },
      website: website
        ? {
            status: website.status,
            mode: website.mode,
            generator: website.generator,
            updatedAt: website.updatedAt,
            isLive: website.status === 'published' && company.status === 'active',
            theme: website.theme,
            content: website.content,
          }
        : { status: 'none' as const },
      // Required onboarding tasks (in order).
      tasks: website
        ? [
            ...(website.mode === 'advanced'
              ? [
                  {
                    key: 'unlock_advanced_builder' as const,
                    required: true,
                    status: company.advancedUnlockedAt ? ('done' as const) : ('todo' as const),
                  },
                ]
              : []),
            {
              key: 'set_location' as const,
              required: true,
              status:
                company.category && primaryLocation && primaryLocation.lat != null
                  ? ('done' as const)
                  : ('todo' as const),
            },
            {
              key: 'set_campaign_budget' as const,
              required: true,
              status: campaignLive ? ('done' as const) : ('todo' as const),
            },
          ]
        : [],
    };
  }

  /**
   * Set / replace the company's exact-niche category + primary service-area
   * location (post-account: advanced onboarding, or editing later).
   */
  async setLocation(
    userId: string,
    companyId: string,
    input: {
      categorySlug: string;
      city: string;
      region?: string;
      country?: string;
      lat: number;
      lng: number;
      radiusKm: number;
    },
  ): Promise<CompanyView> {
    const role = await this.membershipRole(companyId, userId);
    if (!role) throw new NotFoundException('Company not found');
    if (!ROLES_THAT_CAN_EDIT.includes(role)) {
      throw new ForbiddenException('Your role cannot edit this company');
    }
    const category = await this.drafts.assertCategory(input.categorySlug);

    const data = {
      city: input.city.trim(),
      region: input.region?.trim() || null,
      country: (input.country || 'RO').toUpperCase().slice(0, 2),
      lat: input.lat,
      lng: input.lng,
      serviceRadiusKm: Math.round(input.radiusKm),
      isPrimary: true,
    };

    const existing = await this.prisma.companyLocation.findFirst({
      where: { companyId, isPrimary: true },
      orderBy: { createdAt: 'asc' },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: { categoryId: category.id },
      });
      if (existing) {
        await tx.companyLocation.update({ where: { id: existing.id }, data });
      } else {
        await tx.companyLocation.create({ data: { ...data, companyId } });
      }
    });

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: companyInclude,
    });
    return toCompanyView(company, role);
  }

  /** Make the company + its website publicly visible in the feed (PRD §11). */
  async setPublished(userId: string, companyId: string, live: boolean) {
    const role = await this.membershipRole(companyId, userId);
    if (!role) throw new NotFoundException('Company not found');
    if (!ROLES_THAT_CAN_EDIT.includes(role)) {
      throw new ForbiddenException('Your role cannot publish this company');
    }

    await this.prisma.$transaction([
      this.prisma.company.update({
        where: { id: companyId },
        data: {
          status: live ? 'active' : 'draft',
          claimedAt: live ? new Date() : undefined,
        },
      }),
      this.prisma.website.updateMany({
        where: { companyId },
        data: { status: live ? 'published' : 'unpublished' },
      }),
    ]);

    return this.dashboard(userId, companyId);
  }

  /**
   * Permanently delete a business. Owner only. Website / campaign / locations
   * cascade via FKs; the user's wallet is untouched, and its past spend
   * transactions keep their history with `companyId` nulled.
   */
  async remove(userId: string, companyId: string): Promise<void> {
    const role = await this.membershipRole(companyId, userId);
    if (!role) throw new NotFoundException('Company not found');
    if (role !== CompanyRole.owner) {
      throw new ForbiddenException('only_the_owner_can_delete');
    }
    await this.prisma.company.delete({ where: { id: companyId } });
  }

  /** Compact list of the user's businesses for the dashboard switcher. */
  async overview(userId: string) {
    const companies = await this.prisma.company.findMany({
      where: { members: { some: { userId, status: 'active' } } },
      orderBy: { createdAt: 'asc' },
      include: { website: { select: { mode: true, status: true } } },
    });
    const ids = companies.map((c) => c.id);
    const [campaigns, consumedMap, locations] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { companyId: { in: ids } },
        select: { companyId: true, status: true },
      }),
      this.wallet.consumedByCompanies(ids),
      this.prisma.companyLocation.findMany({
        where: { companyId: { in: ids }, isPrimary: true },
        select: { companyId: true, city: true },
      }),
    ]);
    const campMap = new Map(campaigns.map((x) => [x.companyId, x.status]));
    const locMap = new Map(locations.map((x) => [x.companyId, x.city]));

    return companies.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      slug: c.slug,
      status: c.status,
      website: c.website ? { mode: c.website.mode, status: c.website.status } : null,
      campaignStatus: campMap.get(c.id) ?? null,
      consumedCredits: (consumedMap.get(c.id) ?? 0) / CREDIT_MINOR,
      locationCity: locMap.get(c.id) ?? null,
    }));
  }
}
