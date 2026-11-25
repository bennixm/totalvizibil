/**
 * Per-campaign settings of a customer's optimization agent. Every switch maps
 * onto an existing capability of the platform optimizer
 * (google-ads/optimization/); nothing here invents a new optimization.
 * Budget changes are never a setting: they are always proposals the owner
 * approves (see GoogleAdsUserService.approveAction).
 */

export const SCHEDULES = ['manual', 'weekly', 'biweekly', 'monthly'] as const;
export type Schedule = (typeof SCHEDULES)[number];

export interface UserAgentSettings {
  /** Add missing headlines/descriptions, sitelinks, callouts, snippet and
   *  business name automatically (the optimizer's gap filling). */
  autoApply: boolean;
  /** Write the ad group's missing keywords into the headlines when that
   *  holds Ad Strength back (applied automatically, restored if worse). */
  keywordHeadlines: boolean;
  /** Add stock photos (Pexels, free commercial license) as image assets. */
  images: boolean;
  /** Search terms for the photos (English works best). */
  imageQuery: string;
  /** Propose rewrites of weak texts (LOW-rated, Ad Strength) for approval. */
  textRewriteProposals: boolean;
  /** Turn Google's own budget recommendations into proposals to approve. */
  budgetProposals: boolean;
  /** Days between automatic ad-text changes, so Google can evaluate them. */
  creativeCooldownDays: number;
  /** Automatic cycles (each one billed). `manual` = only when started. */
  schedule: Schedule;
  /** A scheduled cycle whose price would exceed this is skipped. */
  maxCreditsPerCycle: number;
  /** Most the chat may cost per day on this campaign (0 = no limit). */
  chatDailyLimitCredits: number;
  /** Shown next to the ads as the BUSINESS_NAME asset (max 25 characters). */
  businessName: string;
  /** What the business does; context for every text the AI writes. */
  businessDescription: string;
}

export const DEFAULT_AGENT_SETTINGS: UserAgentSettings = {
  autoApply: true,
  keywordHeadlines: true,
  images: false,
  imageQuery: '',
  textRewriteProposals: true,
  budgetProposals: true,
  creativeCooldownDays: 7,
  schedule: 'manual',
  maxCreditsPerCycle: 30,
  chatDailyLimitCredits: 20,
  businessName: '',
  businessDescription: '',
};

export const SCHEDULE_DAYS: Record<Schedule, number | null> = {
  manual: null,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

export function readSettings(raw: unknown): UserAgentSettings {
  const o = raw && typeof raw === 'object' ? (raw as Partial<UserAgentSettings>) : {};
  const s = { ...DEFAULT_AGENT_SETTINGS, ...o };
  return {
    autoApply: !!s.autoApply,
    keywordHeadlines: !!s.keywordHeadlines,
    images: !!s.images,
    imageQuery: String(s.imageQuery ?? '').slice(0, 80),
    textRewriteProposals: !!s.textRewriteProposals,
    budgetProposals: !!s.budgetProposals,
    creativeCooldownDays: clampInt(s.creativeCooldownDays, 1, 60, 7),
    schedule: SCHEDULES.includes(s.schedule as Schedule) ? (s.schedule as Schedule) : 'manual',
    maxCreditsPerCycle: clampNum(s.maxCreditsPerCycle, 1, 100_000, 30),
    chatDailyLimitCredits: clampNum(s.chatDailyLimitCredits, 0, 100_000, 20),
    businessName: String(s.businessName ?? '')
      .trim()
      .slice(0, 25),
    businessDescription: String(s.businessDescription ?? '')
      .trim()
      .slice(0, 300),
  };
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
}
function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : dflt;
}
