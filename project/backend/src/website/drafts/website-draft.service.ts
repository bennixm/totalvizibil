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
  NO_CHAT_STEPS,
  TranscriptTurn,
  advanceEasy,
  openingTranscript,
} from './website-draft.script';
import {
  EasyAnswers,
  type EasyPatch,
  StudioLocale,
  composeEasySite,
  fallbackServiceItems,
  mergeEasyPatch,
} from './easy-compose';
import { assertClean } from './content-filter';
import { toDraftView, WebsiteDraftView } from './website-draft.view';

/** Anonymous drafts live for a week before they are considered abandoned. */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Real AI copy calls allowed per draft (initial write + a few regenerations). */
const AI_CALL_CAP = 4;

/** End-of-setup AI text-review passes allowed per draft. */
const REVIEW_CAP = 5;

/** One finding from `reviewDraft`, with a human label for the field. */
export interface DraftReviewIssue {
  key: string;
  label: string;
  kind: 'meaning' | 'grammar' | 'profanity' | 'other';
  message: string;
}

/** Field labels for the end-of-setup review, per locale. */
const REVIEW_LABELS: Record<StudioLocale, Record<string, string>> = {
  ro: {
    companyName: 'Nume firmă',
    businessType: 'Domeniu',
    landingTitle: 'Titlu principal',
    landingSubtitle: 'Subtitlu',
    about: 'Despre noi',
    ctaHeadline: 'Îndemn — titlu',
    ctaButton: 'Îndemn — buton',
    hours: 'Program',
    whyUs: 'De ce noi',
    process: 'Pas',
    testimonial: 'Testimonial',
    faq: 'Întrebare',
    stat: 'Cifră',
    service: 'Serviciu',
  },
  en: {
    companyName: 'Business name',
    businessType: 'Field',
    landingTitle: 'Headline',
    landingSubtitle: 'Subheadline',
    about: 'About us',
    ctaHeadline: 'Call to action — headline',
    ctaButton: 'Call to action — button',
    hours: 'Opening hours',
    whyUs: 'Why us',
    process: 'Step',
    testimonial: 'Testimonial',
    faq: 'FAQ',
    stat: 'Stat',
    service: 'Service',
  },
  de: {
    companyName: 'Firmenname',
    businessType: 'Branche',
    landingTitle: 'Überschrift',
    landingSubtitle: 'Unterüberschrift',
    about: 'Über uns',
    ctaHeadline: 'Call-to-Action — Titel',
    ctaButton: 'Call-to-Action — Button',
    hours: 'Öffnungszeiten',
    whyUs: 'Warum wir',
    process: 'Schritt',
    testimonial: 'Testimonial',
    faq: 'FAQ',
    stat: 'Kennzahl',
    service: 'Leistung',
  },
};

/** Max decoded size for an uploaded Simple-site image. */
const MAX_ASSET_BYTES = 4_500_000;

const ASSET_URL_RE = /^\/api\/v1\/website-assets\/[0-9a-fA-F-]{36}$/;
const DATA_URI_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;

