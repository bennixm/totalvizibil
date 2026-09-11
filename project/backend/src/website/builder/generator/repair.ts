/**
 * Post-generation auto-repair.
 *
 * The generated site is verified (deterministic `structuralAudit` + the model's
 * `reviewSite`, run once by the pipeline) and the problems are FIXED here —
 * before `generateSite` returns — so the studio only ever shows the finished,
 * corrected result. The client is never asked to resolve generation artefacts.
 *
 *   … compose → verify → fix → return   (one pass, bounded to +1 AI call)
 *
 * Deterministic fixes handle structure (stacked duplicate sections, a monotonous
 * variant run, a missing hero); one batched AI call (`fixSections`) rewrites the
 * sections whose COPY was flagged (placeholder text, near-empty, exaggerated /
 * contradictory claims, brief not reflected).
 */
import { randomUUID } from 'node:crypto';
import {
  SECTION_CATALOG,
  coerceContent,
  seedSectionContent,
  snapVariant,
} from '../section-catalog';
import type { SeedCtx } from '../section-catalog';
import type { SectionType } from '../../website.types';
import {
  normalizeDoc,
  seedFillEmptySections,
  type BuilderDoc,
  type DocSection,
} from '../compose-advanced';
import { structuralAudit, type SiteFinding } from '../site-audit';
import type { GeneratorAi, GeneratorBusiness } from './types';

/** A sibling type to retype a stacked-duplicate section to. */
const SIBLING: Partial<Record<SectionType, SectionType>> = {
  services: 'features',
  features: 'highlightsRow',
  highlightsRow: 'features',
  gallery: 'showcase',
  showcase: 'gallery',
  stats: 'highlightsRow',
  testimonials: 'quoteBig',
  process: 'timeline',
  timeline: 'process',
  faq: 'highlightsRow',
};

interface FlatSection {
  pageTitle: string;
  pageIdx: number;
  secIdx: number;
  section: DocSection;
}

function flatten(doc: BuilderDoc): FlatSection[] {
  const out: FlatSection[] = [];
  doc.pages.forEach((p, pageIdx) => {
    if (p.system) return;
    p.sections.forEach((section, secIdx) =>
      out.push({ pageTitle: p.title, pageIdx, secIdx, section }),
    );
  });
  return out;
}

/** `"Home: services, Contact: faq"` → `[["Home","services"],["Contact","faq"]]`. */
function parseCheckDetail(detail: string): [string, string][] {
  return detail
    .split(',')
    .map((s) => s.trim())
    .map((s): [string, string] => {
      const i = s.lastIndexOf(':');
      return i >= 0 ? [s.slice(0, i).trim(), s.slice(i + 1).trim()] : ['', s];
    })
    .filter(([, type]) => !!type);
}

