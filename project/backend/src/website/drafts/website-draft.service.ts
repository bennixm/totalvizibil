import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService, ParsedIntro } from '../../ai/ai.service';
import { resolveLocationInput } from '../../geo/ro-cities';
import { WebsiteAssetService } from '../assets/website-asset.service';
import { ServiceItem, ToneOfVoice } from '../website.types';
import {
  EasyStep,
  FREE_MAX_TURNS,
  NO_CHAT_STEPS,
  TranscriptTurn,
  advanceEasy,
  extractBusinessName,
  foldText,
  isCopiedSentence,
  looksLikeName,
  openingTranscript,
  quickNameGuess,
} from './website-draft.script';
import {
  EasyAnswers,
  type EasyPatch,
  StudioLocale,
  composeEasySite,
  fallbackServiceItems,
  mergeEasyPatch,
  pickTemplate,
} from './easy-compose';
import { assertClean } from './content-filter';
import { toDraftView, WebsiteDraftView } from './website-draft.view';

/** Anonymous drafts live for a week before they are considered abandoned. */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Real AI copy calls allowed per draft (initial write + a few regenerations). */
const AI_CALL_CAP = 4;

/** End-of-setup AI text-review passes allowed per draft. */
const REVIEW_CAP = 5;

/** Free-form chat-edit requests allowed per draft, once the site is generated
 *  (the `done` step) — separate from `AI_CALL_CAP` (services) and
 *  `REVIEW_CAP` (end-of-setup review), which this doesn't touch. */
const EDIT_CALL_CAP = 15;

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

const ASSET_URL_RE = /^\/api\/v1\/website-assets\/[0-9a-fA-F-]{36}$/;

export type { EasyPatch };

