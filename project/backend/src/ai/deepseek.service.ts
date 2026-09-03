import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/env';

export type AiLocale = 'ro' | 'en' | 'de';

export interface ServiceCopyInput {
  companyName: string;
  businessType?: string;
  city?: string;
  services: string[];
  locale: AiLocale;
}

export interface ServiceCopy {
  name: string;
  description: string;
}

/** Advanced builder — "generate a whole site from a prompt". */
export interface PlanWebsiteInput {
  brief: string;
  business: { name: string; type?: string; city?: string; services: string[] };
  locale: AiLocale;
  /** Pre-rendered catalog description (one line per section type). */
  catalogText: string;
}
export interface AiSitePlan {
  theme?: Record<string, unknown>;
  pages?: unknown[];
}

/** Advanced builder — rewrite one section's content from an instruction. */
export interface SectionContentInput {
  type: string;
  variant: string;
  fieldKeys: string[];
  instruction: string;
  current: Record<string, unknown>;
  locale: AiLocale;
}

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_MS = 20_000;
const PLAN_TIMEOUT_MS = 45_000;

const LOCALE_NAME: Record<AiLocale, string> = {
  ro: 'Romanian',
  en: 'English',
  de: 'German',
};

const SYSTEM: Record<AiLocale, string> = {
  ro: 'Ești copywriter pentru site-uri de prezentare ale firmelor locale. Scrii descrieri scurte, concrete și convingătoare pentru servicii, la persoana I plural, fără clișee de marketing. Răspunzi DOAR cu JSON valid.',
  en: 'You are a copywriter for local business landing pages. You write short, concrete, persuasive service descriptions in the first person plural, with no marketing clichés. You reply with valid JSON only.',
  de: 'Du bist Werbetexter für lokale Unternehmensseiten. Du schreibst kurze, konkrete, überzeugende Leistungsbeschreibungen in der Wir-Form, ohne Marketingfloskeln. Du antwortest nur mit gültigem JSON.',
};

const ASK: Record<AiLocale, string> = {
  ro: 'Pentru fiecare serviciu scrie o descriere de 1–2 propoziții (maxim 220 de caractere). Răspunde cu JSON de forma {"services":[{"name":"...","description":"..."}]}, păstrând exact numele primite și ordinea lor.',
  en: 'For each service write a 1–2 sentence description (max 220 characters). Reply with JSON shaped {"services":[{"name":"...","description":"..."}]}, keeping the exact names given and their order.',
  de: 'Schreibe für jede Leistung eine Beschreibung mit 1–2 Sätzen (max. 220 Zeichen). Antworte mit JSON in der Form {"services":[{"name":"...","description":"..."}]}, behalte die übergebenen Namen und ihre Reihenfolge exakt bei.',
};

const PROOFREAD_SYSTEM: Record<AiLocale, string> = {
  ro: 'Corectezi greșeli de ortografie, gramatică și punctuație în limba română. Păstrezi sensul, tonul, lungimea și formatarea. NU adaugi și NU elimini idei. Răspunzi DOAR cu textul corectat, fără ghilimele, fără explicații.',
  en: 'You fix spelling, grammar and punctuation in English. Keep the meaning, tone, length and formatting. Do NOT add or remove ideas. Reply with ONLY the corrected text, no quotes, no explanation.',
  de: 'Du korrigierst Rechtschreibung, Grammatik und Zeichensetzung im Deutschen. Behalte Sinn, Ton, Länge und Formatierung. Füge KEINE Inhalte hinzu und entferne keine. Antworte NUR mit dem korrigierten Text, ohne Anführungszeichen, ohne Erklärung.',
};

/**
 * DeepSeek client — deliberately tiny. The "Site Simplu" builder makes exactly
 * ONE real AI call: turning a list of service names into `{ name, description }`
 * cards. Everything else in that builder is deterministic JSON guidance.
 *
 * Modelled on `MailService`: it never throws. Any failure (no key, timeout,
 * non-200, unparseable body) resolves to `null` and the caller falls back to
 * deterministic copy, so the flow always completes.
 */
@Injectable()
export class DeepseekService {
  private readonly logger = new Logger('Deepseek');
  private readonly apiKey: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.apiKey = config.get('deepseekApiKey', { infer: true }) ?? '';
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  async serviceCopy(input: ServiceCopyInput): Promise<ServiceCopy[] | null> {
    const names = input.services
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!names.length) return null;
    if (!this.configured) {
      this.logger.log(
        `[DEV] DEEPSEEK_API_KEY not set — service copy will use the deterministic fallback`,
      );
      return null;
    }

