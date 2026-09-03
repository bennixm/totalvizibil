import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DeepseekService } from '../../ai/deepseek.service';
import { ServiceItem } from '../website.types';
import {
  EasyStep,
  FREE_MAX_TURNS,
  TranscriptTurn,
  advanceEasy,
  openingTranscript,
} from './website-draft.script';
import {
  EasyAnswers,
  EasyFaq,
  EasyProcessStep,
  EasyStat,
  EasyTestimonial,
  StudioLocale,
  composeEasySite,
  fallbackServiceItems,
} from './easy-compose';
import { assertClean } from './content-filter';
import { toDraftView, WebsiteDraftView } from './website-draft.view';

/** Anonymous drafts live for a week before they are considered abandoned. */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Real DeepSeek calls allowed per draft (initial write + a few regenerations). */
const AI_CALL_CAP = 4;

/** AI grammar-fix calls allowed per draft. */
const PROOFREAD_CAP = 40;

/** Max decoded size for an uploaded Simple-site image. */
const MAX_ASSET_BYTES = 4_500_000;

const ASSET_URL_RE = /^\/api\/v1\/website-assets\/[0-9a-fA-F-]{36}$/;
const DATA_URI_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;

/** Fields the studio widgets can patch without spending a chat turn. */
export interface EasyPatch {
  accentColor?: string;
  landingTitle?: string;
  landingSubtitle?: string;
  landingImage?: string;
  portfolio?: string[];
  services?: { name: string; description: string }[];
  phone?: string;
  email?: string;
  city?: string;
  about?: string;
  showAbout?: boolean;
  stats?: EasyStat[];
  showStats?: boolean;
  whyUs?: string[];
  showWhyUs?: boolean;
  process?: EasyProcessStep[];
  showProcess?: boolean;
  testimonials?: EasyTestimonial[];
  faq?: EasyFaq[];
  ctaHeadline?: string;
  ctaButton?: string;
  showCta?: boolean;
  hours?: string;
  template?: 'classic' | 'bold' | 'minimal';
  autoGrammar?: boolean;
  locale?: StudioLocale;
}

