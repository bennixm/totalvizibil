import Anthropic from '@anthropic-ai/sdk';
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

/** Google Ads agent (docs/ai/GOOGLE-ADS-AGENT-PLAN.md) — one-time keyword
 *  + ad copy generation for a brand-new per-subcategory campaign. */
export interface GoogleAdsKeywordPlanInput {
  categoryName: string;
  parentCategoryName?: string;
  landingUrl: string;
  businessNames: string[];
}
export interface GoogleAdsKeywordPlan {
  keywords: string[];
  headlines: string[];
  descriptions: string[];
  /** Short benefit/trust phrases (≤25 chars) for callout assets — Ad
   *  Strength research doc, Direction 2. No URL needed, unlike sitelinks
   *  (which this platform skips: every subcategory has exactly ONE landing
   *  page, so distinct sitelink destinations don't exist here). */
  callouts: string[];
  /** A short English search phrase for sourcing a generic stock photo
   *  (Pexels) to attach as an image asset — Direction 2. */
  imageSearchQuery: string;
  /** Rough cost estimate (minor credit units) for this one call — see
   *  `estimateClaudeCostMinor()`. For the admin panel's cost-tracking tab
   *  (`GoogleAdsAgentRun.claudeCostEstimateMinor`), not real billing. */
  costEstimateMinor: number;
  /** Raw usage, so the caller can roll it into `GoogleAdsAgentRun`'s own
   *  token/model columns for the finance module's "Consum AI" report. */
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/** Google Ads agent — daily batch budget/CPC proposal, one Claude call
 *  across every live subcategory campaign at once. */
export interface GoogleAdsBudgetSignal {
  categorySlug: string;
  categoryName: string;
  activeCompanyCount: number;
  currentDailyBudgetCredits: number;
  currentMaxCpcCredits: number;
}
export interface GoogleAdsBudgetIntelligenceInput {
  signals: GoogleAdsBudgetSignal[];
  feedCpcFloorCredits: number;
  maxDailyBudgetCapCredits: number;
  maxCpcCapCredits: number;
}
export interface GoogleAdsBudgetProposal {
  categorySlug: string;
  proposedDailyBudgetCredits: number;
  proposedMaxCpcCredits: number;
  reasoning: string;
}
export interface GoogleAdsBudgetIntelligenceResult {
  proposals: GoogleAdsBudgetProposal[];
  /** See `GoogleAdsKeywordPlan.costEstimateMinor`. */
  costEstimateMinor: number;
  /** See `GoogleAdsKeywordPlan.inputTokens`/`outputTokens`/`model`. */
  inputTokens: number;
  outputTokens: number;
  model: string;
}

const TIMEOUT_MS = 20_000;
const PLAN_TIMEOUT_MS = 60_000;

/** Rough, USD-denominated estimate treated as credits (1 credit ≈ $1 here —
 *  an explicit simplification for a cost-TRACKING estimate, not a real
 *  invoice), priced at the "fast" model tier's rates (Sonnet-class: $2/$10
 *  per MTok input/output) — the tier both Google Ads agent calls use. */
export function estimateClaudeCostMinor(usage: {
  input_tokens: number;
  output_tokens: number;
}): number {
  const usd = (usage.input_tokens / 1_000_000) * 2 + (usage.output_tokens / 1_000_000) * 10;
  return Math.round(usd * 100);
}

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

  constructor(config: ConfigService<AppConfig, true>) {
    const anthropicKey = config.get('anthropicApiKey', { infer: true }) ?? '';
    this.anthropicModel = config.get('anthropicModel', { infer: true }) || 'claude-opus-5';
    // The generator fires ~6–10 calls per site; the high-volume ones (copy,
    // section rewrites, reviews, image intents) run on a faster/cheaper model.
    // Sonnet is the sane default — Opus times out on a chain this long.
    this.anthropicModelFast =
      config.get('anthropicModelFast', { infer: true }) || 'claude-sonnet-5';
    this.anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

    if (!this.anthropic) {
      this.logger.log('ANTHROPIC_API_KEY not set — builders run on deterministic copy/plans');
    }
  }

  /** True when Claude is configured. */
  get configured(): boolean {
    return !!this.anthropic;
  }

  /** The model name used for the "smart" calls (and PRO's agent loop) — for cost/usage logging. */
  get modelName(): string {
    return this.anthropicModel;
  }

  // --- transports ------------------------------------------------------

  /** One Claude Messages call → parsed JSON object, or `null` on any failure. */
  private async anthropicJson(
    system: string,
    user: string,
    opts: CallOpts,
  ): Promise<Record<string, unknown> | null> {
    const result = await this.anthropicJsonWithUsage(system, user, opts);
    return result?.data ?? null;
  }

