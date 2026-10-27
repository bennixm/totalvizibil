import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CampaignStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/env';
import { resolveLocationInput } from '../geo/ro-cities';
import { isEligibleForFeed } from '../analytics/feed-pricing';
import { WalletService } from '../wallet/wallet.service';
import { CampaignService } from '../campaigns/campaign.service';
import { COMPANY_DELETE_GRACE_MS } from '../companies/companies.constants';
import { LeadsService } from '../leads/leads.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ProV2Service } from '../website/builder/pro-v2/pro-v2.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RUN_SCORE_GRACE_MS } from '../analytics/visibility';
import { money } from '../wallet/money';
import { generateTablePdf } from '../common/table-pdf';
import { SaveCampaignDto } from '../campaigns/dto/save-campaign.dto';
import { CampaignActionDto } from './dto/campaign-action.dto';
import { SetCompanyStatusDto } from './dto/set-company-status.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { LeadsQueryDto } from './dto/leads-query.dto';
import { ListCompaniesQuery } from './dto/list-companies.query';
import { SetCompanyLocationDto } from './dto/set-company-location.dto';

/**
 * Admin-side controls over a single business: a full detail payload (profile,
 * campaign editor, analytics, leads) plus the levers to run its campaign and
 * freeze/unfreeze the listing. These bypass the owner-membership checks the
 * normal endpoints run — the platform-admin guard is the gate.
 */
@Injectable()
export class AdminCompaniesService {
  private readonly logger = new Logger(AdminCompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly campaigns: CampaignService,
    private readonly leads: LeadsService,
    private readonly analytics: AnalyticsService,
    private readonly builder: ProV2Service,
    private readonly settings: PlatformSettingsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Every admin-initiated notification below sends the owner to the real
   *  support page instead of a bare "contactează-ne" with nothing to click. */
  private get supportCta() {
    return {
      label: 'Contactează suportul',
      url: `${this.config.get('frontendOrigin', { infer: true })}/support`,
    };
  }

  private async loadCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { campaign: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  /**
   * Mirrors the owner-facing `assertCanEditCompany`/`assertCanEdit` guards
   * (companies.service.ts, campaign.service.ts) on the admin side, which had
   * no equivalent at all — an admin could reactivate, publish, or edit a
   * company already mid-deletion, producing a state the owner's own (always
   * blocked) edit paths could never reach or undo. Every mutating method
   * below calls this except `cancelDeletion`, which is the one way OUT of
   * this state.
   */
  private async assertNotPendingDeletion(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { deletionScheduledAt: true },
    });
    if (company?.deletionScheduledAt) {
      throw new BadRequestException('company_pending_deletion');
    }
  }

  // --- list / browse --------------------------------------------

