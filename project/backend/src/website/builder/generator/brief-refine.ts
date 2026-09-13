/**
 * Stage 0 — rewrite the client's raw brief into a richer, more specific one
 * BEFORE the rest of the pipeline reads it, and recommend a page split.
 *
 * The single hard rule: elaborate tone / structure / emphasis, make the
 * IMPLICIT explicit — NEVER invent a fact (years in business, staff size,
 * prices, certifications, testimonials, named clients). The rewritten brief
 * feeds every later AI call; `doc.ai.brief` (what the client sees) is set by
 * the caller from the ORIGINAL text and never touches this output.
 *
 * Deterministic fallback (no AI key, or the call fails): the brief passes
 * through UNCHANGED; `suggestedPages` come from a small per-archetype table.
 */
import { classifyArchetype, type Archetype } from '../site-archetypes';
import type { StudioLocale } from '../section-catalog';
import type { EnrichedBrief, GeneratorAi, GeneratorBusiness, SuggestedPage } from './types';

/** Internal hint labels — never rendered; the real page titles come from
 *  `layout-recipe.ts`'s own localized `PAGE_TITLE` map. */
const ARCHETYPE_PAGE_HINTS: Record<Archetype, SuggestedPage[]> = {
  'local-trade': [
    { title: 'Services', purpose: 'detailed breakdown of what is offered' },
    { title: 'Contact', purpose: 'contact details + quote request' },
  ],
  agency: [
    { title: 'Work', purpose: 'portfolio / case studies' },
    { title: 'Contact', purpose: 'contact + inquiry' },
  ],
  portfolio: [
    { title: 'Gallery', purpose: 'the full body of work' },
    { title: 'Contact', purpose: 'booking / inquiry' },
  ],
  saas: [
    { title: 'Pricing', purpose: 'plans + comparison' },
    { title: 'Contact', purpose: 'sales contact' },
  ],
  hospitality: [
    { title: 'Menu', purpose: 'the full menu / offering' },
    { title: 'Contact', purpose: 'reservations + location' },
  ],
  clinic: [
    { title: 'Team', purpose: 'practitioners + credentials' },
    { title: 'Contact', purpose: 'book an appointment' },
  ],
  shop: [
    { title: 'Products', purpose: 'the catalog / range' },
    { title: 'Contact', purpose: 'store info' },
  ],
  events: [
    { title: 'Gallery', purpose: 'past events' },
    { title: 'Contact', purpose: 'booking' },
  ],
  generic: [
    { title: 'Services', purpose: 'a fuller look at the offering' },
    { title: 'Contact', purpose: 'contact details' },
  ],
};

export interface RefineBriefInput {
  brief: string;
  business: GeneratorBusiness;
  locale: StudioLocale;
}

/** Compact one-line form the `planArchitecture` prompt reads as `pageHint`. */
export function serializePageHint(pages: SuggestedPage[]): string {
  return pages.map((p) => `${p.title} (${p.purpose})`).join('; ');
}

/**
 * Above this length, a brief is already detailed enough that the prompt's own
 * instruction to the model is "add almost nothing" — so skip the AI call
 * entirely and save the latency for the case that actually needs it (a short
 * or vague brief). Calibrated against real briefs: terse ones run ~80-150
 * chars; a genuinely detailed, already-good one starts around ~400+.
 */
const SKIP_AI_OVER_CHARS = 350;

export async function refineBrief(
  ai: GeneratorAi,
  input: RefineBriefInput,
): Promise<EnrichedBrief> {
  const archetype = classifyArchetype(input.brief, input.business.type, input.business.services);
  const fallback: EnrichedBrief = {
    brief: input.brief,
    suggestedPages: ARCHETYPE_PAGE_HINTS[archetype] ?? ARCHETYPE_PAGE_HINTS.generic,
    emphasize: [],
    clarifications: [],
  };
  if (!ai.configured || input.brief.trim().length > SKIP_AI_OVER_CHARS) return fallback;

  const raw = await ai
    .refineBrief({ brief: input.brief, business: input.business, locale: input.locale })
    .catch(() => null);
  if (!raw) return fallback;

  return {
    brief: raw.brief?.trim() || fallback.brief,
    suggestedPages: raw.suggestedPages?.length ? raw.suggestedPages : fallback.suggestedPages,
    emphasize: raw.emphasize ?? [],
    clarifications: raw.clarifications ?? [],
  };
}
