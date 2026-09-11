import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompanyRole, Prisma } from '@prisma/client';
import { AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../../wallet/wallet.service';
import { CREDIT_MINOR } from '../../wallet/money';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import { slugify } from '../../common/slug';
import { AiService } from '../../ai/ai.service';
import { SectionType } from '../website.types';
import { assertClean } from '../drafts/content-filter';
import { WebsiteAssetService } from '../assets/website-asset.service';
import {
  ANIMATIONS,
  SECTION_CATALOG,
  SECTION_TYPES,
  SeedCtx,
  catalogForClient,
  coerceContent,
  seedSectionContent,
  snapAnimation,
  snapVariant,
} from './section-catalog';
import {
  BuilderDoc,
  DocSection,
  MAX_PAGES,
  MAX_SECTIONS,
  MOTIONS,
  PageSpec,
  coerceOverrides,
  coerceStyle,
  composeAdvancedDoc,
  docFromLegacy,
  normalizeDoc,
  normalizeFooter,
  normalizeNav,
  normalizeTheme,
  seedFillEmptySections,
  starterAdvancedDoc,
} from './compose-advanced';
import { classifyArchetype, pickSkeleton, skeletonExampleJson } from './site-archetypes';
import { fillDocImages, hashInt, verifyDocImages } from './stock-images';
import { generateSite } from './generator/pipeline';
import { ImageSearchService } from './generator/image-provider/image-search.service';
import type { VisualQaConfig } from './generator/types';
import { PutPagesDto } from './dto/put-pages.dto';
import { SaveDocDto } from './dto/save-doc.dto';
import { AddSectionDto } from './dto/add-section.dto';
import { PatchSectionDto } from './dto/patch-section.dto';
import { MoveSectionDto } from './dto/move-section.dto';
import { PatchThemeDto } from './dto/patch-theme.dto';
import { PatchChromeDto } from './dto/patch-chrome.dto';
import { BuilderAddAssetDto } from './dto/add-asset.dto';
import { AiPlanDto } from './dto/ai-plan.dto';
import { AiSectionDto } from './dto/ai-section.dto';

const CAN_EDIT: CompanyRole[] = [CompanyRole.owner, CompanyRole.manager];

/** AI generations allowed per company (bounds cost / abuse). */
const AI_PLAN_CAP = 6;
const AI_SECTION_CAP = 40;

/** When to reach for a non-default variant — fights "always variants[0]". */
function variantHintText(): string {
  return [
    'hero: imageBg/overlap when a strong photo carries the page; minimal/centered for text-first brands; gradient for products.',
    'services: iconGrid for many short services; rows/list for a menu-like list; numbered when order matters.',
    'about: stat when milestones matter; twoCol for a longer story; imageLeft/imageRight to break up text.',
    'testimonials: single/ticker for one strong quote or a stream; columns/cards for volume.',
    'gallery: masonry/carousel for portfolios; wide for hero-scale shots; grid for tidy proof.',
    'cta: boxed on a light page; gradient/solid for a full-bleed break.',
    'features vs featureSplit vs bento: features for a scannable grid; featureSplit for 2–3 story rows with imagery; bento for an asymmetric highlight wall.',
    'use timeline for history/roadmap, comparison for us-vs-them, marquee for logos or a moving statement, pricing for plans.',
  ].join('\n');
}

/** One line per section type for the AI planner's system prompt. A few types
 *  need owner-only input the model can't supply (a free-form block stack, an
 *  external video URL, a real before/after photo pair) — keep them out. */
const AI_SKIP_TYPES = new Set<SectionType>(['custom', 'video', 'beforeAfter']);
function catalogPromptText(): string {
  return SECTION_TYPES.filter((t) => !AI_SKIP_TYPES.has(t))
    .map((t) => {
      const spec = SECTION_CATALOG[t];
      const variants = spec.variants.map((v) => v.id).join('|');
      const fields = spec.fields
        .map((f) => {
          if (f.type === 'items') {
            return `${f.key}:items[${(f.itemFields ?? []).map((x) => x.key).join(',')}]`;
          }
          if (f.type === 'enum') return `${f.key}:${(f.enumValues ?? []).join('/')}`;
          return `${f.key}:${f.type}`;
        })
        .join(', ');
      return `  ${t} (variants: ${variants}; fields: ${fields})`;
    })
    .join('\n');
}

/**
 * Post-AI hygiene: the model can't know real client logos, real contact details
 * or real team members. Blank / placeholder those and return note keys so the
 * studio can tell the owner what still needs their input.
 */
function sanitizeAiPlan(doc: BuilderDoc, ctx: SeedCtx): string[] {
  const notes = new Set<string>();
  const placeholder =
    ctx.locale === 'de' ? 'Vorname Name' : ctx.locale === 'en' ? 'Full Name' : 'Nume Prenume';
  const localAsset = (v: unknown): string =>
    typeof v === 'string' && /^\/api\/v1\/website-assets\//.test(v) ? v : '';

  for (const p of doc.pages) {
    for (const s of p.sections) {
      const anim = snapAnimation(s.animation);
      if (anim) s.animation = anim;
      else delete s.animation;
      if (s.type === 'logos' && Array.isArray(s.content.items)) {
        for (const it of s.content.items as Record<string, unknown>[]) {
          it.imageUrl = localAsset(it.imageUrl);
        }
      }
      if (s.type === 'contact') {
        s.content.phone = ctx.phone ?? '';
        s.content.email = ctx.email ?? '';
        s.content.addressLine = '';
        if (!ctx.phone && !ctx.email) notes.add('contact');
      }
      if (s.type === 'team' && Array.isArray(s.content.items)) {
        for (const m of s.content.items as Record<string, unknown>[]) {
          m.name = placeholder;
          m.bio = '';
          m.imageUrl = localAsset(m.imageUrl); // never a stock face for a real hire
        }
        notes.add('team');
      }
    }
  }
  return [...notes];
}

type LoadedCompany = Prisma.CompanyGetPayload<{
  include: { website: true; locations: true; services: true; contacts: true };
}>;

@Injectable()
export class WebsiteBuilderService {
  private readonly visualQa: VisualQaConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly settings: PlatformSettingsService,
    private readonly assets: WebsiteAssetService,
    private readonly ai: AiService,
    private readonly imageSearch: ImageSearchService,
    config: ConfigService<AppConfig, true>,
  ) {
    // Phase 3 visual QA is opt-in and needs a screenshot service; without one it
    // is a no-op (`siteUrl` is left undefined here — no public preview endpoint).
    this.visualQa = {
      enabled: config.get('visualQa', { infer: true }),
      screenshotUrl: config.get('screenshotUrl', { infer: true }),
    };
  }

  // --- loading / context ------------------------------------------------

  /** Does this user hold the platform `admin` role? (admin panel entry-point). */
  private async isPlatformAdmin(userId: string): Promise<boolean> {
    const row = await this.prisma.platformRoleAssignment.findFirst({
      where: { userId, role: 'admin' },
      select: { userId: true },
    });
    return !!row;
  }

  private async load(
    companyId: string,
    userId: string,
    needEdit = false,
    requireAdvanced = true,
  ): Promise<LoadedCompany> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') {
      // A platform admin editing a business on the owner's behalf gets the same
      // rights an owner has here (the admin panel guards the entry point).
      if (!(await this.isPlatformAdmin(userId))) {
        throw new NotFoundException('Company not found');
      }
    } else if (needEdit && !CAN_EDIT.includes(member.role)) {
      throw new ForbiddenException('Your role cannot edit the website');
    }
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { website: true, locations: true, services: true, contacts: true },
    });
    if (!company.website) throw new NotFoundException('No website');
    // A business scheduled for deletion can still be viewed, just not edited
    // or (re-)unlocked, during its grace window.
    if (needEdit && company.deletionScheduledAt) {
      throw new ForbiddenException('company_pending_deletion');
    }
    if (requireAdvanced && company.website.mode !== 'advanced') {
      throw new BadRequestException('not_an_advanced_website');
    }
    return company;
  }

  /** Company that is on the advanced plan AND has paid the unlock — editing gate. */
  private async loadEditable(companyId: string, userId: string): Promise<LoadedCompany> {
    const company = await this.load(companyId, userId, true, true);
    if (!company.advancedUnlockedAt) throw new ForbiddenException('advanced_builder_locked');
    return company;
  }

  private seedCtx(company: LoadedCompany): SeedCtx {
    const loc = company.locations.find((l) => l.isPrimary) ?? company.locations[0];
    const contact = (t: 'phone' | 'email'): string | undefined =>
      company.contacts.find((c) => c.type === t && c.isPublic)?.value;
    const locale = (['ro', 'en', 'de'] as const).includes(
      company.defaultLocale as SeedCtx['locale'],
    )
      ? (company.defaultLocale as SeedCtx['locale'])
      : 'ro';
    return {
      businessName: (company.displayName ?? '').trim(),
      businessType: (company.description ?? '').trim().slice(0, 48),
      city: loc?.city ?? '',
      services: company.services
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((s) => s.name.trim())
        .filter(Boolean)
        .slice(0, 8),
      phone: contact('phone'),
      email: contact('email'),
      locale,
    };
  }

  private loadDoc(website: LoadedCompany['website'], ctx: SeedCtx): BuilderDoc {
    return docFromLegacy(website!.builderSpec, website!.content, website!.theme, ctx);
  }

  // --- content moderation ---------------------------------------------

  private assertDocClean(doc: BuilderDoc): void {
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const p of doc.pages) {
      strings.push(p.title);
      p.sections.forEach((s) => walk(s.content));
    }
    assertClean(...strings);
  }

  // --- persistence --------------------------------------------------

  private async persist(companyId: string, doc: BuilderDoc, ctx: SeedCtx): Promise<void> {
    const clean = normalizeDoc(doc, ctx);
    this.assertDocClean(clean);
    const g = composeAdvancedDoc(clean, ctx);
    await this.prisma.website.update({
      where: { companyId },
      data: {
        builderSpec: clean as unknown as Prisma.InputJsonValue,
        content: g.content as unknown as Prisma.InputJsonValue,
        theme: g.theme as unknown as Prisma.InputJsonValue,
        generator: g.generator,
      },
    });
    // Keep the feed-card logo (`company.logoUrl`) in step with the site logo.
    const logo = (clean.theme as { logoUrl?: string }).logoUrl;
    await this.prisma.company.update({
      where: { id: companyId },
      data: { logoUrl: typeof logo === 'string' && logo.trim() ? logo : null },
    });
  }

  // --- view ----------------------------------------------------------

  private async view(companyId: string, userId: string) {
    const company = await this.load(companyId, userId, false, false);
    const w = company.website!;
    const ctx = this.seedCtx(company);
    const [price, walletSummary, isAdmin] = await Promise.all([
      this.settings.advancedBuilderPriceCredits(),
      this.wallet.getSummary(company.ownerUserId),
      this.isPlatformAdmin(userId),
    ]);
    let unlocked = company.advancedUnlockedAt != null && w.mode === 'advanced';

    // The site is already on the advanced plan but never paid the deferred
    // unlock fee (e.g. picked "advanced" at signup, never opened the builder).
    // For the owner that fee is still due — they see the pay screen. A platform
    // admin opening it IS the grant: heal the flag for free so the studio opens
    // and every edit endpoint (which re-checks `advancedUnlockedAt`) works.
    if (!unlocked && isAdmin && w.mode === 'advanced') {
      const now = new Date();
      await this.prisma.company.update({
        where: { id: companyId },
        data: { advancedUnlockedAt: now },
      });
      company.advancedUnlockedAt = now;
      unlocked = true;
    }

    // Has the owner already done the post-builder location + category step?
    // (Same rule the dashboard uses for the `set_location` task.) Lets the
    // studio stop nagging "continue → location" once it's set.
    const loc = company.locations.find((l) => l.isPrimary) ?? company.locations[0];
    const locationSet = company.categoryId != null && !!loc && (loc.lat != null || loc.nationwide);

    let doc: BuilderDoc | null = null;
    let content: unknown = w.content ?? null;
    let theme: unknown = w.theme ?? null;

    if (unlocked) {
      doc = this.loadDoc(w, ctx);
      const g = composeAdvancedDoc(doc, ctx);
      content = g.content;
      theme = g.theme;
      // Lazily persist a migrated (legacy → v2) doc so later reads are cheap.
      const stored = w.builderSpec as { v?: number } | null;
      if (!stored || stored.v !== 2) {
        await this.prisma.website.update({
          where: { companyId },
          data: {
            builderSpec: doc as unknown as Prisma.InputJsonValue,
            content: g.content as unknown as Prisma.InputJsonValue,
            theme: g.theme as unknown as Prisma.InputJsonValue,
            generator: g.generator,
          },
        });
      }
    }

    // The undo history can be several full sites — keep it server-side, expose
    // only a flag + the AI budget counters.
    const aiCanUndo = (doc?.history?.length ?? 0) > 0;
    const clientDoc = doc ? { ...doc, history: undefined } : null;

    return {
      mode: w.mode,
      unlocked,
      locationSet,
      priceCredits: price,
      wallet: { balance: walletSummary.balance },
      websiteStatus: w.status,
      theme,
      content,
      doc: clientDoc,
      aiCanUndo,
      aiConfigured: this.ai.configured,
      // Manual editing is unlimited; AI is metered per site so it can't run away
      // with cost. `left` is what's still available on this site.
      aiLimits: {
        plan: AI_PLAN_CAP,
        section: AI_SECTION_CAP,
        planUsed: doc?.ai?.planCount ?? 0,
        sectionUsed: doc?.ai?.sectionCount ?? 0,
        planLeft: Math.max(0, AI_PLAN_CAP - (doc?.ai?.planCount ?? 0)),
        sectionLeft: Math.max(0, AI_SECTION_CAP - (doc?.ai?.sectionCount ?? 0)),
      },
      catalog: unlocked ? catalogForClient() : null,
      // Deterministic seed copy per type so the studio can add a section fully
      // client-side (it no longer round-trips the server per edit).
      seeds: unlocked
        ? Object.fromEntries(SECTION_TYPES.map((t) => [t, seedSectionContent(t, ctx)]))
        : null,
      animations: ANIMATIONS,
      motions: MOTIONS,
    };
  }

  get(userId: string, companyId: string) {
    return this.view(companyId, userId);
  }

  // --- unlock (unchanged fee logic; seeds a real starter doc) ---------

  async unlock(userId: string, companyId: string) {
    const company = await this.load(companyId, userId, true, false);
    await this.applyUnlock(company, { chargeOwner: true });
    return this.view(companyId, userId);
  }

  /**
   * Grant the advanced builder to a business — a platform admin doing it on the
   * owner's behalf. Bypasses the owner-membership check (the admin guard is the
   * gate). `charge: true` debits the owner's wallet the standard fee (rejected
   * up-front if they can't cover it); otherwise it's free. Returns nothing; the
   * admin panel re-reads the company detail afterwards.
   */
  async unlockForAdmin(companyId: string, opts: { charge?: boolean } = {}): Promise<void> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { website: true, locations: true, services: true, contacts: true },
    });
    if (!company.website) throw new NotFoundException('No website');
    if (opts.charge && !company.advancedUnlockedAt) {
      const price = await this.settings.advancedBuilderPriceCredits();
      if (!(await this.wallet.canAfford(company.ownerUserId, price * CREDIT_MINOR))) {
        throw new BadRequestException('owner_wallet_cannot_afford_upgrade');
      }
    }
    await this.applyUnlock(company, { chargeOwner: !!opts.charge });
  }

  /** Shared body of both unlock paths — optionally charges the owner's wallet. */
  private async applyUnlock(company: LoadedCompany, opts: { chargeOwner: boolean }): Promise<void> {
    const w = company.website!;
    if (
      company.advancedUnlockedAt &&
      w.mode === 'advanced' &&
      (w.builderSpec as { v?: number })?.v === 2
    ) {
      return;
    }

    if (opts.chargeOwner && !company.advancedUnlockedAt) {
      const price = await this.settings.advancedBuilderPriceCredits();
      await this.wallet.spend(company.ownerUserId, price * CREDIT_MINOR, {
        description: 'Advanced website builder',
        companyId: company.id,
      });
    }

    await this.prisma.company.update({
      where: { id: company.id },
      data: { advancedUnlockedAt: company.advancedUnlockedAt ?? new Date() },
    });

    // Seed the 3-page starter site unless a v2 builder doc already exists.
    const ctx = this.seedCtx(company);
    const doc =
      (w.builderSpec as { v?: number })?.v === 2 ? this.loadDoc(w, ctx) : starterAdvancedDoc(ctx);
    const g = composeAdvancedDoc(doc, ctx);
    await this.prisma.website.update({
      where: { companyId: company.id },
      data: {
        mode: 'advanced',
        builderSpec: doc as unknown as Prisma.InputJsonValue,
        content: g.content as unknown as Prisma.InputJsonValue,
        theme: g.theme as unknown as Prisma.InputJsonValue,
        generator: g.generator,
      },
    });
  }

  // --- editing ------------------------------------------------------

  private findSection(
    doc: BuilderDoc,
    sectionId: string,
  ): { page: PageSpec; section: DocSection; index: number } | null {
    for (const page of doc.pages) {
      const index = page.sections.findIndex((s) => s.id === sectionId);
      if (index >= 0) return { page, section: page.sections[index], index };
    }
    return null;
  }

  async putPages(userId: string, companyId: string, dto: PutPagesDto) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const doc = this.loadDoc(company.website, ctx);
    const byId = new Map(doc.pages.map((p) => [p.id, p]));
    // Legal pages are managed separately — the owner can't reorder or drop them.
    const systemPages = doc.pages.filter((p) => p.system);

    let pages: PageSpec[] = dto.pages.slice(0, MAX_PAGES).map((p, i) => {
      const existing = p.id ? byId.get(p.id) : undefined;
      if (existing?.system) return existing; // ignore any attempt to touch a legal page
      const title = p.title.trim().slice(0, 60) || `Page ${i + 1}`;
      return {
        id: existing?.id ?? randomUUID(),
        title,
        slug: existing?.slug || slugify(title) || `page-${i + 1}`,
        isHome: false,
        nav: p.nav !== false,
        sections: existing?.sections ?? [],
      };
    });
    pages = pages.filter((p) => !p.system);
    if (!pages.length) pages = starterAdvancedDoc(ctx).pages.filter((p) => !p.system);

    const homeIdx = dto.pages.findIndex((p) => p.isHome);
    pages.forEach(
      (p, i) => (p.isHome = i === (homeIdx >= 0 && homeIdx < pages.length ? homeIdx : 0)),
    );

    doc.pages = [...pages, ...systemPages];
    await this.persist(companyId, doc, ctx);
    return this.view(companyId, userId);
  }

  async addSection(userId: string, companyId: string, pageId: string, dto: AddSectionDto) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const doc = this.loadDoc(company.website, ctx);
    const page = doc.pages.find((p) => p.id === pageId);
    if (!page) throw new NotFoundException('page_not_found');
    // Legal pages are a single, non-editable-structure text page.
    if (page.system) throw new BadRequestException('system_page_locked');
    if (!(dto.type in SECTION_CATALOG)) throw new BadRequestException('unknown_section_type');
    if (page.sections.length >= MAX_SECTIONS) throw new BadRequestException('section_limit');

    const type = dto.type as SectionType;
    const section: DocSection = {
      id: randomUUID(),
      type,
      variant: snapVariant(type, dto.variant),
      visible: true,
      content: seedSectionContent(type, ctx),
    };
    const at = Math.min(Math.max(0, dto.index ?? page.sections.length), page.sections.length);
    page.sections.splice(at, 0, section);

    await this.persist(companyId, doc, ctx);
    return this.view(companyId, userId);
  }

  async patchSection(userId: string, companyId: string, sectionId: string, dto: PatchSectionDto) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const doc = this.loadDoc(company.website, ctx);
    const found = this.findSection(doc, sectionId);
    if (!found) throw new NotFoundException('section_not_found');

    if (dto.variant !== undefined) {
      found.section.variant = snapVariant(found.section.type, dto.variant);
    }
    if (dto.animation !== undefined) {
      const anim = snapAnimation(dto.animation);
      if (anim) found.section.animation = anim;
      else delete found.section.animation;
    }
    if (dto.visible !== undefined) found.section.visible = dto.visible;
    if (dto.style !== undefined) {
      found.section.style = coerceStyle({ ...found.section.style, ...dto.style });
    }
    if (dto.overrides !== undefined) {
      const merged: Record<string, unknown> = { ...found.section.overrides };
      for (const [k, v] of Object.entries(dto.overrides)) {
        if (v == null || (typeof v === 'object' && !Object.keys(v).length)) delete merged[k];
        else merged[k] = { ...(merged[k] as object), ...(v as object) };
      }
      found.section.overrides = coerceOverrides(found.section.type, merged);
    }
    if (dto.content) {
      found.section.content = coerceContent(found.section.type, {
        ...found.section.content,
        ...dto.content,
      });
    }

    await this.persist(companyId, doc, ctx);
    return this.view(companyId, userId);
  }

  async moveSection(userId: string, companyId: string, sectionId: string, dto: MoveSectionDto) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const doc = this.loadDoc(company.website, ctx);
    const found = this.findSection(doc, sectionId);
    const target = doc.pages.find((p) => p.id === dto.toPageId);
    if (!found || !target) throw new NotFoundException('section_or_page_not_found');
    // Never restructure a legal page (in or out).
    if (found.page.system || target.system) throw new BadRequestException('system_page_locked');
    const crossPage = found.page.id !== target.id;
    if (crossPage && target.sections.length >= MAX_SECTIONS) {
      throw new BadRequestException('section_limit');
    }
    if (crossPage && found.page.sections.length <= 1) {
      throw new BadRequestException('last_section');
    }

    found.page.sections.splice(found.index, 1);
    const at = Math.min(Math.max(0, dto.toIndex), target.sections.length);
    target.sections.splice(at, 0, found.section);

    await this.persist(companyId, doc, ctx);
    return this.view(companyId, userId);
  }

  async deleteSection(userId: string, companyId: string, sectionId: string) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const doc = this.loadDoc(company.website, ctx);
    const found = this.findSection(doc, sectionId);
    if (!found) throw new NotFoundException('section_not_found');
    if (found.page.system) throw new BadRequestException('system_page_locked');
    if (found.page.sections.length <= 1) throw new BadRequestException('last_section');
    found.page.sections.splice(found.index, 1);

    await this.persist(companyId, doc, ctx);
    return this.view(companyId, userId);
  }

  async patchTheme(userId: string, companyId: string, dto: PatchThemeDto) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const doc = this.loadDoc(company.website, ctx);
    // Only merge the keys the client actually sent (a DTO instance can carry
    // `undefined` own-props for unset optional fields under useDefineForClassFields).
    const sent = Object.fromEntries(
      Object.entries(dto as Record<string, unknown>).filter(([, v]) => v !== undefined),
    );
    // A granular tweak (no `preset` in the patch) detaches from the named bundle;
    // `applyPreset` always sends `preset` so it survives.
    const merged: Record<string, unknown> = { ...doc.theme, ...sent };
    if (!('preset' in sent)) delete merged.preset;
    if ('logoUrl' in sent && !String(sent.logoUrl).trim()) delete merged.logoUrl;
    doc.theme = normalizeTheme(merged);

    await this.persist(companyId, doc, ctx);
    return this.view(companyId, userId);
  }

  /**
   * Save the whole working doc from the studio (the studio no longer autosaves).
   * The body is untrusted — `normalizeDoc` + `assertDocClean` in `persist` clamp
   * and moderate it. Server-authoritative fields (`ai` budget, undo `history`)
   * are carried over from the stored doc, never taken from the client.
   */
  async saveDoc(userId: string, companyId: string, dto: SaveDocDto) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const current = this.loadDoc(company.website, ctx);
    const incoming = normalizeDoc(dto.doc, ctx);
    incoming.ai = current.ai;
    incoming.history = current.history;
    await this.persist(companyId, incoming, ctx);
    return this.view(companyId, userId);
  }

  async addAsset(userId: string, companyId: string, dto: BuilderAddAssetDto) {
    await this.loadEditable(companyId, userId);
    return this.assets.addCompanyAsset(companyId, dto.dataUri, dto.kind);
  }

  /** Update the site navbar / footer settings. */
  async patchChrome(userId: string, companyId: string, dto: PatchChromeDto) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const doc = this.loadDoc(company.website, ctx);
    if (dto.nav !== undefined) doc.nav = normalizeNav({ ...doc.nav, ...dto.nav });
    if (dto.footer !== undefined) doc.footer = normalizeFooter({ ...doc.footer, ...dto.footer });
    await this.persist(companyId, doc, ctx);
    return this.view(companyId, userId);
  }

  // --- AI: generate from a prompt --------------------------------------

  /** Replace the whole site from a free-text brief. Keeps an undo snapshot. */
  async aiPlan(userId: string, companyId: string, dto: AiPlanDto) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const doc = this.loadDoc(company.website, ctx);

    const spent = doc.ai?.planCount ?? 0;
    if (spent >= AI_PLAN_CAP) throw new BadRequestException('ai_plan_limit');
    const brief = dto.brief.trim();
    assertClean(brief);

    // A follow-up prompt EVOLVES the current site (keeps what works, applies the
    // request on top) instead of rebuilding it. First prompt → build from scratch.
    const improve = dto.mode === 'replace' ? false : spent > 0 && doc.pages.some((p) => !p.system);

    // On a fresh (non-improve) plan the brief is the owner telling us exactly
    // what to build. Stored category/description/services from an earlier easy
    // setup — or from a different initial advanced category — must NOT override
    // it, so drop them for this generation. (Follow-up prompts keep continuity.)
    const genCtx: SeedCtx = improve ? ctx : { ...ctx, businessType: '', services: [] };

    let planned: BuilderDoc;
    let notes: string[];
    // Structural fingerprints of this company's recent generations — the pipeline
    // re-rolls the seed if a fresh structure repeats one of them.
    const recentFingerprints =
      (doc.ai as { fingerprints?: string[] } | undefined)?.fingerprints ?? [];
    let fingerprints = recentFingerprints;

    if (improve) {
      ({ planned, notes } = await this.aiImprove(doc, brief, genCtx));
    } else {
      // Fresh generation → the business-aware design pipeline. It runs the full
      // chain (analysis → direction + DNA hints → IA → DNA + recipe → copy →
      // compose → VERIFY → FIX) with a deterministic fallback at every stage. Any
      // problems the model introduced are corrected inside `generateSite`; the
      // studio is never handed a list of generation issues to resolve.
      // Pass the seed through ONLY when the caller set one explicitly (the
      // "generate another variant" button). Otherwise let `generateSite` derive
      // its own stable default AND run the anti-collision re-roll off
      // `recentFingerprints` so a plain re-generate lands on a new layout.
      const gen = await generateSite(this.ai, {
        brief,
        ctx: genCtx,
        ...(typeof dto.seed === 'number' ? { seed: dto.seed } : {}),
        recentFingerprints,
        images: this.imageSearch,
        ...(this.visualQa.enabled && this.visualQa.screenshotUrl
          ? { visualQa: this.visualQa }
          : {}),
      });
      planned = gen.doc;
      notes = sanitizeAiPlan(planned, ctx);
      fingerprints = [gen.fingerprint.hash, ...recentFingerprints].slice(0, 5);
    }

    planned.mode = 'ai';
    planned.ai = {
      brief,
      planCount: spent + 1,
      sectionCount: doc.ai?.sectionCount ?? 0,
      ...(notes.length ? { notes } : {}),
      ...(fingerprints.length ? { fingerprints } : {}),
    };
    planned.history = [...(doc.history ?? []).slice(-2), doc.pages];

    await this.persist(companyId, planned, ctx);
    return this.view(companyId, userId);
  }

  /**
   * Follow-up prompt: evolve the existing site (keep sections that still fit by
   * id, apply the brief on top). Never rebuilds. Uses the legacy structure call
   * which handles `current` / partial edits well.
   */
  private async aiImprove(doc: BuilderDoc, brief: string, genCtx: SeedCtx) {
    const current = {
      theme: doc.theme as unknown as Record<string, unknown>,
      pages: doc.pages
        .filter((p) => !p.system)
        .map((p) => ({
          title: p.title,
          slug: p.slug,
          sections: p.sections.map((s) => ({ id: s.id, type: s.type, variant: s.variant })),
        })),
    };
    const archetype = classifyArchetype(brief, genCtx.businessType, genCtx.services);
    const raw = await this.ai.planWebsite({
      brief,
      business: {
        name: genCtx.businessName,
        type: genCtx.businessType || undefined,
        city: genCtx.city || undefined,
        services: genCtx.services,
      },
      locale: genCtx.locale,
      catalogText: catalogPromptText(),
      archetype,
      skeletonExample: skeletonExampleJson(pickSkeleton(archetype, hashInt(`${brief}`))),
      variantHints: variantHintText(),
      current,
    });
    if (!raw || !Array.isArray(raw.pages) || !raw.pages.length) {
      throw new BadRequestException('ai_unavailable');
    }
    const planned = normalizeDoc(
      {
        v: 2,
        mode: 'ai',
        theme: raw.theme ?? doc.theme,
        pages: raw.pages,
        nav: doc.nav,
        footer: doc.footer,
      },
      genCtx,
    );
    // Restore the copy of every section the planner chose to keep (by id).
    const oldById = new Map(doc.pages.flatMap((p) => p.sections).map((s) => [s.id, s.content]));
    for (const p of planned.pages) {
      for (const s of p.sections) {
        const kept = oldById.get(s.id);
        if (kept && Object.keys(s.content ?? {}).length === 0) s.content = kept;
      }
    }
    const seededCount = seedFillEmptySections(planned, genCtx);
    fillDocImages(planned, genCtx, brief, { keepExisting: true });
    await verifyDocImages(planned, genCtx, brief);

    const notes = sanitizeAiPlan(planned, genCtx);
    if (seededCount > 0 && !notes.includes('seeded')) notes.push('seeded');
    return { planned, notes };
  }

  /** Roll back the most recent AI plan replace. */
  async aiUndo(userId: string, companyId: string) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const doc = this.loadDoc(company.website, ctx);
    const prev = doc.history?.pop();
    if (!prev) throw new BadRequestException('nothing_to_undo');
    doc.pages = prev;

    await this.persist(companyId, doc, ctx);
    return this.view(companyId, userId);
  }

  /** Rewrite one section's content from an instruction. */
  async aiSection(userId: string, companyId: string, sectionId: string, dto: AiSectionDto) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const doc = this.loadDoc(company.website, ctx);
    const found = this.findSection(doc, sectionId);
    if (!found) throw new NotFoundException('section_not_found');

    const spent = doc.ai?.sectionCount ?? 0;
    if (spent >= AI_SECTION_CAP) throw new BadRequestException('ai_section_limit');
    const instruction = dto.instruction.trim();
    assertClean(instruction);

    const spec = SECTION_CATALOG[found.section.type];
    const raw = await this.ai.sectionContent({
      type: found.section.type,
      variant: found.section.variant,
      fieldKeys: spec.fields.map((f) => f.key),
      instruction,
      current: found.section.content,
      locale: ctx.locale,
    });
    if (!raw) throw new BadRequestException('ai_unavailable');

    found.section.content = coerceContent(found.section.type, {
      ...found.section.content,
      ...raw,
    });
    doc.ai = {
      brief: doc.ai?.brief,
      planCount: doc.ai?.planCount ?? 0,
      sectionCount: spent + 1,
    };

    await this.persist(companyId, doc, ctx);
    return this.view(companyId, userId);
  }
}
