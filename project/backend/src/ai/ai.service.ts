import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/env';
import type { SiteFinding } from '../website/builder/site-audit';
import type {
  BusinessProfile,
  CreativeDirection,
  DesignDNA,
  DnaHints,
  GeneratorBusiness,
  IARole,
  SectionRole,
  TargetedFix,
  VisualReview,
} from '../website/builder/generator/types';

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
  /** Classified site archetype (`local-trade`, `saas`, …) — steers structure. */
  archetype?: string;
  /** A compact worked-example outline for that archetype — few-shot, "adapt". */
  skeletonExample?: string;
  /** One line per section on WHEN to use each variant (fights homogenisation). */
  variantHints?: string;
  /**
   * Present on a FOLLOW-UP prompt: the site as it stands now. The planner then
   * EVOLVES it (keeps sections it reuses by `id`, only adds/changes per the
   * brief) instead of rebuilding from scratch.
   */
  current?: {
    theme?: Record<string, unknown>;
    pages: {
      title: string;
      slug: string;
      sections: { id: string; type: string; variant: string }[];
    }[];
  };
}
export interface AiSitePlan {
  theme?: Record<string, unknown>;
  pages?: unknown[];
  /** Fraction of sections the copy pass actually filled (0–1). */
  filledRatio?: number;
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

/** Simple builder — end-of-setup review of the texts the owner typed. */
export interface ReviewCopyInput {
  items: { key: string; label: string; text: string }[];
  locale: AiLocale;
}
export type ReviewIssueKind = 'meaning' | 'grammar' | 'profanity' | 'other';
export interface ReviewIssue {
  key: string;
  kind: ReviewIssueKind;
  message: string;
  /** A corrected version — only for `grammar`; the caller may apply it. */
  fix?: string;
}

const TIMEOUT_MS = 20_000;
const PLAN_TIMEOUT_MS = 60_000;

/** Shared knobs for one Claude call. */
interface CallOpts {
  maxTokens: number;
  timeoutMs?: number;
  /** Adaptive-thinking budget — `low` on mechanical calls, `medium` on the plan. */
  effort?: 'low' | 'medium' | 'high';
  /** Override the model for this call (generator routing: `_FAST` / `_VISION`). */
  model?: string;
}

/**
 * Parse a JSON object that an LLM produced, tolerating the two things they get
 * wrong under an output-token cap: a ```json fence wrapper, and a response that
 * was cut off mid-value. On a truncation we walk the text tracking string/quote
 * state and a `{`/`[` stack, drop the incomplete tail, and append the closers
 * needed to make it valid — so a clipped 6-page plan still yields the pages that
 * did come through instead of nothing.
 */
function parseLooseJson(raw: string): Record<string, unknown> | null {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start > 0) s = s.slice(start);

  const tryParse = (t: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(t) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(s);
  if (direct) return direct;

  // Repair a truncated tail.
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let lastSafe = -1; // index just after a top-of-value boundary we can cut at
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      stack.pop();
      if (stack.length >= 1) lastSafe = i + 1; // a nested value just closed cleanly
    } else if (c === ',' && stack.length >= 1) {
      lastSafe = i; // safe to cut just before this separator
    }
  }
  if (lastSafe > 0) {
    const head = s.slice(0, lastSafe).replace(/,\s*$/, '');
    // close whatever containers are still open (root first was pushed first)
    const openStack: string[] = [];
    let str = false;
    let e = false;
    for (let i = 0; i < head.length; i++) {
      const c = head[i];
      if (str) {
        if (e) e = false;
        else if (c === '\\') e = true;
        else if (c === '"') str = false;
        continue;
      }
      if (c === '"') str = true;
      else if (c === '{') openStack.push('}');
      else if (c === '[') openStack.push(']');
      else if (c === '}' || c === ']') openStack.pop();
    }
    const closed = head + openStack.reverse().join('');
    const repaired = tryParse(closed);
    if (repaired) return repaired;
  }
  return null;
}

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

const REVIEW_SYSTEM: Record<AiLocale, string> = {
  ro:
    'Verifici textele scrise de proprietarul unui site de prezentare. Pentru fiecare intrare (identificată prin "key") semnalezi DOAR problemele reale: ' +
    '"meaning" = textul nu are sens, e incomplet sau contradictoriu; "grammar" = greșeli de ortografie/gramatică/punctuație; ' +
    '"profanity" = limbaj vulgar sau ofensator; "other" = altă problemă clară (ex. text de tip lorem ipsum, spam, informații evident false). ' +
    'Pentru "grammar" dă și un câmp "fix" cu varianta corectată (același sens, aceeași lungime aproximativă). ' +
    'Ignoră chestiuni de stil sau preferință. Dacă un text e în regulă, nu îl include. ' +
    'Răspunzi DOAR cu JSON: {"issues":[{"key":"...","kind":"meaning|grammar|profanity|other","message":"explicație scurtă în română","fix":"...opțional..."}]}.',
  en:
    'You review the texts a small-business site owner typed. For each entry (identified by "key") flag ONLY real problems: ' +
    '"meaning" = the text makes no sense, is incomplete or contradictory; "grammar" = spelling/grammar/punctuation errors; ' +
    '"profanity" = vulgar or offensive language; "other" = another clear problem (e.g. lorem-ipsum placeholder, spam, obviously false claims). ' +
    'For "grammar" also give a "fix" field with the corrected text (same meaning, roughly the same length). ' +
    'Ignore matters of style or preference. If an entry is fine, do not include it. ' +
    'Reply with JSON only: {"issues":[{"key":"...","kind":"meaning|grammar|profanity|other","message":"short explanation","fix":"...optional..."}]}.',
  de:
    'Du prüfst die Texte, die ein Inhaber einer Unternehmensseite eingegeben hat. Für jeden Eintrag (per "key" identifiziert) meldest du NUR echte Probleme: ' +
    '"meaning" = der Text ergibt keinen Sinn, ist unvollständig oder widersprüchlich; "grammar" = Rechtschreib-/Grammatik-/Zeichensetzungsfehler; ' +
    '"profanity" = vulgäre oder beleidigende Sprache; "other" = ein anderes klares Problem (z. B. Lorem-Ipsum-Platzhalter, Spam, offensichtlich falsche Angaben). ' +
    'Für "grammar" gib zusätzlich ein Feld "fix" mit dem korrigierten Text (gleicher Sinn, etwa gleiche Länge). ' +
    'Ignoriere Stil- oder Geschmacksfragen. Ist ein Eintrag in Ordnung, lasse ihn weg. ' +
    'Antworte NUR mit JSON: {"issues":[{"key":"...","kind":"meaning|grammar|profanity|other","message":"kurze Erklärung","fix":"...optional..."}]}.',
};

