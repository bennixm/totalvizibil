import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, CompanyRole, Website } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../../ai/ai.service';
import { WebsiteAssetService } from '../assets/website-asset.service';
import { assertClean } from '../drafts/content-filter';
import { easyBlock } from '../drafts/website-draft.view';
import {
  EasyAnswers,
  type EasyPatch,
  StudioLocale,
  composeEasySite,
  fallbackServiceItems,
  mergeEasyPatch,
  templateKey,
} from '../drafts/easy-compose';
import { ServiceItem } from '../website.types';

const CAN_EDIT: CompanyRole[] = [CompanyRole.owner, CompanyRole.manager];
const ASSET_URL_RE = /^\/api\/v1\/website-assets\/[0-9a-fA-F-]{36}$/;
/** AI Services-copy calls allowed per site (mirrors the draft's per-config cap). */
const AI_CALL_CAP = 4;
/** Studio upload kind → the company asset store's kind. */
const KIND_MAP: Record<string, string> = { landing: 'hero', portfolio: 'gallery', logo: 'logo' };

@Injectable()
export class EasySiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: WebsiteAssetService,
    private readonly ai: AiService,
  ) {}

  // --- loading + auth -------------------------------------------------

  private async load(companyId: string, userId: string, needEdit = false): Promise<Website> {
    const member = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId } },
    });
    if (!member || member.status !== 'active') throw new NotFoundException('Company not found');
    if (needEdit && !CAN_EDIT.includes(member.role)) {
      throw new ForbiddenException('Your role cannot edit the website');
    }
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { website: true },
    });
    if (!company.website) throw new NotFoundException('No website');
    if (company.website.mode !== 'easy') throw new BadRequestException('not_a_simple_site');
    if (needEdit && company.deletionScheduledAt) {
      throw new ForbiddenException('company_pending_deletion');
    }
    return company.website;
  }

  private answersOf(w: Website): EasyAnswers {
    return ((w.easyConfig as unknown as EasyAnswers) ?? {}) as EasyAnswers;
  }

  /** Older easy sites (claimed before `easyConfig` existed) — rebuild it once. */
  private async ensureConfig(w: Website): Promise<EasyAnswers> {
    if (w.easyConfig && typeof w.easyConfig === 'object') return this.answersOf(w);
    const a = reconstructEasyConfig(w);
    await this.prisma.website.update({
      where: { id: w.id },
      data: { easyConfig: a as unknown as Prisma.InputJsonValue },
    });
    return a;
  }

  private assetUrl = (url: string | undefined): string | undefined => {
    const v = (url ?? '').trim();
    if (!v) return undefined;
    if (!ASSET_URL_RE.test(v)) throw new BadRequestException('bad_asset_url');
    return v;
  };

  private view(w: Website, a: EasyAnswers) {
    return {
      easy: easyBlock(a),
      theme: (w.theme as unknown) ?? null,
      content: (w.content as unknown) ?? null,
      status: w.status,
    };
  }

  private async recompose(w: Website, a: EasyAnswers) {
    const g = composeEasySite(a);
    const updated = await this.prisma.website.update({
      where: { id: w.id },
      data: {
        theme: g.theme as unknown as Prisma.InputJsonValue,
        content: g.content as unknown as Prisma.InputJsonValue,
        generator: g.generator,
        easyConfig: a as unknown as Prisma.InputJsonValue,
      },
    });
    return this.view(updated, a);
  }

  // --- API ---------------------------------------------------------

  async get(companyId: string, userId: string) {
    const w = await this.load(companyId, userId);
    const a = await this.ensureConfig(w);
    return this.view(w, a);
  }

  async patch(companyId: string, userId: string, patch: EasyPatch) {
    const w = await this.load(companyId, userId, true);
    const a = await this.ensureConfig(w);

    assertClean(
      patch.landingTitle,
      patch.landingSubtitle,
      patch.about,
      patch.ctaHeadline,
      patch.ctaButton,
      patch.hours,
      patch.navCtaLabel,
      patch.footerTagline,
      ...(patch.whyUs ?? []),
      ...(patch.services ?? []).flatMap((s) => [s.name, s.description]),
      ...(patch.testimonials ?? []).flatMap((tt) => [tt.quote, tt.author ?? '']),
      ...(patch.faq ?? []).flatMap((q) => [q.q, q.a]),
      ...(patch.stats ?? []).flatMap((s) => [s.value, s.label]),
      ...(patch.process ?? []).flatMap((s) => [s.title, s.text ?? '']),
      ...(patch.footerSocials ?? []).map((s) => s.label),
    );

    mergeEasyPatch(a, patch, {
      assetUrl: this.assetUrl,
      onBadColor: () => {
        throw new BadRequestException('bad_color');
      },
    });
    return this.recompose(w, a);
  }

  async regenerateServices(companyId: string, userId: string, names: string[]) {
    const w = await this.load(companyId, userId, true);
    const a = await this.ensureConfig(w);
    assertClean(...names);

    const clean = names
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 12);
    a.serviceNames = clean;
    if (clean.length && !a.businessType) a.businessType = clean.slice(0, 3).join(', ');

    const locale: StudioLocale = a.locale ?? 'ro';
    let items: ServiceItem[] | null = null;
    const spent = a.aiCalls ?? 0;
    if (clean.length && spent < AI_CALL_CAP) {
      items = await this.ai.serviceCopy({
        companyName: a.companyName ?? '',
        businessType: a.businessType,
        city: a.city,
        services: clean,
        locale,
      });
      a.aiCalls = spent + 1;
    }
    a.services = items ?? (clean.length ? fallbackServiceItems(clean, locale) : []);
    return this.recompose(w, a);
  }

  async addAsset(
    companyId: string,
    userId: string,
    dataUri: string,
    kind: string,
  ): Promise<{ id: string; url: string }> {
    await this.load(companyId, userId, true);
    const mapped = KIND_MAP[kind];
    if (!mapped) throw new BadRequestException('bad_kind');
    return this.assets.addCompanyAsset(companyId, dataUri, mapped);
  }
}

