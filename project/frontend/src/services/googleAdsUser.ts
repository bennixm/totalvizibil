/**
 * Google Ads optimization builder (customers' own Google Ads accounts).
 * Backend: src/google-ads-user/. Builder steps run before an account exists
 * and are authorized by a draft token kept in this browser (only its hash is
 * stored server-side); campaign management uses the normal session.
 */
import { apiFetch } from '@/services/api'
import type {
  GoogleAdsAgentEvent,
  GoogleAdsAssetSummary,
  GoogleAdsIssue,
  GoogleAdsScoreComponent,
  GoogleAdsCampaignMetrics,
} from '@/services/google-ads-optimization'

const BASE = '/google-ads-user'
const DRAFT_KEY = 'tvz.adsDraft.v1'

export function readDraftToken(): string | null {
  try {
    return localStorage.getItem(DRAFT_KEY)
  } catch {
    return null
  }
}
export function saveDraftToken(token: string): void {
  try {
    localStorage.setItem(DRAFT_KEY, token)
  } catch {
    /* without storage the builder still works for this page view */
  }
}
export function clearDraftToken(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

function draftHeaders(): Record<string, string> {
  const t = readDraftToken()
  return t ? { 'x-ads-draft': t } : {}
}

export interface ConnectionView {
  id: string
  status: 'pending' | 'connected' | 'revoked' | 'error'
  googleEmail: string | null
  lastError: string | null
  selected: { customerId: string; loginCustomerId: string | null; campaignId: string } | null
  /** All campaigns picked in the builder (multi-select). */
  selections?: SelectionItem[]
}

/** One picked campaign (account + campaign). */
export interface SelectionItem {
  customerId: string
  loginCustomerId: string | null
  campaignId: string
}

/** A Google account connected by the signed-in owner. */
export interface GoogleConnection {
  id: string
  googleEmail: string | null
  status: 'pending' | 'connected' | 'revoked' | 'error'
  connectedAt: string | null
  lastError: string | null
  campaigns: {
    id: string
    name: string
    status: 'active' | 'paused' | 'disconnected'
    customerName: string | null
    customerId: string
  }[]
}

export interface AdsAccount {
  customerId: string
  loginCustomerId: string | null
  name: string
  currencyCode: string | null
  manager: boolean
  testAccount: boolean
  selectable: boolean
  reason?: 'manager_no_clients' | 'not_enabled' | string
  status?: string
}

export interface AdsCampaignListItem {
  id: string
  name: string
  status: string
  primaryStatus: string | null
  channelType: string
  biddingStrategyType: string | null
  dailyBudgetMicros: string | null
  currencyCode: string | null
  supported: boolean
  /** Already in the owner's panel (connected-account "add" flow only). */
  managed?: boolean
  last30: { impressions: number; clicks: number; costMicros: number; conversions: number }
}

export interface PriceLine {
  task: string
  units: number
  creditsPerUnit: number
  credits: number
}
export interface PriceBreakdown {
  lines: PriceLine[]
  elementsAnalyzed: number
  elementsCredits: number
  points: number
  level: { key: string; label: string; multiplier: number }
  computedCredits: number
  minCredits: number
  maxCredits: number
  credits: number
  minor: number
}
export interface PlannedTask {
  task: string
  units: number
  detail: string
}

export type Schedule = 'manual' | 'weekly' | 'biweekly' | 'monthly'
export interface AgentSettings {
  autoApply: boolean
  keywordHeadlines: boolean
  images: boolean
  imageQuery: string
  textRewriteProposals: boolean
  budgetProposals: boolean
  creativeCooldownDays: number
  schedule: Schedule
  maxCreditsPerCycle: number
  chatDailyLimitCredits: number
  businessName: string
  businessDescription: string
}

export const BRIEF_FIELDS = ['services', 'areas', 'audience', 'goal', 'differentiators', 'offer', 'avoid'] as const
export type CampaignBrief = Partial<Record<(typeof BRIEF_FIELDS)[number], string>>

/** Whether the agent knows enough to optimize the campaign. */
export interface Readiness {
  level: 'ready' | 'partial' | 'insufficient'
  score: number
  gaps: { key: string; severity: 'required' | 'useful'; askable: boolean }[]
}

export interface ChatPrice {
  baseCredits: number
  aiCredits: number
  lines: { type: string; units: number; creditsPerUnit: number; credits: number }[]
  credits: number
  minor: number
}
export interface ChatTurn {
  id: string
  status: 'running' | 'completed' | 'failed'
  userText: string
  assistantText: string | null
  questions: { question: string; options: string[] }[]
  chargedMinor: number
  heldMinor: number
  pricing: ChatPrice | null
  errorCode: string | null
  createdAt: string
  actions: UserAction[]
}
export interface AdsConversation {
  turns: ChatTurn[]
  brief: CampaignBrief
  readiness: Readiness | null
  available: boolean
  pricing: { minCredits: number; maxCredits: number; baseCredits: number; changeCredits: Record<string, number> }
  spentTodayMinor: number
  dailyLimitMinor: number | null
  balanceMinor: number
}

export interface UserAction {
  id: string
  cycleId: string | null
  action: string
  status: 'applied' | 'pending_approval' | 'rejected' | 'failed' | 'approved' | 'superseded'
  before: unknown
  after: unknown
  reasoning: string | null
  executionResult: string | null
  errorMessage: string | null
  verifiedAt: string | null
  createdAt: string
}

export interface OptimizationCycle {
  id: string
  trigger: 'manual' | 'scheduled' | 'staff'
  status: 'running' | 'completed' | 'failed'
  quote: PriceBreakdown & { tasks?: PlannedTask[] }
  quotedMinor: number
  chargedMinor: number
  refundedMinor: number
  settlement: PriceBreakdown | null
  complexityLevel: string | null
  tasksPlanned: number
  tasksApplied: number
  tasksProposed: number
  elementsAnalyzed: number
  scoreBefore: number | null
  scoreAfter: number | null
  summary: string | null
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
}

export interface CampaignSnapshot {
  evaluation: {
    score: number | null
    components: GoogleAdsScoreComponent[]
    issues: GoogleAdsIssue[]
    assets: GoogleAdsAssetSummary
    adStrength: string | null
    performance: Omit<GoogleAdsCampaignMetrics, 'periodDays'>
  }
  campaign: {
    status: string
    primaryStatus: string | null
    primaryStatusReasons: string[]
    channelType: string
    biddingStrategyType: string | null
    dailyBudgetMicros: string | null
    currencyCode: string | null
    keywords: number
  }
  syncedAt: string
}

export interface UserCampaignSummary {
  id: string
  name: string
  customerName: string | null
  status: 'active' | 'paused' | 'disconnected'
  score: number | null
  adStrength: string | null
  lastCycleAt: string | null
  pendingApprovals: number
}

export interface UserCampaignDetail {
  campaign: {
    id: string
    name: string
    customerId: string
    customerName: string | null
    googleCampaignId: string
    channelType: string | null
    currencyCode: string | null
    status: 'active' | 'paused' | 'disconnected'
    score: number | null
    adStrength: string | null
    syncedAt: string | null
    lastCycleAt: string | null
    nextCycleAt: string | null
    createdAt: string
  }
  connection: { status: string; googleEmail: string | null } | null
  snapshot: CampaignSnapshot | null
  settings: AgentSettings
  readiness: Readiness | null
  pending: UserAction[]
  cycles: OptimizationCycle[]
  runningCycle: { id: string; startedAt: string } | null
  firstCycleDone: boolean
  pricing: { minCredits: number; maxCredits: number; levels: { key: string; label: string; minPoints: number; multiplier: number }[] }
  balance: { minor: number; credits: number }
}

export const googleAdsUserApi = {
  status: () => apiFetch<{ available: boolean; minCredits: number }>(`${BASE}/status`),
  start: () =>
    apiFetch<{ draftToken: string; connection: ConnectionView }>(`${BASE}/builder/start`, {
      method: 'POST',
      body: { draftToken: readDraftToken() ?? undefined },
    }),
  state: () => apiFetch<ConnectionView>(`${BASE}/builder/state`, { headers: draftHeaders() }),
  connectUrl: () =>
    apiFetch<{ url: string }>(`${BASE}/builder/connect-url`, {
      method: 'POST',
      headers: draftHeaders(),
    }),
  disconnectDraft: () =>
    apiFetch<ConnectionView>(`${BASE}/builder/disconnect`, {
      method: 'POST',
      headers: draftHeaders(),
    }),
  accounts: () =>
    apiFetch<AdsAccount[]>(`${BASE}/builder/accounts`, { headers: draftHeaders(), timeoutMs: 45_000 }),
  campaigns: (customerId: string, loginCustomerId: string | null) =>
    apiFetch<AdsCampaignListItem[]>(
      `${BASE}/builder/campaigns?customerId=${encodeURIComponent(customerId)}` +
        (loginCustomerId ? `&loginCustomerId=${encodeURIComponent(loginCustomerId)}` : ''),
      { headers: draftHeaders(), timeoutMs: 30_000 },
    ),
  select: (items: SelectionItem[]) =>
    apiFetch<ConnectionView>(`${BASE}/builder/select`, {
      method: 'POST',
      headers: draftHeaders(),
      body: { items },
      timeoutMs: 45_000,
    }),
  claim: () =>
    apiFetch<{ campaignId: string; campaignIds: string[]; taken?: string[] }>(`${BASE}/builder/claim`, {
      method: 'POST',
      headers: draftHeaders(),
      timeoutMs: 180_000,
    }),

  // --- connected Google accounts (signed-in owner) ---
  connections: () => apiFetch<GoogleConnection[]>(`${BASE}/connections`),
  connectionAccounts: (id: string) =>
    apiFetch<AdsAccount[]>(`${BASE}/connections/${id}/accounts`, { timeoutMs: 45_000 }),
  connectionCampaigns: (id: string, customerId: string, loginCustomerId: string | null) =>
    apiFetch<AdsCampaignListItem[]>(
      `${BASE}/connections/${id}/campaigns?customerId=${encodeURIComponent(customerId)}` +
        (loginCustomerId ? `&loginCustomerId=${encodeURIComponent(loginCustomerId)}` : ''),
      { timeoutMs: 30_000 },
    ),
  addCampaigns: (id: string, items: SelectionItem[]) =>
    apiFetch<{ campaignIds: string[]; taken?: string[] }>(`${BASE}/connections/${id}/campaigns`, {
      method: 'POST',
      body: { items },
      timeoutMs: 180_000,
    }),
  disconnectConnection: (id: string) =>
    apiFetch<{ ok: true }>(`${BASE}/connections/${id}/disconnect`, { method: 'POST' }),
  reconnectConnection: (id: string) =>
    apiFetch<{ url: string }>(`${BASE}/connections/${id}/reconnect-url`, { method: 'POST' }),

  list: () => apiFetch<UserCampaignSummary[]>(`${BASE}/campaigns`),
  detail: (id: string) => apiFetch<UserCampaignDetail>(`${BASE}/campaigns/${id}`),
  sync: (id: string) =>
    apiFetch<{ synced: boolean }>(`${BASE}/campaigns/${id}/sync`, { method: 'POST', timeoutMs: 90_000 }),
  quote: (id: string) =>
    apiFetch<{ quote: PriceBreakdown; tasks: PlannedTask[]; score: number | null; readiness: Readiness; nothingToDo: boolean; balanceMinor: number }>(
      `${BASE}/campaigns/${id}/quote`,
      { timeoutMs: 90_000 },
    ),
  startCycle: (id: string, idempotencyKey: string, expectedQuoteMinor: number, ignoreMissingInfo = false) =>
    apiFetch<{ cycleId: string; status: string; chargedMinor: number }>(
      `${BASE}/campaigns/${id}/cycles`,
      { method: 'POST', body: { idempotencyKey, expectedQuoteMinor, ignoreMissingInfo }, timeoutMs: 90_000 },
    ),
  chat: (id: string) => apiFetch<AdsConversation>(`${BASE}/campaigns/${id}/chat`),
  sendChat: (id: string, text: string, idempotencyKey: string, locale: string) =>
    apiFetch<{ turnId: string; status: string }>(`${BASE}/campaigns/${id}/chat`, {
      method: 'POST',
      body: { text, idempotencyKey, locale },
      timeoutMs: 30_000,
    }),
  saveBrief: (id: string, patch: CampaignBrief) =>
    apiFetch<CampaignBrief>(`${BASE}/campaigns/${id}/brief`, { method: 'PATCH', body: patch }),
  actions: (id: string) => apiFetch<UserAction[]>(`${BASE}/campaigns/${id}/actions`),
  activity: (id: string, after?: string) =>
    apiFetch<{ events: GoogleAdsAgentEvent[]; running: boolean; serverTime: string }>(
      `${BASE}/campaigns/${id}/activity${after ? `?after=${encodeURIComponent(after)}` : ''}`,
    ),
  saveSettings: (id: string, patch: Partial<AgentSettings>) =>
    apiFetch<AgentSettings>(`${BASE}/campaigns/${id}/settings`, { method: 'PATCH', body: patch }),
  pause: (id: string) => apiFetch(`${BASE}/campaigns/${id}/pause`, { method: 'POST' }),
  resume: (id: string) => apiFetch(`${BASE}/campaigns/${id}/resume`, { method: 'POST' }),
  remove: (id: string) => apiFetch(`${BASE}/campaigns/${id}`, { method: 'DELETE' }),
  disconnect: (id: string) =>
    apiFetch<{ ok: true }>(`${BASE}/campaigns/${id}/disconnect`, { method: 'POST' }),
  reconnectUrl: (id: string) =>
    apiFetch<{ url: string }>(`${BASE}/campaigns/${id}/reconnect-url`, { method: 'POST' }),
  approve: (id: string, actionId: string) =>
    apiFetch<UserAction>(`${BASE}/campaigns/${id}/actions/${actionId}/approve`, {
      method: 'POST',
      timeoutMs: 90_000,
    }),
  reject: (id: string, actionId: string) =>
    apiFetch(`${BASE}/campaigns/${id}/actions/${actionId}/reject`, { method: 'POST' }),
}

// --- admin ------------------------------------------------------------------

export interface OptimizerPricing {
  minCredits: number
  maxCredits: number
  taskCredits: Record<string, number>
  perElementCredits: number
  levels: { key: string; label: string; minPoints: number; multiplier: number }[]
}

export interface ChatPricing {
  minCredits: number
  maxCredits: number
  baseCredits: number
  aiMarkup: number
  changeCredits: Record<string, number>
  maxAiCalls: number
}

export interface AdminOptimizerUsage {
  chat: { messages: number; failed: number; chargedMinor: number; aiCostMinor: number; aiCalls: number }
  totals: {
    cycles: number
    chargedMinor: number
    refundedMinor: number
    quotedMinor: number
    aiCostMinor: number
    aiCalls: number
    tasksApplied: number
    tasksProposed: number
    campaigns: number
    connectedAccounts: number
  }
  byLevel: { level: string | null; cycles: number; chargedMinor: number }[]
  page: number
  pageSize: number
  cycles: {
    id: string
    startedAt: string
    finishedAt: string | null
    status: string
    trigger: string
    user: { id: string; email: string; name: string }
    campaign: { name: string; customerName: string | null }
    complexityLevel: string | null
    complexityPoints: number | null
    quotedMinor: number
    chargedMinor: number
    refundedMinor: number
    aiCostMinor: number
    aiCallCount: number
    tasksApplied: number
    tasksProposed: number
    elementsAnalyzed: number
    scoreBefore: number | null
    scoreAfter: number | null
    errorMessage: string | null
  }[]
}

export interface AdminAllCampaigns {
  page: number
  pageSize: number
  total: number
  items: {
    id: string
    name: string
    customerName: string | null
    customerId: string
    status: 'active' | 'paused' | 'disconnected'
    score: number | null
    syncedAt: string | null
    nextCycleAt: string | null
    user: { id: string; name: string; email: string }
    googleEmail: string | null
    lastError: string | null
    lastCycle: { status: string; startedAt: string; errorMessage: string | null } | null
    pendingApprovals: number
  }[]
}

export interface AdminOauthConfig {
  clientId: string
  clientSecretSet: boolean
  clientIdFromEnv: boolean
  tokenKeyConfigured: boolean
  redirectUri: string
  missing: string[]
}

const ADMIN = '/admin/google-ads-optimizer'
export const adminGoogleAdsUserApi = {
  pricing: () => apiFetch<{ pricing: OptimizerPricing; defaults: OptimizerPricing }>(`${ADMIN}/pricing`),
  savePricing: (p: OptimizerPricing) =>
    apiFetch<{ pricing: OptimizerPricing; defaults: OptimizerPricing }>(`${ADMIN}/pricing`, {
      method: 'PATCH',
      body: p,
    }),
  chatPricing: () => apiFetch<{ pricing: ChatPricing; defaults: ChatPricing }>(`${ADMIN}/chat-pricing`),
  saveChatPricing: (p: ChatPricing) =>
    apiFetch<{ pricing: ChatPricing; defaults: ChatPricing }>(`${ADMIN}/chat-pricing`, { method: 'PATCH', body: p }),
  oauth: () => apiFetch<AdminOauthConfig>(`${ADMIN}/oauth`),
  saveOauth: (input: { clientId?: string; clientSecret?: string }) =>
    apiFetch<AdminOauthConfig>(`${ADMIN}/oauth`, { method: 'PATCH', body: input }),
  usage: (from?: string, to?: string, page = 1) =>
    apiFetch<AdminOptimizerUsage>(
      `${ADMIN}/usage?${new URLSearchParams({ page: String(page), ...(from ? { from } : {}), ...(to ? { to } : {}) })}`,
    ),
  campaigns: (f: { search: string; status: string; problem: boolean; page: number }) =>
    apiFetch<AdminAllCampaigns>(
      `${ADMIN}/campaigns?${new URLSearchParams({
        page: String(f.page),
        ...(f.search ? { search: f.search } : {}),
        ...(f.status ? { status: f.status } : {}),
        ...(f.problem ? { problem: '1' } : {}),
      })}`,
    ),
}
