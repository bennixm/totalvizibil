import { CampaignData } from '../google-ads/optimization/google-ads-account-data';
import { UserAgentSettings } from './agent-settings';

/**
 * What the agent knows about the advertised business, and whether that is
 * enough to optimize its campaign. The check is deterministic and free: it
 * decides when the agent must ask before working, so a customer never pays a
 * cycle for texts written from guesses.
 */

export const BRIEF_FIELDS = [
  'services',
  'areas',
  'audience',
  'goal',
  'differentiators',
  'offer',
  'avoid',
] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];
export type CampaignBrief = Partial<Record<BriefField, string>>;
const FIELD_MAX = 400;

export function readBrief(raw: unknown): CampaignBrief {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: CampaignBrief = {};
  for (const f of BRIEF_FIELDS) {
    const v = typeof o[f] === 'string' ? o[f].trim().slice(0, FIELD_MAX) : '';
    if (v) out[f] = v;
  }
  return out;
}

/** Merges a patch; an empty string removes the field. Unknown keys ignored. */
export function mergeBrief(current: unknown, patch: unknown): CampaignBrief {
  const p = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {};
  const known = Object.fromEntries(BRIEF_FIELDS.filter((f) => f in p).map((f) => [f, p[f]]));
  return readBrief({ ...readBrief(current), ...known });
}

const LABEL: Record<BriefField, string> = {
  services: 'Servicii/produse',
  areas: 'Zone deservite',
  audience: 'Clienți vizați',
  goal: 'Scopul campaniei',
  differentiators: 'Avantaje',
  offer: 'Ofertă actuală',
  avoid: 'De evitat în texte',
};

/** Business context for every AI text (optimization cycles included). */
export function businessContext(s: UserAgentSettings, brief: CampaignBrief): string {
  return [
    s.businessDescription,
    ...BRIEF_FIELDS.filter((f) => brief[f]).map((f) => `${LABEL[f]}: ${brief[f]}`),
  ]
    .filter(Boolean)
    .join('. ');
}

export type GapKey =
  | 'business'
  | 'landing'
  | 'ads'
  | 'keywords'
  | 'services'
  | 'areas'
  | 'goal'
  | 'audience'
  | 'differentiators'
  | 'traffic';
export interface Gap {
  key: GapKey;
  /** `required`: without it the agent would be guessing. */
  severity: 'required' | 'useful';
  /** Something the owner can answer (false = only time/traffic solves it). */
  askable: boolean;
}
export interface Readiness {
  level: 'ready' | 'partial' | 'insufficient';
  /** 0-100, how much of what the agent needs is known. */
  score: number;
  gaps: Gap[];
}

const MIN_LANDING_TEXT = 400;
const MIN_DESCRIPTION = 30;
const LOW_TRAFFIC_IMPRESSIONS = 100;

const WEIGHT: Record<GapKey, number> = {
  business: 25,
  landing: 10,
  ads: 15,
  keywords: 15,
  services: 10,
  areas: 5,
  goal: 5,
  audience: 5,
  differentiators: 5,
  traffic: 5,
};

function withLevel(gaps: Gap[]): Readiness {
  const lost = gaps.reduce((n, g) => n + WEIGHT[g.key] * (g.severity === 'required' ? 1 : 0.6), 0);
  return {
    level: gaps.some((g) => g.severity === 'required')
      ? 'insufficient'
      : gaps.filter((g) => g.askable).length > 1
        ? 'partial'
        : 'ready',
    score: Math.max(0, Math.round(100 - lost)),
    gaps,
  };
}

export function assessReadiness(
  c: CampaignData,
  s: UserAgentSettings,
  brief: CampaignBrief,
  landingText: string,
): Readiness {
  const gaps: Gap[] = [];
  const gap = (key: GapKey, severity: Gap['severity'], askable = true) =>
    gaps.push({ key, severity, askable });

  const ads = c.ads.filter((a) => a.status === 'ENABLED');
  const landingOk = landingText.length >= MIN_LANDING_TEXT;
  const described = s.businessDescription.length >= MIN_DESCRIPTION;
  // Without an enabled ad, keywords are unknown here (they hang off the ad's
  // group): the missing ad is the thing to report.
  const keywords = new Set(ads.flatMap((a) => a.keywords)).size;

  if (!landingOk && !described && !brief.services) gap('business', 'required');
  else if (!brief.services && !described) gap('services', 'useful');
  if (!landingOk) gap('landing', 'useful');
  if (!ads.length) gap('ads', 'required');
  else if (!keywords) gap('keywords', 'required');
  else if (keywords < 5) gap('keywords', 'useful');
  if (!brief.areas) gap('areas', 'useful');
  if (!brief.goal) gap('goal', 'useful');
  if (!brief.audience) gap('audience', 'useful');
  if (!brief.differentiators) gap('differentiators', 'useful');
  if (c.current.impressions < LOW_TRAFFIC_IMPRESSIONS) gap('traffic', 'useful', false);

  return withLevel(gaps);
}

/** The last sync's readiness, minus what the owner has answered since. */
export function readinessNow(
  r: Readiness | null | undefined,
  brief: CampaignBrief,
): Readiness | null {
  if (!r || !Array.isArray(r.gaps)) return null;
  const answered = (k: GapKey) =>
    k === 'business' ? !!brief.services : !!(brief as Record<string, string | undefined>)[k];
  return withLevel(r.gaps.filter((g) => !answered(g.key)));
}