  private buildListWhere(
    query: Pick<ListCompaniesQuery, 'search' | 'status' | 'campaign' | 'pendingDeletion'>,
  ): Prisma.CompanyWhereInput {
    const { search, status, campaign, pendingDeletion } = query;
    return {
      ...(status ? { status } : {}),
      ...(campaign === 'none' ? { campaign: { is: null } } : {}),
      ...(campaign && campaign !== 'none' ? { campaign: { status: campaign } } : {}),
      ...(pendingDeletion ? { deletionScheduledAt: { not: null } } : {}),
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
  }

  async list(query: ListCompaniesQuery) {
    const { page = 1, pageSize = 20 } = query;
    const where = this.buildListWhere(query);

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
        deletionScheduledAt: c.deletionScheduledAt,
        deletionEffectiveAt: c.deletionScheduledAt
          ? new Date(c.deletionScheduledAt.getTime() + COMPANY_DELETE_GRACE_MS)
          : null,
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

  /** Same business list, same filters, as a downloadable PDF — capped so an
   *  unfiltered export on a very large platform still returns promptly. */
  async exportPdf(
    query: Pick<ListCompaniesQuery, 'search' | 'status' | 'campaign' | 'pendingDeletion'>,
  ): Promise<Buffer> {
    const EXPORT_CAP = 2000;
    const where = this.buildListWhere(query);
    const rows = await this.prisma.company.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_CAP,
      include: {
        campaign: { select: { status: true } },
        owner: { select: { name: true, email: true } },
      },
    });
    const consumed = await this.wallet.consumedByCompanies(rows.map((r) => r.id));

    const STATUS_RO: Record<string, string> = {
      draft: 'Ciornă',
      active: 'Activă',
      suspended: 'Suspendată',
    };
    const CAMP_RO: Record<string, string> = {
      draft: 'Ciornă',
      active: 'Activă',
      paused: 'Pe pauză',
      depleted: 'Epuizată',
    };

    return generateTablePdf({
      title: 'AFACERI',
      ownerName: 'Panou admin',
      subtitle: `${rows.length} afaceri`,
      columns: [
        { label: 'Afacere', width: 0.3 },
        { label: 'Status', width: 0.14 },
        { label: 'Proprietar', width: 0.26 },
        { label: 'Campanie', width: 0.14, align: 'right' },
        { label: 'Consumat', width: 0.16, align: 'right' },
      ],
      rows: rows.map((c) => [
        c.displayName,
        STATUS_RO[c.status] ?? c.status,
        c.owner.email,
        c.campaign ? (CAMP_RO[c.campaign.status] ?? c.campaign.status) : 'Fără campanie',
        `${money(consumed.get(c.id) ?? 0).credits.toFixed(2)} cr`,
      ]),
      emptyText: 'Nicio afacere pentru acest filtru.',
    });
  }

  // --- full detail ------------------------------------------------