@Injectable()
export class WebsiteDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deepseek: DeepseekService,
  ) {}

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private static assetUrl(url: string | undefined): string | undefined {
    const v = (url ?? '').trim();
    if (!v) return undefined;
    if (!ASSET_URL_RE.test(v)) throw new BadRequestException('bad_asset_url');
    return v;
  }

  /**
   * Start a fresh draft. The raw token is returned once and never stored.
   * `input.mode` picks the plan (`advanced` for the paid builder); an optional
   * `seed` pre-fills the company name so a starter one-pager exists immediately.
   */
  async create(
    input: {
      mode?: 'easy' | 'advanced';
      seed?: { businessName: string };
      locale?: StudioLocale;
    } = {},
  ): Promise<{ id: string; token: string; draft: WebsiteDraftView }> {
    const token = randomBytes(32).toString('base64url');
    const advanced = input.mode === 'advanced';
    const locale: StudioLocale = input.locale ?? 'ro';

    const answers: EasyAnswers = { locale };
    if (input.seed?.businessName) {
      answers.companyName = input.seed.businessName.trim().slice(0, 80);
    }

    // Compose a starter site up front so the studio preview is never blank —
    // the template picker (first step) then updates it live.
    const g = composeEasySite(answers);
    const data: Prisma.WebsiteDraftCreateInput = {
      tokenHash: WebsiteDraftService.hash(token),
      mode: advanced ? 'advanced' : 'easy',
      plan: advanced ? 'advanced' : 'free',
      // The advanced flow drives its own script post-claim; a seeded advanced
      // draft is "done" so the easy studio doesn't try to walk it.
      step: input.seed?.businessName && advanced ? 'done' : 'template',
      status: 'ready',
      answers: answers as unknown as Prisma.InputJsonValue,
      transcript: openingTranscript() as unknown as Prisma.InputJsonValue,
      theme: g.theme as unknown as Prisma.InputJsonValue,
      content: g.content as unknown as Prisma.InputJsonValue,
      generator: g.generator,
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
    };

    const draft = await this.prisma.websiteDraft.create({ data });
    return { id: draft.id, token, draft: toDraftView(draft) };
  }

  async get(id: string, token: string): Promise<WebsiteDraftView> {
    return toDraftView(await this.load(id, token));
  }

  // --- helpers -----------------------------------------------------------

  private answersOf(draft: { answers: Prisma.JsonValue }): EasyAnswers {
    return ((draft.answers as unknown as EasyAnswers) ?? {}) as EasyAnswers;
  }

  private composeInto(
    a: EasyAnswers,
  ): Pick<Prisma.WebsiteDraftUpdateInput, 'theme' | 'content' | 'generator'> {
    const g = composeEasySite(a);
    return {
      theme: g.theme as unknown as Prisma.InputJsonValue,
      content: g.content as unknown as Prisma.InputJsonValue,
      generator: g.generator,
    };
  }

  /** Run the single DeepSeek call (capped per draft), else deterministic copy. */
  private async writeServiceCopy(a: EasyAnswers, names: string[]): Promise<ServiceItem[]> {
    const clean = names
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (clean.length === 0) return [];
    const locale = a.locale ?? 'ro';
    const spent = a.aiCalls ?? 0;

    let items: ServiceItem[] | null = null;
    if (spent < AI_CALL_CAP) {
      items = await this.deepseek.serviceCopy({
        companyName: a.companyName ?? '',
        businessType: a.businessType,
        city: a.city,
        services: clean,
        locale,
      });
      a.aiCalls = spent + 1;
    }
    return items ?? fallbackServiceItems(clean, locale);
  }

  // --- guided chat -----------------------------------------------------

  /** Process one visitor message: advance the guide, run AI if due, re-compose. */
  async sendMessage(id: string, token: string, rawText: string): Promise<WebsiteDraftView> {
    const draft = await this.load(id, token);

    const text = rawText.trim();
    if (!text) throw new BadRequestException('Message is empty');
    assertClean(text);
    if (draft.turnsUsed >= FREE_MAX_TURNS) {
      throw new ForbiddenException('free_plan_turn_limit');
    }

    const answers = this.answersOf(draft);
    const transcript = ((draft.transcript as unknown as TranscriptTurn[]) ?? []).slice();
    const at = new Date().toISOString();

    const result = advanceEasy(draft.step as EasyStep, answers, text);

    transcript.push({ role: 'user', text: text.slice(0, 2000), at });
    for (const key of result.assistant) transcript.push({ role: 'assistant', key, at });

    if (result.generateServicesFor?.length) {
      result.answers.services = await this.writeServiceCopy(
        result.answers,
        result.generateServicesFor,
      );
    }

    const turnsUsed = draft.turnsUsed + 1;
    if (turnsUsed >= FREE_MAX_TURNS && result.step !== 'done') {
      transcript.push({ role: 'assistant', key: 'cap', at });
    }

    const updated = await this.prisma.websiteDraft.update({
      where: { id: draft.id },
      data: {
        step: result.step,
        answers: result.answers as unknown as Prisma.InputJsonValue,
        transcript: transcript as unknown as Prisma.InputJsonValue,
        turnsUsed,
        status: 'ready',
        ...(result.regenerate ? this.composeInto(result.answers) : {}),
      },
    });
    return toDraftView(updated);
  }

  /** Advance a widget step (colour / portfolio) from the studio's "Continue". */
  async advanceStep(id: string, token: string): Promise<WebsiteDraftView> {
    const draft = await this.load(id, token);
    if (draft.mode !== 'easy') throw new BadRequestException('not_a_simple_site');

    const answers = this.answersOf(draft);
    const transcript = ((draft.transcript as unknown as TranscriptTurn[]) ?? []).slice();
    const at = new Date().toISOString();

    const result = advanceEasy(draft.step as EasyStep, answers);
    for (const key of result.assistant) transcript.push({ role: 'assistant', key, at });

    if (result.generateServicesFor?.length) {
      result.answers.services = await this.writeServiceCopy(
        result.answers,
        result.generateServicesFor,
      );
    }

    const updated = await this.prisma.websiteDraft.update({
      where: { id: draft.id },
      data: {
        step: result.step,
        answers: result.answers as unknown as Prisma.InputJsonValue,
        transcript: transcript as unknown as Prisma.InputJsonValue,
        status: 'ready',
        ...(result.regenerate ? this.composeInto(result.answers) : {}),
      },
    });
    return toDraftView(updated);
  }

  /** Patch config fields from the studio widgets — no chat turn, live re-compose. */
  async patchEasy(id: string, token: string, patch: EasyPatch): Promise<WebsiteDraftView> {
    const draft = await this.load(id, token);
    if (draft.mode !== 'easy') throw new BadRequestException('not_a_simple_site');

    // Reject sexual / hateful / threatening wording on any editable text field.
    assertClean(
      patch.landingTitle,
      patch.landingSubtitle,
      patch.about,
      patch.ctaHeadline,
      patch.ctaButton,
      patch.hours,
      ...(patch.whyUs ?? []),
      ...(patch.services ?? []).flatMap((s) => [s.name, s.description]),
      ...(patch.testimonials ?? []).flatMap((tt) => [tt.quote, tt.author ?? '']),
      ...(patch.faq ?? []).flatMap((q) => [q.q, q.a]),
      ...(patch.stats ?? []).flatMap((s) => [s.value, s.label]),
      ...(patch.process ?? []).flatMap((s) => [s.title, s.text ?? '']),
    );

    const a = this.answersOf(draft);

    if (patch.accentColor !== undefined) {
      const c = patch.accentColor.trim();
      if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) throw new BadRequestException('bad_color');
      a.accentColor = c || undefined;
    }
    if (patch.landingTitle !== undefined)
      a.landingTitle = patch.landingTitle.slice(0, 120) || undefined;
    if (patch.landingSubtitle !== undefined) {
      a.landingSubtitle = patch.landingSubtitle.slice(0, 160) || undefined;
    }
    if (patch.landingImage !== undefined)
      a.landingImage = WebsiteDraftService.assetUrl(patch.landingImage);
    if (patch.portfolio !== undefined) {
      a.portfolio = patch.portfolio
        .map((u) => WebsiteDraftService.assetUrl(u))
        .filter((u): u is string => !!u)
        .slice(0, 10);
    }
    if (patch.services !== undefined) {
      a.services = patch.services.slice(0, 12).map((s) => ({
        name: String(s.name ?? '').slice(0, 80),
        description: String(s.description ?? '').slice(0, 300),
      }));
    }
    if (patch.phone !== undefined) a.phone = patch.phone.slice(0, 40) || undefined;
    if (patch.email !== undefined) a.email = patch.email.slice(0, 120) || undefined;
    if (patch.city !== undefined) a.city = patch.city.slice(0, 80) || undefined;

    if (patch.about !== undefined) a.about = patch.about.slice(0, 900) || undefined;
    if (patch.showAbout !== undefined) a.showAbout = patch.showAbout;
    if (patch.stats !== undefined) {
      a.stats = patch.stats
        .map((s) => ({
          value: String(s.value ?? '').slice(0, 24),
          label: String(s.label ?? '').slice(0, 60),
        }))
        .filter((s) => s.value.trim() && s.label.trim())
        .slice(0, 4);
    }
    if (patch.showStats !== undefined) a.showStats = patch.showStats;
    if (patch.whyUs !== undefined) {
      a.whyUs = patch.whyUs
        .map((s) => String(s ?? '').slice(0, 90))
        .filter((s) => s.trim())
        .slice(0, 6);
    }
    if (patch.showWhyUs !== undefined) a.showWhyUs = patch.showWhyUs;
    if (patch.process !== undefined) {
      a.process = patch.process
        .map((s) => ({
          title: String(s.title ?? '').slice(0, 80),
          text: String(s.text ?? '').slice(0, 200) || undefined,
        }))
        .filter((s) => s.title.trim())
        .slice(0, 6);
    }
    if (patch.showProcess !== undefined) a.showProcess = patch.showProcess;
    if (patch.testimonials !== undefined) {
      a.testimonials = patch.testimonials
        .map((tt) => ({
          quote: String(tt.quote ?? '').slice(0, 400),
          author: String(tt.author ?? '').slice(0, 80),
        }))
        .filter((tt) => tt.quote.trim())
        .slice(0, 8);
    }
    if (patch.faq !== undefined) {
      a.faq = patch.faq
        .map((q) => ({ q: String(q.q ?? '').slice(0, 160), a: String(q.a ?? '').slice(0, 600) }))
        .filter((q) => q.q.trim() && q.a.trim())
        .slice(0, 10);
    }
    if (patch.ctaHeadline !== undefined)
      a.ctaHeadline = patch.ctaHeadline.slice(0, 120) || undefined;
    if (patch.ctaButton !== undefined) a.ctaButton = patch.ctaButton.slice(0, 40) || undefined;
    if (patch.showCta !== undefined) a.showCta = patch.showCta;
    if (patch.hours !== undefined) a.hours = patch.hours.slice(0, 120) || undefined;
    if (patch.template !== undefined) {
      a.template = ['classic', 'bold', 'minimal'].includes(patch.template)
        ? patch.template
        : 'classic';
    }
    if (patch.autoGrammar !== undefined) a.autoGrammar = patch.autoGrammar;

    if (patch.locale !== undefined) a.locale = patch.locale;

    const updated = await this.prisma.websiteDraft.update({
      where: { id: draft.id },
      data: {
        answers: a as unknown as Prisma.InputJsonValue,
        status: 'ready',
        ...this.composeInto(a),
      },
    });
    return toDraftView(updated);
  }

  /** Re-run the Services copy for a new/edited list of names (capped per draft). */
  async regenerateServices(id: string, token: string, names: string[]): Promise<WebsiteDraftView> {
    const draft = await this.load(id, token);
    if (draft.mode !== 'easy') throw new BadRequestException('not_a_simple_site');

    assertClean(...names);
    const a = this.answersOf(draft);
    const clean = names
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 12);
    a.serviceNames = clean;
    if (clean.length && !a.businessType) a.businessType = clean.slice(0, 3).join(', ');
    a.services = await this.writeServiceCopy(a, clean);

    const updated = await this.prisma.websiteDraft.update({
      where: { id: draft.id },
      data: {
        answers: a as unknown as Prisma.InputJsonValue,
        status: 'ready',
        ...this.composeInto(a),
      },
    });
    return toDraftView(updated);
  }

  /**
   * Fix a manual prose string. Always applies a deterministic tidy (spacing,
   * capitalisation, terminal punctuation); when a DeepSeek key is set and the
   * per-draft budget allows, also runs an AI grammar pass. Never throws.
   */
  async proofread(id: string, token: string, raw: string): Promise<{ text: string }> {
    const draft = await this.load(id, token);
    if (draft.mode !== 'easy') throw new BadRequestException('not_a_simple_site');
    assertClean(raw);

    const a = this.answersOf(draft);
    const tidy = WebsiteDraftService.tidyProse(raw);
    if (!tidy) return { text: '' };

    const spent = a.proofreadCount ?? 0;
    if (spent >= PROOFREAD_CAP) return { text: tidy };

    const fixed = await this.deepseek.proofread(tidy, a.locale ?? 'ro');
    if (fixed) {
      a.proofreadCount = spent + 1;
      await this.prisma.websiteDraft.update({
        where: { id: draft.id },
        data: { answers: a as unknown as Prisma.InputJsonValue },
      });
      return { text: WebsiteDraftService.tidyProse(fixed) || tidy };
    }
    return { text: tidy };
  }

  private static tidyProse(v: string): string {
    let s = (v ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/([,;:])(?=[^\s\d])/g, '$1 ')
      .replace(/([.!?])(?=[A-Za-zĂÂÎȘȚăâîșț])/g, '$1 ')
      .trim();
    if (!s) return '';
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (s.length > 12 && !/[.!?…]$/.test(s)) s += '.';
    return s.slice(0, 900);
  }

  // --- assets ----------------------------------------------------------

  /** Store a base64 image for the draft; returns its stable URL. */
  async addAsset(
    id: string,
    token: string,
    dataUri: string,
    kind: string,
  ): Promise<{ id: string; url: string }> {
    const draft = await this.load(id, token);
    if (kind !== 'landing' && kind !== 'portfolio') {
      throw new BadRequestException('bad_kind');
    }
    const m = DATA_URI_RE.exec(dataUri.trim());
    if (!m) throw new BadRequestException('bad_image');
    const mime = m[1];
    const bytes = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
    if (bytes.length === 0) throw new BadRequestException('bad_image');
    if (bytes.length > MAX_ASSET_BYTES) throw new BadRequestException('image_too_large');

    if (kind === 'portfolio') {
      const count = await this.prisma.websiteAsset.count({
        where: { draftId: draft.id, kind: 'portfolio' },
      });
      if (count >= 20) throw new BadRequestException('portfolio_full');
    }

    const row = await this.prisma.websiteAsset.create({
      data: { draftId: draft.id, kind, mime, bytes, size: bytes.length },
    });
    return { id: row.id, url: `/api/v1/website-assets/${row.id}` };
  }

  // --- location + claim ----------------------------------------------

  /**
   * Assert a slug is an active category and return it. Accepts either an
   * exact-niche (leaf) subcategory or a whole parent group ("all services in
   * Construction"). The create flow must pin one so the business is filed in
   * the feed.
   */
  async assertCategory(slug: string): Promise<{ id: string; slug: string }> {
    const category = await this.prisma.category.findUnique({ where: { slug } });
    if (!category || !category.isActive) {
      throw new BadRequestException('unknown_category');
    }
    return { id: category.id, slug: category.slug };
  }

  /** Persist the location + category step (M2). Requires the one-pager first. */
  async setLocation(
    id: string,
    token: string,
    input: {
      categorySlug: string;
      city?: string;
      region?: string;
      country?: string;
      lat?: number;
      lng?: number;
      radiusKm?: number;
      nationwide?: boolean;
    },
  ): Promise<WebsiteDraftView> {
    const draft = await this.load(id, token);
    if (draft.content == null) {
      throw new BadRequestException('generate_website_first');
    }
    const category = await this.assertCategory(input.categorySlug);
    const nationwide = !!input.nationwide;

    const updated = await this.prisma.websiteDraft.update({
      where: { id: draft.id },
      data: {
        categorySlug: category.slug,
        // Whole-country coverage carries no city, coordinates or radius.
        locationCity: nationwide ? null : (input.city?.trim() ?? null),
        locationRegion: nationwide ? null : input.region?.trim() || null,
        locationCountry: (input.country || 'RO').toUpperCase().slice(0, 2),
        locationLat: nationwide ? null : (input.lat ?? null),
        locationLng: nationwide ? null : (input.lng ?? null),
        locationRadiusKm: nationwide ? null : Math.round(input.radiusKm ?? 15),
        locationNationwide: nationwide,
      },
    });
    return toDraftView(updated);
  }

  /** Resolve a draft by its opaque token alone (used by the account claim step). */
  async loadByToken(token: string) {
    if (!token) throw new NotFoundException('Draft not found');
    const draft = await this.prisma.websiteDraft.findUnique({
      where: { tokenHash: WebsiteDraftService.hash(token) },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.expiresAt.getTime() < Date.now()) throw new NotFoundException('Draft expired');
    return draft;
  }

  /**
   * Mark a draft as claimed by a company and re-parent its uploaded images.
   * Runs inside the caller's transaction.
   */
  async markClaimed(
    tx: Prisma.TransactionClient,
    draftId: string,
    companyId: string,
  ): Promise<unknown> {
    await tx.websiteAsset.updateMany({ where: { draftId }, data: { companyId } });
    return tx.websiteDraft.update({
      where: { id: draftId },
      data: { status: 'claimed', claimedCompanyId: companyId },
    });
  }

  private async load(id: string, token: string) {
    const draft = await this.loadByToken(token);
    if (draft.id !== id) throw new NotFoundException('Draft not found');
    return draft;
  }
}