    const prompt = [
      `${input.locale === 'en' ? 'Business' : input.locale === 'de' ? 'Unternehmen' : 'Firmă'}: ${input.companyName || (input.locale === 'en' ? 'a local business' : input.locale === 'de' ? 'ein lokales Unternehmen' : 'o firmă locală')}`,
      input.businessType
        ? `${input.locale === 'en' ? 'Field' : input.locale === 'de' ? 'Branche' : 'Domeniu'}: ${input.businessType}`
        : '',
      input.city
        ? `${input.locale === 'en' ? 'City' : input.locale === 'de' ? 'Stadt' : 'Oraș'}: ${input.city}`
        : '',
      `${input.locale === 'en' ? 'Services' : input.locale === 'de' ? 'Leistungen' : 'Servicii'}: ${names.join(', ')}`,
      '',
      ASK[input.locale],
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: SYSTEM[input.locale] },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 900,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) {
        this.logger.warn(`DeepSeek responded ${res.status} — using the deterministic fallback`);
        return null;
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = data.choices?.[0]?.message?.content;
      if (!raw) return null;

      const parsed = JSON.parse(raw) as {
        services?: { name?: string; description?: string }[];
      };
      const out = (parsed.services ?? [])
        .map((s) => ({
          name: (s.name ?? '').trim().slice(0, 120),
          description: (s.description ?? '').trim().slice(0, 280),
        }))
        .filter((s) => s.name && s.description);
      return out.length ? out : null;
    } catch (err) {
      this.logger.warn(`DeepSeek call failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Fix spelling / grammar / punctuation in a short prose string, preserving
   * meaning and length. Returns `null` when unavailable so the caller keeps the
   * original (a deterministic tidy is applied by the caller regardless).
   */
  async proofread(text: string, locale: AiLocale): Promise<string | null> {
    const src = text.trim();
    if (src.length < 2 || src.length > 1200) return null;
    if (!this.configured) return null;

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: PROOFREAD_SYSTEM[locale] ?? PROOFREAD_SYSTEM.ro },
            { role: 'user', content: src },
          ],
          temperature: 0.1,
          max_tokens: 600,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`DeepSeek proofread responded ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const out = data.choices?.[0]?.message?.content?.trim();
      if (!out) return null;
      // Strip a wrapping pair of quotes the model sometimes adds.
      const unquoted = out.replace(/^["'“”](.*)["'“”]$/s, '$1').trim();
      // Guardrail: reject a "correction" that changed length drastically.
      if (unquoted.length > src.length * 2 + 40) return null;
      return unquoted.slice(0, 1200);
    } catch (err) {
      this.logger.warn(
        `DeepSeek proofread failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** One OpenAI-compatible chat completion, JSON mode. Returns the parsed object or `null`. */
  private async chatJson(
    system: string,
    user: string,
    opts: { maxTokens: number; temperature?: number; timeoutMs?: number },
  ): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: opts.temperature ?? 0.6,
          max_tokens: opts.maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`DeepSeek responded ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = data.choices?.[0]?.message?.content;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      this.logger.warn(`DeepSeek call failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Advanced builder — turn a free-text brief into a structured multi-page site
   * plan. Two phases: (A) one small call decides the STRUCTURE + theme and
   * infers the site's scope from the brief; (B) one call per page, in parallel,
   * writes that page's copy. The caller validates everything against the catalog.
   * `null` (phase A failed / no key) ⇒ caller uses the deterministic fallback.
   */
  async planWebsite(input: PlanWebsiteInput): Promise<AiSitePlan | null> {
    if (!this.configured) {
      this.logger.log(
        '[DEV] DEEPSEEK_API_KEY not set — AI site plan will use the keyword fallback',
      );
      return null;
    }
    const lang = LOCALE_NAME[input.locale] ?? 'Romanian';
    const facts =
      `Business name: ${input.business.name || '(unnamed)'}\n` +
      (input.business.type ? `Field: ${input.business.type}\n` : '') +
      (input.business.city ? `City: ${input.business.city}\n` : '') +
      (input.business.services.length ? `Services: ${input.business.services.join(', ')}\n` : '');

    // --- Phase A: structure + theme ---------------------------------
    const outlineSys =
      `You are a senior web designer. Design the STRUCTURE of a small-business marketing website ` +
      `(no body text yet). Decide the scope FROM THE BRIEF: a short or vague brief → 1–2 focused pages; ` +
      `a detailed brief that names pages, audiences or many services → 4–6 pages.\n` +
      `Rules:\n` +
      `- Output: { "theme": {...}, "pages": [{ "title": string, "purpose": string, "nav": boolean, ` +
      `"sections": [{ "type": string, "variant": string }] }] }.\n` +
      `- First page is the home page (the caller marks isHome). Home starts with a "hero". ` +
      `The last page has a "contact" section.\n` +
      `- Use ONLY these section types + variants:\n${input.catalogText}\n` +
      `- "theme": { "preset": "studio|bold|editorial|soft|tech|warm|mono", ` +
      `"palette": "indigo|violet|blue|cyan|teal|emerald|lime|amber|orange|rose|fuchsia|slate", ` +
      `"background": "light|tinted|dark", "headingFont": "grotesk|inter|fraunces|jetbrains", ` +
      `"bodyFont": "grotesk|inter", "radius": "none|subtle|rounded|large|pill", ` +
      `"buttonStyle": "solid|outline|soft|pill", "shadow": "none|soft|bold", ` +
      `"density": "compact|comfortable|spacious" } — choose values that fit the business's character ` +
      `(e.g. a tech product → dark + cyan; a studio → tinted + editorial serif).\n` +
      `Reply with JSON only.`;
    const outline = (await this.chatJson(outlineSys, `Brief: ${input.brief}\n${facts}`, {
      maxTokens: 1400,
      temperature: 0.5,
      timeoutMs: PLAN_TIMEOUT_MS,
    })) as { theme?: Record<string, unknown>; pages?: unknown[] } | null;

    if (!outline || !Array.isArray(outline.pages) || !outline.pages.length) return null;

    const pages = outline.pages.slice(0, 6).map((p) => {
      const pp = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      const sections = Array.isArray(pp.sections)
        ? pp.sections
            .map((s) => {
              const ss = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
              return { type: String(ss.type ?? ''), variant: String(ss.variant ?? '') };
            })
            .filter((s) => s.type)
        : [];
      return {
        title: String(pp.title ?? 'Page'),
        purpose: String(pp.purpose ?? ''),
        nav: pp.nav !== false,
        sections,
      };
    });

    // --- Phase B: per-page copy, in parallel -----------------------
    const priorFacts =
      `Business: ${input.business.name || '(unnamed)'}` +
      (input.business.services.length ? `; services: ${input.business.services.join(', ')}` : '');
    const contentSys =
      `You write website copy. For the given page, fill each section's "content" object using its ` +
      `catalog fields. Keep the section order and the type/variant unchanged. "items" fields are ` +
      `arrays of objects with the listed sub-keys; "list" fields are arrays of strings.\n` +
      `Catalog:\n${input.catalogText}\n` +
      `Write ALL text in ${lang}, concrete and specific, no lorem ipsum, no empty clichés.\n` +
      `For "image" fields, give a relevant royalty-free photo URL from https://images.unsplash.com/ ` +
      `(a real photo id, sized "&w=1400&q=80"), or leave it "" if unsure. Do NOT use other image hosts.\n` +
      `Reply with JSON only: { "sections": [{ "type": string, "variant": string, "content": {...} }] }.`;

    const results = await Promise.allSettled(
      pages.map((pg) =>
        this.chatJson(
          contentSys,
          `Brief: ${input.brief}\n${facts}Consistency facts: ${priorFacts}\n\n` +
            `Page: "${pg.title}" — ${pg.purpose || 'a page of the site'}\n` +
            `Sections (write content for each, in order):\n${JSON.stringify(pg.sections)}`,
          { maxTokens: 2000, temperature: 0.7 },
        ),
      ),
    );

    const outPages = pages.map((pg, i) => {
      const r = results[i];
      const filled =
        r.status === 'fulfilled' && r.value && Array.isArray(r.value.sections)
          ? (r.value.sections as Record<string, unknown>[])
          : [];
      const sections = pg.sections.map((s, j) => {
        const f = filled[j];
        const content =
          f && typeof f.content === 'object' && f.content
            ? (f.content as Record<string, unknown>)
            : {};
        return { type: s.type, variant: s.variant, content };
      });
      return { title: pg.title, nav: pg.nav, sections };
    });

    return { theme: outline.theme, pages: outPages };
  }

  /**
   * Advanced builder — rewrite a single section's content per an instruction,
   * keeping the same field shape. Returns the raw content object or `null`.
   */
  async sectionContent(input: SectionContentInput): Promise<Record<string, unknown> | null> {
    if (!this.configured) return null;
    const lang = LOCALE_NAME[input.locale] ?? 'Romanian';
    const system =
      `You edit one section of a small-business website. Apply the user's instruction to the ` +
      `content below. Keep EXACTLY these top-level keys and their types: ${input.fieldKeys.join(', ')}. ` +
      `Do not add or drop keys. Write user-facing text in ${lang}. Reply with JSON only — the content object.`;
    const user =
      `Section type: ${input.type} (variant: ${input.variant})\n` +
      `Instruction: ${input.instruction}\n` +
      `Current content:\n${JSON.stringify(input.current)}`;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.6,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`DeepSeek sectionContent responded ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = data.choices?.[0]?.message?.content;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      this.logger.warn(
        `DeepSeek sectionContent failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