@Injectable()
export class WebsiteDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly assets: WebsiteAssetService,
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
      step: input.seed?.businessName && advanced ? 'done' : 'intro',
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

  /**
   * One-shot: write the rest of the site (landing copy, about, why-us,
   * process, FAQ, CTA) from the visitor's intro + services, once, right as
   * the guided intake finishes, THEN always runs the AI text review over the
   * result — the creation flow has no manual "check my text" trigger any
   * more, verification is unconditional. Guarded by `generatedAt` rather
   * than a numeric cap — a replayed transition into `done` must never spend
   * either call twice. Never touches `stats`/`testimonials` (see
   * `AiService.generateEasySite`'s doc comment) and silently no-ops on any
   * AI failure — the deterministic template defaults in `easy-compose.ts`
   * already cover every field it would have written, so a failed call
   * degrades gracefully, not visibly.
   */
  private async generateFullSite(a: EasyAnswers): Promise<DraftReviewIssue[]> {
    if (a.generatedAt) return [];
    a.generatedAt = new Date().toISOString();

    const out = await this.ai.generateEasySite({
      rawIntro: a.rawIntro ?? a.companyName ?? '',
      services: a.serviceNames?.length ? a.serviceNames : (a.services ?? []).map((s) => s.name),
      locale: a.locale ?? 'ro',
    });
    if (out) {
      if (out.companyName) a.companyName = out.companyName;
      if (out.businessType && !a.businessType) a.businessType = out.businessType;
      if (out.city && !a.city) a.city = out.city;
      if (out.landingTitle) a.landingTitle = out.landingTitle;
      if (out.landingSubtitle) a.landingSubtitle = out.landingSubtitle;
      if (out.about) a.about = out.about;
      if (out.whyUs?.length) a.whyUs = out.whyUs;
      if (out.process?.length) a.process = out.process;
      if (out.faq?.length) a.faq = out.faq;
      if (out.ctaHeadline) a.ctaHeadline = out.ctaHeadline;
      if (out.ctaButton) a.ctaButton = out.ctaButton;
    }

    const { issues } = await this.reviewAnswers(a);
    return issues;
  }

  /**
   * The visitor's very first message — one sentence: who they are, what they
   * do, where — gets an immediate, cheap AI read (`AiService.parseIntro`) so
   * the preview shows an interpreted business name/headline from turn one,
   * never the raw sentence `quickNameGuess` left as a placeholder. Also picks
   * the one-pager's template right here (tone-aware, `easy-compose.ts`'s
   * `pickTemplate`), seeded by the draft id so a single draft's pick never
   * flickers across composes. Mutates `a` in place; silently no-ops any part
   * the AI call couldn't determine — the deterministic fallbacks already in
   * `a` (and `composeEasySite`'s own defaults) cover the rest.
   */
  private async applyParsedIntro(
    a: EasyAnswers,
    rawIntro: string,
    toneGuess: ToneOfVoice | null | undefined,
    draftId: string,
    allowUnclear: boolean,
  ): Promise<'ok' | 'unclear'> {
    const parsed = await this.ai.parseIntro({ rawIntro, locale: a.locale ?? 'ro' });
    // Not a description of a business at all (greeting, question…): ask
    // again instead of turning it into a name. Only once, so a misread can
    // never trap the visitor on this step.
    if (parsed?.isIntro === false && allowUnclear) return 'unclear';
    if (parsed && parsed.isIntro !== false) {
      if (parsed.businessType) a.businessType = parsed.businessType;
      if (parsed.city) a.city = parsed.city;
      if (parsed.landingTitle) a.landingTitle = parsed.landingTitle;
    }
    a.companyName = this.introName(parsed, rawIntro, a);
    const tone = toneGuess ?? parsed?.tone ?? null;
    a.template = pickTemplate(tone, a.businessType ?? '', draftId);
    return 'ok';
  }

  /**
   * The business name from the first message, always INTERPRETED: the AI's
   * name unless it is just the sentence copied back; else a short name from
   * the AI's trade + city; else (AI unavailable) the text itself only when
   * it plausibly is a bare name ("Frizeria Ionuț"). Otherwise undefined, so
   * the preview shows its neutral default and the end-of-intake AI call or
   * the owner sets it, never the raw sentence.
   */
  private introName(
    parsed: ParsedIntro | null,
    rawIntro: string,
    a: EasyAnswers,
  ): string | undefined {
    const name = parsed?.companyName?.trim();
    if (name && !isCopiedSentence(name, rawIntro)) return name.slice(0, 80);
    const type = parsed?.businessType?.trim();
    if (type) {
      const base = type.charAt(0).toUpperCase() + type.slice(1);
      const city = parsed?.city?.trim() ?? a.city?.trim();
      const composed = city && !foldText(base).includes(foldText(city)) ? `${base} ${city}` : base;
      if (!isCopiedSentence(composed, rawIntro)) return composed.slice(0, 80);
    }
    // AI unavailable or it found no name: read an explicitly stated one
    // ("…se numește X", "X SRL", "Suntem X") before giving up.
    const stated = extractBusinessName(rawIntro);
    if (stated) return stated;
    const guess = quickNameGuess(rawIntro);
    return looksLikeName(guess) ? guess : undefined;
  }

  /** Compact snapshot of the editable text handed to `AiService.interpretEasyEdit`
   *  so it can target the right field(s) — deliberately excludes images/contact. */
  private static editSnapshot(a: EasyAnswers): Record<string, unknown> {
    return {
      companyName: a.companyName,
      landingTitle: a.landingTitle,
      landingSubtitle: a.landingSubtitle,
      about: a.about,
      whyUs: a.whyUs,
      process: a.process,
      faq: a.faq,
      testimonials: a.testimonials,
      stats: a.stats,
      ctaHeadline: a.ctaHeadline,
      ctaButton: a.ctaButton,
      hours: a.hours,
      footerTagline: a.footerTagline,
      accentColor: a.accentColor,
      template: a.template,
    };
  }

  /**
   * A chat message at the `done` step is a free-form edit request on the
   * generated site, not a guided-step answer — `advanceEasy` never sees it.
   * Interprets it via Claude, applies the returned patch through the SAME
   * `mergeEasyPatch` both this service and the claimed-site editor already
   * share, and appends the AI's own reply text to the transcript as-is (the
   * one deliberate exception to i18n-key-only assistant turns — see
   * `website-draft.script.ts`'s comment on this).
   */
  private async handleChatEdit(
    draft: {
      id: string;
      mode: string;
      turnsUsed: number;
      transcript: Prisma.JsonValue;
      answers: Prisma.JsonValue;
    },
    text: string,
  ): Promise<WebsiteDraftView> {
    // Advanced drafts are seeded straight into `done` (see `create()`) — chat-
    // edit is an Easy-only feature, same gate as `advanceStep`/`patchEasy`.
    if (draft.mode !== 'easy') throw new BadRequestException('not_a_simple_site');
    const a = this.answersOf(draft);
    const transcript = ((draft.transcript as unknown as TranscriptTurn[]) ?? []).slice();
    const at = new Date().toISOString();
    transcript.push({ role: 'user', text: text.slice(0, 2000), at });

    const spent = a.editCalls ?? 0;
    if (spent >= EDIT_CALL_CAP) {
      transcript.push({ role: 'assistant', key: 'editCapped', at });
    } else {
      a.editCalls = spent + 1;
      const result = await this.ai.interpretEasyEdit({
        message: text,
        current: WebsiteDraftService.editSnapshot(a),
        locale: a.locale ?? 'ro',
      });
      if (result) {
        try {
          mergeEasyPatch(a, result.patch as EasyPatch, {
            assetUrl: WebsiteDraftService.assetUrl,
            onBadColor: () => {
              throw new BadRequestException('bad_color');
            },
          });
        } catch {
          // An invalid field in the AI's own patch (e.g. a malformed colour)
          // must not fail the whole request — keep the reply, drop the patch.
        }
        transcript.push({ role: 'assistant', text: result.reply.slice(0, 500), at });
      } else {
        transcript.push({ role: 'assistant', key: 'editFailed', at });
      }
    }

    const turnsUsed = draft.turnsUsed + 1;
    const updated = await this.prisma.websiteDraft.update({
      where: { id: draft.id },
      data: {
        answers: a as unknown as Prisma.InputJsonValue,
        transcript: transcript as unknown as Prisma.InputJsonValue,
        turnsUsed,
        status: 'ready',
        ...this.composeInto(a),
      },
    });
    return toDraftView(updated);
  }

  /** Run the single AI call (capped per draft), else deterministic copy. */
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
      items = await this.ai.serviceCopy({
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
  async sendMessage(
    id: string,
    token: string,
    rawText: string,
  ): Promise<WebsiteDraftView & { reviewIssues?: DraftReviewIssue[] }> {
    const draft = await this.load(id, token);

    const text = rawText.trim();
    if (!text) throw new BadRequestException('Message is empty');
    // Choice / upload steps have no free-text input — the visitor advances them
    // from the widget's "Continue" button (`advanceStep`), not the chat. (Empty
    // today — see `NO_CHAT_STEPS`'s own comment — kept as a no-op guard rather
    // than a removed call site.)
    if (NO_CHAT_STEPS.includes(draft.step as EasyStep)) {
      throw new BadRequestException('choose_option');
    }
    assertClean(text);
    if (draft.turnsUsed >= FREE_MAX_TURNS) {
      throw new ForbiddenException('free_plan_turn_limit');
    }

    // `done` is no longer a dead end: a chat message here is a free-form edit
    // request on the already-generated site, not a guided-step answer —
    // `advanceEasy` never sees it (see `handleChatEdit`'s own comment).
    if (draft.step === 'done') {
      return this.handleChatEdit(draft, text);
    }

    const answers = this.answersOf(draft);
    const transcript = ((draft.transcript as unknown as TranscriptTurn[]) ?? []).slice();
    const at = new Date().toISOString();

    let result = advanceEasy(draft.step as EasyStep, answers, text);

    // The first answer always goes through the AI read before anything uses
    // it; a message that isn't an intro keeps the visitor on this step.
    if (result.parseIntroFor) {
      const askedAgain = transcript.some((x) => x.key === 'introUnclear');
      const verdict = await this.applyParsedIntro(
        result.answers,
        result.parseIntroFor,
        result.toneGuess,
        draft.id,
        !askedAgain,
      );
      if (verdict === 'unclear') {
        result = {
          answers,
          step: 'intro',
          assistant: ['introUnclear'],
          regenerate: false,
        };
      } else if (
        !result.answers.companyName?.trim() &&
        !transcript.some((x) => x.key === 'askCompanyName')
      ) {
        // No name could be read (typically the AI is down and the sentence
        // states none). Ask for it once, instead of letting the business be
        // created and published as the generic "Afacerea mea".
        result = {
          answers: { ...result.answers, awaitingName: true },
          step: 'intro',
          assistant: ['askCompanyName'],
          regenerate: true,
        };
      }
    }

    transcript.push({ role: 'user', text: text.slice(0, 2000), at });
    for (const key of result.assistant) transcript.push({ role: 'assistant', key, at });
    if (result.generateServicesFor?.length) {
      result.answers.services = await this.writeServiceCopy(
        result.answers,
        result.generateServicesFor,
      );
    }
    let reviewIssues: DraftReviewIssue[] = [];
    if (result.generateFullSite) {
      reviewIssues = await this.generateFullSite(result.answers);
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
    return { ...toDraftView(updated), ...(reviewIssues.length ? { reviewIssues } : {}) };
  }

  /**
   * Advance a widget step (skip/continue, photo upload) from the studio —
   * not a typed chat message, but still a real answer to the question on
   * screen. `note`, when given, is a short, honest, already-resolved trace
   * of what the visitor just did (e.g. "Am sărit peste poze", the actual
   * service list just typed) and is pushed as a real `user`-role transcript
   * turn BEFORE the assistant's reply, same as a typed message gets — so the
   * conversation doesn't go silent on the visitor's side just because they
   * used a button/upload instead of the text box.
   */
  async advanceStep(
    id: string,
    token: string,
    note?: string,
  ): Promise<WebsiteDraftView & { reviewIssues?: DraftReviewIssue[] }> {
    const draft = await this.load(id, token);
    if (draft.mode !== 'easy') throw new BadRequestException('not_a_simple_site');

    const answers = this.answersOf(draft);
    const transcript = ((draft.transcript as unknown as TranscriptTurn[]) ?? []).slice();
    const at = new Date().toISOString();

    const result = advanceEasy(draft.step as EasyStep, answers);
    const trimmedNote = (note ?? '').trim();
    if (trimmedNote) transcript.push({ role: 'user', text: trimmedNote.slice(0, 300), at });
    for (const key of result.assistant) transcript.push({ role: 'assistant', key, at });

    if (result.generateServicesFor?.length) {
      result.answers.services = await this.writeServiceCopy(
        result.answers,
        result.generateServicesFor,
      );
    }
    let reviewIssues: DraftReviewIssue[] = [];
    if (result.generateFullSite) {
      reviewIssues = await this.generateFullSite(result.answers);
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
    return { ...toDraftView(updated), ...(reviewIssues.length ? { reviewIssues } : {}) };
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
   * owner to correct. Never throws — no AI provider ⇒ `{ issues: [] }`. Kept
   * as a public endpoint for the claimed-site editor's own manual "check my
   * text" button (`easy-site.service.ts` has its own equivalent) — the
   * CREATION flow no longer exposes a manual trigger for this; see
   * `generateFullSite`, which now always runs it automatically instead.
   */
  async reviewDraft(
    id: string,
    token: string,
  ): Promise<{ issues: DraftReviewIssue[]; draft: WebsiteDraftView }> {
    const draft = await this.load(id, token);
    if (draft.mode !== 'easy') throw new BadRequestException('not_a_simple_site');

    const a = this.answersOf(draft);
    const { issues, touched } = await this.reviewAnswers(a);

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

  /**
   * The actual review pass, shared by `reviewDraft()` (the claimed-site
   * editor's manual button) and `generateFullSite()` (the creation flow's
   * now-automatic check) — mutates `a` in place (grammar auto-fixes), the
   * caller persists/composes. Never throws — no AI provider ⇒ no issues.
   */
  private async reviewAnswers(
    a: EasyAnswers,
  ): Promise<{ issues: DraftReviewIssue[]; touched: boolean }> {
    const locale = a.locale ?? 'ro';
    const spent = a.reviewCount ?? 0;
    const items = WebsiteDraftService.reviewItems(a, locale);
    if (spent >= REVIEW_CAP || !items.length) return { issues: [], touched: false };

    const found = await this.ai.reviewCopy({
      items: items.map(({ key, label, text }) => ({ key, label, text })),
      locale,
    });
    if (!found) return { issues: [], touched: false };

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
    return { issues, touched };
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
    return this.assets.addDraftAsset(draft.id, dataUri, kind);
  }

  // --- location + claim ----------------------------------------------

  /**
   * Assert a slug is an active, real leaf subcategory and return it. A bare
   * parent-group slug is rejected — a business is tagged with real leaves
   * only; "offers everything in the group" is derived from having all of
   * them, never a separate tag (see `feed.service.ts`'s "Servicii complete").
   */
  async assertCategory(slug: string): Promise<{ id: string; slug: string }> {
    const category = await this.prisma.category.findUnique({ where: { slug } });
    if (!category || !category.isActive || !category.parentId) {
      throw new BadRequestException('unknown_category');
    }
    return { id: category.id, slug: category.slug };
  }

  /**
   * Assert a list of subcategory slugs: each must be an active leaf, and all
   * must share one parent group (multi-group tagging isn't supported yet).
   */
  async assertCategories(slugs: string[]): Promise<{ id: string; slug: string }[]> {
    const unique = Array.from(new Set(slugs.map((s) => s.trim()).filter(Boolean)));
    if (!unique.length) throw new BadRequestException('category_required');

    const resolved = await Promise.all(unique.map((s) => this.assertCategory(s)));

    const rows = await this.prisma.category.findMany({
      where: { id: { in: resolved.map((c) => c.id) } },
      select: { id: true, parentId: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const parentIds = new Set(resolved.map((c) => byId.get(c.id)?.parentId).filter(Boolean));
    if (parentIds.size > 1) throw new BadRequestException('category_mixed_groups');

    return resolved;
  }

  /** Persist the location + category step (M2). Requires the one-pager first. */
  async setLocation(
    id: string,
    token: string,
    input: {
      categorySlugs: string[];
      counties?: string[];
      city?: string;
      country?: string;
      lat?: number;
      lng?: number;
      nationwide?: boolean;
    },
  ): Promise<WebsiteDraftView> {
    const draft = await this.load(id, token);
    if (draft.content == null) {
      throw new BadRequestException('generate_website_first');
    }
    const categories = await this.assertCategories(input.categorySlugs);
    const { nationwide, counties } = resolveLocationInput(input);

    const updated = await this.prisma.websiteDraft.update({
      where: { id: draft.id },
      data: {
        categorySlugs: categories.map((c) => c.slug),
        // Whole-country coverage carries no județe, city or coordinates.
        locationCounties: nationwide ? [] : counties,
        locationCity: nationwide ? null : (input.city?.trim() ?? null),
        locationCountry: (input.country || 'RO').toUpperCase().slice(0, 2),
        locationLat: nationwide ? null : (input.lat ?? null),
        locationLng: nationwide ? null : (input.lng ?? null),
        locationNationwide: nationwide,
      },
    });
    return toDraftView(updated);
  }

  /**
   * Resolve a draft by its opaque token alone. ONLY the account-claim step
   * (`CompaniesService.createFromDraft`) may use this: it is the one caller
   * that legitimately needs to see an already-`claimed` row, because it keys
   * its idempotent-retry branch off `status === 'claimed' || claimedCompanyId`
   * and would dead-end the create flow if a claimed draft were hidden from it.
   *
   * Everything else must go through `load()`, which rejects claimed drafts —
   * see the comment there.
   */
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

  /**
   * The single token-resolution path behind EVERY anonymous draft endpoint —
   * `get`, `sendMessage`, `advanceStep`, `patchEasy`, `regenerateServices`,
   * `reviewDraft`, `addAsset` and `setLocation` all enter through here (and
   * `website-draft.controller.ts` exposes nothing else), so the checks below
   * cover all of them without per-call-site changes.
   *
   * A CLAIMED draft is treated as if it did not exist. The draft token is an
   * anonymous, pre-signup bearer credential: no session, no account. Once the
   * draft has been turned into a real company it must stop being a usable
   * credential, otherwise anyone who picked the token up during the anonymous
   * phase (a referrer leak, a shared screenshot, synced browser history, a
   * proxy log) keeps full read/write on the row for the rest of its 7-day
   * TTL. The concrete abuse that buys: `addAsset` keeps minting
   * `WebsiteAsset` rows scoped to `draftId` with no `companyId`, which the
   * per-company 60-asset cap therefore never counts, while they stay publicly
   * servable from `/api/v1/website-assets/:id` — free, uncapped image hosting
   * on our own domain. (The live site is unaffected; it renders from the
   * `Website`/`CompanyContact` rows created at claim time, never from the
   * draft.)
   *
   * Deliberately the SAME `NotFoundException('Draft not found')` the missing
   * -token branch throws, not a distinct "already claimed" error: a different
   * response would confirm to a token holder that their token was once valid.
   */
  private async load(id: string, token: string) {
    const draft = await this.loadByToken(token);
    if (draft.id !== id) throw new NotFoundException('Draft not found');
    if (draft.status === 'claimed' || draft.claimedCompanyId) {
      throw new NotFoundException('Draft not found');
    }
    return draft;
  }
}