export type { EasyPatch };

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
    // Choice / upload steps have no free-text input — the visitor advances them
    // from the widget's "Continue" button (`advanceStep`), not the chat.
    if (NO_CHAT_STEPS.includes(draft.step as EasyStep)) {
      throw new BadRequestException('choose_option');
    }
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

    const a = this.answersOf(draft);
    mergeEasyPatch(a, patch, {
      assetUrl: WebsiteDraftService.assetUrl,
      onBadColor: () => {
        throw new BadRequestException('bad_color');
      },
    });

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
   * End-of-setup review: one AI pass over every text the owner typed. Flags
   * meaning / grammar / vulgar / other problems. `grammar` issues carry a fix
   * that is applied to the draft automatically; the rest are returned for the
   * owner to correct. Never throws — no AI provider ⇒ `{ issues: [] }`.
   */
  async reviewDraft(
    id: string,
    token: string,
  ): Promise<{ issues: DraftReviewIssue[]; draft: WebsiteDraftView }> {
    const draft = await this.load(id, token);
    if (draft.mode !== 'easy') throw new BadRequestException('not_a_simple_site');

    const a = this.answersOf(draft);
    const locale = a.locale ?? 'ro';
    const spent = a.reviewCount ?? 0;
    const items = WebsiteDraftService.reviewItems(a, locale);

    if (spent >= REVIEW_CAP || !items.length) {
      return { issues: [], draft: toDraftView(draft) };
    }

    const found = await this.deepseek.reviewCopy({
      items: items.map(({ key, label, text }) => ({ key, label, text })),
      locale,
    });
    if (!found) return { issues: [], draft: toDraftView(draft) };

    a.reviewCount = spent + 1;
    const labelByKey = new Map(items.map((i) => [i.key, i.label]));

    // Auto-apply grammar fixes; surface the rest.
    let touched = false;
    const issues: DraftReviewIssue[] = [];
    for (const f of found) {
      if (f.kind === 'grammar' && f.fix) {
        if (WebsiteDraftService.applyReviewFix(a, f.key, f.fix)) touched = true;
        continue;
      }
      issues.push({
        key: f.key,
        label: labelByKey.get(f.key) ?? f.key,
        kind: f.kind,
        message: f.message,
      });
    }

    const updated = await this.prisma.websiteDraft.update({
      where: { id: draft.id },
      data: {
        answers: a as unknown as Prisma.InputJsonValue,
        status: 'ready',
        ...(touched ? this.composeInto(a) : {}),
      },
    });
    return { issues, draft: toDraftView(updated) };
  }

  /** Every owner-typed text field, as `{ key, label, text }` for the AI review. */
  private static reviewItems(
    a: EasyAnswers,
    locale: StudioLocale,
  ): { key: string; label: string; text: string }[] {
    const L = REVIEW_LABELS[locale] ?? REVIEW_LABELS.ro;
    const out: { key: string; label: string; text: string }[] = [];
    const push = (key: string, label: string, text: unknown): void => {
      const v = typeof text === 'string' ? text.trim() : '';
      if (v.length >= 2) out.push({ key, label, text: v });
    };
    push('companyName', L.companyName, a.companyName);
    push('businessType', L.businessType, a.businessType);
    push('landingTitle', L.landingTitle, a.landingTitle);
    push('landingSubtitle', L.landingSubtitle, a.landingSubtitle);
    push('about', L.about, a.about);
    push('ctaHeadline', L.ctaHeadline, a.ctaHeadline);
    push('ctaButton', L.ctaButton, a.ctaButton);
    push('hours', L.hours, a.hours);
    (a.whyUs ?? []).forEach((v, i) => push(`whyUs.${i}`, `${L.whyUs} ${i + 1}`, v));
    (a.process ?? []).forEach((s, i) => {
      push(`process.${i}.title`, `${L.process} ${i + 1}`, s?.title);
      push(`process.${i}.text`, `${L.process} ${i + 1}`, s?.text);
    });
    (a.testimonials ?? []).forEach((s, i) =>
      push(`testimonials.${i}.quote`, `${L.testimonial} ${i + 1}`, s?.quote),
    );
    (a.faq ?? []).forEach((s, i) => {
      push(`faq.${i}.q`, `${L.faq} ${i + 1}`, s?.q);
      push(`faq.${i}.a`, `${L.faq} ${i + 1}`, s?.a);
    });
    (a.stats ?? []).forEach((s, i) => push(`stats.${i}.label`, `${L.stat} ${i + 1}`, s?.label));
    (a.services ?? []).forEach((s, i) => {
      push(`services.${i}.name`, `${L.service} ${i + 1}`, s?.name);
      push(`services.${i}.description`, `${L.service} ${i + 1}`, s?.description);
    });
    return out;
  }

  /** Write one grammar-corrected string back into `answers` by its dotted key. */
  private static applyReviewFix(a: EasyAnswers, key: string, fix: string): boolean {
    const v = WebsiteDraftService.tidyProse(fix) || fix.trim();
    if (!v) return false;
    const parts = key.split('.');
    const scalars: Record<string, keyof EasyAnswers> = {
      companyName: 'companyName',
      businessType: 'businessType',
      landingTitle: 'landingTitle',
      landingSubtitle: 'landingSubtitle',
      about: 'about',
      ctaHeadline: 'ctaHeadline',
      ctaButton: 'ctaButton',
      hours: 'hours',
    };
    if (parts.length === 1 && scalars[parts[0]]) {
      (a as Record<string, unknown>)[scalars[parts[0]]] = v.slice(0, 900);
      return true;
    }
    const [group, idxRaw, sub] = parts;
    const idx = Number(idxRaw);
    if (!Number.isInteger(idx) || idx < 0) return false;
    if (group === 'whyUs' && a.whyUs?.[idx] !== undefined) {
      a.whyUs[idx] = v.slice(0, 120);
      return true;
    }
    if (group === 'process' && a.process?.[idx] && (sub === 'title' || sub === 'text')) {
      a.process[idx][sub] = v.slice(0, 200);
      return true;
    }
    if (group === 'testimonials' && a.testimonials?.[idx] && sub === 'quote') {
      a.testimonials[idx].quote = v.slice(0, 400);
      return true;
    }
    if (group === 'faq' && a.faq?.[idx] && (sub === 'q' || sub === 'a')) {
      a.faq[idx][sub] = v.slice(0, 400);
      return true;
    }
    if (group === 'stats' && a.stats?.[idx] && sub === 'label') {
      a.stats[idx].label = v.slice(0, 60);
      return true;
    }
    if (group === 'services' && a.services?.[idx] && (sub === 'name' || sub === 'description')) {
      a.services[idx][sub] = v.slice(0, sub === 'name' ? 80 : 300);
      return true;
    }
    return false;
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
    if (kind !== 'landing' && kind !== 'portfolio' && kind !== 'logo') {
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