/**
 * AI client for the website builders — **Claude (Anthropic Messages API) only**.
 *
 * Powered by `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` (with optional
 * `ANTHROPIC_MODEL_FAST` / `ANTHROPIC_MODEL_VISION` for the generator's cheaper /
 * vision calls). When the key is unset every method resolves to `null` and the
 * callers fall back to deterministic copy / keyword plans, so every flow still
 * completes. (The earlier DeepSeek fallback transport has been removed.)
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');
  private readonly anthropic: Anthropic | null;
  private readonly anthropicModel: string;
  private readonly anthropicModelFast: string;
  private readonly anthropicModelVision: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const anthropicKey = config.get('anthropicApiKey', { infer: true }) ?? '';
    this.anthropicModel = config.get('anthropicModel', { infer: true }) || 'claude-opus-5';
    // The generator fires ~6–10 calls per site; the high-volume ones (copy,
    // section rewrites, reviews, image intents) run on a faster/cheaper model.
    // Sonnet is the sane default — Opus times out on a chain this long.
    this.anthropicModelFast =
      config.get('anthropicModelFast', { infer: true }) || 'claude-sonnet-5';
    this.anthropicModelVision =
      config.get('anthropicModelVision', { infer: true }) || this.anthropicModel;
    this.anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

    if (!this.anthropic) {
      this.logger.log('ANTHROPIC_API_KEY not set — builders run on deterministic copy/plans');
    }
  }

  /** True when Claude is configured. */
  get configured(): boolean {
    return !!this.anthropic;
  }

  // --- transports ------------------------------------------------------

  /** One Claude Messages call → parsed JSON object, or `null` on any failure. */
  private async anthropicJson(
    system: string,
    user: string,
    opts: CallOpts,
  ): Promise<Record<string, unknown> | null> {
    if (!this.anthropic) return null;
    try {
      const res = await this.anthropic.messages.create(
        {
          model: opts.model || this.anthropicModel,
          max_tokens: opts.maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
        },
        { timeout: opts.timeoutMs ?? TIMEOUT_MS },
      );
      if (res.stop_reason === 'max_tokens') {
        this.logger.warn(
          `Claude hit max_tokens (${opts.maxTokens}) — attempting to repair truncated JSON`,
        );
      }
      const parsed = parseLooseJson(this.textOf(res));
      if (!parsed) {
        this.logger.warn('Claude returned unparseable JSON (even after repair)');
        return null;
      }
      return parsed;
    } catch (err) {
      this.logger.warn(`Claude call failed: ${this.errMsg(err)}`);
      return null;
    }
  }

  /** One Claude Messages call → plain text, or `null` on any failure. */
  private async anthropicText(
    system: string,
    user: string,
    opts: CallOpts,
  ): Promise<string | null> {
    if (!this.anthropic) return null;
    try {
      const res = await this.anthropic.messages.create(
        {
          model: opts.model || this.anthropicModel,
          max_tokens: opts.maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
        },
        { timeout: opts.timeoutMs ?? TIMEOUT_MS },
      );
      const out = this.textOf(res).trim();
      return out || null;
    } catch (err) {
      this.logger.warn(`Claude call failed: ${this.errMsg(err)}`);
      return null;
    }
  }

  /**
   * One Claude **vision** Messages call (a base64 image + a text prompt) → parsed
   * JSON, or `null` on any failure. Runs on `ANTHROPIC_MODEL_VISION`.
   */
  private async anthropicVisionJson(
    system: string,
    textPrompt: string,
    image: { base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' },
    opts: CallOpts,
  ): Promise<Record<string, unknown> | null> {
    if (!this.anthropic) return null;
    try {
      const res = await this.anthropic.messages.create(
        {
          model: opts.model || this.anthropicModelVision,
          max_tokens: opts.maxTokens,
          system,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: image.mediaType,
                    data: image.base64,
                  },
                },
                { type: 'text', text: textPrompt },
              ],
            },
          ],
          ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
        },
        { timeout: opts.timeoutMs ?? TIMEOUT_MS },
      );
      const parsed = parseLooseJson(this.textOf(res));
      if (!parsed) {
        this.logger.warn('Claude vision returned unparseable JSON');
        return null;
      }
      return parsed;
    } catch (err) {
      this.logger.warn(`Claude vision call failed: ${this.errMsg(err)}`);
      return null;
    }
  }

  private textOf(res: Anthropic.Message): string {
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  private errMsg(err: unknown): string {
    if (err instanceof Anthropic.APIError) return `${err.status ?? ''} ${err.message}`.trim();
    return err instanceof Error ? err.message : String(err);
  }

  /** One Claude call → parsed JSON object, or `null` on any failure. */
  private json(
    system: string,
    user: string,
    opts: CallOpts,
  ): Promise<Record<string, unknown> | null> {
    return this.anthropicJson(system, user, opts);
  }

  /** One Claude call → plain text, or `null` on any failure. */
  private text(system: string, user: string, opts: CallOpts): Promise<string | null> {
    return this.anthropicText(system, user, opts);
  }

  // --- public API --------------------------------------------------

  async serviceCopy(input: ServiceCopyInput): Promise<ServiceCopy[] | null> {
    const names = input.services
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!names.length) return null;
    if (!this.configured) {
      this.logger.log('No AI key — service copy will use the deterministic fallback');
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

    const parsed = (await this.json(SYSTEM[input.locale], prompt, {
      maxTokens: 900,
      effort: 'low',
      model: this.anthropicModelFast,
    })) as { services?: { name?: string; description?: string }[] } | null;
    if (!parsed) return null;

    const out = (parsed.services ?? [])
      .map((s) => ({
        name: (s.name ?? '').trim().slice(0, 120),
        description: (s.description ?? '').trim().slice(0, 280),
      }))
      .filter((s) => s.name && s.description);
    return out.length ? out : null;
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

    const out = await this.text(PROOFREAD_SYSTEM[locale] ?? PROOFREAD_SYSTEM.ro, src, {
      maxTokens: 600,
      effort: 'low',
      model: this.anthropicModelFast,
    });
    if (!out) return null;
    // Strip a wrapping pair of quotes the model sometimes adds.
    const unquoted = out.replace(/^["'“”](.*)["'“”]$/s, '$1').trim();
    // Guardrail: reject a "correction" that changed length drastically.
    if (unquoted.length > src.length * 2 + 40) return null;
    return unquoted.slice(0, 1200);
  }

  /**
   * Simple builder — one end-of-setup pass over the texts the owner typed.
   * Flags meaning / grammar / profanity / other problems; `grammar` issues
   * carry a `fix`. `null` when no provider is configured.
   */
  async reviewCopy(input: ReviewCopyInput): Promise<ReviewIssue[] | null> {
    const items = input.items
      .map((i) => ({ key: i.key, label: i.label, text: (i.text ?? '').trim() }))
      .filter((i) => i.key && i.text)
      .slice(0, 60);
    if (!items.length) return [];
    if (!this.configured) return null;

    const lang = LOCALE_NAME[input.locale] ?? 'Romanian';
    const user =
      `Language: ${lang}\nEntries to check:\n` +
      JSON.stringify(
        items.map((i) => ({ key: i.key, label: i.label, text: i.text.slice(0, 900) })),
      );

    const parsed = (await this.json(REVIEW_SYSTEM[input.locale] ?? REVIEW_SYSTEM.ro, user, {
      maxTokens: 2000,
      effort: 'low',
      model: this.anthropicModelFast,
    })) as { issues?: unknown[] } | null;
    if (!parsed) return null;

    const known = new Set(items.map((i) => i.key));
    const kinds: ReviewIssueKind[] = ['meaning', 'grammar', 'profanity', 'other'];
    const out: ReviewIssue[] = [];
    for (const raw of Array.isArray(parsed.issues) ? parsed.issues : []) {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const key = String(o.key ?? '');
      const kind = kinds.includes(o.kind as ReviewIssueKind)
        ? (o.kind as ReviewIssueKind)
        : 'other';
      const message = String(o.message ?? '')
        .trim()
        .slice(0, 240);
      if (!known.has(key) || !message) continue;
      const fixRaw = typeof o.fix === 'string' ? o.fix.trim().slice(0, 900) : '';
      out.push({ key, kind, message, ...(kind === 'grammar' && fixRaw ? { fix: fixRaw } : {}) });
    }
    return out.slice(0, 40);
  }

  /**
   * Advanced builder — the model's own read of a site it just generated. Given
   * the brief + a text digest (one line per section), it flags sections that
   * don't match their type or the brief, contradictory / nonsensical info, and
   * filler. Advisory only. `null` when no provider is configured.
   */
  async reviewSite(input: {
    brief: string;
    digest: string;
    locale: AiLocale;
  }): Promise<SiteFinding[] | null> {
    const digest = input.digest.trim();
    if (!digest) return [];
    if (!this.configured) return null;

    const lang = LOCALE_NAME[input.locale] ?? 'Romanian';
    const system =
      `You review a small-business website an AI just generated. You get the owner's BRIEF and a ` +
      `text DIGEST of the finished site (one line per section: "type/variant: text"). Flag ONLY ` +
      `real problems: a section whose content doesn't match its type or the brief; information that ` +
      `is nonsensical, contradictory or obviously false; a section that is empty or pure filler; a ` +
      `claim the business could not credibly make. Ignore matters of style, taste or layout. ` +
      `For each finding give "ref" (page + section, e.g. "Home · pricing"), "severity" ` +
      `("warn" = should fix, "block" = clearly broken) and a one-line "message" in ${lang}. ` +
      `If the site is fine, return an empty list. Reply with JSON only: ` +
      `{"findings":[{"ref":"...","severity":"warn|block","message":"..."}]}.`;
    const user = `BRIEF: ${input.brief}\n\nDIGEST:\n${digest}`;

    const parsed = (await this.json(system, user, {
      maxTokens: 1500,
      effort: 'low',
      model: this.anthropicModelFast,
    })) as { findings?: unknown[] } | null;
    if (!parsed) return null;

    const out: SiteFinding[] = [];
    for (const raw of Array.isArray(parsed.findings) ? parsed.findings : []) {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const message = String(o.message ?? '')
        .trim()
        .slice(0, 240);
      if (!message) continue;
      out.push({
        ref:
          String(o.ref ?? '')
            .trim()
            .slice(0, 80) || 'site',
        severity: o.severity === 'block' ? 'block' : 'warn',
        message,
      });
    }
    return out.slice(0, 20);
  }

  // --- Advanced builder: business-aware generation pipeline -----------

  private facts(b: GeneratorBusiness): string {
    return (
      `Business: ${b.name || '(unnamed)'}\n` +
      (b.type ? `Field: ${b.type}\n` : '') +
      (b.city ? `City: ${b.city}\n` : '') +
      (b.services.length ? `Services: ${b.services.join(', ')}\n` : '')
    );
  }

  /**
   * Stage 1–2: read the business, then commit to ONE creative direction that
   * fits it. `seed` asks for "variant N" of a fitting direction so re-runs vary.
   */
  async analyzeBusiness(input: {
    brief: string;
    business: GeneratorBusiness;
    locale: AiLocale;
    seed: number;
  }): Promise<{
    profile: Partial<BusinessProfile>;
    direction: Partial<CreativeDirection>;
    dnaHints?: Partial<DnaHints>;
  } | null> {
    if (!this.configured) return null;
    const system =
      `You are a brand & web strategist. From a brief for a small business, output ONE JSON object:\n` +
      `{"profile":{"businessType","audience","purchaseIntent":"impulse|considered|high-trust",` +
      `"trustDrivers":[..],"primaryConversion","secondaryConversion",` +
      `"maturity":"new|established|premium","positioning","emotionalTone",` +
      `"visualOpportunities":[what is worth photographing],"contentPriorities":[ordered],` +
      `"imageIntensity":"minimal|medium|high|gallery-led"},` +
      `"direction":{"family":"one-or-two words e.g. architectural / warm-local / editorial / clinical-calm",` +
      `"rationale":"<=25 words","referencePoints":[2 comparables]},` +
      `"dna":{ optional deliberate design choices for THIS brand — include ONLY what you would ` +
      `genuinely pick, omit the rest: "headingFont":"grotesk|inter|fraunces|jetbrains",` +
      `"headingScale":"tight|normal|display","headingAlign":"left|center",` +
      `"spacing":"compact|standard|spacious","radius":"none|subtle|rounded|large|pill",` +
      `"heroStyle":"split|centered|imageBg|minimal|gradient|overlap",` +
      `"cardStyle":"flat|bordered|raised|editorial","decorativeStyle":"none|subtle|expressive",` +
      `"background":"light|tinted|dark","palette":"indigo|violet|blue|cyan|teal|emerald|lime|amber|orange|rose|fuchsia|slate",` +
      `"accentHex":"#rrggbb only if the brand has a real colour","photographyStyle":"short phrase" }}.\n` +
      `The direction AND the dna MUST suit the business — never pick a look just to be different. ` +
      `Give creative-direction variant #${(Math.abs(input.seed) % 3) + 1} of a fitting family. ` +
      `Reply with JSON only.`;
    const parsed = (await this.json(
      system,
      `Brief: ${input.brief}\n${this.facts(input.business)}`,
      {
        maxTokens: 2000,
        effort: 'medium',
        timeoutMs: PLAN_TIMEOUT_MS,
      },
    )) as {
      profile?: Partial<BusinessProfile>;
      direction?: Partial<CreativeDirection>;
      dna?: Partial<DnaHints>;
    } | null;
    if (!parsed) return null;
    return {
      profile: parsed.profile ?? {},
      direction: parsed.direction ?? {},
      dnaHints: parsed.dna && typeof parsed.dna === 'object' ? parsed.dna : {},
    };
  }

  /**
   * Stage 4: ordered list of section ROLES (from a fixed vocab) this business
   * needs — plus which to omit. Structure only, no copy, no catalog types.
   */
  async planArchitecture(input: {
    brief: string;
    business: GeneratorBusiness;
    profile: BusinessProfile;
    direction: CreativeDirection;
    locale: AiLocale;
    seed: number;
    roleVocab: string[];
  }): Promise<{ roles: IARole[]; omitted: SectionRole[]; pageCount: number } | null> {
    if (!this.configured) return null;
    const system =
      `You are an information architect. Decide which sections THIS business needs and their order. ` +
      `Use ONLY these role ids: ${input.roleVocab.join(', ')}. A lawyer, a photographer and a ` +
      `restaurant should get visibly different lists — do not default to hero/services/testimonials/cta ` +
      `for everyone. Drop roles that do not serve this business.\n` +
      `Return JSON only: {"roles":[{"role","required":bool,"priority":int,"rationale":"<=12 words"}],` +
      `"omitted":[role,...],"pageCount":1|2}. "hero" first, "contact" last. 4–9 roles.`;
    const user =
      `Brief: ${input.brief}\n${this.facts(input.business)}` +
      `Positioning: ${input.profile.positioning}\nPrimary goal: ${input.profile.primaryConversion}\n` +
      `Direction: ${input.direction.family} — ${input.direction.rationale}\n` +
      `Image intensity: ${input.profile.imageIntensity}. Variant seed: ${input.seed}.`;
    const parsed = (await this.json(system, user, {
      maxTokens: 1200,
      effort: 'medium',
      timeoutMs: PLAN_TIMEOUT_MS,
    })) as { roles?: unknown[]; omitted?: unknown[]; pageCount?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.roles)) return null;
    const roles: IARole[] = parsed.roles
      .map((r, i) => {
        const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
        return {
          role: String(o.role ?? '') as SectionRole,
          required: !!o.required,
          priority: Number.isFinite(o.priority) ? Number(o.priority) : i,
          rationale: typeof o.rationale === 'string' ? o.rationale.slice(0, 120) : undefined,
        };
      })
      .filter((r) => r.role);
    const omitted = Array.isArray(parsed.omitted)
      ? parsed.omitted.filter((x): x is SectionRole => typeof x === 'string')
      : [];
    const pageCount = parsed.pageCount === 2 ? 2 : 1;
    return roles.length >= 3 ? { roles, omitted, pageCount } : null;
  }

  /**
   * Stage 6: fill the copy for a set of pages whose section list + variants are
   * ALREADY fixed by the recipe. Returns one `{type,content}[]` per page, or
   * `null` when nothing came back. Reuses the batched `copyPasses` transport.
   */
  async writePageCopy(input: {
    brief: string;
    business: GeneratorBusiness;
    profile: BusinessProfile;
    dna: DesignDNA;
    locale: AiLocale;
    pages: {
      title: string;
      purpose: string;
      sections: { type: string; variant: string; role: string; fieldKeys: string[] }[];
    }[];
  }): Promise<Record<string, unknown>[][] | null> {
    if (!this.configured || !input.pages.length) return null;
    const lang = LOCALE_NAME[input.locale] ?? 'Romanian';
    const system =
      `You write website copy for a specific business. Fill each section's "content" object using ` +
      `ONLY its listed field keys — keep the section order and its type/variant. "items" fields are ` +
      `arrays of objects; "list" fields are arrays of strings. Return EVERY section.\n` +
      `Voice: ${input.profile.emotionalTone}. Positioning: ${input.profile.positioning}. ` +
      `Audience: ${input.profile.audience}. Primary goal: ${input.profile.primaryConversion}.\n` +
      `Write ALL text in ${lang}, concrete and specific to THIS business — no lorem ipsum, no empty ` +
      `clichés, no "we are a team that…" openers repeated. Vary sentence length and how sections open.\n` +
      `GOOD: "Turnăm fundații și structuri de rezistență pentru case pe un nivel, în jur de Cluj." ` +
      `BAD: "Oferim servicii de calitate superioară adaptate nevoilor dumneavoastră." ` +
      `Name real things (materiale, orașe, tipuri de lucrări, pași); avoid superlative fără dovadă ` +
      `("cel mai bun", "lider de piață", "24/7") unless the brief says so.\n` +
      `Leave every image/imageUrl/backgroundImage field an empty string "". In "contact" leave phone/` +
      `email empty. In "team" use a short placeholder name and empty bio.\n` +
      `Reply with COMPACT JSON only: {"sections":[{"type":string,"content":{...}}]}.`;
    const user = (pg: (typeof input.pages)[number]): string =>
      `Brief: ${input.brief}\n${this.facts(input.business)}` +
      `Page "${pg.title}" — ${pg.purpose}\nSections (in order):\n` +
      JSON.stringify(
        pg.sections.map((s) => ({ type: s.type, variant: s.variant, fields: s.fieldKeys })),
      );
    const out = await this.copyPasses(input.pages, system, user);
    return out.some((p) => p.length) ? out : null;
  }

  /**
   * Stage 7 (Phase 2): enrich image-search intents. Given rough slots, return a
   * map key → { subject, scene, avoid } with business-specific search subjects.
   */
  async enrichImageIntents(input: {
    business: GeneratorBusiness;
    profile: BusinessProfile;
    dna: DesignDNA;
    locale: AiLocale;
    slots: { key: string; role: string; sectionType: string; hint: string }[];
  }): Promise<Record<string, { subject: string; scene: string; avoid: string[] }> | null> {
    if (!this.configured || !input.slots.length) return null;
    const system =
      `You brief a photo researcher for a small-business website. For each slot return a concrete, ` +
      `searchable subject + scene for THIS business and a short "avoid" list. Never generic ` +
      `("business", "team", "office"). Reply JSON only: {"<key>":{"subject","scene","avoid":[..]}}.`;
    const user =
      `Business: ${input.business.name} — ${input.profile.businessType}\n` +
      `Photography style: ${input.dna.photographyStyle}\n` +
      `Visual opportunities: ${input.profile.visualOpportunities.join(', ')}\n` +
      `Slots:\n` +
      JSON.stringify(input.slots);
    const parsed = (await this.json(system, user, {
      maxTokens: 1400,
      effort: 'low',
      model: this.anthropicModelFast,
    })) as Record<string, unknown> | null;
    if (!parsed) return null;
    const out: Record<string, { subject: string; scene: string; avoid: string[] }> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      out[k] = {
        subject: String(o.subject ?? '')
          .trim()
          .slice(0, 120),
        scene: String(o.scene ?? '')
          .trim()
          .slice(0, 120),
        avoid: Array.isArray(o.avoid)
          ? o.avoid.filter((x): x is string => typeof x === 'string').slice(0, 6)
          : [],
      };
    }
    return out;
  }

  /**
   * Phase 3 — Claude-vision review of a screenshot of the RENDERED site. Returns
   * a 0–100 score + issues + a short list of surgical `TargetedFix`es. `null`
   * when no key. Runs on `ANTHROPIC_MODEL_VISION`.
   */
  async visualReview(input: {
    imageBase64: string;
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
    brief: string;
    digest: string;
    locale: AiLocale;
  }): Promise<VisualReview | null> {
    if (!this.configured) return null;
    const system =
      `You are a senior web designer reviewing a SCREENSHOT of a freshly generated small-business ` +
      `website against its brief. Judge: visual hierarchy, whitespace/rhythm, typographic quality, ` +
      `image fit, and whether it looks bespoke vs. a filled template. Be concrete and brief.\n` +
      `"recommendedFixes" MUST be surgical — each is {"target","instruction"} where target is one of: ` +
      `"hero.image", "typography", "spacing", "section:<id>.image", "section:<id>.variant", ` +
      `"section:<id>.copy". Use the section ids from the digest. Max 4 fixes; only real problems.\n` +
      `Reply JSON only: {"score":0-100,"criticalIssues":[..],"warnings":[..],"strengths":[..],` +
      `"recommendedFixes":[{"target","instruction"}]}.`;
    const user = `Brief: ${input.brief}\n\nSite digest (section ids in brackets):\n${input.digest}`;
    const parsed = await this.anthropicVisionJson(
      system,
      user,
      { base64: input.imageBase64, mediaType: input.mediaType },
      { maxTokens: 1200, effort: 'low', timeoutMs: PLAN_TIMEOUT_MS },
    );
    if (!parsed) return null;

    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
    const rawFixes = Array.isArray(parsed.recommendedFixes) ? parsed.recommendedFixes : [];
    const fixTarget = /^(hero\.image|typography|spacing|section:[^.]+\.(image|variant|copy))$/;
    const recommendedFixes: TargetedFix[] = rawFixes
      .map((f): TargetedFix | null => {
        const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
        const target = String(o.target ?? '');
        const instruction = String(o.instruction ?? '').trim();
        return fixTarget.test(target) && instruction
          ? { target: target as TargetedFix['target'], instruction: instruction.slice(0, 200) }
          : null;
      })
      .filter((f): f is TargetedFix => f !== null)
      .slice(0, 4);

    const scoreNum = Number(parsed.score);
    return {
      score: Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, Math.round(scoreNum))) : 60,
      criticalIssues: arr(parsed.criticalIssues),
      warnings: arr(parsed.warnings),
      strengths: arr(parsed.strengths),
      recommendedFixes,
    };
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
      this.logger.log('No AI key — AI site plan will use the keyword fallback');
      return null;
    }
    const lang = LOCALE_NAME[input.locale] ?? 'Romanian';
    const facts =
      `Business name: ${input.business.name || '(unnamed)'}\n` +
      (input.business.type ? `Field: ${input.business.type}\n` : '') +
      (input.business.city ? `City: ${input.business.city}\n` : '') +
      (input.business.services.length ? `Services: ${input.business.services.join(', ')}\n` : '');

    // --- Phase A: structure + theme ---------------------------------
    const improve = !!input.current && input.current.pages.length > 0;
    const knownIds = new Set(
      (input.current?.pages ?? []).flatMap((p) => p.sections.map((s) => s.id)),
    );
    const example =
      !improve && input.skeletonExample
        ? `\nHere is ONE solid ${input.archetype ?? ''} structure — it is one valid option out of many, ` +
          `not a template. ADAPT it to THIS brief: reorder sections, swap variants, add or drop ` +
          `pages/sections, and change at least a third of the section mix so two businesses in the ` +
          `same field don't get the same site. Do NOT copy it verbatim:\n${input.skeletonExample}\n` +
          `The theme values in it are a starting point — keep a palette/font only if the brand ` +
          `genuinely calls for it, otherwise pick your own.\n`
        : '';
    const currentBlock = improve
      ? `\nThe site ALREADY EXISTS. Here it is (structure only):\n` +
        JSON.stringify({
          theme: input.current!.theme ?? {},
          pages: input.current!.pages.map((p) => ({
            title: p.title,
            sections: p.sections.map((s) => ({ id: s.id, type: s.type, variant: s.variant })),
          })),
        }) +
        `\nThe owner now asks for CHANGES (see brief). Return the FULL updated structure. ` +
        `KEEP every section that still fits and reuse its exact "id". Only ADD new sections/pages ` +
        `(omit "id" for those) or change a variant/order where the brief needs it. Keep the theme ` +
        `unless the brief asks otherwise. Do NOT rebuild the site.\n`
      : '';
    const hints = input.variantHints
      ? `\nVariant guidance (pick with intent):\n${input.variantHints}\n`
      : '';
    const outlineSys =
      (improve
        ? `You are a senior web designer editing an existing small-business website STRUCTURE (no body text). `
        : `You are a senior web designer. Design the STRUCTURE of a small-business marketing website ` +
          `(no body text yet). Decide the scope FROM THE BRIEF: a short or vague brief → 1–2 focused pages; ` +
          `a detailed brief that names pages, audiences or many services → 4–6 pages.\n`) +
      `Rules:\n` +
      `- Output COMPACT JSON (no line breaks inside it, no markdown fence): ` +
      `{ "theme": {...}, "pages": [{ "title": string, "purpose": string (max 8 words), "nav": boolean, ` +
      `"sections": [{ "id"?: string, "type": string, "variant": string, "animation": string }] }] }.\n` +
      `- Keep it lean: 3–6 sections per page. "animation" is optional: ` +
      `none|fade|rise|slideLeft|slideRight|zoom|blur — vary the entrances; a hero is usually "none"/"fade".\n` +
      `- First page is the home page (the caller marks isHome). Home starts with a "hero". ` +
      `The last page has a "contact" section.\n` +
      `- MAKE IT DISTINCTIVE. Do not default to hero→services→testimonials→cta for every site. ` +
      `Use at least THREE of {featureSplit, bento, timeline, comparison, process, marquee, pricing, ` +
      `logos, stats, banner, showcase, caseStudy, ratingBand, highlightsRow, splitCta, tabs, quoteBig, bigStatement} ` +
      `where the business makes them relevant, and choose variants that suit the brand — not just the first option. ` +
      `Two sites in the same field should not share a section order.\n` +
      `- Use ONLY these section types + variants:\n${input.catalogText}\n${hints}` +
      `- "theme": { "preset": "studio|bold|editorial|soft|tech|warm|mono", ` +
      `"palette": "indigo|violet|blue|cyan|teal|emerald|lime|amber|orange|rose|fuchsia|slate", ` +
      `"background": "light|tinted|dark", "headingFont": "grotesk|inter|fraunces|jetbrains", ` +
      `"bodyFont": "grotesk|inter", "radius": "none|subtle|rounded|large|pill", ` +
      `"buttonStyle": "solid|outline|soft|pill", "shadow": "none|soft|bold", ` +
      `"motion": "off|subtle|lively", ` +
      `"density": "compact|comfortable|spacious" } — choose values that fit the business's character ` +
      `(e.g. a tech product → dark + cyan; a studio → tinted + editorial serif).\n${example}${currentBlock}` +
      `Reply with JSON only.`;
    const outline = (await this.json(outlineSys, `Brief: ${input.brief}\n${facts}`, {
      maxTokens: 3200,
      effort: 'medium',
      timeoutMs: PLAN_TIMEOUT_MS,
    })) as { theme?: Record<string, unknown>; pages?: unknown[] } | null;

    if (!outline || !Array.isArray(outline.pages) || !outline.pages.length) return null;

    const pages = outline.pages.slice(0, 6).map((p) => {
      const pp = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      const sections = Array.isArray(pp.sections)
        ? pp.sections
            .map((s) => {
              const ss = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
              const id = typeof ss.id === 'string' && knownIds.has(ss.id) ? ss.id : undefined;
              return {
                id,
                type: String(ss.type ?? ''),
                variant: String(ss.variant ?? ''),
                animation: ss.animation ? String(ss.animation) : undefined,
                keep: !!id, // reuse existing copy — Phase B won't rewrite it
              };
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

    // Repair a degenerate outline instead of failing the whole plan.
    if (pages[0] && !pages[0].sections.some((s) => s.type === 'hero')) {
      pages[0].sections.unshift({
        id: undefined,
        type: 'hero',
        variant: 'split',
        animation: 'fade',
        keep: false,
      });
    }
    const totalSections = pages.reduce((n, p) => n + p.sections.length, 0);
    if (totalSections < 2) return null;

    // --- Phase B: per-page copy, batched with one retry pass ------
    const priorFacts =
      `Business: ${input.business.name || '(unnamed)'}` +
      (input.business.services.length ? `; services: ${input.business.services.join(', ')}` : '');
    const contentSys =
      `You write website copy. For the given page, fill each section's "content" object using its ` +
      `catalog fields. Keep the section order and the type/variant unchanged. "items" fields are ` +
      `arrays of objects with the listed sub-keys; "list" fields are arrays of strings. ` +
      `Return EVERY section — never skip one.\n` +
      `Catalog:\n${input.catalogText}\n` +
      `Write ALL text in ${lang}, concrete and specific, no lorem ipsum, no empty clichés.\n` +
      `Vary how sections open — do NOT start several sections the same way ` +
      `(e.g. "We are a team that…" / "Suntem o echipă care…"). Lead with a concrete detail, a ` +
      `number, or a question, and keep sentence length varied.\n` +
      `IMAGES: leave every "image" / "imageUrl" / "backgroundImage" field as an empty string "" — ` +
      `photos are added automatically afterwards. Do not put any URL there.\n` +
      `NEVER invent facts you cannot know: in a "contact" section leave "phone" and "email" empty; ` +
      `in a "team" section do NOT invent real people — leave "name" as a short placeholder and "bio" empty.\n` +
      `Reply with COMPACT JSON only (no markdown fence): ` +
      `{ "sections": [{ "type": string, "content": {...} }] }.`;

    const pageUser = (pg: (typeof pages)[number]): string =>
      `Brief: ${input.brief}\n${facts}Consistency facts: ${priorFacts}\n\n` +
      `Page: "${pg.title}" — ${pg.purpose || 'a page of the site'}\n` +
      `Write content ONLY for these sections, in order:\n` +
      JSON.stringify(
        pg.sections.filter((s) => !s.keep).map((s) => ({ type: s.type, variant: s.variant })),
      );

    // In improve mode, skip the copy call for pages that gained nothing new.
    const toFill = pages.map((pg) => pg.sections.some((s) => !s.keep));
    const fillIdx = pages.map((_, i) => i).filter((i) => toFill[i]);
    const filledSub = await this.copyPasses(
      fillIdx.map((i) => pages[i]),
      contentSys,
      pageUser,
    );
    const filledPages: Record<string, unknown>[][] = pages.map(() => []);
    fillIdx.forEach((i, k) => (filledPages[i] = filledSub[k]));

    let done = 0;
    let newCount = 0;
    const outPages = pages.map((pg, i) => {
      const returned = filledPages[i];
      // Align by type, not blind index: a short / reordered response still maps.
      const pool = returned.map((x, k) => ({ x, k, used: false }));
      const sections = pg.sections.map((s) => {
        if (s.keep)
          return {
            id: s.id,
            type: s.type,
            variant: s.variant,
            animation: s.animation,
            content: {},
          };
        newCount++;
        const hit = pool.find((e) => !e.used && String((e.x as { type?: string }).type) === s.type);
        const slot = hit ?? pool.find((e) => !e.used);
        if (slot) slot.used = true;
        const raw = slot?.x as { content?: unknown } | undefined;
        const content =
          raw && typeof raw.content === 'object' && raw.content
            ? (raw.content as Record<string, unknown>)
            : {};
        if (Object.keys(content).length) done++;
        return { type: s.type, variant: s.variant, animation: s.animation, content };
      });
      return { title: pg.title, nav: pg.nav, sections };
    });

    return {
      theme: outline.theme,
      pages: outPages,
      filledRatio: newCount ? done / newCount : 1,
    };
  }

  /**
   * Run the per-page copy calls in parallel batches of 3, then one retry pass
   * over pages that came back empty. Bounds total wall time to ~2 timeouts
   * regardless of page count, and rides out a transient 429 / timeout.
   */
  private async copyPasses<P>(
    pages: P[],
    system: string,
    user: (pg: P) => string,
  ): Promise<Record<string, unknown>[][]> {
    const out: Record<string, unknown>[][] = pages.map(() => []);
    const call = (i: number) =>
      this.json(system, user(pages[i]), {
        maxTokens: 3200,
        effort: 'low',
        model: this.anthropicModelFast,
        timeoutMs: PLAN_TIMEOUT_MS,
      });
    const pass = async (idxs: number[]): Promise<void> => {
      for (let i = 0; i < idxs.length; i += 3) {
        const batch = idxs.slice(i, i + 3);
        const res = await Promise.allSettled(batch.map((k) => call(k)));
        res.forEach((r, j) => {
          if (r.status === 'fulfilled' && r.value && Array.isArray(r.value.sections)) {
            out[batch[j]] = r.value.sections as Record<string, unknown>[];
          }
        });
      }
    };
    await pass(pages.map((_, i) => i));
    const failed = out.map((v, i) => (v.length ? -1 : i)).filter((i) => i >= 0);
    if (failed.length) {
      this.logger.warn(`Phase-B: retrying ${failed.length} page(s) that returned no copy`);
      await pass(failed);
    }
    return out;
  }

  /**
   * Advanced builder — post-generation auto-repair. Given a set of just-generated
   * sections and the concrete ISSUES found in each, rewrite their content to
   * resolve them (drop exaggerated / contradictory / unverifiable / placeholder
   * claims, be concrete and credible) keeping the same field shape. One batched
   * call. Returns `index → new content`, or `null` when unavailable.
   */
  async fixSections(input: {
    brief: string;
    business: GeneratorBusiness;
    locale: AiLocale;
    sections: {
      ref: string;
      type: string;
      variant: string;
      fieldKeys: string[];
      content: Record<string, unknown>;
      issues: string[];
    }[];
  }): Promise<Record<number, Record<string, unknown>> | null> {
    if (!this.configured || !input.sections.length) return null;
    const lang = LOCALE_NAME[input.locale] ?? 'Romanian';
    const system =
      `You are quality-fixing specific sections of a small-business website that was just generated. ` +
      `For each section, rewrite its "content" so the listed ISSUES are resolved:\n` +
      `- remove exaggerated, absolute, contradictory or unverifiable claims (e.g. "0 wait time", "24/7", ` +
      `"#1", "best in the country") unless the brief clearly supports them;\n` +
      `- replace placeholder / lorem-ipsum / empty text with concrete, specific copy for THIS business;\n` +
      `- keep claims consistent with the rest of the site.\n` +
      `Keep EXACTLY the given field keys and their types. Do not add or drop keys. Leave every ` +
      `image / imageUrl / backgroundImage field untouched. Write all text in ${lang}.\n` +
      `Reply with JSON only: {"sections":[{"index":int,"content":{...}}]} — one entry per input section.`;
    const user =
      `Brief: ${input.brief}\n${this.facts(input.business)}\nSections to fix:\n` +
      JSON.stringify(
        input.sections.map((s, i) => ({
          index: i,
          type: s.type,
          variant: s.variant,
          fields: s.fieldKeys,
          issues: s.issues,
          content: s.content,
        })),
      );
    const parsed = (await this.json(system, user, {
      maxTokens: 3000,
      effort: 'low',
      model: this.anthropicModelFast,
      timeoutMs: PLAN_TIMEOUT_MS,
    })) as { sections?: unknown[] } | null;
    if (!parsed || !Array.isArray(parsed.sections)) return null;
    const out: Record<number, Record<string, unknown>> = {};
    for (const raw of parsed.sections) {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const idx = Number(o.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= input.sections.length) continue;
      if (o.content && typeof o.content === 'object') {
        out[idx] = o.content as Record<string, unknown>;
      }
    }
    return Object.keys(out).length ? out : null;
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
    const parsed = await this.json(system, user, {
      maxTokens: 1200,
      effort: 'low',
      model: this.anthropicModelFast,
    });
    return parsed && typeof parsed === 'object' ? parsed : null;
  }
}
