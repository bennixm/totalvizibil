/**
 * Scripted guide for the "Site Simplu" studio.
 *
 * This is deliberately NOT an LLM: a small deterministic state machine that
 * walks the visitor through configuring the fixed one-pager template (name,
 * colour, landing, services, portfolio, contact). The ONE real AI touchpoint —
 * writing the Services copy with DeepSeek — is triggered by this script but
 * executed by the service (`generateServicesFor`).
 *
 * Assistant turns are returned as i18n KEYS (resolved under `studio.msg.*` on
 * the frontend), never as baked strings — the platform is RO/EN/DE.
 *
 * The tone/email/phone/list helpers here are also reused by the advanced
 * builder script (`builder/builder-script.ts`).
 */
import { ToneOfVoice } from '../website.types';
import { EasyAnswers } from './easy-compose';

export type { EasyAnswers } from './easy-compose';

/** Guided steps, in order. `done` is terminal. */
export type EasyStep =
  | 'template'
  | 'name'
  | 'field'
  | 'color'
  | 'landing'
  | 'services'
  | 'portfolio'
  | 'contact'
  | 'done';
export const EASY_STEPS: EasyStep[] = [
  'template',
  'name',
  'field',
  'color',
  'landing',
  'services',
  'portfolio',
  'contact',
  'done',
];

/**
 * Guidance is cheap (no LLM), so the message budget is generous — it only
 * exists to stop a runaway client. The single billable action (DeepSeek) is
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
  /** service names to run through DeepSeek before composing (services step only) */
  generateServicesFor?: string[];
}

/** The assistant's first message on a fresh draft (asks for the company name). */
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
 * the text steps (name / landing title / services list / contact); the widget
 * steps (colour, portfolio) carry no text and are advanced from the studio's
 * "Continue" button. Pure: the caller persists answers/step, runs the single
 * DeepSeek call if `generateServicesFor` is set, then re-composes the site.
 */
export function advanceEasy(step: EasyStep, answers: EasyAnswers, text?: string): EasyAdvance {
  const a: EasyAnswers = { ...answers };
  const t = (text ?? '').trim();

  switch (step) {
    case 'template':
      // The layout variant is chosen from the widget; nothing to read from text.
      return { answers: a, step: 'name', assistant: ['askName'], regenerate: true };

    case 'name': {
      if (t) a.companyName = t.slice(0, 80);
      return { answers: a, step: 'field', assistant: ['askField'], regenerate: true };
    }

    case 'field': {
      // The trade/field — given to DeepSeek so the Services copy is on point.
      if (t && !SKIP_PATTERN.test(t)) a.businessType = condenseType(t);
      return { answers: a, step: 'color', assistant: ['askColor'], regenerate: true };
    }

    case 'color':
      // Colour is applied live via `patchEasy` — nothing to read from text here.
      return { answers: a, step: 'landing', assistant: ['askLanding'], regenerate: true };

    case 'landing': {
      if (t && !SKIP_PATTERN.test(t)) a.landingTitle = t.slice(0, 120);
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
      return { answers: a, step: 'portfolio', assistant: ['askPortfolio'], regenerate: true };
    }

    case 'portfolio':
      // Photos are added live via `addAsset` + `patchEasy`.
      return { answers: a, step: 'contact', assistant: ['askContact'], regenerate: true };

    case 'contact': {
      if (!SKIP_PATTERN.test(t)) {
        a.phone = extractPhone(t) ?? a.phone;
        a.email = extractEmail(t) ?? a.email;
      }
      return { answers: a, step: 'done', assistant: ['contactSaved', 'done'], regenerate: true };
    }

    case 'done':
    default:
      return { answers: a, step: 'done', assistant: ['alreadyDone'], regenerate: false };
  }
}
