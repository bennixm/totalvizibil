import { CampaignData, RsaAd } from '../google-ads/optimization/google-ads-account-data';
import { CampaignEvaluation } from '../google-ads/optimization/google-ads-campaign-evaluator';
import {
  keywordCoverage,
  keywordsHurtAdStrength,
  replaceableHeadlines,
} from '../google-ads/optimization/google-ads-headline-keywords';
import {
  CALLOUTS,
  RSA,
  SITELINKS,
  STRUCTURED_SNIPPETS,
} from '../google-ads/optimization/google-ads-specs';
import { UserAgentSettings } from './agent-settings';
import { WorkUnits } from './pricing';

/**
 * What one optimization cycle is expected to do, derived from the fresh
 * evaluation with the SAME rules and caps the optimizer applies
 * (google-ads-optimizer.service.ts), so the quote describes real work. The
 * final price is recomputed from the work actually performed (`performedWork`)
 * and can only be lower than the quote, never higher.
 */

/** Mirrors the optimizer's caps (MAX_KEYWORD_HEADLINES, MAX_STRENGTH_SWAPS,
 *  MAX_REPLACEMENTS_PER_CAMPAIGN_PER_CYCLE, IMAGE_TARGET). */
const CAPS = { keywordHeadlines: 4, strengthSwaps: 6, lowReplacements: 2, images: 4 };

export interface WorkPlan {
  units: WorkUnits;
  elementsAnalyzed: number;
  /** One line per planned task, for the owner ("what the agent will do"). */
  tasks: { task: keyof WorkUnits; units: number; detail: string }[];
}

function pickRsa(c: CampaignData): RsaAd | undefined {
  return [...c.ads.filter((a) => a.status === 'ENABLED')].sort(
    (a, b) => b.headlines.length - a.headlines.length,
  )[0];
}

export function elementsAnalyzed(c: CampaignData, ev: CampaignEvaluation): number {
  const rsa = pickRsa(c);
  return (
    1 +
    ev.assets.headlines.length +
    ev.assets.descriptions.length +
    ev.assets.sitelinks.length +
    ev.assets.callouts.length +
    ev.assets.structuredSnippets +
    ev.assets.images.length +
    (rsa?.keywords.length ?? 0) +
    c.openRecommendations.length
  );
}

