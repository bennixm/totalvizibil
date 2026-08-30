/**
 * Scripted assistant for the free one-pager studio.
 *
 * This is deliberately NOT an LLM: it is a small, deterministic state machine
 * that walks the visitor through a fixed set of questions and feeds the answers
 * into `RuleBasedWebsiteGenerator`. It sits behind the same draft API an
 * LLM-backed assistant would use later, so swapping it out touches only this
 * file and the service that persists its output.
 *
 * Assistant turns are returned as i18n KEYS (resolved under `studio.msg.*` on
 * the frontend), never as baked strings — the platform is RO/EN/DE.
 */
import { EasyInput, ToneOfVoice } from '../website.types';

export type DraftStep = 'business' | 'name' | 'city' | 'services' | 'contact' | 'refine' | 'done';

/** Free plan: how many visitor messages the assistant will process. */
export const FREE_MAX_TURNS = 12;

export interface DraftAnswers {
  description?: string;
  businessType?: string;
  businessName?: string;
  city?: string;
  services?: string[];
  phone?: string;
  email?: string;
  tone?: ToneOfVoice;
}

export interface TranscriptTurn {
  role: 'assistant' | 'user';
  /** assistant turns: i18n key under `studio.msg.*` */
  key?: string;
  /** user turns: the raw message */
  text?: string;
  at: string;
}

export interface AdvanceResult {
  answers: DraftAnswers;
  step: DraftStep;
  /** i18n keys for the assistant replies to append, in order */
  assistant: string[];
  /** whether the website should be re-generated from the new answers */
  regenerate: boolean;
}

/** The assistant's first message on a fresh draft. */
export function openingTranscript(now = new Date()): TranscriptTurn[] {
  return [{ role: 'assistant', key: 'opening', at: now.toISOString() }];
}

const TONE_PATTERNS: [RegExp, ToneOfVoice][] = [
  [/prieten|friendl|warm|cald|apropiat/i, 'friendly'],
  [/profesional|professional|serios|formal|corporate/i, 'professional'],
  [/premium|lux|elegant|rafinat|refined|upscale/i, 'premium'],
  [/bold|îndr[aă]zne|indrazne|curajos|puternic|confident|striking/i, 'bold'],
  [/calm|lini[sș]tit|relax|reassur|blând|bland/i, 'calm'],
];

const DONE_PATTERN =
  /^(gata|ok(ay)?|perfect|bine|da|done|finish(ed)?|termin|continu|next|mai departe|e bun|arata bine|arată bine|nimic)/i;

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

/** Turn a free-text sentence into a short business-type label for headlines. */
export function condenseType(text: string): string {
  const cleaned = text
    .replace(
      /^(suntem|sunt|noi suntem|we are|we're|i am|i'm|this is|it's|its)\s+(a|an|o|un|una)?\s*/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').slice(0, 6).join(' ');
  return words.slice(0, 48).replace(/[.,;:!?]+$/, '') || cleaned.slice(0, 48);
}

export function splitList(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,;\n•]|(?:^|\s)[-–*]\s/g)
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s.length > 1 && s.length < 80),
    ),
  ).slice(0, 8);
}

/** Build a generator input from whatever answers we have so far (with fallbacks). */
export function buildEasyInput(answers: DraftAnswers): EasyInput {
  return {
    mode: 'easy',
    businessName: answers.businessName?.trim() || '',
    businessType: (answers.businessType || answers.description || '').trim().slice(0, 48),
    city: answers.city?.trim() || '',
    services: answers.services ?? [],
    shortDescription: answers.description?.trim() || '',
    tone: answers.tone,
    phone: answers.phone,
    email: answers.email,
  };
}

const SKIP_PATTERN = /^(skip|sar|sări|sar peste|pas|nu|no|n\/a|later|mai t[âa]rziu|-)$/i;

/**
 * Advance the conversation one visitor message. Pure: callers persist the
 * returned answers/step and (if `regenerate`) the new website.
 */
export function advance(step: DraftStep, answers: DraftAnswers, userText: string): AdvanceResult {
  const text = userText.trim();
  const a: DraftAnswers = { ...answers };

  switch (step) {
    case 'business':
      a.description = text;
      a.businessType = condenseType(text);
      return { answers: a, step: 'name', assistant: ['askName'], regenerate: true };

    case 'name':
      a.businessName = text.slice(0, 80);
      return { answers: a, step: 'city', assistant: ['askCity'], regenerate: true };

    case 'city':
      a.city = text.slice(0, 80);
      return { answers: a, step: 'services', assistant: ['askServices'], regenerate: true };

    case 'services':
      a.services = SKIP_PATTERN.test(text) ? [] : splitList(text);
      return { answers: a, step: 'contact', assistant: ['askContact'], regenerate: true };

    case 'contact':
      if (!SKIP_PATTERN.test(text)) {
        a.phone = extractPhone(text) ?? a.phone;
        a.email = extractEmail(text) ?? a.email;
      }
      return {
        answers: a,
        step: 'refine',
        assistant: ['generated', 'askRefine'],
        regenerate: true,
      };

    case 'refine': {
      const tone = matchTone(text);
      if (tone) {
        a.tone = tone;
        return {
          answers: a,
          step: 'refine',
          assistant: ['updated', 'askRefine'],
          regenerate: true,
        };
      }
      if (DONE_PATTERN.test(text)) {
        return { answers: a, step: 'done', assistant: ['done'], regenerate: false };
      }
      // Anything else: treat as a description tweak and regenerate.
      a.description = text;
      a.businessType = condenseType(text);
      return { answers: a, step: 'refine', assistant: ['updated', 'askRefine'], regenerate: true };
    }

    case 'done':
    default:
      return { answers: a, step: 'done', assistant: ['alreadyDone'], regenerate: false };
  }
}
