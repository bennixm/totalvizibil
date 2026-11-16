/**
 * Scripted guide for the "Site Simplu" studio's CREATION flow.
 *
 * This is deliberately NOT an LLM: a small deterministic state machine that
 * walks the visitor through a short conversational intake (who they are,
 * their services, optional photos, contact) before the service hands off to
 * Claude once, at the `contact` → `done` transition, to write the rest of the
 * site (see `WebsiteDraftService.generateFullSite`). Template/colour are no
 * longer blocking steps — they get a sane default and stay adjustable
 * live via `patchEasy`, same as always.
 *
 * `done` is the terminal step, but — unlike the old flow — it is NOT a dead
 * end: once here, chat text is a free-form EDIT request on the generated
 * site, interpreted by the service (`WebsiteDraftService`'s chat-edit branch),
 * not by this pure script.
 *
 * Assistant turns are returned as i18n KEYS (resolved under `studio.msg.*` on
 * the frontend), never as baked strings — the platform is RO/EN/DE. The one
 * deliberate exception is the chat-edit reply at `done`, which the service
 * appends as raw AI-generated text (see its own comment) — that path never
 * goes through `advanceEasy`.
 */
import { ToneOfVoice } from '../website.types';
import { EasyAnswers } from './easy-compose';

export type { EasyAnswers } from './easy-compose';

/** Guided steps, in order. `done` is terminal (but chat-enabled — see above). */
export type EasyStep = 'intro' | 'services' | 'photos' | 'contact' | 'done';
export const EASY_STEPS: EasyStep[] = ['intro', 'services', 'photos', 'contact', 'done'];

/**
 * No step blocks chat text any more — `photos` treats any message (including
 * "skip") as "move on", and `done` is now a free-form edit request. Kept as an
 * empty list (rather than deleted) so the controller's existing check stays a
 * no-op instead of a removed call site.
 */
export const NO_CHAT_STEPS: EasyStep[] = [];

/**
 * Guidance is cheap (no LLM), so the message budget is generous — it only
 * exists to stop a runaway client. The single billable action (the AI call) is
 * capped separately, per draft, in the service.
 */
export const FREE_MAX_TURNS = 40;

export interface TranscriptTurn {
  role: 'assistant' | 'user';
  /** assistant turns: i18n key under `studio.msg.*` */
  key?: string;
  /** user turns: the raw message */
  text?: string;
  at: string;
}

export interface EasyAdvance {
  answers: EasyAnswers;
  step: EasyStep;
  /** i18n keys for the assistant replies to append, in order */
  assistant: string[];
  /** whether the site should be re-composed from the new answers */
  regenerate: boolean;
  /** service names to run through the AI before composing (services step only) */
  generateServicesFor?: string[];
  /** set on the `contact` → `done` transition: the service should run the
   *  one-shot full-site generation call before composing (see
   *  `WebsiteDraftService.generateFullSite`) */
  generateFullSite?: boolean;
}

/** The assistant's first message on a fresh draft (asks the one combined intro question). */
export function openingTranscript(now = new Date()): TranscriptTurn[] {
  return [{ role: 'assistant', key: 'opening', at: now.toISOString() }];
}

/**
 * A quick, free, deterministic guess at the business name from the intro
 * sentence — just enough for the preview to show SOMETHING immediately. The
 * AI generation call later (service layer) can replace this with a cleaner
 * extraction once it parses the full `rawIntro` with real context.
 */
export function quickNameGuess(text: string): string {
  const head = text.split(/[,–—\n]|(?:\s-\s)/)[0].trim();
  return (head || text).slice(0, 80);
}

const TONE_PATTERNS: [RegExp, ToneOfVoice][] = [
  [/prieten|friendl|warm|cald|apropiat/i, 'friendly'],
  [/profesional|professional|serios|formal|corporate/i, 'professional'],
  [/premium|lux|elegant|rafinat|refined|upscale/i, 'premium'],
  [/bold|îndr[aă]zne|indrazne|curajos|puternic|confident|striking/i, 'bold'],
  [/calm|lini[sș]tit|relax|reassur|blând|bland/i, 'calm'],
];