export function planWork(
  c: CampaignData,
  ev: CampaignEvaluation,
  s: UserAgentSettings,
  flags: {
    /** The optimizer's ad-text cooldown/pending-proposal blocker is active. */
    rsaBlocked: boolean;
    imagesAvailable: boolean;
    budgetRecommendations: number;
    hasBusinessName: boolean;
    /** The optimizer may not change keyword headlines right now. */
    keywordsBlocked: boolean;
    /** Ad keywords, most popular first (the optimizer's own order). */
    rankedKeywords?: string[];
  },
): WorkPlan {
  const rsa = pickRsa(c);
  const units: WorkUnits = { analysis: 1 };
  const tasks: WorkPlan['tasks'] = [
    {
      task: 'analysis',
      units: 1,
      detail: 'Sincronizare, analiză și scor față de cerințele Google',
    },
  ];
  const add = (task: keyof WorkUnits, n: number, detail: string) => {
    if (n <= 0) return;
    units[task] = (units[task] ?? 0) + n;
    tasks.push({ task, units: n, detail });
  };

  // Policy compliance always runs first (not gated by the cooldown): each
  // disapproved ad text is rewritten. Removing disapproved assets/keywords
  // is not charged.
  const disapprovedTexts = c.ads
    .filter((a) => a.status === 'ENABLED')
    .flatMap((a) => [...a.headlines, ...a.descriptions])
    .filter((t) => t.approvalStatus === 'DISAPPROVED').length;
  add('text_rewrite', disapprovedTexts, 'texte respinse de Google (politici), rescrise conform');

  if (s.autoApply && rsa && !flags.rsaBlocked) {
    const h = Math.max(0, RSA.headlines.max - rsa.headlines.length);
    const d = Math.max(0, RSA.descriptions.max - rsa.descriptions.length);
    add('rsa_text', h + d, `${h} titluri și ${d} descrieri lipsă`);
  }
  if (s.autoApply) {
    const sl = Math.max(0, SITELINKS.recommended - ev.assets.sitelinks.length);
    const co = Math.max(0, CALLOUTS.ourTarget - ev.assets.callouts.length);
    const sn = ev.assets.structuredSnippets ? 0 : STRUCTURED_SNIPPETS.recommendedValues;
    const bn = flags.hasBusinessName && !ev.assets.businessName ? 1 : 0;
    add(
      'extensions',
      sl + co + sn + bn,
      `${sl} sitelink-uri, ${co} callout-uri, snippet, nume afacere`,
    );
  }
  if (s.autoApply && s.images && flags.imagesAvailable && c.channelType === 'SEARCH') {
    const valid = ev.assets.images.filter((i) => i.valid).length;
    add('images', Math.max(0, CAPS.images - valid), 'imagini lipsă');
  }
  if (s.autoApply && s.keywordHeadlines && rsa && !flags.keywordsBlocked && rsa.keywords.length) {
    const cov = keywordCoverage(
      rsa.headlines.map((h) => h.text),
      flags.rankedKeywords ?? rsa.keywords,
      rsa.actionItems,
    );
    if (keywordsHurtAdStrength(rsa.adStrength, cov)) {
      const room = Math.max(0, RSA.headlines.max - rsa.headlines.length);
      const slots = room || replaceableHeadlines(rsa.headlines, cov.keywords).length;
      add(
        'keyword_headlines',
        Math.min(cov.missing.length, CAPS.keywordHeadlines, slots),
        `${cov.missing.length} cuvinte cheie lipsă din titluri`,
      );
    }
  }
  if (s.textRewriteProposals && rsa) {
    const low = [...rsa.headlines, ...rsa.descriptions].filter(
      (t) => t.performanceLabel === 'LOW',
    ).length;
    add('text_rewrite', Math.min(low, CAPS.lowReplacements), 'texte cu performanță scăzută');
    const full =
      rsa.headlines.length >= RSA.headlines.max && rsa.descriptions.length >= RSA.descriptions.max;
    if (!flags.rsaBlocked && full && (rsa.adStrength === 'POOR' || rsa.adStrength === 'AVERAGE')) {
      add('text_rewrite', CAPS.strengthSwaps, `rescriere pentru Ad Strength (${rsa.adStrength})`);
    }
  }
  if (s.budgetProposals) {
    add(
      'budget_proposal',
      flags.budgetRecommendations,
      'propuneri de buget (necesită aprobarea ta)',
    );
  }
  return { units, elementsAnalyzed: elementsAnalyzed(c, ev), tasks };
}

/** Whether a cycle could change or propose anything: planned work, or
 *  elements refused by Google that the agent removes free of charge. */
export function hasWork(plan: WorkPlan, ev: CampaignEvaluation): boolean {
  return (
    plan.tasks.some((t) => t.task !== 'analysis') || ev.issues.some((i) => i.code === 'disapproved')
  );
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The work a finished cycle actually performed, from the action rows it
 *  wrote (applied changes and proposals). Analysis counts once. */
export function performedWork(
  actions: { action: string; status: string; after: unknown }[],
  analysed: boolean,
): WorkUnits {
  const u: WorkUnits = analysed ? { analysis: 1 } : {};
  const inc = (k: keyof WorkUnits, n: number) => {
    if (n > 0) u[k] = (u[k] ?? 0) + n;
  };
  for (const a of actions) {
    const after = obj(a.after);
    const added = obj(after.added);
    const applied = a.status === 'applied';
    switch (a.action) {
      case 'creative.rsa_gap_fill':
        if (applied) inc('rsa_text', arr(added.headlines).length + arr(added.descriptions).length);
        break;
      case 'creative.assets_gap_fill':
        if (applied)
          inc(
            'extensions',
            arr(added.sitelinks).length +
              arr(added.callouts).length +
              arr(obj(added.structuredSnippet).values).length +
              (added.businessName ? 1 : 0),
          );
        break;
      case 'creative.images_gap_fill':
        if (applied) inc('images', arr(added.images).length);
        break;
      case 'creative.keyword_headlines':
        if (applied) inc('keyword_headlines', arr(after.added).length + arr(after.replaced).length);
        break;
      case 'creative.replace_text':
        inc('text_rewrite', 1);
        break;
      case 'policy.fix_text':
        if (applied) inc('text_rewrite', arr(after.replaced).length);
        break;
      case 'budget.change.proposed':
        inc('budget_proposal', 1);
        break;
    }
  }
  return u;
}