// --- legacy reconstruction ------------------------------------------

type RawSection = Record<string, unknown> & { type?: string };

/** Best-effort `EasyAnswers` from an already-composed easy `Website`. Runs once. */
function reconstructEasyConfig(w: Website): EasyAnswers {
  const content = (w.content ?? {}) as {
    pages?: { sections?: RawSection[] }[];
    nav?: { logo?: string; cta?: { label?: string; target?: string } | null };
    footer?: {
      tagline?: string;
      showContact?: boolean;
      socials?: { label?: string; url?: string }[];
    };
  };
  const theme = (w.theme ?? {}) as { accent?: string };
  const sections = content.pages?.[0]?.sections ?? [];
  const byType = (t: string): RawSection | undefined => sections.find((s) => s.type === t);
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const arr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

  const hero = byType('hero');
  const about = byType('about');
  const services = byType('services');
  const stats = byType('stats');
  const process = byType('process');
  const features = byType('features');
  const gallery = byType('gallery');
  const testimonials = byType('testimonials');
  const faq = byType('faq');
  const cta = byType('cta');
  const contact = byType('contact');

  const tplMatch = /easy-template-v3:(classic|bold|minimal)/.exec(w.generator ?? '');

  return {
    companyName: str(hero?.headline),
    landingTitle: str(hero?.headline),
    landingSubtitle: str(hero?.subheadline),
    landingImage: str(hero?.backgroundImage),
    accentColor: /^#[0-9a-f]{6}$/i.test(theme.accent ?? '') ? theme.accent : undefined,
    services: arr(services?.items).map((s) => ({
      name: String(s.name ?? '').slice(0, 80),
      description: String(s.description ?? '').slice(0, 300),
    })),
    portfolio: arr(gallery?.items)
      .map((g) => str(g.imageUrl))
      .filter((u): u is string => !!u),
    phone: str(contact?.phone),
    email: str(contact?.email),
    city: str(contact?.city),
    hours: str(contact?.hours),
    about: str(about?.body),
    showAbout: !!about,
    stats: arr(stats?.items).map((s) => ({
      value: String(s.value ?? '').slice(0, 24),
      label: String(s.label ?? '').slice(0, 60),
    })),
    showStats: !!stats,
    whyUs: arr(features?.items)
      .map((f) => str(f.title))
      .filter((t): t is string => !!t),
    showWhyUs: !!features,
    process: arr(process?.items).map((p) => ({
      title: String(p.title ?? '').slice(0, 80),
      text: str(p.text),
    })),
    showProcess: !!process,
    testimonials: arr(testimonials?.items).map((t) => ({
      quote: String(t.quote ?? '').slice(0, 400),
      author: str(t.author),
    })),
    faq: arr(faq?.items).map((q) => ({
      q: String(q.q ?? '').slice(0, 160),
      a: String(q.a ?? '').slice(0, 600),
    })),
    ctaHeadline: str(cta?.headline),
    ctaButton: str(cta?.buttonLabel),
    showCta: !!cta,
    navShowLogo: content.nav?.logo !== 'hide',
    navCtaLabel: str(content.nav?.cta?.label),
    navCtaTarget: str(content.nav?.cta?.target),
    footerTagline: str(content.footer?.tagline),
    footerShowContact: content.footer?.showContact !== false,
    footerSocials: arr(content.footer?.socials)
      .map((s) => ({
        label: String(s.label ?? '').slice(0, 40),
        url: String(s.url ?? '').slice(0, 200),
      }))
      .filter((s) => s.label && s.url),
    template: templateKey(tplMatch?.[1]),
  };
}