const SKIP_PATTERN = /^(skip|sar|sări|sar peste|pas|nu|no|n\/a|later|mai t[âa]rziu|-)$/i;

export function matchTone(text: string): ToneOfVoice | null {
  for (const [re, tone] of TONE_PATTERNS) if (re.test(text)) return tone;
  return null;
}

export function extractEmail(text: string): string | undefined {
  const m = text.match(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/);
  return m ? m[0].toLowerCase() : undefined;
}

export function extractPhone(text: string): string | undefined {
  const m = text.match(/\+?\d[\d\s().-]{6,}\d/);
  if (!m) return undefined;
  return m[0].replace(/[^\d+]/g, '').slice(0, 20);
}

/** Turn a free-text sentence into a short label for headlines / SEO. */
export function condenseType(text: string): string {
  const cleaned = text
    .replace(
      /^(suntem|sunt|noi suntem|we are|we're|i am|i'm|this is|it's|its)\s+(a|an|o|un|una)?\s*/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
  // Up to 6 words, but never cut mid-word — drop trailing words past ~52 chars.
  const words = cleaned.split(' ').slice(0, 6);
  while (words.length > 1 && words.join(' ').length > 52) words.pop();
  return words.join(' ').replace(/[.,;:!?]+$/, '') || cleaned.slice(0, 48);
}

export function splitList(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,;\n•]|(?:^|\s)[-–*]\s/g)
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s.length > 1 && s.length < 80),
    ),
  ).slice(0, 10);
}

export function nextEasyStep(step: EasyStep): EasyStep {
  const i = EASY_STEPS.indexOf(step);
  return i < 0 || i >= EASY_STEPS.length - 1 ? 'done' : EASY_STEPS[i + 1];
}

/**
 * Advance the guided flow one step. `text` is the visitor's chat message for
 * the text steps (intro / services / contact); `photos` carries no meaningful
 * text (photos are added live via `addAsset` + `patchEasy`) — any message,
 * including "skip", just moves on. Pure: the caller persists answers/step,
 * runs the AI call(s) if `generateServicesFor`/`generateFullSite` is set,
 * then re-composes the site.
 */
export function advanceEasy(step: EasyStep, answers: EasyAnswers, text?: string): EasyAdvance {
  const a: EasyAnswers = { ...answers };
  const t = (text ?? '').trim();

  switch (step) {
    case 'intro': {
      // A quick deterministic guess so the preview updates immediately; the
      // full-site generation call later refines name/trade/city from the
      // full sentence, kept here as `rawIntro`.
      if (t) {
        a.rawIntro = t.slice(0, 500);
        a.companyName = quickNameGuess(t);
      }
      return { answers: a, step: 'services', assistant: ['askServices'], regenerate: true };
    }

    case 'services': {
      // A real list keeps us on this step (so the client can reorder / tweak the
      // AI copy); an empty message or the "Continue" button moves on.
      if (t && !SKIP_PATTERN.test(t)) {
        const names = splitList(t);
        a.serviceNames = names;
        if (!a.businessType && names.length) a.businessType = names.slice(0, 3).join(', ');
        return {
          answers: a,
          step: 'services',
          assistant: names.length ? ['servicesGenerated'] : ['askServices'],
          regenerate: true,
          generateServicesFor: names.length ? names : undefined,
        };
      }
      return { answers: a, step: 'photos', assistant: ['askPhotos'], regenerate: true };
    }

    case 'photos':
      // Photos are added live via `addAsset` + `patchEasy`; this step is
      // optional/skippable — any chat message (including "skip") moves on.
      return { answers: a, step: 'contact', assistant: ['askContact'], regenerate: true };

    case 'contact': {
      if (!SKIP_PATTERN.test(t)) {
        a.phone = extractPhone(t) ?? a.phone;
        a.email = extractEmail(t) ?? a.email;
      }
      return {
        answers: a,
        step: 'done',
        assistant: ['contactSaved', 'done'],
        regenerate: true,
        generateFullSite: true,
      };
    }

    case 'done':
    default:
      return { answers: a, step: 'done', assistant: ['alreadyDone'], regenerate: false };
  }
}