  async detail(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        category: { include: { parent: { select: { slug: true, nameI18n: true } } } },
        locations: { orderBy: { isPrimary: 'desc' } },
        website: {
          select: { mode: true, status: true, updatedAt: true, content: true, theme: true },
        },
        owner: { select: { id: true, name: true, email: true, status: true } },
        _count: { select: { services: true, contacts: true, leads: true, adClicks: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    const [campaign, feedRanks, analytics, leadItems, leadSummary, advancedPriceCredits] =
      await Promise.all([
        this.campaigns.getFor(companyId),
        // Same per-Feed source of truth the owner's own campaign-spend page
        // reads — so admin sees exactly where the company really stands, not
        // just the editor's flat recommendation. `feedRanksFor` alone (not
        // the full `spendReportFor`) so this doesn't run the campaign's
        // self-healing `reconcile()` a second time in parallel with `getFor`.
        this.analytics.feedRanksFor(companyId),
        this.analytics.companyAnalytics(companyId),
        this.leads.listFor(companyId, { limit: 30 }),
        this.leads.summaryFor(companyId),
        this.settings.advancedBuilderPriceCredits(),
      ]);
    // Mirrors `CampaignService.spendReportFor`'s own needsPositionUpgrade:
    // only a real ask when raising CPC to the recommendation would still
    // change anything (manual mode, current CPC below it) — composite rank
    // can stay "not #1" for budget/response/plan/age reasons this number
    // can't fix, so it's not flagged as a CPC problem once CPC already meets it.
    const recommendedCpc = campaign.suggestions.appearFirst.cpc;
    const needsPositionUpgrade =
      !!campaign.campaign &&
      !campaign.campaign.autoOptimize &&
      campaign.campaign.cpc.minor < recommendedCpc.minor &&
      feedRanks.some((r) => r.position !== 1);
    const feedStatus = { feedRanks, needsPositionUpgrade, recommendedCpc };

    // Județ-based coverage only — never mixed, so the first row's `nationwide`
    // tells the whole story (either one `nationwide` row, or one row per județ).
    const isNationwide = company.locations[0]?.nationwide ?? false;
    const counties = company.locations
      .filter((l) => !l.nationwide && l.county)
      .map((l) => l.county!);
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
        advancedPriceCredits,
        deletionScheduledAt: company.deletionScheduledAt,
        deletionEffectiveAt: company.deletionScheduledAt
          ? new Date(company.deletionScheduledAt.getTime() + COMPANY_DELETE_GRACE_MS)
          : null,
        category: company.category
          ? {
              slug: company.category.slug,
              name: company.category.nameI18n,
              parent: company.category.parent
                ? { slug: company.category.parent.slug, name: company.category.parent.nameI18n }
                : null,
            }
          : null,
        location: company.locations.length ? { nationwide: isNationwide, counties } : null,
        website: company.website
          ? {
              mode: company.website.mode,
              status: company.website.status,
              updatedAt: company.website.updatedAt,
              // Rendered site for the admin's in-app preview (the public page
              // 404s for non-active businesses, so a link there is a dead end).
              theme: company.website.theme,
              content: company.website.content,
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
      feedStatus,
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

  /** Admin: move a request through new → seen → resolved. */
  async setLeadStatus(companyId: string, leadId: string, status: 'new' | 'seen' | 'resolved') {
    await this.loadCompany(companyId);
    await this.leads.updateFor(companyId, leadId, { status });
    return this.detail(companyId);
  }

  // --- website builder ---------------------------------------------

  /**
   * Give a business the advanced website builder — a platform admin doing it for
   * the owner. `charge: true` debits the owner's wallet the standard fee (fails
   * if they can't afford it); otherwise it's free. Idempotent (re-running on an
   * already-unlocked site just returns the current detail).
   */
  async upgradeToAdvanced(companyId: string, charge = false) {
    await this.loadCompany(companyId);
    await this.assertNotPendingDeletion(companyId);
    await this.builder.unlockForAdmin(companyId, { charge });
    return this.detail(companyId);
  }

  // --- profile edit ---------------------------------------------

  async updateCompany(companyId: string, dto: UpdateCompanyDto) {
    const existing = await this.loadCompany(companyId);
    await this.assertNotPendingDeletion(companyId);
    if (dto.categoryId) {
      const cat = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!cat || !cat.isActive || cat.parentId == null) {
        throw new BadRequestException('Pick an active leaf category');
      }
    }
    // Only a REAL category change is worth telling the owner about — it
    // moves which feed they compete/bill in, unlike a plain display-name or
    // description edit in the same request, which isn't.
    const categoryChanged = !!dto.categoryId && dto.categoryId !== existing.categoryId;
    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: {
          ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
          ...(dto.legalName !== undefined ? { legalName: dto.legalName || null } : {}),
          ...(dto.description !== undefined ? { description: dto.description || null } : {}),
          ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        },
      });
      if (dto.categoryId) {
        // Keep `company_categories` — the Feed's actual source of truth for
        // ranking/billing (feed.service.ts reads `categoryAssignments`
        // exclusively, never the `Company.categoryId` scalar) — in sync
        // with the mirror above. The owner-facing path already does this
        // (CompaniesService.update → syncPrimaryCategory); this admin path
        // was writing only the scalar, so the company kept competing and
        // being billed under its OLD category forever.
        await tx.companyCategory.deleteMany({ where: { companyId } });
        await tx.companyCategory.create({
          data: { companyId, categoryId: dto.categoryId, isPrimary: true },
        });
      }
    });

