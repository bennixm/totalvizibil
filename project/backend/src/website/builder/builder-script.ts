/**
 * Scripted assistant for the ADVANCED website builder (M7).
 *
 * Same idea as the free-plan studio script: a deterministic state machine (not
 * an LLM) that walks a richer set of questions — multiple pages, palette,
 * typography, portfolio — and feeds an `AdvancedInput` into the generator. It
 * runs on the company's real `Website` (post-account, after the paid unlock).
 */
import {
  AdvancedInput,
  AdvancedPage,
  GalleryItem,
  ToneOfVoice,
  WebsiteTheme,
} from '../website.types';
import {
  condenseType,
  extractEmail,
  extractPhone,
  matchTone,
  splitList,
} from '../drafts/website-draft.script';

export type BuilderStep =
  | 'business'
  | 'name'
  | 'city'
  | 'services'
  | 'audience'
  | 'tone'
  | 'pages'
  | 'design'
  | 'typography'
  | 'portfolio'
  | 'contact'
  | 'refine'
  | 'done';

export interface BuilderAnswers {
  description?: string;
  businessType?: string;
  businessName?: string;
  city?: string;
  services?: string[];
  targetAudience?: string;
  tone?: ToneOfVoice;
  pages?: AdvancedPage[];
  palette?: WebsiteTheme['palette'];
  fontPair?: WebsiteTheme['fontPair'];
  portfolio?: GalleryItem[];
  phone?: string;
  email?: string;
  includeFaq?: boolean;
  includeTestimonials?: boolean;
}

export interface BuilderTurn {
  role: 'assistant' | 'user';
  key?: string;
  text?: string;
  at: string;
}

export interface BuilderAdvance {
  answers: BuilderAnswers;
  step: BuilderStep;
  assistant: string[];
  regenerate: boolean;
}

export function openingBuilderTranscript(now = new Date()): BuilderTurn[] {
  return [{ role: 'assistant', key: 'opening', at: now.toISOString() }];
}

const SKIP = /^(skip|sar|sări|sar peste|pas|nu|no|n\/a|later|mai t[âa]rziu|-)$/i;
const DONE =
  /^(gata|ok(ay)?|perfect|bine|da|done|finish(ed)?|termin|continu|next|mai departe|e bun|arata bine|arată bine)/i;

const PALETTES: [RegExp, WebsiteTheme['palette']][] = [
  [/albastr|blue|indigo|violet|mov/i, 'indigo'],
  [/verde|green|emerald|smarald|eco/i, 'emerald'],
  [/auriu|galben|amber|gold|yellow|portocal|orange/i, 'amber'],
  [/gri|gray|grey|slate|antracit|neutru/i, 'slate'],
  [/roz|rose|pink|magenta|coral/i, 'rose'],
];
const FONTS: [RegExp, WebsiteTheme['fontPair']][] = [
  [/serif|clasic|elegant|editorial/i, 'serif-sans'],
  [/mono|tehnic|technical|code|cod/i, 'mono-sans'],
  [/modern|grotesk|sans|geometric|curat/i, 'grotesk-inter'],
];
const PAGE_WORDS: [RegExp, AdvancedPage][] = [
  [/despre|about|povest|echip|team/i, 'about'],
  [/servici|service|ofert/i, 'services'],
  [/portofoli|portfolio|lucr[aă]ri|proiect|galer|gallery|work/i, 'portfolio'],
  [/[îi]ntreb[aă]ri|faq|q&a|q and a/i, 'faq'],
  [/contact/i, 'contact'],
];

export function matchPalette(text: string): WebsiteTheme['palette'] | null {
  for (const [re, v] of PALETTES) if (re.test(text)) return v;
  return null;
}
export function matchFont(text: string): WebsiteTheme['fontPair'] | null {
  for (const [re, v] of FONTS) if (re.test(text)) return v;
  return null;
}
export function parsePages(text: string): AdvancedPage[] {
  const found = new Set<AdvancedPage>(['home']);
  for (const [re, page] of PAGE_WORDS) if (re.test(text)) found.add(page);
  // "toate" / "all" -> the full set
  if (/\b(toate|all|tot)\b/i.test(text)) {
    (['about', 'services', 'portfolio', 'faq', 'contact'] as AdvancedPage[]).forEach((p) =>
      found.add(p),
    );
  }
  if (found.size === 1) found.add('services').add('contact');
  return [...found];
}

export function buildAdvancedInput(a: BuilderAnswers): AdvancedInput {
  return {
    mode: 'advanced',
    businessName: a.businessName?.trim() || '',
    businessType: (a.businessType || a.description || '').trim().slice(0, 48),
    city: a.city?.trim() || '',
    services: a.services ?? [],
    shortDescription: a.description?.trim() || '',
    targetAudience: a.targetAudience,
    toneOfVoice: a.tone,
    palette: a.palette,
    fontPair: a.fontPair,
    primaryCta: 'Get a quote',
    includeFaq: a.pages?.includes('faq') ?? false,
    includeTestimonials: a.includeTestimonials ?? true,
    phone: a.phone,
    email: a.email,
    pages: a.pages,
    portfolio: a.portfolio,
  };
}

export function advanceBuilder(
  step: BuilderStep,
  answers: BuilderAnswers,
  userText: string,
): BuilderAdvance {
  const text = userText.trim();
  const a: BuilderAnswers = { ...answers };
  const step2 = (next: BuilderStep, key: string): BuilderAdvance => ({
    answers: a,
    step: next,
    assistant: [key],
    regenerate: true,
  });

  switch (step) {
    case 'business':
      a.description = text;
      a.businessType = condenseType(text);
      return step2('name', 'askName');
    case 'name':
      a.businessName = text.slice(0, 80);
      return step2('city', 'askCity');
    case 'city':
      a.city = text.slice(0, 80);
      return step2('services', 'askServices');
    case 'services':
      a.services = SKIP.test(text) ? [] : splitList(text);
      return step2('audience', 'askAudience');
    case 'audience':
      if (!SKIP.test(text)) a.targetAudience = text.slice(0, 120);
      return step2('tone', 'askTone');
    case 'tone':
      if (!SKIP.test(text)) a.tone = matchTone(text) ?? a.tone;
      return step2('pages', 'askPages');
    case 'pages':
      a.pages = parsePages(text);
      return step2('design', 'askDesign');
    case 'design':
      if (!SKIP.test(text)) a.palette = matchPalette(text) ?? a.palette;
      return step2('typography', 'askTypography');
    case 'typography':
      if (!SKIP.test(text)) a.fontPair = matchFont(text) ?? a.fontPair;
      return step2('portfolio', 'askPortfolio');
    case 'portfolio':
      a.portfolio = SKIP.test(text) ? [] : splitList(text).map((title) => ({ title }));
      return step2('contact', 'askContact');
    case 'contact':
      if (!SKIP.test(text)) {
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
      const palette = matchPalette(text);
      const font = matchFont(text);
      if (tone || palette || font) {
        if (tone) a.tone = tone;
        if (palette) a.palette = palette;
        if (font) a.fontPair = font;
        return {
          answers: a,
          step: 'refine',
          assistant: ['updated', 'askRefine'],
          regenerate: true,
        };
      }
      if (DONE.test(text)) {
        return { answers: a, step: 'done', assistant: ['done'], regenerate: false };
      }
      a.description = text;
      a.businessType = condenseType(text);
      return { answers: a, step: 'refine', assistant: ['updated', 'askRefine'], regenerate: true };
    }
    case 'done':
    default:
      return { answers: a, step: 'done', assistant: ['alreadyDone'], regenerate: false };
  }
}
