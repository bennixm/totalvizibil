import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompanyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../../wallet/wallet.service';
import { CREDIT_MINOR } from '../../wallet/money';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import { slugify } from '../../common/slug';
import { DeepseekService } from '../../ai/deepseek.service';
import { SectionType } from '../website.types';
import { assertClean } from '../drafts/content-filter';
import { WebsiteAssetService } from '../assets/website-asset.service';
import {
  SECTION_CATALOG,
  SECTION_TYPES,
  SeedCtx,
  catalogForClient,
  coerceContent,
  seedSectionContent,
  snapVariant,
} from './section-catalog';
import {
  BuilderDoc,
  DocSection,
  MAX_PAGES,
  PageSpec,
  composeAdvancedDoc,
  docFromLegacy,
  keywordPlanDoc,
  normalizeDoc,
  normalizeTheme,
  starterAdvancedDoc,
} from './compose-advanced';
import { PutPagesDto } from './dto/put-pages.dto';
import { AddSectionDto } from './dto/add-section.dto';
import { PatchSectionDto } from './dto/patch-section.dto';
import { MoveSectionDto } from './dto/move-section.dto';
import { PatchThemeDto } from './dto/patch-theme.dto';
import { BuilderAddAssetDto } from './dto/add-asset.dto';
import { AiPlanDto } from './dto/ai-plan.dto';
import { AiSectionDto } from './dto/ai-section.dto';

const CAN_EDIT: CompanyRole[] = [CompanyRole.owner, CompanyRole.manager];

/** AI generations allowed per company (bounds cost / abuse). */
const AI_PLAN_CAP = 6;
const AI_SECTION_CAP = 40;

/** One line per section type for the AI planner's system prompt. */
function catalogPromptText(): string {
  return SECTION_TYPES.map((t) => {
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
  }).join('\n');
}

type LoadedCompany = Prisma.CompanyGetPayload<{
  include: { website: true; locations: true; services: true; contacts: true };
}>;

@Injectable()
export class WebsiteBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly settings: PlatformSettingsService,
    private readonly assets: WebsiteAssetService,
    private readonly deepseek: DeepseekService,
  ) {}

  // --- loading / context ------------------------------------------------

  private async load(
    companyId: string,
    userId: string,
    needEdit = false,
    requireAdvanced = true,
  ): Promise<LoadedCompany> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') throw new NotFoundException('Company not found');
    if (needEdit && !CAN_EDIT.includes(member.role)) {
      throw new ForbiddenException('Your role cannot edit the website');
    }
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { website: true, locations: true, services: true, contacts: true },
    });
    if (!company.website) throw new NotFoundException('No website');
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
  }

  // --- view ----------------------------------------------------------

  private async view(companyId: string, userId: string) {
    const company = await this.load(companyId, userId, false, false);
    const w = company.website!;
    const ctx = this.seedCtx(company);
    const [price, walletSummary] = await Promise.all([
      this.settings.advancedBuilderPriceCredits(),
      this.wallet.getSummary(company.ownerUserId),
    ]);
    const unlocked = company.advancedUnlockedAt != null && w.mode === 'advanced';

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
      aiConfigured: this.deepseek.configured,
      catalog: unlocked ? catalogForClient() : null,
    };
  }

  get(userId: string, companyId: string) {
    return this.view(companyId, userId);
  }

  // --- unlock (unchanged fee logic; seeds a real starter doc) ---------

  async unlock(userId: string, companyId: string) {
    const company = await this.load(companyId, userId, true, false);
    const w = company.website!;
    if (
      company.advancedUnlockedAt &&
      w.mode === 'advanced' &&
      (w.builderSpec as { v?: number })?.v === 2
    ) {
      return this.view(companyId, userId);
    }

    if (!company.advancedUnlockedAt) {
      const price = await this.settings.advancedBuilderPriceCredits();
      await this.wallet.spend(company.ownerUserId, price * CREDIT_MINOR, {
        description: 'Advanced website builder',
        companyId,
      });
    }

    await this.prisma.company.update({
      where: { id: companyId },
      data: { advancedUnlockedAt: company.advancedUnlockedAt ?? new Date() },
    });

    // Seed the 3-page starter site unless a v2 builder doc already exists.
    const ctx = this.seedCtx(company);
    const doc =
      (w.builderSpec as { v?: number })?.v === 2 ? this.loadDoc(w, ctx) : starterAdvancedDoc(ctx);
    const g = composeAdvancedDoc(doc, ctx);
    await this.prisma.website.update({
      where: { companyId },
      data: {
        mode: 'advanced',
        builderSpec: doc as unknown as Prisma.InputJsonValue,
        content: g.content as unknown as Prisma.InputJsonValue,
        theme: g.theme as unknown as Prisma.InputJsonValue,
        generator: g.generator,
      },
    });

    return this.view(companyId, userId);
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

    let pages: PageSpec[] = dto.pages.slice(0, MAX_PAGES).map((p, i) => {
      const existing = p.id ? byId.get(p.id) : undefined;
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
    if (!pages.length) pages = starterAdvancedDoc(ctx).pages;

    const homeIdx = dto.pages.findIndex((p) => p.isHome);
    pages.forEach(
      (p, i) => (p.isHome = i === (homeIdx >= 0 && homeIdx < pages.length ? homeIdx : 0)),
    );

    doc.pages = pages;
    await this.persist(companyId, doc, ctx);
    return this.view(companyId, userId);
  }

  async addSection(userId: string, companyId: string, pageId: string, dto: AddSectionDto) {
    const company = await this.loadEditable(companyId, userId);
    const ctx = this.seedCtx(company);
    const doc = this.loadDoc(company.website, ctx);
    const page = doc.pages.find((p) => p.id === pageId);
    if (!page) throw new NotFoundException('page_not_found');
    if (!(dto.type in SECTION_CATALOG)) throw new BadRequestException('unknown_section_type');

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
    if (dto.visible !== undefined) found.section.visible = dto.visible;
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
    doc.theme = normalizeTheme(merged);

    await this.persist(companyId, doc, ctx);
    return this.view(companyId, userId);
  }

  async addAsset(userId: string, companyId: string, dto: BuilderAddAssetDto) {
    await this.loadEditable(companyId, userId);
    return this.assets.addCompanyAsset(companyId, dto.dataUri, dto.kind);
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

    const raw = await this.deepseek.planWebsite({
      brief,
      business: {
        name: ctx.businessName,
        type: ctx.businessType || undefined,
        city: ctx.city || undefined,
        services: ctx.services,
      },
      locale: ctx.locale,
      catalogText: catalogPromptText(),
    });

    const planned =
      raw && Array.isArray(raw.pages) && raw.pages.length
        ? normalizeDoc({ v: 2, mode: 'ai', theme: raw.theme ?? doc.theme, pages: raw.pages }, ctx)
        : keywordPlanDoc(brief, ctx);

    planned.mode = 'ai';
    planned.ai = {
      brief,
      planCount: spent + 1,
      sectionCount: doc.ai?.sectionCount ?? 0,
    };
    planned.history = [...(doc.history ?? []).slice(-2), doc.pages];

    await this.persist(companyId, planned, ctx);
    return this.view(companyId, userId);
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
    const raw = await this.deepseek.sectionContent({
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
