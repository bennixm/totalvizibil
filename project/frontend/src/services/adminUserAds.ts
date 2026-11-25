/** Staff administration of one customer's Google Ads campaigns.
 *  Backend: src/google-ads-user/admin-user-ads.controller.ts (admin only). */
import type { AdsApi } from '@/components/ads/adsApi'
import { apiFetch } from './api'
import type { AgentSettings, UserAction, UserCampaignDetail } from './googleAdsUser'

export interface AdminAdsCampaign {
  id: string
  name: string
  customerId: string
  customerName: string | null
  googleCampaignId: string
  channelType: string | null
  status: 'active' | 'paused' | 'disconnected'
  score: number | null
  adStrength: string | null
  syncedAt: string | null
  lastCycleAt: string | null
  nextCycleAt: string | null
  createdAt: string
  googleEmail: string | null
  connectionStatus: string
  pendingApprovals: number
}

export interface AdsEditorText {
  text: string
  pinned: boolean
}
export interface AdsEditorData {
  writesAllowed: boolean
  status: string
  currencyCode: string | null
  budget: { amountMicros: string; shared: boolean } | null
  pendingBudgetMicros: string | null
  landingUrl: string
  ad: { headlines: AdsEditorText[]; descriptions: AdsEditorText[] } | null
  keywords: { text: string; matchType: string; status: string; negative: boolean }[]
  sitelinks: { text: string; url: string }[]
  callouts: string[]
}
export type AdminAdsChangeKind = 'ad_texts' | 'keywords' | 'extensions' | 'status' | 'budget'

export interface UserActivityItem {
  id: string
  createdAt: string
  source: 'owner' | 'staff' | 'google_ads' | 'google_ads_cycle' | 'session' | 'ticket'
  action: string
  status: string | null
  subject: string | null
  actor: string | null
  reason: string | null
}

const SLOW = { timeoutMs: 90_000 }

export function adminUserAdsApi(userId: string): AdsApi & {
  list: () => Promise<AdminAdsCampaign[]>
  editor: (id: string) => Promise<AdsEditorData>
  change: (id: string, kind: AdminAdsChangeKind, input: object, reason: string) => Promise<UserAction>
} {
  const base = `/admin/users/${userId}/google-ads/campaigns`
  return {
    list: () => apiFetch<AdminAdsCampaign[]>(base),
    detail: (id) => apiFetch<UserCampaignDetail>(`${base}/${id}`),
    editor: (id) => apiFetch<AdsEditorData>(`${base}/${id}/editor`, SLOW),
    change: (id, kind, input, reason) =>
      apiFetch<UserAction>(`${base}/${id}/changes`, { method: 'POST', body: { kind, input, reason }, ...SLOW }),
    sync: (id) => apiFetch(`${base}/${id}/sync`, { method: 'POST', ...SLOW }),
    quote: (id) => apiFetch(`${base}/${id}/quote`, SLOW),
    startCycle: (id, idempotencyKey, _price, ignoreMissingInfo = false) =>
      apiFetch(`${base}/${id}/cycles`, { method: 'POST', body: { idempotencyKey, ignoreMissingInfo }, ...SLOW }),
    actions: (id) => apiFetch<UserAction[]>(`${base}/${id}/actions`),
    activity: (id, after) =>
      apiFetch(`${base}/${id}/activity${after ? `?after=${encodeURIComponent(after)}` : ''}`),
    saveSettings: (id, patch) =>
      apiFetch<AgentSettings>(`${base}/${id}/settings`, { method: 'PATCH', body: patch }),
    pause: (id) => apiFetch(`${base}/${id}/pause`, { method: 'POST' }),
    resume: (id) => apiFetch(`${base}/${id}/resume`, { method: 'POST' }),
    approve: (id, actionId) =>
      apiFetch<UserAction>(`${base}/${id}/actions/${actionId}/approve`, { method: 'POST', ...SLOW }),
    reject: (id, actionId) => apiFetch(`${base}/${id}/actions/${actionId}/reject`, { method: 'POST' }),
  }
}

export function fetchUserActivity(userId: string, before?: string | null) {
  return apiFetch<{ items: UserActivityItem[]; next: string | null }>(
    `/admin/users/${userId}/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`,
  )
}