  /**
   * Same as `anthropicJson`, plus the raw token usage — for callers that
   * need a cost estimate (the Google Ads agent's `claudeCostEstimateMinor`
   * tracking). `anthropicJson` itself stays a thin wrapper around this so
   * every other caller (`serviceCopy`, `reviewCopy`, …) is unaffected.
   */
  private async anthropicJsonWithUsage(
    system: string,
    user: string,
    opts: CallOpts,
  ): Promise<{ data: Record<string, unknown>; usage: Anthropic.Usage } | null> {
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
      return { data: parsed, usage: res.usage };
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
   * One raw Claude Messages call with native tool-use enabled — returns the
   * full `Message` (so the caller can inspect `stop_reason`, `content`
   * `tool_use` blocks, and `usage`) instead of pre-parsing it, because driving
   * a multi-turn tool loop is the CALLER's job (see the Website Builder's
   * `ProV2AgentService`), not this service's. `AiService` stays the single
   * owner of the Anthropic client/model config; this is the one place the
   * agent's tool loop reaches into it — no second client, no duplicated config.
   */
  async agentMessage(params: {
    system: string;
    messages: Anthropic.MessageParam[];
    tools: Anthropic.Tool[];
    maxTokens: number;
    model?: string;
    timeoutMs?: number;
  }): Promise<Anthropic.Message | null> {
    if (!this.anthropic) return null;
    try {
      return await this.anthropic.messages.create(
        {
          model: params.model || this.anthropicModel,
          max_tokens: params.maxTokens,
          system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
          messages: params.messages,
          tools: params.tools,
        },
        { timeout: params.timeoutMs ?? PLAN_TIMEOUT_MS },
      );
    } catch (err) {
      this.logger.warn(`PRO agent call failed: ${this.errMsg(err)}`);
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
   * Google Ads agent (docs/ai/GOOGLE-ADS-AGENT-PLAN.md), Faza 3: one-time
   * keyword + Responsive Search Ad copy for a brand-new per-subcategory
   * campaign skeleton. `null` when no provider is configured — the caller
   * (`GoogleAdsAgentContentService`) leaves the campaign `pending_creation`
   * rather than publishing ads with fabricated/placeholder copy.
   */
  async googleAdsKeywordPlan(
    input: GoogleAdsKeywordPlanInput,
  ): Promise<GoogleAdsKeywordPlan | null> {
    if (!this.configured) return null;

    const user = [
      `Subcategorie: ${input.categoryName}${input.parentCategoryName ? ` (din grupul ${input.parentCategoryName})` : ''}`,
      `URL de destinație: ${input.landingUrl}`,
      input.businessNames.length
        ? `Exemple de firme reale listate în această subcategorie: ${input.businessNames.slice(0, 10).join(', ')}`
        : '',
      '',
      'Generează un plan de cuvinte cheie + reclamă Google Ads (Search, Responsive Search Ad) ' +
        'pentru a atrage vizitatori din România către această subcategorie pe o platformă de ' +
        'listare de firme locale (marketplace, nu o singură firmă). Pentru Ad Strength "Excellent" ' +
        'ai nevoie de CÂT MAI MULTE titluri/descrieri UNICE, cu unghiuri diferite (beneficiu, call-to-' +
        'action, localizare+subcategorie) — nu repeta aceeași formulare cu sinonime. Răspunde STRICT ' +
        'JSON: {"keywords": string[8-15, în română, fraze scurte de căutare], ' +
        '"headlines": string[10-15, max 30 caractere FIECARE, română, unghiuri variate], ' +
        '"descriptions": string[4, max 90 caractere FIECARE, română, unghiuri variate], ' +
        '"callouts": string[4-8, max 25 caractere FIECARE, română, fraze scurte de încredere/beneficiu ' +
        'fără URL — ex. "Firme verificate"], ' +
        '"imageSearchQuery": string (o frază scurtă ÎN ENGLEZĂ pentru căutarea unei fotografii stock ' +
        'generice relevante pentru această subcategorie, ex. "car mechanic repair shop")}. ' +
        'Nu promite preț/discount specific. Nu numi o singură firmă din exemple ca fiind "cea mai bună".',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.anthropicJsonWithUsage(
      'Ești un specialist Google Ads pentru o platformă românească de listare firme locale.',
      user,
      { maxTokens: 1600, effort: 'medium', model: this.anthropicModelFast },
    );
    if (!result) return null;
    const parsed = result.data as {
      keywords?: unknown[];
      headlines?: unknown[];
      descriptions?: unknown[];
      callouts?: unknown[];
      imageSearchQuery?: unknown;
    };

    const asStrings = (v: unknown[] | undefined, maxLen: number): string[] =>
      (Array.isArray(v) ? v : [])
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter((s) => s && s.length <= maxLen);

    const keywords = asStrings(parsed.keywords, 80).slice(0, 15);
    const headlines = asStrings(parsed.headlines, 30).slice(0, 15);
    const descriptions = asStrings(parsed.descriptions, 90).slice(0, 4);
    const callouts = asStrings(parsed.callouts, 25).slice(0, 8);
    const imageSearchQuery =
      typeof parsed.imageSearchQuery === 'string'
        ? parsed.imageSearchQuery.trim().slice(0, 100)
        : '';

    // Google Ads' own minimums for a Responsive Search Ad / a usable keyword
    // list — below this, writing the ad would just be rejected by the API,
    // so fail here (caller keeps the campaign pending_creation) instead of
    // sending a doomed mutate call.
    if (keywords.length < 3 || headlines.length < 3 || descriptions.length < 2) {
      this.logger.warn(
        `Google Ads keyword plan came back under the minimum sizes ` +
          `(keywords=${keywords.length}, headlines=${headlines.length}, descriptions=${descriptions.length})`,
      );
      return null;
    }
    return {
      keywords,
      headlines,
      descriptions,
      callouts,
      imageSearchQuery,
      costEstimateMinor: estimateClaudeCostMinor(result.usage),
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      model: this.anthropicModelFast,
    };
  }

  /**
   * Google Ads agent, Faza 3: one batch call across every live subcategory
   * campaign — Claude sees the whole portfolio at once so it can reallocate
   * between subcategories, not just tune each one in isolation. `null`
   * when unavailable; the caller skips this cycle entirely (no proposals is
   * safer than guessed ones).
   */
  async googleAdsBudgetIntelligence(
    input: GoogleAdsBudgetIntelligenceInput,
  ): Promise<GoogleAdsBudgetIntelligenceResult | null> {
    if (!this.configured || !input.signals.length) return null;

    const user = [
      `Prag minim CPC pe platformă (credite, 1 credit = 1 EUR): ${input.feedCpcFloorCredits.toFixed(2)}`,
      `Plafon absolut buget zilnic per subcategorie (credite): ${input.maxDailyBudgetCapCredits}`,
      `Plafon absolut CPC maxim per subcategorie (credite): ${input.maxCpcCapCredits}`,
      '',
      'Subcategorii (buget/CPC curent, nr. firme active):',
      JSON.stringify(input.signals),
      '',
      'Propune pentru FIECARE subcategorie din listă un buget zilnic și un CPC maxim (credite, ' +
        'pot avea 2 decimale), ținând cont de nr. de firme active (mai multe firme = cerere mai ' +
        'mare = buget mai mare justificat; 0-1 firme = buget mic). NU propune peste plafoanele de ' +
        'mai sus. Explică scurt (1 propoziție, română) raționamentul fiecărei propuneri. Răspunde ' +
        'STRICT JSON: {"proposals": [{"categorySlug": string, "proposedDailyBudgetCredits": number, ' +
        '"proposedMaxCpcCredits": number, "reasoning": string}]}.',
    ].join('\n');

    const result = await this.anthropicJsonWithUsage(
      'Ești un specialist în alocare de buget Google Ads pentru o platformă românească de listare firme locale.',
      user,
      { maxTokens: 4000, effort: 'medium', model: this.anthropicModelFast },
    );
    if (!result) return null;
    const parsed = result.data as { proposals?: unknown[] };

    const knownSlugs = new Set(input.signals.map((s) => s.categorySlug));
    const proposals: GoogleAdsBudgetProposal[] = [];
    for (const raw of Array.isArray(parsed.proposals) ? parsed.proposals : []) {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const categorySlug = String(o.categorySlug ?? '');
      const proposedDailyBudgetCredits = Number(o.proposedDailyBudgetCredits);
      const proposedMaxCpcCredits = Number(o.proposedMaxCpcCredits);
      if (!knownSlugs.has(categorySlug)) continue;
      if (!Number.isFinite(proposedDailyBudgetCredits) || proposedDailyBudgetCredits <= 0) continue;
      if (!Number.isFinite(proposedMaxCpcCredits) || proposedMaxCpcCredits <= 0) continue;
      proposals.push({
        categorySlug,
        proposedDailyBudgetCredits,
        proposedMaxCpcCredits,
        reasoning: String(o.reasoning ?? '')
          .trim()
          .slice(0, 500),
      });
    }
    return {
      proposals,
      costEstimateMinor: estimateClaudeCostMinor(result.usage),
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      model: this.anthropicModelFast,
    };
  }
}
