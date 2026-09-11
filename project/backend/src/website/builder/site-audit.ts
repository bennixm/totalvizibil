/**
 * Post-generation review for the Advanced builder.
 *
 * `normalizeDoc` proves the JSON is well-formed; this file asks the harder
 * question — "did the AI actually build a sensible site?". Two layers:
 *   1. `structuralAudit()` — deterministic, no network: missing hero/contact,
 *      thin pages, stacked duplicate sections, placeholder / lorem-ipsum text,
 *      near-empty copy, whether the brief is echoed anywhere.
 *   2. the model's own read of the result — `AiService.reviewSite()` — a
 *      single call over a text digest of the finished site.
 *
 * Both are advisory: findings are attached to `doc.ai.review` and surfaced in
 * the studio; nothing is mutated or blocked here.
 */
import type { BuilderDoc, PageSpec } from './compose-advanced';

/** A single model finding about the generated site. */
export interface SiteFinding {
  /** Human ref, e.g. `Home · pricing`. */
  ref: string;
  severity: 'warn' | 'block';
  message: string;
}

/** One deterministic check result. */
export interface AuditCheck {
  id: string;
  ok: boolean;
  detail?: string;
}

const PLACEHOLDER_RE =
  /lorem ipsum|\bplaceholder\b|\bTODO\b|\bTBD\b|\bxxx+\b|\byour (text|company|business) here\b|text de completat|nume prenume|full name|vorname name|\bclient \d\b|example\.com/i;

const STOPWORDS = new Set(
  (
    'the a an and or of for to in on with we our you your it is are be la le un o si și de pe cu ne va ai un ' +
    'este sunt care din pentru website site firma firmă companie business afacere vreau want need'
  ).split(/\s+/),
);

/** Every user-facing string in a section's content, flattened. */
function sectionStrings(content: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.trim()) out.push(v.trim());
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        // skip image / url fields — not prose
        if (/image|url|icon|target|href/i.test(k)) continue;
        walk(x);
      }
    }
  };
  walk(content);
  return out;
}

function nonSystemPages(doc: BuilderDoc): PageSpec[] {
  return doc.pages.filter((p) => !p.system);
}

/**
 * Deterministic checks over a finished plan. Returns one entry per check;
 * callers keep the failures (`ok === false`).
 */
export function structuralAudit(doc: BuilderDoc, brief = ''): AuditCheck[] {
  const pages = nonSystemPages(doc);
  const checks: AuditCheck[] = [];
  const add = (id: string, ok: boolean, detail?: string): void => {
    checks.push(detail && !ok ? { id, ok, detail } : { id, ok });
  };

  // home starts with a hero
  const home = pages[0];
  add('home_hero', !!home && home.sections[0]?.type === 'hero');

  // a contact path exists
  const hasContact = pages.some((p) => p.sections.some((s) => s.type === 'contact'));
  add('has_contact', hasContact);

  // no thin page
  const thin = pages.filter((p) => p.sections.filter((s) => s.visible).length < 2);
  add('page_depth', thin.length === 0, thin.map((p) => p.title).join(', '));

  // no two adjacent sections of the same type
  const stacked: string[] = [];
  for (const p of pages) {
    for (let i = 1; i < p.sections.length; i++) {
      if (p.sections[i].type === p.sections[i - 1].type) {
        stacked.push(`${p.title}: ${p.sections[i].type}`);
      }
    }
  }
  add('no_stacked_dups', stacked.length === 0, stacked.join(', '));

  // placeholder / lorem-ipsum text + near-empty sections
  const placeholderHits: string[] = [];
  const thinSections: string[] = [];
  for (const p of pages) {
    for (const s of p.sections) {
      const strings = sectionStrings(s.content ?? {});
      const joined = strings.join(' ');
      if (PLACEHOLDER_RE.test(joined)) placeholderHits.push(`${p.title}: ${s.type}`);
      if (joined.replace(/\s+/g, '').length < 25) thinSections.push(`${p.title}: ${s.type}`);
    }
  }
  add('no_placeholder_text', placeholderHits.length === 0, placeholderHits.join(', '));
  add('sections_have_copy', thinSections.length === 0, thinSections.join(', '));

  // is the brief reflected anywhere in the copy?
  const briefWords = brief
    .toLowerCase()
    .split(/[^a-z0-9ăâîșț]+/i)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w));
  if (briefWords.length) {
    const allCopy = pages
      .flatMap((p) => p.sections.flatMap((s) => sectionStrings(s.content ?? {})))
      .join(' ')
      .toLowerCase();
    const echoed = briefWords.some((w) => allCopy.includes(w));
    add('brief_reflected', echoed, echoed ? undefined : briefWords.slice(0, 6).join(', '));
  }

  // --- design-quality signals (the generator's diversity engine) ---------
  const allSecs = pages.flatMap((p) => p.sections.filter((s) => s.visible !== false));

  // section-type variety: a site that is mostly one or two block types reads
  // as "template filling".
  if (allSecs.length >= 4) {
    const distinct = new Set(allSecs.map((s) => s.type)).size;
    const ratio = distinct / allSecs.length;
    add('section_variety', ratio >= 0.6, `${distinct}/${allSecs.length} distinct types`);
  }

  // no run of 3+ sections sharing one variant id (a visible rhythm stall).
  let stall = 0;
  let maxStall = 1;
  for (let i = 1; i < allSecs.length; i++) {
    stall = allSecs[i].variant === allSecs[i - 1].variant ? stall + 1 : 0;
    maxStall = Math.max(maxStall, stall + 1);
  }
  add('layout_rhythm', maxStall < 3, maxStall >= 3 ? `${maxStall} in a row` : undefined);

  // the theme carries a typographic character (Design DNA landed).
  const t = doc.theme as {
    headingAlign?: string;
    headingScale?: string;
    background?: string;
  };
  add('typographic_character', !!(t.headingAlign || t.headingScale || t.background));

  return checks;
}

/** Compact text digest of the finished site for the model review call.
 *  `sectionIds` prefixes each line with `[<id>]` so a visual-QA verdict can
 *  point a fix at a specific section. */
export function siteDigest(
  doc: BuilderDoc,
  cap = 4000,
  opts: { sectionIds?: boolean } = {},
): string {
  const lines: string[] = [];
  for (const p of nonSystemPages(doc)) {
    lines.push(`## ${p.title}`);
    for (const s of p.sections) {
      if (!s.visible) continue;
      const txt = sectionStrings(s.content ?? {})
        .join(' · ')
        .replace(/\s+/g, ' ')
        .slice(0, 240);
      const id = opts.sectionIds ? `[${s.id}] ` : '';
      lines.push(`- ${id}${s.type}/${s.variant}: ${txt || '(no text)'}`);
    }
  }
  return lines.join('\n').slice(0, cap);
}