    if (categoryChanged) {
      // Already committed — a notification hiccup must never mask this.
      void this.notifications
        .notify({
          userId: existing.ownerUserId,
          type: 'company_category_changed_by_admin',
          title: `Categoria afacerii „${existing.displayName}" a fost schimbată`,
          body: `Un administrator a schimbat categoria afacerii „${existing.displayName}" — de acum concurează și este facturată într-un alt Feed.`,
          channels: { panel: true, email: true },
          data: { companyId },
          email: { cta: this.supportCta },
        })
        .catch((err) =>
          this.logger.error(
            'Company-category-changed notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );
    }

    return this.detail(companyId);
  }

  /**
   * Admin: replace the company's ENTIRE service area — one or several județe,
   * or nationwide — a full-replace override, same as the owner-facing flow;
   * it must not leave other, previously-set județe stranded behind it.
   */
  async setLocation(companyId: string, dto: SetCompanyLocationDto) {
    const company = await this.loadCompany(companyId);
    await this.assertNotPendingDeletion(companyId);
    const { nationwide, counties } = resolveLocationInput(dto);
    // Carry the existing primary row's city/lat/lng forward onto the new
    // primary row — this admin coverage editor only ever touches the
    // județe list, but a full delete+recreate was dropping the exact-address
    // pin entirely. With it gone, the owner's own `setPublished` (which
    // requires `nationwide || (lat && lng)`) started rejecting every future
    // publish attempt with no way to fix it from this screen.
    const existingPrimary = await this.prisma.companyLocation.findFirst({
      where: { companyId, isPrimary: true },
      select: { city: true, lat: true, lng: true },
    });
    const rows: Prisma.CompanyLocationCreateManyInput[] = nationwide
      ? [{ companyId, nationwide: true, country: 'RO', isPrimary: true }]
      : counties.map((county, i) => ({
          companyId,
          county,
          nationwide: false,
          country: 'RO',
          isPrimary: i === 0,
          city: i === 0 ? (existingPrimary?.city ?? null) : null,
          lat: i === 0 ? (existingPrimary?.lat ?? null) : null,
          lng: i === 0 ? (existingPrimary?.lng ?? null) : null,
        }));
    await this.prisma.$transaction([
      this.prisma.companyLocation.deleteMany({ where: { companyId } }),
      this.prisma.companyLocation.createMany({ data: rows }),
    ]);

    // Already committed — a notification hiccup must never mask this. Every
    // call here is a deliberate full-replace of the service area, unlike the
    // category edit above — no "did anything actually change" check needed.
    void this.notifications
      .notify({
        userId: company.ownerUserId,
        type: 'company_location_changed_by_admin',
        title: `Zona de acoperire a afacerii „${company.displayName}" a fost schimbată`,
        body: `Un administrator a schimbat județele/zona de acoperire a afacerii „${company.displayName}" — de acolo apar acum anunțurile și se facturează clicurile.`,
        channels: { panel: true, email: true },
        data: { companyId },
        email: { cta: this.supportCta },
      })
      .catch((err) =>
        this.logger.error(
          'Company-location-changed notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

    return this.detail(companyId);
  }

  /** Admin: take the public website online / offline (does not touch business status). */
  async setWebsitePublished(companyId: string, published: boolean) {
    const outer = await this.loadCompany(companyId);
    await this.assertNotPendingDeletion(companyId);
    if (published) {
      // Same readiness gate the owner's own `setPublished` enforces
      // (companies.service.ts) — without it, this could "publish" a site
      // with no content, no category, or no usable location, leaving
      // `website.status === 'published'` true while the company's own
      // `status` (left untouched by design here) keeps the public URL
      // unreachable — a contradictory, confusing state.
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
    await this.prisma.website.updateMany({
      where: { companyId },
      data: { status: published ? 'published' : 'unpublished' },
    });

    // Already committed — a notification hiccup must never mask this. The
    // owner's own `setPublished` already notifies nothing for either
    // direction (the owner just clicked the button themselves); this is the
    // ADMIN-initiated lever, where silence is exactly the "my site is down
    // and I don't know why" support ticket this closes off.
    void this.notifications
      .notify(
        published
          ? {
              userId: outer.ownerUserId,
              type: 'company_website_published_by_admin',
              title: `Site-ul afacerii „${outer.displayName}" este din nou public`,
              body: `Un administrator a republicat site-ul afacerii „${outer.displayName}".`,
              channels: { panel: true },
              data: { companyId },
            }
          : {
              userId: outer.ownerUserId,
              type: 'company_website_unpublished_by_admin',
              title: `Site-ul afacerii „${outer.displayName}" a fost depublicat`,
              body: `Un administrator a depublicat site-ul afacerii „${outer.displayName}" — nu mai este vizibil public.`,
              channels: { panel: true, email: true },
              data: { companyId },
              email: { cta: this.supportCta },
            },
      )
      .catch((err) =>
        this.logger.error(
          'Company-website-published notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

    return this.detail(companyId);
  }

  // --- campaign editing ---------------------------------------

  async saveCampaign(companyId: string, dto: SaveCampaignDto) {
    await this.loadCompany(companyId);
    await this.assertNotPendingDeletion(companyId);
    await this.campaigns.saveFor(companyId, dto, 'admin');
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
    await this.assertNotPendingDeletion(companyId);
    if (!company.campaign) throw new BadRequestException('This business has no campaign');
    const wasLive = company.campaign.status === CampaignStatus.active;

    if (dto.action === 'delete') {
      await this.prisma.$transaction([
        this.prisma.campaign.delete({ where: { companyId } }),
        this.prisma.company.update({
          where: { id: companyId },
          // Never silently lift a `suspended` status by routing it back to
          // `draft` just because its campaign was deleted.
          data:
            company.status === 'suspended'
              ? { featured: false }
              : { status: 'draft', featured: false },
        }),
        this.prisma.website.updateMany({
          where: { companyId },
          data: { status: 'unpublished' },
        }),
      ]);
      void this.notifications
        .notify({
          userId: company.ownerUserId,
          type: 'campaign_deleted_by_admin',
          title: `Campania „${company.displayName}" a fost ștearsă`,
          body: `„${company.displayName}" nu mai apare în feed — campania a fost ștearsă. Poți configura una nouă din panou.`,
          channels: { panel: true, email: true },
          data: { companyId },
          email: {
            details: [{ label: 'Afacere', value: company.displayName }],
            cta: this.supportCta,
          },
        })
        .catch((err) =>
          this.logger.error(
            'Campaign-deleted-by-admin notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );
      return { ok: true as const, action: 'delete' as const };
    }

    if (dto.action === 'pause') {
      // Kill AUTO too, else the owner's next page load would revive it.
      const autoWasOn = company.campaign.autoOptimize;
      if (autoWasOn) {
        await this.prisma.campaign.update({
          where: { companyId },
          data: { autoOptimize: false },
        });
      }
      if (wasLive || company.campaign.status === CampaignStatus.depleted) {
        await this.setLive(companyId, false, wasLive);
      }
      if (wasLive) {
        void this.notifications
          .notify({
            userId: company.ownerUserId,
            type: 'campaign_paused_by_admin',
            title: `Campania „${company.displayName}" a fost pusă pe pauză`,
            body:
              `„${company.displayName}" nu mai apare în feed. Campania este oprită și nu consumă buget.` +
              (autoWasOn
                ? ' Modul AUTO a fost dezactivat — va trebui repornit manual, nu se reactivează singur.'
                : ''),
            channels: { panel: true, email: true },
            data: { companyId },
            email: {
              details: [{ label: 'Afacere', value: company.displayName }],
              cta: this.supportCta,
            },
          })
          .catch((err) =>
            this.logger.error(
              'Campaign-paused-by-admin notification failed',
              err instanceof Error ? err.stack : err,
            ),
          );
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
    // A manual CPC Maxim under the Feed's own CPC minim is ineligible for
    // every Feed — activating it anyway shows "Active" in the admin panel
    // while `CampaignService.reconcile`'s self-heal immediately pauses it
    // back, undoing a success toast the admin just saw. Same check the
    // owner-facing `activate()` already enforces.
    if (
      !company.campaign.autoOptimize &&
      !isEligibleForFeed(company.campaign.cpcMinor, await this.analytics.marginConfig())
    ) {
      throw new BadRequestException('cpc_below_feed_minimum');
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

    // Already committed — a notification hiccup must never mask this. The
    // owner-facing `activate()` notifies `campaign_activated`; this is the
    // admin-initiated mirror — the wallet starts being debited per click
    // from an action the owner didn't take, the inverse of the pause/delete
    // cases above.
    void this.notifications
      .notify({
        userId: owner.ownerUserId,
        type: 'campaign_activated_by_admin',
        title: `Campania „${company.displayName}" este acum live`,
        body: `Un administrator a activat campania afacerii „${company.displayName}" — a apărut în feed și portofelul este debitat per clic.`,
        channels: { panel: true, email: true },
        data: { companyId },
        email: {
          details: [{ label: 'Afacere', value: company.displayName }],
          cta: this.supportCta,
        },
      })
      .catch((err) =>
        this.logger.error(
          'Campaign-activated-by-admin notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

    return { ok: true as const, action: 'activate' as const };
  }

  async setStatus(companyId: string, dto: SetCompanyStatusDto) {
    const company = await this.loadCompany(companyId);
    await this.assertNotPendingDeletion(companyId);

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

      // Already committed — a notification hiccup must never mask this.
      const autoWasOn = !!company.campaign?.autoOptimize;
      void this.notifications
        .notify({
          userId: company.ownerUserId,
          type: 'business_suspended',
          title: `Afacerea „${company.displayName}" a fost suspendată`,
          body:
            `„${company.displayName}" nu mai apare în feed. Campania este oprită și nu consumă buget.` +
            (autoWasOn
              ? ' Modul AUTO a fost dezactivat — va trebui repornit manual la reactivare.'
              : ''),
          channels: { email: true, panel: true },
          data: { companyId },
          email: {
            details: [{ label: 'Afacere', value: company.displayName }],
            cta: this.supportCta,
          },
        })
        .catch((err) =>
          this.logger.error(
            'Business-suspended notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );

      return { ok: true as const, status: 'suspended' as const };
    }

    // Lift the suspension — the listing returns to `draft`; the owner
    // re-activates the campaign to go back into the feed.
    await this.prisma.company.update({
      where: { id: companyId },
      data: { status: 'draft' },
    });

    void this.notifications
      .notify({
        userId: company.ownerUserId,
        type: 'business_reactivated',
        title: `Afacerea „${company.displayName}" a fost reactivată`,
        body: `„${company.displayName}" poate fi republicată — suspendarea a fost ridicată.`,
        channels: { email: true, panel: true },
        data: { companyId },
        email: {
          details: [{ label: 'Afacere', value: company.displayName }],
          cta: this.supportCta,
        },
      })
      .catch((err) =>
        this.logger.error(
          'Business-reactivated notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

    return { ok: true as const, status: 'draft' as const };
  }

  /**
   * Call off a pending deletion on the owner's behalf — same effect as the
   * owner's own `cancelDeletion` (no admin-bypass needed there since this
   * doesn't touch anything ownership-gated), just reachable from here too
   * for support cases where the owner can't get to their own panel in time.
   * A no-op past the grace window — the sweep may already be mid-wipe.
   */
  async cancelDeletion(companyId: string) {
    const company = await this.loadCompany(companyId);
    if (!company.deletionScheduledAt) return this.detail(companyId);
    if (Date.now() - company.deletionScheduledAt.getTime() >= COMPANY_DELETE_GRACE_MS) {
      throw new BadRequestException('deletion_grace_expired');
    }
    await this.prisma.company.update({
      where: { id: companyId },
      data: { deletionScheduledAt: null, deletionReminderSentAt: null },
    });

    void this.notifications
      .notify({
        userId: company.ownerUserId,
        type: 'business_deletion_canceled',
        title: `Ștergerea afacerii „${company.displayName}" a fost anulată`,
        body: `„${company.displayName}" este din nou activă — ștergerea programată a fost anulată de un administrator.`,
        channels: { panel: true, email: true },
        data: { companyId },
        email: {
          details: [{ label: 'Afacere', value: company.displayName }],
          cta: this.supportCta,
        },
      })
      .catch((err) =>
        this.logger.error(
          'Deletion-canceled notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

    return this.detail(companyId);
  }
}
