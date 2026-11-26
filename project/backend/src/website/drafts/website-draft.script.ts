/**
 * Scripted guide for the "Site Simplu" studio's CREATION flow.
 *
 * This is deliberately NOT an LLM: a small deterministic state machine that
 * walks the visitor through a short conversational intake (who they are,
 * their services, optional photos, contact). The service hands off to Claude
 * TWICE: a cheap, immediate read of the intro sentence as soon as it arrives
 * (see `WebsiteDraftService.sendMessage`'s `parseIntroFor` branch and
 * `AiService.parseIntro`), so the preview never shows the raw sentence as the
 * business name, and once more at the `contact` → `done` transition to write
 * the rest of the site (see `WebsiteDraftService.generateFullSite`).
 * Template/colour are no longer blocking steps — they get an automatic,
 * tone-aware pick (`easy-compose.ts`'s `pickTemplate`) and stay adjustable
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
  /** set on the first `intro` message: the service should run
   *  `AiService.parseIntro` on this raw text before composing, so the
   *  preview shows an interpreted name/headline from turn one instead of
   *  `quickNameGuess`'s raw-sentence fallback (see
   *  `WebsiteDraftService.sendMessage`). */
  parseIntroFor?: string;
  /** the regex-based tone pre-filter on the same intro text (see
   *  `matchTone` below) — carried alongside `parseIntroFor` so the service
   *  can combine it with the AI's own tone read for the automatic template
   *  pick (`easy-compose.ts`'s `pickTemplate`). */
  toneGuess?: ToneOfVoice | null;
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

export const foldText = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Sentence openers that mean the text is a description, not a name. */
const SENTENCE_START =
  /^(sunt|suntem|eu|noi|fac|facem|am|avem|ma|ne|vreau|vrem|lucrez|lucram|ofer|oferim|salut|buna|hello|hi|hey|i|im|we|were|my|our|ich|wir|hallo|mein|meine|unser|unsere)\b/;

/**
 * Whether a short text plausibly IS a business name (used only when the AI
 * read is unavailable): at most 4 words / 40 chars, no sentence opener, no
 * sentence punctuation.
 */
export function looksLikeName(text: string): boolean {
  const t = text.trim();
  if (!t || [...t].length > 40 || /[.!?]/.test(t)) return false;
  if (t.split(/\s+/).length > 4) return false;
  return !SENTENCE_START.test(foldText(t));
}

const CAP_WORD = String.raw`[A-ZĂÂÎȘȚŞŢÄÖÜ0-9][\p{L}\p{N}&'’.+-]*`;
const LEGAL_FORM = String.raw`(?:S\.?\s?R\.?\s?L\.?(?:-?D)?|P\.?F\.?A\.?|I\.?I\.?|S\.?A\.?|GmbH|Ltd\.?|LLC)`;
/** Words that end a name captured after "se numește …" ("… și facem …"). */
const NAME_STOP =
  /^(si|și|iar|care|ce|cu|din|în|in|la|pentru|facem|oferim|lucram|lucrăm|and|that|which|we|in|with|for|und|die|der|wir|mit|für|in)$/i;
const NAMED_AS =
  /(?:se\s+nume[sșş]te|se\s+cheam[aă]|numele\s+(?:firmei|afacerii|nostru|meu)(?:\s+(?:este|e))?|firma\s+(?:mea|noastr[aă])\s+(?:este|e)|is\s+called|we\s+are\s+called|named|hei[sß]+t|hei[sß]+en|namens)\s*[:-]?\s*["„“”'«]?([^,.;:!?\n"”»]+)/iu;