/** Best-effort map a `reviewSite` finding ref (`"Home · pricing"`) to a section. */
function matchFinding(ref: string, flat: FlatSection[]): FlatSection | undefined {
  const tokens = ref
    .toLowerCase()
    .split(/[·\-:>/|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return undefined;
  let best: { hit: FlatSection; score: number } | undefined;
  for (const fs of flat) {
    const type = fs.section.type.toLowerCase();
    const title = fs.pageTitle.toLowerCase();
    let score = 0;
    for (const tk of tokens) {
      if (type === tk) score += 3;
      else if (type.includes(tk) || tk.includes(type)) score += 2;
      if (title === tk) score += 2;
      else if (title.includes(tk)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { hit: fs, score };
  }
  return best?.hit;
}

// --- deterministic structural fixes -----------------------------------

function fixStackedDups(doc: BuilderDoc, ctx: SeedCtx, log: string[]): void {
  for (const p of doc.pages) {
    if (p.system) return;
    for (let i = 1; i < p.sections.length; i++) {
      if (p.sections[i].type !== p.sections[i - 1].type) continue;
      const dup = p.sections[i];
      if (p.sections.length > 3) {
        p.sections.splice(i, 1);
        log.push(`removed a duplicate ${dup.type} section on "${p.title}"`);
        i--;
      } else {
        const next = (SIBLING[dup.type] ?? 'about') as SectionType;
        dup.type = next;
        dup.variant = snapVariant(next, '');
        dup.content = seedSectionContent(next, ctx);
        log.push(`retyped a duplicate ${p.sections[i - 1].type} → ${next} on "${p.title}"`);
      }
    }
  }
}

function fixVariantRun(doc: BuilderDoc, log: string[]): void {
  for (const p of doc.pages) {
    if (p.system) return;
    let run = 1;
    for (let i = 1; i < p.sections.length; i++) {
      if (p.sections[i].variant === p.sections[i - 1].variant) {
        run++;
        if (run >= 3) {
          const s = p.sections[i - 1];
          const opts = (SECTION_CATALOG[s.type]?.variants ?? [])
            .map((v) => v.id)
            .filter((v) => v !== s.variant);
          if (opts.length) {
            s.variant = opts[i % opts.length];
            log.push(`varied a repeated "${s.type}" layout on "${p.title}"`);
          }
          run = 1;
        }
      } else {
        run = 1;
      }
    }
  }
}

function ensureHero(doc: BuilderDoc, ctx: SeedCtx, log: string[]): void {
  const home = doc.pages.find((p) => !p.system);
  if (home && home.sections[0]?.type !== 'hero') {
    home.sections.unshift({
      id: randomUUID(),
      type: 'hero',
      variant: 'split',
      visible: true,
      content: seedSectionContent('hero', ctx),
    });
    log.push('added a missing hero to the home page');
  }
}

// --- the single-pass repair ---------------------------------------

export interface RepairInput {
  ai: GeneratorAi;
  doc: BuilderDoc;
  brief: string;
  ctx: SeedCtx;
  business: GeneratorBusiness;
  /** Findings already gathered by the pipeline's first review (avoids a re-call). */
  initialFindings: SiteFinding[];
}

export interface RepairResult {
  doc: BuilderDoc;
  /** Human-readable list of what was auto-fixed — for logs, never shown as "problems". */
  repaired: string[];
  /** Whatever advisory issues remain (kept server-side only). */
  residual: { checks: string[]; findings: SiteFinding[] };
}

export async function repairGeneratedSite(input: RepairInput): Promise<RepairResult> {
  let { doc } = input;
  const { ai, brief, ctx, business } = input;
  const findings = input.initialFindings;
  const repaired: string[] = [];

  const checks = structuralAudit(doc, brief).filter((c) => !c.ok);

  // 1 · deterministic structure fixes (instant, no AI)
  if (checks.some((c) => c.id === 'no_stacked_dups')) fixStackedDups(doc, ctx, repaired);
  if (checks.some((c) => c.id === 'layout_rhythm')) fixVariantRun(doc, repaired);
  if (checks.some((c) => c.id === 'home_hero')) ensureHero(doc, ctx, repaired);

  // 2 · collect the sections whose COPY needs a rewrite — from the failed
  //     content checks and every model finding — and fix them in ONE call.
  const flat = flatten(doc);
  const targets = new Map<DocSection, { fs: FlatSection; issues: Set<string> }>();
  const add = (fs: FlatSection | undefined, issue: string): void => {
    if (!fs) return;
    const cur = targets.get(fs.section) ?? { fs, issues: new Set<string>() };
    cur.issues.add(issue);
    targets.set(fs.section, cur);
  };
  for (const c of checks) {
    if ((c.id === 'no_placeholder_text' || c.id === 'sections_have_copy') && c.detail) {
      for (const [pageTitle, type] of parseCheckDetail(c.detail)) {
        const fs = flat.find(
          (x) => x.section.type === type && (!pageTitle || x.pageTitle === pageTitle),
        );
        add(
          fs,
          c.id === 'no_placeholder_text'
            ? 'contains placeholder / lorem-ipsum text'
            : 'the section is almost empty — write real copy',
        );
      }
    }
    if (c.id === 'brief_reflected') {
      add(
        flat.find((x) => x.section.type === 'hero'),
        `the copy does not mention what the brief asked: ${c.detail ?? ''}`,
      );
      add(
        flat.find((x) => x.section.type === 'about'),
        'tie the story back to the brief',
      );
    }
  }
  for (const f of findings) add(matchFinding(f.ref, flat), f.message);

  if (targets.size && ai.configured) {
    const list = [...targets.values()];
    const fixes = await ai
      .fixSections({
        brief,
        business,
        locale: ctx.locale,
        sections: list.map(({ fs, issues }) => ({
          ref: `${fs.pageTitle} · ${fs.section.type}`,
          type: fs.section.type,
          variant: fs.section.variant,
          fieldKeys: (SECTION_CATALOG[fs.section.type]?.fields ?? []).map((x) => x.key),
          content: fs.section.content ?? {},
          issues: [...issues],
        })),
      })
      .catch(() => null);
    if (fixes) {
      let n = 0;
      for (const [i, content] of Object.entries(fixes)) {
        const t = list[Number(i)];
        if (!t) continue;
        t.fs.section.content = coerceContent(t.fs.section.type, {
          ...t.fs.section.content,
          ...content,
        });
        n++;
      }
      if (n) repaired.push(`rewrote ${n} section(s) to fix claims / thin copy`);
    }
  }

  // 3 · re-clamp + backfill anything a rewrite left blank; one final deterministic
  //     structural pass catches any structure a rewrite disturbed.
  doc = normalizeDoc(doc, ctx);
  seedFillEmptySections(doc, ctx);
  const recheck = structuralAudit(doc, brief).filter((c) => !c.ok);
  if (recheck.some((c) => c.id === 'no_stacked_dups')) fixStackedDups(doc, ctx, repaired);
  if (recheck.some((c) => c.id === 'home_hero')) ensureHero(doc, ctx, repaired);
  doc = normalizeDoc(doc, ctx);

  const finalChecks = structuralAudit(doc, brief)
    .filter((c) => !c.ok)
    .map((c) => (c.detail ? `${c.id}: ${c.detail}` : c.id));
  return { doc, repaired, residual: { checks: finalChecks, findings } };
}
