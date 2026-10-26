import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CompanyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { uniqueSlug } from '../common/slug';
import { assertCounty, resolveLocationInput } from '../geo/ro-cities';
import { WebsiteDraftService } from '../website/drafts/website-draft.service';
import { WalletService } from '../wallet/wallet.service';
import { CREDIT_MINOR } from '../wallet/money';
import { CampaignService } from '../campaigns/campaign.service';
import { LeadsService } from '../leads/leads.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { companyInclude, toCompanyView, CompanyView } from './company.view';
import {
  COMPANY_DELETE_GRACE_MS,
  DELETION_REMINDER_LEAD_MS,
  STALE_DRAFT_AGE_MS,
} from './companies.constants';

const ROLES_THAT_CAN_EDIT: CompanyRole[] = [CompanyRole.owner, CompanyRole.manager];
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CompaniesService implements OnModuleInit {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly drafts: WebsiteDraftService,
    private readonly wallet: WalletService,
    private readonly campaigns: CampaignService,
    private readonly leads: LeadsService,
    private readonly analytics: AnalyticsService,
    private readonly settings: PlatformSettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Email-only confirmation once a business is actually created (direct or draft flow).
   *  The business is already committed by the time this runs — a notification hiccup
   *  must never turn an already-successful creation into an error response. */
  private async notifyBusinessCreated(userId: string, displayName: string): Promise<void> {
    await this.notifications
      .notify({
        userId,
        type: 'business_created',
        title: `Afacerea „${displayName}" a fost creată`,
        body: `Afacerea „${displayName}" a fost creată cu succes pe platformă.`,
        channels: { email: true },
      })
      .catch((err) =>
        this.logger.error(
          'Business-created notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
  }

  /**
   * No cron dependency in this app — cleanup normally rides along with the
   * reads that naturally happen anyway (see `purgeExpiredDeletions`). That
   * doesn't work for abandoned drafts specifically: by definition, an owner
   * who never comes back also never triggers a lazy check. A plain daily
   * timer is the simplest thing that actually guarantees this runs. Skipped
   * under Jest (`NODE_ENV=test`, set automatically) so test runs don't pick
   * up a background interval.
   */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.sweepStaleDrafts(), 60_000);
    setInterval(() => void this.sweepStaleDrafts(), SWEEP_INTERVAL_MS);
    setTimeout(() => void this.sweepDeletionReminders(), 90_000);
    setInterval(() => void this.sweepDeletionReminders(), SWEEP_INTERVAL_MS);
  }

  /**
   * Auto-schedules deletion (same reversible flow as `requestDeletion`, still
   * cancellable within `COMPANY_DELETE_GRACE_MS`) for any draft business that
   * never had an active campaign, never paid to unlock the advanced builder,
   * and has sat untouched for `STALE_DRAFT_AGE_MS` — dead weight nobody is
   * coming back to activate.
   */
  private async sweepStaleDrafts(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_DRAFT_AGE_MS);
    try {
      const stale = await this.prisma.company.findMany({
        where: {
          status: 'draft',
          deletionScheduledAt: null,
          advancedUnlockedAt: null,
          createdAt: { lte: cutoff },
          OR: [{ campaign: null }, { campaign: { activatedAt: null } }],
        },
        select: { id: true },
      });
      for (const { id } of stale) {
        await this.scheduleDeletion(id);
      }
      if (stale.length > 0) {
        this.logger.log(`Scheduled ${stale.length} stale draft business(es) for deletion`);
      }
    } catch (err) {
      this.logger.error('Stale-draft sweep failed', err instanceof Error ? err.stack : err);
    }
  }

  /**
   * Last-chance email, `DELETION_REMINDER_LEAD_MS` before a scheduled
   * deletion actually wipes the business — whether the owner asked for it or
   * the stale-draft sweep did. `deletionReminderSentAt` dedupes so this only
   * ever fires once per grace window (cleared on cancel or a fresh schedule).
   */
  private async sweepDeletionReminders(): Promise<void> {
    try {
      const dueBy = new Date(Date.now() - (COMPANY_DELETE_GRACE_MS - DELETION_REMINDER_LEAD_MS));
      const due = await this.prisma.company.findMany({
        where: {
          deletionScheduledAt: { lte: dueBy },
          deletionReminderSentAt: null,
        },
        select: { id: true, displayName: true, ownerUserId: true, deletionScheduledAt: true },
      });
      for (const c of due) {
        try {
          // Claim before notify — an atomic conditional UPDATE, not a plain
          // read-then-write — so a process restart (deploy) landing between
          // the send and the flag-write can't leave this company to be
          // reminded a second time on the next sweep tick. Same reasoning as
          // NotificationsSweepService's two sweeps.
          const claimed = await this.prisma.company.updateMany({
            where: { id: c.id, deletionReminderSentAt: null },
            data: { deletionReminderSentAt: new Date() },
          });
          if (claimed.count === 0) continue;

          const effectiveAt = new Date(c.deletionScheduledAt!.getTime() + COMPANY_DELETE_GRACE_MS);
          await this.notifications.notify({
            userId: c.ownerUserId,
            type: 'business_deletion_reminder',
            title: `Afacerea „${c.displayName}" va fi ștearsă definitiv în curând`,
            body: `Mai ai puțin timp să anulezi — datele afacerii „${c.displayName}" sunt șterse definitiv pe ${effectiveAt.toLocaleDateString('ro-RO')}.`,
            channels: { email: true },
            data: { companyId: c.id },
          });
        } catch (err) {
          this.logger.error(
            `Deletion-reminder failed for company ${c.id}`,
            err instanceof Error ? err.stack : err,
          );
        }
      }
      if (due.length > 0) {
        this.logger.log(`Sent ${due.length} pre-deletion reminder(s)`);
      }
    } catch (err) {
      this.logger.error('Deletion-reminder sweep failed', err instanceof Error ? err.stack : err);
    }
  }

  /** Membership role of a user in a company, or null if not a member. */
  private async membershipRole(companyId: string, userId: string): Promise<CompanyRole | null> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') return null;
    return member.role;
  }

  /**
   * Role check + "not pending deletion" gate, shared by every mutation that
   * touches an existing company's profile/location/publish state (campaign
   * mutations have their own equivalent in `CampaignService.assertCanEdit`).
   * A business pending deletion is fully frozen — the owner must cancel the
   * deletion first before any of campaign/site/budget/profile can change
   * again; `requestDeletion`/`cancelDeletion` themselves don't go through
   * this, since cancelling is exactly what must still work in that state.
   */
  private async assertCanEditCompany(companyId: string, userId: string): Promise<CompanyRole> {
    const role = await this.membershipRole(companyId, userId);
    if (!role) throw new NotFoundException('Company not found');
    if (!ROLES_THAT_CAN_EDIT.includes(role)) {
      throw new ForbiddenException('Your role cannot edit this company');
    }
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { deletionScheduledAt: true },
    });
    if (company?.deletionScheduledAt) throw new ForbiddenException('company_pending_deletion');
    return role;
  }

  /**
   * Replaces a company's full `company_categories` set — one real leaf, or
   * several. `primaryCategoryId` (first in the list when omitted) is the one
   * mirrored for display purposes and feeds the single `Company.categoryId`
   * scalar still read by not-yet-migrated call sites.
   */
  private async syncCategoryAssignments(
    tx: Prisma.TransactionClient | PrismaService,
    companyId: string,
    categoryIds: string[],
    primaryCategoryId?: string | null,
  ): Promise<void> {
    await tx.companyCategory.deleteMany({ where: { companyId } });
    const primary = primaryCategoryId ?? categoryIds[0] ?? null;
    if (categoryIds.length) {
      await tx.companyCategory.createMany({
        data: categoryIds.map((categoryId) => ({
          companyId,
          categoryId,
          isPrimary: categoryId === primary,
        })),
      });
    }
  }

  /** Single-category admin paths (`create`/`update`'s `categoryId` DTO field). */
  private async syncPrimaryCategory(
    tx: Prisma.TransactionClient | PrismaService,
    companyId: string,
    categoryId: string | null,
  ): Promise<void> {
    await this.syncCategoryAssignments(tx, companyId, categoryId ? [categoryId] : []);
  }

  /**
   * The row set for a company's service area: one `nationwide` row, or one
   * row per județ (the first carries the map pin — city/lat/lng — as the
   * `isPrimary` display row; the rest are tag-only).
   */
  private locationCreateInputs(input: {
    nationwide: boolean;
    counties: string[];
    city?: string | null;
    country?: string | null;
    lat?: number | null;
    lng?: number | null;
  }): Prisma.CompanyLocationCreateManyCompanyInput[] {
    const country = (input.country || 'RO').toUpperCase().slice(0, 2);
    if (input.nationwide) {
      return [{ nationwide: true, country, isPrimary: true }];
    }
    return input.counties.map((county, i) => ({
      county,
      country,
      nationwide: false,
      isPrimary: i === 0,
      city: i === 0 ? (input.city ?? null) : null,
      lat: i === 0 ? (input.lat ?? null) : null,
      lng: i === 0 ? (input.lng ?? null) : null,
    }));
  }

  /** Replaces a company's full location set — mirrors `syncCategoryAssignments`. */
  private async syncLocations(
    tx: Prisma.TransactionClient | PrismaService,
    companyId: string,
    input: Parameters<CompaniesService['locationCreateInputs']>[0],
  ): Promise<void> {
    await tx.companyLocation.deleteMany({ where: { companyId } });
    await tx.companyLocation.createMany({
      data: this.locationCreateInputs(input).map((row) => ({ ...row, companyId })),
    });
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
                county: dto.location.county ? assertCounty(dto.location.county) : null,
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

    await this.syncPrimaryCategory(this.prisma, company.id, dto.categoryId ?? null);
    await this.notifyBusinessCreated(userId, company.displayName);
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
      // Idempotent retry: the create flow may re-send this request after an
      // earlier attempt that actually succeeded server-side but whose response
      // the client never saw (slow transaction hit the request timeout, a
      // dropped connection, etc.). If the claimed company still belongs to the
      // same user, return it so the flow continues instead of dead-ending on
      // "draft_already_claimed".
      if (draft.claimedCompanyId) {
        const claimed = await this.prisma.company.findFirst({
          where: { id: draft.claimedCompanyId, ownerUserId: userId },
          include: companyInclude,
        });
        if (claimed) return toCompanyView(claimed, CompanyRole.owner);
      }
      throw new ConflictException('draft_already_claimed');
    }
    if (draft.content == null || draft.theme == null) {
      throw new BadRequestException('website_not_generated');
    }
    // Every business must be filed under at least one subcategory to reach the feed.
    if (!draft.categorySlugs.length) {
      throw new BadRequestException('category_required');
    }
    const categories = await this.drafts.assertCategories(draft.categorySlugs);
    const primaryCategory = categories[0];

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
      // Easy studio stores `companyName`; older/advanced drafts used `businessName`.
      companyName?: string;
      businessName?: string;
      businessType?: string;
      about?: string;
      description?: string;
      phone?: string;
      email?: string;
      logoUrl?: string;
    };
    // The panel must show the FIRM name, never the trade/what-they-do.
    const displayName =
      answers.companyName?.trim() || answers.businessName?.trim() || 'Afacerea mea';

    const slug = await uniqueSlug(
      displayName,
      async (candidate) => (await this.prisma.company.count({ where: { slug: candidate } })) > 0,
    );

    const contacts: Prisma.CompanyContactCreateManyCompanyInput[] = [];
    if (answers.phone) contacts.push({ type: 'phone', value: answers.phone.trim() });
    if (answers.email) {
      contacts.push({ type: 'email', value: answers.email.trim().toLowerCase() });
    }

    const hasLocation = draft.locationNationwide || draft.locationCounties.length > 0;

    const company = await this.prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          displayName,
          description:
            answers.description?.trim() ||
            answers.businessType?.trim() ||
            answers.about?.trim().slice(0, 240) ||
            null,
          categoryId: primaryCategory.id,
          ownerUserId: userId,
          slug,
          ...(typeof answers.logoUrl === 'string' && answers.logoUrl.trim()
            ? { logoUrl: answers.logoUrl.trim().slice(0, 500) }
            : {}),
          members: { create: { userId, role: CompanyRole.owner, status: 'active' } },
          contacts: contacts.length ? { createMany: { data: contacts } } : undefined,
          locations: hasLocation
            ? {
                createMany: {
                  data: this.locationCreateInputs({
                    nationwide: draft.locationNationwide,
                    counties: draft.locationCounties,
                    city: draft.locationCity,
                    country: draft.locationCountry,
                    lat: draft.locationLat,
                    lng: draft.locationLng,
                  }),
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
              // Keep the guided answers so the owner can re-open the simple-site
              // studio editor from the dashboard.
              ...(draft.mode === 'advanced'
                ? {}
                : { easyConfig: (draft.answers ?? {}) as Prisma.InputJsonValue }),
            },
          },
        },
        include: companyInclude,
      });

      await this.syncCategoryAssignments(
        tx,
        created.id,
        categories.map((c) => c.id),
        primaryCategory.id,
      );

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

    await this.notifyBusinessCreated(userId, company.displayName);
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

    await this.purgeExpiredDeletions([companyId]);
    const company = await this.prisma.company
      .findUniqueOrThrow({ where: { id: companyId }, include: companyInclude })
      .catch(() => {
        throw new NotFoundException('Company not found');
      });
    return toCompanyView(company, role);
  }

  async update(userId: string, companyId: string, dto: UpdateCompanyDto): Promise<CompanyView> {
    const role = await this.assertCanEditCompany(companyId, userId);

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
    if (dto.categoryId !== undefined) {
      await this.syncPrimaryCategory(this.prisma, companyId, dto.categoryId);
    }
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
        locations: company.locations,
        contactsCount: company.contacts.length,
        servicesCount: company.services.length,
        createdAt: company.createdAt,
        viewerRole: company.viewerRole,
        deletionScheduledAt: company.deletionScheduledAt,
        deletionEffectiveAt: company.deletionEffectiveAt,
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
            // Set only once a Website Builder (PRO V2) bundle has been
            // published — the dashboard preview uses this to show the real
            // live bundle instead of `content`/`theme`, which PRO V2 never
            // touches (see pro-v2.service.ts publishBundle).
            publishedAt: website.publishedAt,
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
              key: 'set_category' as const,
              required: true,
              status: company.category ? ('done' as const) : ('todo' as const),
            },
            {
              key: 'set_location' as const,
              required: true,
              status:
                primaryLocation && (primaryLocation.lat != null || primaryLocation.nationwide)
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
   * Set / replace the company's service-area location (post-account: advanced
   * onboarding, or editing later) — subcategory tagging is a separate call
   * (see `setCategories`), each editable without touching the other.
   */
  async setLocation(
    userId: string,
    companyId: string,
    input: {
      counties?: string[];
      city?: string;
      country?: string;
      lat?: number;
      lng?: number;
      nationwide?: boolean;
    },
  ): Promise<CompanyView> {
    const role = await this.assertCanEditCompany(companyId, userId);
    const { nationwide, counties } = resolveLocationInput(input);

    await this.prisma.$transaction(async (tx) => {
      await this.syncLocations(tx, companyId, {
        nationwide,
        counties,
        city: input.city,
        country: input.country,
        lat: input.lat,
        lng: input.lng,
      });
    });

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: companyInclude,
    });
    return toCompanyView(company, role);
  }

  /** Set / replace the company's subcategory tagging (one or several real
   *  leaves) — the primary (feed) category is always the first one. */
  async setCategories(
    userId: string,
    companyId: string,
    categorySlugs: string[],
  ): Promise<CompanyView> {
    const role = await this.assertCanEditCompany(companyId, userId);
    const categories = await this.drafts.assertCategories(categorySlugs);
    const primaryCategory = categories[0];

    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: { categoryId: primaryCategory.id },
      });
      await this.syncCategoryAssignments(
        tx,
        companyId,
        categories.map((c) => c.id),
        primaryCategory.id,
      );
    });

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: companyInclude,
    });
    return toCompanyView(company, role);
  }

  /** Make the company + its website publicly visible in the feed (PRD §11). */
  async setPublished(userId: string, companyId: string, live: boolean) {
    await this.assertCanEditCompany(companyId, userId);

    if (live) {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          categoryId: true,
          website: { select: { id: true } },
          locations: { select: { nationwide: true, lat: true, lng: true } },
        },
      });
      if (!company?.website) throw new BadRequestException('website_missing');
      if (!company.categoryId) throw new BadRequestException('category_required');
      const loc = company.locations.find((l) => l.nationwide || (l.lat != null && l.lng != null));
      if (!loc) throw new BadRequestException('location_required');
      if (!(await this.campaigns.isListingWebsiteReady(companyId))) {
        throw new BadRequestException('website_builder_incomplete');
      }
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
   * Schedule the business for deletion. Owner only. The listing comes down
   * immediately (status → draft, un-featured, website unpublished, campaign
   * paused) but the record is only wiped after `COMPANY_DELETE_GRACE_MS` — the
   * owner can `cancelDeletion` until then. Re-requesting keeps the first
   * deadline.
   */
  async requestDeletion(userId: string, companyId: string): Promise<void> {
    const role = await this.membershipRole(companyId, userId);
    if (!role) throw new NotFoundException('Company not found');
    if (role !== CompanyRole.owner) {
      throw new ForbiddenException('only_the_owner_can_delete');
    }
    await this.scheduleDeletion(companyId);
  }

  /** The actual takedown-and-arm-the-grace-window transaction, shared by an
   *  owner's own `requestDeletion` and the automatic `sweepStaleDrafts`. */
  private async scheduleDeletion(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { deletionScheduledAt: true, displayName: true, ownerUserId: true },
    });
    if (company.deletionScheduledAt) return;

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.company.update({
        where: { id: companyId },
        data: {
          deletionScheduledAt: now,
          deletionReminderSentAt: null,
          status: 'draft',
          featured: false,
        },
      }),
      this.prisma.website.updateMany({
        where: { companyId },
        data: { status: 'unpublished' },
      }),
      this.prisma.campaign.updateMany({
        where: { companyId, status: { in: ['active', 'depleted'] } },
        data: { status: 'paused', pausedAt: now, autoOptimize: false },
      }),
      // A campaign that's already `paused` (not active/depleted) is missed
      // by the clause above but can still carry `autoOptimize: true` — left
      // alone, `CampaignService.reconcile`'s 24/7 AUTO-revival branch
      // (`autoOptimize && paused` → funded → active) would bring it straight
      // back into the feed on the very next read, regardless of this
      // deletion. Clear the flag unconditionally instead of only for the
      // statuses handled above.
      this.prisma.campaign.updateMany({
        where: { companyId, status: { notIn: ['active', 'depleted'] }, autoOptimize: true },
        data: { autoOptimize: false },
      }),
    ]);

    // The takedown is already committed by this point — a notification
    // hiccup must never make this look like it failed. Fires the same for
    // both the owner's own request and the automatic stale-draft sweep: the
    // sweep case especially needs it, since the owner was never in the app
    // when it happened.
    const effectiveAt = new Date(now.getTime() + COMPANY_DELETE_GRACE_MS);
    void this.notifications
      .notify({
        userId: company.ownerUserId,
        type: 'business_deletion_scheduled',
        title: `Afacerea „${company.displayName}" a fost programată pentru ștergere`,
        body: `Anunțul a fost dat jos acum. Datele sunt șterse definitiv pe ${effectiveAt.toLocaleDateString('ro-RO')} — poți anula oricând până atunci.`,
        channels: { panel: true, email: true },
        data: { companyId },
      })
      .catch((err) =>
        this.logger.error(
          'Deletion-scheduled notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
  }

  /** Call off a pending deletion — only while still inside the grace window. */
  async cancelDeletion(userId: string, companyId: string): Promise<void> {
    const role = await this.membershipRole(companyId, userId);
    if (!role) throw new NotFoundException('Company not found');
    if (role !== CompanyRole.owner) {
      throw new ForbiddenException('only_the_owner_can_delete');
    }
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { deletionScheduledAt: true, displayName: true },
    });
    if (!company.deletionScheduledAt) return;
    if (Date.now() - company.deletionScheduledAt.getTime() >= COMPANY_DELETE_GRACE_MS) {
      throw new BadRequestException('deletion_grace_expired');
    }
    await this.prisma.company.update({
      where: { id: companyId },
      data: { deletionScheduledAt: null, deletionReminderSentAt: null },
    });

    void this.notifications
      .notify({
        userId,
        type: 'business_deletion_canceled',
        title: `Ștergerea afacerii „${company.displayName}" a fost anulată`,
        body: `Afacerea „${company.displayName}" este din nou activă.`,
        channels: { panel: true },
        data: { companyId },
      })
      .catch((err) =>
        this.logger.error(
          'Deletion-canceled notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );
  }

  /**
   * Wipe any of the given businesses whose grace window has elapsed. There is no
   * cron — this rides along with the reads that list a user's businesses.
   */
  private async purgeExpiredDeletions(companyIds: string[]): Promise<void> {
    if (companyIds.length === 0) return;
    const cutoff = new Date(Date.now() - COMPANY_DELETE_GRACE_MS);
    const expired = await this.prisma.company.findMany({
      where: { id: { in: companyIds }, deletionScheduledAt: { lte: cutoff } },
      select: { id: true },
    });
    if (expired.length === 0) return;
    await this.prisma.company.deleteMany({
      where: { id: { in: expired.map((c) => c.id) } },
    });
  }

  /** Compact list of the user's businesses for the dashboard switcher. */
  async overview(userId: string) {
    const membership = await this.prisma.companyUser.findMany({
      where: { userId, status: 'active' },
      select: { companyId: true },
    });
    await this.purgeExpiredDeletions(membership.map((m) => m.companyId));

    const companies = await this.prisma.company.findMany({
      where: { members: { some: { userId, status: 'active' } } },
      orderBy: { createdAt: 'asc' },
      include: { website: { select: { mode: true, status: true } } },
    });
    const ids = companies.map((c) => c.id);
    const [campaigns, consumedMap, locations, appointmentSettings] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { companyId: { in: ids } },
        select: { companyId: true, status: true },
      }),
      this.wallet.consumedByCompanies(ids),
      this.prisma.companyLocation.findMany({
        where: { companyId: { in: ids }, isPrimary: true },
        select: { companyId: true, city: true },
      }),
      // Backs nav-gating on the frontend (item 11): "Programări" is only
      // worth showing once the owner has actually turned appointments on.
      this.prisma.appointmentSettings.findMany({
        where: { companyId: { in: ids } },
        select: { companyId: true, enabled: true },
      }),
    ]);
    const campMap = new Map(campaigns.map((x) => [x.companyId, x.status]));
    const locMap = new Map(locations.map((x) => [x.companyId, x.city]));
    const apptMap = new Map(appointmentSettings.map((x) => [x.companyId, x.enabled]));

    return companies.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      slug: c.slug,
      status: c.status,
      website: c.website ? { mode: c.website.mode, status: c.website.status } : null,
      // Same condition `dashboard()` uses for its own `unlock_advanced_builder`
      // task — an advanced-plan site with nothing live yet has no real "Cereri".
      builderUnlocked: !!c.advancedUnlockedAt,
      appointmentsEnabled: apptMap.get(c.id) ?? false,
      campaignStatus: campMap.get(c.id) ?? null,
      consumedCredits: (consumedMap.get(c.id) ?? 0) / CREDIT_MINOR,
      locationCity: locMap.get(c.id) ?? null,
      deletionScheduledAt: c.deletionScheduledAt,
      deletionEffectiveAt: c.deletionScheduledAt
        ? new Date(c.deletionScheduledAt.getTime() + COMPANY_DELETE_GRACE_MS)
        : null,
    }));
  }
}