/** Trim a captured name at the first connector word and to a sane length. */
function trimName(raw: string): string | undefined {
  const words: string[] = [];
  for (const w of raw.trim().split(/\s+/)) {
    if (words.length && NAME_STOP.test(foldText(w) || w)) break;
    words.push(w);
    if (words.length >= 5) break;
  }
  const name = words
    .join(' ')
    .replace(new RegExp(`\\s+${LEGAL_FORM}$`, 'iu'), '')
    .replace(/["„“”'«».,;:!?]+$/u, '')
    .trim();
  return name && [...name].length <= 60 ? name : undefined;
}

/**
 * The business name stated in a free-text intro, read WITHOUT the AI — the
 * fallback when Claude is unavailable. Recognises the explicit forms people
 * actually write: "…se numește Termo Audit", "Instalații Audit SRL, …",
 * "Suntem Frizeria Ionuț, …". `undefined` when none is clearly there (the
 * caller then asks for the name instead of inventing a placeholder).
 */
export function extractBusinessName(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const named = t.match(NAMED_AS);
  if (named) {
    const n = trimName(named[1]);
    if (n) return n;
  }
  const legal = t.match(
    new RegExp(`((?:${CAP_WORD}\\s+){0,4}${CAP_WORD})\\s+${LEGAL_FORM}(?![\\p{L}])`, 'u'),
  );
  if (legal) {
    const words = legal[1].split(/\s+/);
    // "Sunt Instalații Audit SRL" — drop a leading sentence opener.
    while (words.length > 1 && SENTENCE_START.test(foldText(words[0]))) words.shift();
    const n = trimName(words.join(' '));
    if (n && !SENTENCE_START.test(foldText(n))) return n;
  }
  const intro = t.match(
    // Opener matched case-insensitively by hand: the name itself must be
    // Capitalised ("Suntem Frizeria Ionuț", never "sunt instalator").
    new RegExp(
      `^(?:[Ss]untem|[Ss]unt|[Nn]oi\\s+suntem|[Ww]e\\s+are|[Ww]e're|I\\s+am|[Ww]ir\\s+sind|[Ii]ch\\s+bin)\\s+((?:${CAP_WORD}\\s*){1,5})`,
      'u',
    ),
  );
  if (intro) {
    const n = trimName(intro[1]);
    if (n) return n;
  }
  return undefined;
}

/** The owner's direct answer to "Cum se numește firma?" — a bare name, or a
 *  sentence containing one. `undefined` for a skip / empty answer. */
export function nameFromAnswer(text: string): string | undefined {
  const t = text.trim();
  if (!t || SKIP_PATTERN.test(t)) return undefined;
  const stated = extractBusinessName(t);
  if (stated) return stated;
  const head = t.split(/[,;\n.!?]/)[0];
  return trimName(head.replace(/^["„“'«]+/u, '')) ?? undefined;
}

/**
 * True when an AI-proposed name is really the visitor's sentence copied
 * back (whole or nearly whole) rather than an interpreted name.
 */
export function isCopiedSentence(name: string, rawIntro: string): boolean {
  const n = foldText(name);
  const r = foldText(rawIntro);
  if (!n) return true;
  if (n === r) return true;
  const words = n.split(' ').length;
  return words > 6 || (r.length > 0 && n.length >= r.length * 0.8 && r.startsWith(n));
}

const TONE_PATTERNS: [RegExp, ToneOfVoice][] = [
  [/prieten|friendl|warm|cald|apropiat/i, 'friendly'],
  [/profesional|professional|serios|formal|corporate/i, 'professional'],
  [/premium|lux|elegant|rafinat|refined|upscale/i, 'premium'],
  [/bold|îndr[aă]zne|indrazne|curajos|puternic|confident|striking/i, 'bold'],
  [/calm|lini[sș]tit|relax|reassur|blând|bland/i, 'calm'],
];

const SKIP_PATTERN = /^(skip|sar|sări|sar peste|pas|nu|no|n\/a|later|mai t[âa]rziu|-)$/i;

/**
 * "Move on" replies typed instead of pressing Continue ("gata", "continuă",
 * "ok"). At the services step these used to be read as a ONE-item service
 * list and replaced the owner's real services with a service called
 * "Continua" — they now advance the step exactly like the button.
 */
const CONTINUE_PATTERN =
  /^(continu[aăi]|continuam|continuăm|mai departe|urm[aă]torul|urm[aă]torul pas|gata|am terminat|e ok|ok|okay|bine|perfect|da|next|done|continue|go on|ready|weiter|fertig|ja)[\s.!]*$/i;

/** True for a reply that only means "skip" or "continue". */
export function isMoveOn(text: string): boolean {
  const t = text.trim();
  return !t || SKIP_PATTERN.test(t) || CONTINUE_PATTERN.test(t);
}

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
      // Second turn of the intro: the visitor is answering "Cum se numește
      // firma?" (asked when neither the AI nor the local reader found a name).
      if (a.awaitingName) {
        a.awaitingName = false;
        const name = nameFromAnswer(t);
        if (name) a.companyName = name;
        return { answers: a, step: 'services', assistant: ['askServices'], regenerate: true };
      }
      // The raw sentence is NEVER used as the name here: `parseIntroFor`
      // tells the service to run it through the AI read first, which sets
      // the interpreted name (or asks again when the text isn't an intro).
      if (t) a.rawIntro = t.slice(0, 500);
      return {
        answers: a,
        step: 'services',
        assistant: ['askServices'],
        regenerate: true,
        parseIntroFor: t || undefined,
        toneGuess: t ? matchTone(t) : undefined,
      };
    }

    case 'services': {
      // A real list keeps us on this step (so the client can reorder / tweak the
      // AI copy); an empty message or the "Continue" button moves on.
      if (!isMoveOn(t)) {
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
      if (!isMoveOn(t)) {
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
