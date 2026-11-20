/**
 * Google Ads continuous-optimization API (backend: GoogleAdsMonitorService,
 * AdminGoogleAdsService optimization endpoints). Every value here comes
 * from real Google Ads data synced by the monitor cycle; the UI only
 * renders it. Kept out of the (already large) admin store on purpose.
 */
import { apiFetch } from '@/services/api'
import type { GoogleAdsAgentActionRow } from '@/stores/admin'

export type IssuePriority = 'critical' | 'high' | 'medium' | 'low'
export type ComponentStatus = 'ok' | 'attention' | 'missing' | 'na'
export type AgentEventStatus = 'running' | 'completed' | 'failed' | 'waiting_approval' | 'skipped'

export interface GoogleAdsIssue {
  code: string
  priority: IssuePriority
  area: string
  title: string
  why: string
  action: string
  autoFixable: boolean
  source?: string
  scope?: 'campaign' | 'account'
}

export interface GoogleAdsScoreComponent {
  key: string
  label: string
  max: number
  earned: number
  status: ComponentStatus
  explanation: string
  missing: string[]
  source?: string
}

export interface PeriodMetrics {
  impressions: number
  clicks: number
  costMicros: number
  conversions: number
  conversionsValue: number
}

export interface GoogleAdsCampaignMetrics {
  current: PeriodMetrics & {
    ctr: number | null
    cpc: number | null
    cpa: number | null
    roas: number | null
  }
  previous: PeriodMetrics & { ctr: number | null }
  ctrChange: number | null
  clicksChange: number | null
  comparable: boolean
  periodDays: number
}

export interface GoogleAdsTextItem {
  text: string
  length: number
  performanceLabel?: string
  approvalStatus?: string
  pinnedField?: string
}

export interface GoogleAdsImageItem {
  fieldType: string
  level: string
  width: number
  height: number
  fileSize: number
  format: string
  valid: boolean
  problems: string[]
}

export interface GoogleAdsAssetSummary {
  evaluatedOn: string | null
  headlines: GoogleAdsTextItem[]
  longHeadlines: GoogleAdsTextItem[]
  descriptions: GoogleAdsTextItem[]
  sitelinks: {
    linkText: string
    description1?: string
    description2?: string
    finalUrl?: string
    level: string
  }[]
  callouts: { text: string; level: string }[]
  structuredSnippets: number
  images: GoogleAdsImageItem[]
  logos: GoogleAdsImageItem[]
  videos: { youtubeVideoId: string; title?: string }[]
  businessName: string | null
  finalUrls: string[]
  adsCount: number
  /** Search only: which ad-group keywords appear in the headlines. */
  headlineKeywords?: { covered: string[]; missing: string[]; googleFlagged: boolean }
}

export interface GoogleAdsAgentEvent {
  id: string
  runId: string | null
  googleCampaignId: string | null
  campaignName: string | null
  step: string
  message: string
  status: AgentEventStatus
  result: string | null
  details: unknown
  startedAt: string
  finishedAt: string | null
}

export interface GoogleAdsOptimizationSummary {
  accountScore: number | null
  accountScoreWeighting: 'spend' | 'average'
  campaigns: number
  activeCampaigns: number
  managedCampaigns: number
  optimizedCampaigns: number
  attentionCampaigns: number
  opportunities: number
  autoFixableOpportunities: number
  accountIssues: GoogleAdsIssue[]
  issuesByPriority: Record<IssuePriority, number>
  pendingApprovals: number
  lastSyncAt: string | null
  lastRun: {
    status: string
    startedAt: string
    finishedAt: string | null
    actionsTaken: number
    actionsPendingApproval: number
    errorSummary: string | null
  } | null
  lastOptimization: {
    action: string
    label: string
    at: string
    googleCampaignId: string | null
  } | null
  running: boolean
  writesAllowed: boolean
  enabled: boolean
  monitorIntervalMinutes: number
  autoFillEnabled: boolean
}

export interface GoogleAdsOptimizationCampaignRow {
  googleCampaignId: string
  name: string
  channelType: string
  status: string
  primaryStatus: string | null
  managed: boolean
  adStrength: string | null
  score: number | null
  metrics: GoogleAdsCampaignMetrics
  currencyCode: string | null
  syncedAt: string
  lastOptimizedAt: string | null
  issueCounts: Record<IssuePriority, number>
}

export interface GoogleAdsOptimizationCampaignDetail {
  snapshot: Omit<GoogleAdsOptimizationCampaignRow, 'issueCounts'> & {
    primaryStatusReasons: string[]
    biddingStrategyType: string | null
    dailyBudgetMicros: string | null
    scoreBreakdown: GoogleAdsScoreComponent[]
    issues: GoogleAdsIssue[]
    assets: GoogleAdsAssetSummary
  }
  history: GoogleAdsAgentActionRow[]
  events: GoogleAdsAgentEvent[]
}

const BASE = '/admin/google-ads-agent'

export const googleAdsOptimizationApi = {
  summary: () => apiFetch<GoogleAdsOptimizationSummary>(`${BASE}/optimization/summary`),
  campaigns: () => apiFetch<GoogleAdsOptimizationCampaignRow[]>(`${BASE}/optimization/campaigns`),
  campaign: (googleCampaignId: string) =>
    apiFetch<GoogleAdsOptimizationCampaignDetail>(
      `${BASE}/optimization/campaigns/${encodeURIComponent(googleCampaignId)}`,
    ),
  activity: (params: { after?: string; googleCampaignId?: string; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.after) q.set('after', params.after)
    if (params.googleCampaignId) q.set('googleCampaignId', params.googleCampaignId)
    if (params.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return apiFetch<{ events: GoogleAdsAgentEvent[]; running: boolean; serverTime: string }>(
      `${BASE}/activity${qs ? `?${qs}` : ''}`,
    )
  },
  runMonitor: () => apiFetch<{ started: boolean }>(`${BASE}/run/monitor`, { method: 'POST' }),
}

/** Google's Ad Strength enum → a display tone. */
export function adStrengthTone(
  v: string | null | undefined,
): 'success' | 'warning' | 'error' | 'neutral' {
  if (v === 'EXCELLENT' || v === 'GOOD') return 'success'
  if (v === 'AVERAGE') return 'warning'
  if (v === 'POOR') return 'error'
  return 'neutral'
}

export function scoreTone(
  score: number | null | undefined,
): 'success' | 'warning' | 'error' | 'neutral' {
  if (score === null || score === undefined) return 'neutral'
  if (score >= 85) return 'success'
  if (score >= 60) return 'warning'
  return 'error'
}
