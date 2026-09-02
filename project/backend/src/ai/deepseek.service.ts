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

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_MS = 20_000;

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
}
