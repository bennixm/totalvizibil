import { defineStore } from 'pinia'

import { apiFetch, ApiError, BASE_URL } from '@/services/api'
import type { PlatformRole } from '@/stores/auth'
import type { BillingProfile, BillingProfileInput } from '@/stores/billing'
import type { CampaignPayload, CampaignSpend, FeedRankEntry, SaveCampaignInput } from '@/stores/campaign'
import type { DashboardAnalytics, LocalizedName } from '@/stores/companies'
import type { WebsiteContent, WebsiteTheme } from '@/types/website'
import type { ConsumptionEntry, SpendCategory } from '@/stores/wallet'

/**
 * Why every fetcher below has a `catch`: they used to be
 * `try { … } finally { loading = false }` with no catch at all, so ANY
 * backend failure — a 403 for the wrong staff role, a timeout, a 500 —
 * resolved into an untouched empty list and rendered as a perfectly calm
 * "no data yet" page. The views read these `*Error` fields and surface the
 * reason instead (same shape `AdminUserDetailView`'s `loadError` already
 * used).
 */
function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return 'request failed'
}

export interface AdminStats {
  users: {
    total: number
    active: number
    suspended: number
    withTwoFactor: number
    staff: number
    new7d: number
    new30d: number
  }
  companies: {
    total: number
    draft: number
    active: number
    suspended: number
    withWebsite: number
    websitesPublished: number
    new7d: number
    new30d: number
    pendingDeletion: number
    byCountry: { country: string; count: number }[]
  }
  economy: {
    creditsSold: Money
    creditsSold30d: Money
    ronCollected: number
    ronCollected30d: number
    cpcConsumed: Money
    cpcConsumed30d: Money
    refunded: Money
    pendingPurchases: number
    walletsBlocked: number
  }
  campaigns: {
    active: number
    paused: number
    depleted: number
    draft: number
    autoOptimize: number
    committedDailyBudget: Money
    clicks30d: number
    leads30d: number
  }
  staffByRole: { role: PlatformRole; count: number }[]
  activeSessions: number
  signups: { date: string; users: number; companies: number }[]
  economySeries: { date: string; sold: number; consumed: number }[]
  /** Live EUR->RON rate, for the RON equivalent shown next to platform credit totals. */
  eurRonRate: number
  generatedAt: string
}

export interface AdminSettings {
  eurRonRate: number
  advancedBuilderPriceCredits: number
  advancedBuilderUnlockBonusCredits: number
  additionalBusinessPriceCredits: number
  invoiceVatRatePct: number
  affiliateEnabled: boolean
  affiliateRewardCredits: number
  affiliateMinDepositCredits: number
  refundFeePct: number
  creditsDiscountEnabled: boolean
  creditsDiscountPct: number
  feedMarjaProfitCredits: number
  feedMarjaPozitionareCredits: number
  domainPurchaseFeeCredits: number
  googleAdsCpcBufferPct: number
  googleAdsMaxCpcCredits: number
  /** Machine-written by the sync job, never admin-edited — null until it
   *  has completed a first cycle (not configured, or no clicks yet today). */
  googleAdsAvgCpcCredits: number | null
  googleAdsAvgCpcUpdatedAt: string | null
  googleAdsAgentEnabled: boolean
  googleAdsAgentDefaultDailyBudgetCredits: number
  googleAdsAgentDefaultMaxCpcCredits: number
  googleAdsAgentMaxDailyBudgetCapCredits: number
  googleAdsAgentMaxCpcCapCredits: number
  googleAdsAgentStructuralIntervalMinutes: number
  googleAdsAgentContentIntervalMinutes: number
  googleAdsAgentIntelligenceIntervalMinutes: number
  googleAdsAgentAutoApplyRecommendationTypes: string[]
  /** Machine-created lazily by whichever Google Ads agent pass needs it
   *  first, never admin-edited — null until then. */
  googleAdsConversionActionResourceName: string | null
  invoiceIssuerName: string
  invoiceIssuerTaxId: string
  invoiceIssuerRegCom: string
  invoiceIssuerAddress: string
  invoiceIssuerIban: string
  invoiceIssuerBank: string
}

export type UserStatus = 'active' | 'suspended'
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'depleted'

interface Money {
  minor: number
  credits: number
}

export interface AdminUserRow {
  id: string
  email: string
  name: string
  status: UserStatus
  platformRoles: PlatformRole[]
  twoFactorEnabled: boolean
  companyCount: number
  walletCredits: number
  walletBlocked: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface AdminUserCompany {
  id: string
  displayName: string
  slug: string
  status: 'draft' | 'active' | 'suspended'
  role: string
  isOwner: boolean
  leadCount: number
  clickCount: number
  consumed: Money
  createdAt: string
  campaign: {
    status: CampaignStatus
    dailyBudget: Money
    cpc: Money
    appearFirst: boolean
    spentToday: Money
    activeDays: number
  } | null
}

export interface AdminUserTxn {
  id: string
  type: 'purchase' | 'spend' | 'refund' | 'adjustment'
  status: string
  amount: Money
  balanceAfter: Money | null
  provider: string | null
  description: string | null
  companyName: string | null
  clicks: number | null
  createdAt: string
  feePct: number | null
  feeMinor: Money | null
  processAt: string | null
}

export interface AdminUserDetail {
  id: string
  email: string
  name: string
  status: UserStatus
  platformRoles: PlatformRole[]
  twoFactorEnabled: boolean
  lastLoginAt: string | null
  passwordChangedAt: string | null
  createdAt: string
  updatedAt: string
  wallet: {
    balance: Money
    purchased: Money
    spent: Money
    currency: string
    eurRonRate: number
    blocked: boolean
    blockedAt: string | null
    blockedReason: string | null
    refundable: Money
  }
  /** The billing identity every one of this user's invoices is made out to.
   *  Null until they've declared one — which is itself why their purchases
   *  may be blocked, so the panel has to be able to show that state. */
  billingProfile: BillingProfile | null
  companies: AdminUserCompany[]
  transactions: AdminUserTxn[]
  invoices: AdminUserInvoice[]
  sessions: { id: string; userAgent: string | null; ip: string | null; createdAt: string }[]
  /** Only present right after `adjustWallet` — the requested vs. actually
   *  applied delta, since a claw-back larger than the balance is clamped
   *  rather than rejected. */
  lastAdjustment?: { requestedCredits: number; appliedCredits: number }
}

/** Compact invoice row embedded in a user's admin detail page. */
export interface AdminUserInvoice {
  id: string
  number: string
  totalMinor: number
  currency: string
  voided: boolean
  issuedAt: string
}

export type InvoiceStatusFilter = 'issued' | 'void'
export type InvoiceKindFilter = 'topup' | 'affiliate_reward'

/** One row in the global admin invoices list. */
export interface AdminInvoiceRow {
  id: string
  number: string
  kind: 'topup' | 'affiliate_reward'
  issuedAt: string
  buyerKind: 'individual' | 'company'
  buyerName: string
  totalMinor: number
  currency: string
  voidedAt: string | null
  voidReason: string | null
  user: { id: string; email: string; name: string }
}

export interface InvoicesFilters {
  search: string
  status: InvoiceStatusFilter | null
  kind: InvoiceKindFilter | null
  page: number
  pageSize: number
}

export interface ReferralsFilters {
  status: 'pending' | 'rewarded' | null
  page: number
  pageSize: number
}

/** Full invoice record for the admin detail view — the raw fiscal document,
 *  unlike the trimmed `AdminInvoiceRow` used for the list. */
export interface AdminInvoiceDetail {
  id: string
  number: string
  kind: 'topup' | 'affiliate_reward'
  issuedAt: string
  buyerKind: 'individual' | 'company'
  buyerName: string
  buyerTaxId: string | null
  buyerRegCom: string | null
  buyerVatPayer: boolean
  buyerAddress: string
  buyerCity: string
  buyerCounty: string | null
  buyerPostalCode: string | null
  buyerCountry: string
  buyerEmail: string | null
  issuerName: string
  issuerTaxId: string | null
  issuerRegCom: string | null
  issuerAddress: string
  issuerIban: string | null
  issuerBank: string | null
  currency: string
  description: string
  subtotalMinor: number
  vatRatePct: number
  vatMinor: number
  totalMinor: number
  eurCents: number | null
  voidedAt: string | null
  voidReason: string | null
  user: { id: string; email: string; name: string }
}

export interface UsersFilters {
  search: string
  status: UserStatus | null
  role: PlatformRole | null
  page: number
  pageSize: number
}

export type BusinessStatus = 'draft' | 'active' | 'suspended'
export type CampaignFilter = 'none' | CampaignStatus

export interface AdminBusinessRow {
  id: string
  displayName: string
  slug: string
  status: BusinessStatus
  country: string
  city: string | null
  category: LocalizedName | null
  owner: { id: string; name: string; email: string }
  createdAt: string
  deletionScheduledAt: string | null
  deletionEffectiveAt: string | null
  campaign: {
    status: CampaignStatus
    dailyBudget: Money
    cpc: Money
    autoOptimize: boolean
  } | null
  leadCount: number
  clickCount: number
  consumed: Money
}

export interface BusinessesFilters {
  search: string
  status: BusinessStatus | null
  campaign: CampaignFilter | null
  pendingDeletion: boolean
  page: number
  pageSize: number
}

export interface AdminCategory {
  id: string
  parentId: string | null
  slug: string
  name: Record<string, string>
  icon: string | null
  isActive: boolean
  position: number
  companyCount: number
  childCount: number
}

export interface AdminCategoryGroup extends AdminCategory {
  children: AdminCategory[]
}

// --- jurnal / audit ----------------------------------------------------

export interface AuditLogActor {
  id: string
  name: string
  email: string
}

/** One staff-privileged write — the Nivel-1 log (admin/support/finance/moderator). */
export interface AdminAuditLogRow {
  id: string
  actorId: string
  /** Point-in-time snapshot of the actor's platform roles at the moment of the action. */
  actorRoles: PlatformRole[]
  action: string
  targetType: string
  targetId: string | null
  before: unknown
  after: unknown
  reason: string | null
  createdAt: string
  actor: AuditLogActor
}

/** One owner/manager/editor/billing write on their own business — the Nivel-2 log. */
export interface AdminBusinessActionLogRow {
  id: string
  companyId: string
  actorId: string
  actorRole: string
  action: string
  targetType: string
  targetId: string | null
  before: unknown
  after: unknown
  createdAt: string
  actor: AuditLogActor
  company: { id: string; displayName: string; slug: string }
}

export interface AuditLogFilters {
  actor: string
  action: string
  targetType: string
  /** `YYYY-MM-DD`, inclusive — empty means unbounded. */
  dateFrom: string
  dateTo: string
  page: number
  pageSize: number
}

export interface BusinessActionLogFilters {
  companyId: string
  company: string
  actor: string
  action: string
  dateFrom: string
  dateTo: string
  page: number
  pageSize: number
}

interface AdminState {
  stats: AdminStats | null
  /** Per-call failure reason, or null on success. See `errMsg` above for why
   *  these exist at all; the views render them as an error empty-state. */
  statsError: string | null
  usersError: string | null
  businessesError: string | null
  invoicesError: string | null
  referralsError: string | null
  categoriesError: string | null
  settingsError: string | null
  users: AdminUserRow[]
  usersTotal: number
  filters: UsersFilters
  loadingUsers: boolean
  businesses: AdminBusinessRow[]
  businessesTotal: number
  businessFilters: BusinessesFilters
  loadingBusinesses: boolean
  /** Bumped on every `fetchBusinesses` call — a reply only replaces
   *  `businesses` if it's still the most recent one issued, so two filter
   *  changes fired in quick succession can't land out of order (same
   *  pattern as `paymentsRequestSeq` in stores/wallet.ts). */
  businessesRequestSeq: number
  settings: AdminSettings | null
  categories: AdminCategoryGroup[]
  loadingCategories: boolean
  invoices: AdminInvoiceRow[]
  invoicesTotal: number
  invoiceFilters: InvoicesFilters
  loadingInvoices: boolean
  referrals: AdminReferralRow[]
  referralsTotal: number
  /** Unfiltered counts for the summary chips — never scoped to the active
   *  status filter, so "Pending" never goes negative under a filter. */
  referralsTotalAll: number
  referralsTotalPending: number
  referralsTotalRewarded: number
  referralsCreditsPaid: number
  referralFilters: ReferralsFilters
  loadingReferrals: boolean
  auditLog: AdminAuditLogRow[]
  auditLogTotal: number
  auditLogFilters: AuditLogFilters
  loadingAuditLog: boolean
  auditLogError: string | null
  businessActionLog: AdminBusinessActionLogRow[]
  businessActionLogTotal: number
  businessActionLogFilters: BusinessActionLogFilters
  loadingBusinessActionLog: boolean
  businessActionLogError: string | null
  googleAdsAgentOverview: GoogleAdsAgentOverview | null
  googleAdsAgentOverviewError: string | null
  loadingGoogleAdsAgentOverview: boolean
  googleAdsAgentProposals: GoogleAdsAgentActionRow[]
  googleAdsAgentProposalsError: string | null
  loadingGoogleAdsAgentProposals: boolean
  googleAdsAgentCampaigns: GoogleAdsAgentCampaignRow[]
  googleAdsAgentCampaignsError: string | null
  loadingGoogleAdsAgentCampaigns: boolean
  googleAdsAgentActions: GoogleAdsAgentActionRow[]
  googleAdsAgentActionsTotal: number
  googleAdsAgentActionsFilters: GoogleAdsAgentActionsFilters
  loadingGoogleAdsAgentActions: boolean
  googleAdsAgentActionsError: string | null
  googleAdsCredentials: GoogleAdsCredentials | null
  googleAdsCredentialsError: string | null
  loadingGoogleAdsCredentials: boolean
}

export interface UpdateUserInput {
  name?: string
  email?: string
  status?: UserStatus
  platformRoles?: PlatformRole[]
  disableTotp?: boolean
  revokeSessions?: boolean
}

export type CampaignAction = 'pause' | 'activate' | 'delete'

export interface CategoryNameInput {
  ro: string
  en: string
  de: string
}
export interface CreateCategoryInput {
  parentId?: string
  slug: string
  name: CategoryNameInput
  icon?: string
  isActive?: boolean
  position?: number
}
export interface UpdateCategoryInput {
  slug?: string
  name?: CategoryNameInput
  icon?: string
  isActive?: boolean
  position?: number
  parentId?: string | null
}

// --- single business admin view -----------------------------------

export interface AdminCompanyLead {
  id: string
  channel: 'form' | 'call'
  status: 'new' | 'seen' | 'resolved'
  name: string | null
  email: string | null
  /** Null until the owner revealed it (form leads). */
  phone: string | null
  hasPhone: boolean
  message: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  responseMinutes: number | null
  createdAt: string
}

export interface AdminCompanyDetail {
  company: {
    id: string
    displayName: string
    legalName: string | null
    slug: string
    description: string | null
    status: 'draft' | 'active' | 'suspended'
    country: string
    createdAt: string
    advancedUnlockedAt: string | null
    /** Standard advanced-builder fee (credits) — for the admin upgrade choice. */
    advancedPriceCredits: number
    category: {
      slug: string
      name: LocalizedName
      parent: { slug: string; name: LocalizedName } | null
    } | null
    location: {
      nationwide: boolean
      /** One or several județe — empty while `nationwide`. */
      counties: string[]
    } | null
    website: {
      mode: 'easy' | 'advanced'
      status: 'draft' | 'published' | 'unpublished'
      updatedAt: string
      theme: WebsiteTheme
      content: WebsiteContent
    } | null
    owner: { id: string; name: string; email: string; status: UserStatus }
    counts: { services: number; contacts: number; leads: number; clicks: number }
    /** Inside the 7-day grace window — frozen, awaiting an owner/admin cancel
     *  or the sweep's final wipe at `deletionEffectiveAt`. */
    deletionScheduledAt: string | null
    deletionEffectiveAt: string | null
  }
  campaign: CampaignPayload
  /** Same per-Feed source of truth the owner's own campaign-spend page reads —
   *  the real position (not just the editor's flat recommendation). */
  feedStatus: {
    feedRanks: FeedRankEntry[]
    needsPositionUpgrade: boolean
    recommendedCpc: Money
  }
  analytics: DashboardAnalytics
  leads: {
    summary: {
      total: number
      new: number
      resolved: number
      form: number
      call: number
      responded: number
      avgResponseMinutes: number | null
    }
    items: AdminCompanyLead[]
    nextCursor: string | null
  }
}

/** The campaign's full cost breakdown — see `AdminCompaniesService.costs`.
 *  `report` is the exact same payload the owner's own Campaign/Consumption
 *  pages read (`spendReportFor`); `breakdown`/`ledger` mirror `/wallet/
 *  spend-breakdown` and `/wallet/consumption`, just admin-scoped. */
export interface AdminCompanyCosts {
  report: CampaignSpend
  breakdown: {
    total: { minor: number; credits: number }
    categories: Array<{ key: SpendCategory; total: { minor: number; credits: number }; count: number }>
  }
  ledger: { items: ConsumptionEntry[]; nextCursor: string | null }
}

export interface UpdateCompanyInput {
  displayName?: string
  legalName?: string
  description?: string
  categoryId?: string
}

export interface AdminCompanyLocationInput {
  nationwide?: boolean
  /** One or several județe — required unless `nationwide` is set. */
  counties?: string[]
}

// --- affiliate program ------------------------------------------------

export interface AdminReferralRow {
  id: string
  status: 'pending' | 'rewarded'
  rewardCredits: number | null
  rewardedAt: string | null
  createdAt: string
  referrer: { id: string; name: string; email: string }
  referred: { id: string; name: string; email: string }
}

export interface AdminReferralsPage {
  items: AdminReferralRow[]
  page: number
  pageSize: number
  total: number
  /** Unfiltered — never scoped to the active status filter, unlike `total`. */
  totalAll: number
  totalPending: number
  totalRewarded: number
  creditsPaid: number
}

/** Google Ads agent (docs/ai/GOOGLE-ADS-AGENT-PLAN.md) — per-subcategory
 *  Google Ads campaigns the platform itself runs, managed by a backend
 *  agent. See AdminGoogleAdsController / AdminGoogleAdsService. */
export interface GoogleAdsAgentRunRow {
  id: string
  kind: 'structural' | 'content' | 'intelligence'
  status: 'in_progress' | 'success' | 'partial' | 'failed'
  startedAt: string
  finishedAt: string | null
  categoriesScanned: number
  actionsTaken: number
  actionsPendingApproval: number
  errorSummary: string | null
}

/** The real Google cost-per-click the FEED algorithm prices Google-Ads-
 *  attributed clicks against (`AnalyticsService.marginConfig()` ->
 *  `googleAdsCostPromovareCredits()`), mirrored here so the admin page shows
 *  exactly what's in effect right now — not just the raw synced average. */
export interface GoogleAdsFeedCpc {
  rawAvgCpcCredits: number | null
  updatedAt: string | null
  bufferPct: number
  bufferedCredits: number | null
  fresh: boolean
  staleAfterMinutes: number
  fallbackCredits: number
  activeCostPromovareCredits: number
}

export interface GoogleAdsAgentOverview {
  enabled: boolean
  campaigns: { active: number; paused: number; pendingCreation: number }
  totalActiveDailyBudgetCredits: number
  spendTodayCredits: number
  spendThisMonthCredits: number
  subcategoriesWithoutCampaign: number
  lastRuns: Record<'structural' | 'content' | 'intelligence', GoogleAdsAgentRunRow | null>
  feedCpc: GoogleAdsFeedCpc
}

export interface GoogleAdsAgentCategoryRef {
  id: string
  slug: string
  nameI18n: LocalizedName
  parent?: { slug: string; nameI18n: LocalizedName } | null
}


export interface GoogleAdsAgentActionRow {
  id: string
  categoryId: string
  category?: GoogleAdsAgentCategoryRef
  action: string
  status: 'applied' | 'pending_approval' | 'rejected'
  before: unknown
  after: unknown
  reasoning: string | null
  approvedBy?: { id: string; name: string; email: string } | null
  approvedAt: string | null
  createdAt: string
}

export interface GoogleAdsAgentCampaignRow {
  id: string
  categoryId: string
  category: GoogleAdsAgentCategoryRef
  googleCampaignId: string | null
  googleAdGroupId: string | null
  status: 'pending_creation' | 'active' | 'paused'
  dailyBudgetMinor: number
  maxCpcMinor: number
  activeCompanyCount: number
  lastStructuralCheckAt: string | null
  lastIntelligenceRunAt: string | null
}

export interface GoogleAdsAgentActionsFilters {
  categoryId: string
  action: string
  status: '' | 'applied' | 'pending_approval' | 'rejected'
  dateFrom: string
  dateTo: string
  page: number
  pageSize: number
}

export interface GoogleAdsCredentials {
  customerId: string
  loginCustomerId: string
  campaignId: string
  serviceAccountKeyConfigured: boolean
  serviceAccountEmail: string | null
  /** Live `GoogleAdsApiClient` state — can lag up to ~60s behind a save
   *  while that client re-reads/validates the new credentials. */
  configured: boolean
}

export interface GoogleAdsCredentialsInput {
  customerId?: string
  loginCustomerId?: string
  campaignId?: string
  /** Omit entirely to leave the stored secret untouched. */
  serviceAccountKeyBase64?: string
}

export const useAdminStore = defineStore('admin', {
  state: (): AdminState => ({
    stats: null,
    statsError: null,
    usersError: null,
    businessesError: null,
    invoicesError: null,
    referralsError: null,
    categoriesError: null,
    settingsError: null,
    users: [],
    usersTotal: 0,
    filters: { search: '', status: null, role: null, page: 1, pageSize: 20 },
    loadingUsers: false,
    businesses: [],
    businessesTotal: 0,
    businessFilters: {
      search: '',
      status: null,
      campaign: null,
      pendingDeletion: false,
      page: 1,
      pageSize: 20,
    },
    loadingBusinesses: false,
    businessesRequestSeq: 0,
    settings: null,
    categories: [],
    loadingCategories: false,
    invoices: [],
    invoicesTotal: 0,
    invoiceFilters: { search: '', status: null, kind: null, page: 1, pageSize: 20 },
    loadingInvoices: false,
    referrals: [],
    referralsTotal: 0,
    referralsTotalAll: 0,
    referralsTotalPending: 0,
    referralsTotalRewarded: 0,
    referralsCreditsPaid: 0,
    referralFilters: { status: null, page: 1, pageSize: 20 },
    loadingReferrals: false,
    auditLog: [],
    auditLogTotal: 0,
    auditLogFilters: { actor: '', action: '', targetType: '', dateFrom: '', dateTo: '', page: 1, pageSize: 20 },
    loadingAuditLog: false,
    auditLogError: null,
    businessActionLog: [],
    businessActionLogTotal: 0,
    businessActionLogFilters: {
      companyId: '',
      company: '',
      actor: '',
      action: '',
      dateFrom: '',
      dateTo: '',
      page: 1,
      pageSize: 20,
    },
    loadingBusinessActionLog: false,
    businessActionLogError: null,
    googleAdsAgentOverview: null,
    googleAdsAgentOverviewError: null,
    loadingGoogleAdsAgentOverview: false,
    googleAdsAgentProposals: [],
    googleAdsAgentProposalsError: null,
    loadingGoogleAdsAgentProposals: false,
    googleAdsAgentCampaigns: [],
    googleAdsAgentCampaignsError: null,
    loadingGoogleAdsAgentCampaigns: false,
    googleAdsAgentActions: [],
    googleAdsAgentActionsTotal: 0,
    googleAdsAgentActionsFilters: {
      categoryId: '',
      action: '',
      status: '',
      dateFrom: '',
      dateTo: '',
      page: 1,
      pageSize: 20,
    },
    loadingGoogleAdsAgentActions: false,
    googleAdsAgentActionsError: null,
    googleAdsCredentials: null,
    googleAdsCredentialsError: null,
    loadingGoogleAdsCredentials: false,
  }),

  actions: {
    async fetchStats(): Promise<void> {
      try {
        this.stats = await apiFetch<AdminStats>('/admin/stats')
        this.statsError = null
      } catch (e) {
        this.statsError = errMsg(e)
      }
    },

    async fetchUsers(): Promise<void> {
      this.loadingUsers = true
      try {
        const p = new URLSearchParams()
        // The search field is `clearable` — Vuetify writes `null` back on
        // clear regardless of the declared `string` type, and `.trim()` on
        // that threw before the request was even built, leaving the list
        // stuck on its last results with no visible error.
        const search = (this.filters.search ?? '').trim()
        if (search) p.set('search', search)
        if (this.filters.status) p.set('status', this.filters.status)
        if (this.filters.role) p.set('role', this.filters.role)
        p.set('page', String(this.filters.page))
        p.set('pageSize', String(this.filters.pageSize))
        const res = await apiFetch<{ items: AdminUserRow[]; total: number; page: number }>(
          `/admin/users?${p.toString()}`,
        )
        this.users = res.items
        this.usersTotal = res.total
        this.usersError = null
      } catch (e) {
        this.usersError = errMsg(e)
      } finally {
        this.loadingUsers = false
      }
    },

    setFilter<K extends keyof UsersFilters>(key: K, value: UsersFilters[K]): void {
      this.filters[key] = value
      if (key !== 'page') this.filters.page = 1
      void this.fetchUsers()
    },

    async fetchBusinesses(): Promise<void> {
      const seq = ++this.businessesRequestSeq
      this.loadingBusinesses = true
      try {
        const f = this.businessFilters
        const p = new URLSearchParams()
        if (f.search.trim()) p.set('search', f.search.trim())
        if (f.status) p.set('status', f.status)
        if (f.campaign) p.set('campaign', f.campaign)
        if (f.pendingDeletion) p.set('pendingDeletion', 'true')
        p.set('page', String(f.page))
        p.set('pageSize', String(f.pageSize))
        const res = await apiFetch<{ items: AdminBusinessRow[]; total: number }>(
          `/admin/companies?${p.toString()}`,
        )
        // A newer filter/page change already started since this request was
        // issued — dropping this reply instead of letting it land out of
        // order and show a list that doesn't match the currently-selected
        // filter chip.
        if (seq !== this.businessesRequestSeq) return
        this.businesses = res.items
        this.businessesTotal = res.total
        this.businessesError = null
      } catch (e) {
        // A superseded request's failure must not overwrite the state a
        // still-in-flight newer one is about to fill.
        if (seq === this.businessesRequestSeq) this.businessesError = errMsg(e)
      } finally {
        if (seq === this.businessesRequestSeq) this.loadingBusinesses = false
      }
    },

    setBusinessFilter<K extends keyof BusinessesFilters>(key: K, value: BusinessesFilters[K]): void {
      this.businessFilters[key] = value
      if (key !== 'page') this.businessFilters.page = 1
      void this.fetchBusinesses()
    },

    async fetchInvoices(): Promise<void> {
      this.loadingInvoices = true
      try {
        const f = this.invoiceFilters
        const p = new URLSearchParams()
        if (f.search.trim()) p.set('search', f.search.trim())
        if (f.status) p.set('status', f.status)
        if (f.kind) p.set('kind', f.kind)
        p.set('page', String(f.page))
        p.set('pageSize', String(f.pageSize))
        const res = await apiFetch<{ items: AdminInvoiceRow[]; total: number }>(
          `/admin/invoices?${p.toString()}`,
        )
        this.invoices = res.items
        this.invoicesTotal = res.total
        this.invoicesError = null
      } catch (e) {
        this.invoicesError = errMsg(e)
      } finally {
        this.loadingInvoices = false
      }
    },

    setInvoiceFilter<K extends keyof InvoicesFilters>(key: K, value: InvoicesFilters[K]): void {
      this.invoiceFilters[key] = value
      if (key !== 'page') this.invoiceFilters.page = 1
      void this.fetchInvoices()
    },

    async fetchReferralsList(): Promise<void> {
      this.loadingReferrals = true
      try {
        const f = this.referralFilters
        const res = await this.fetchReferrals({
          status: f.status ?? undefined,
          page: f.page,
          pageSize: f.pageSize,
        })
        this.referrals = res.items
        this.referralsTotal = res.total
        this.referralsTotalAll = res.totalAll
        this.referralsTotalPending = res.totalPending
        this.referralsTotalRewarded = res.totalRewarded
        this.referralsCreditsPaid = res.creditsPaid
        this.referralsError = null
      } catch (e) {
        this.referralsError = errMsg(e)
      } finally {
        this.loadingReferrals = false
      }
    },

    setReferralFilter<K extends keyof ReferralsFilters>(key: K, value: ReferralsFilters[K]): void {
      this.referralFilters[key] = value
      if (key !== 'page') this.referralFilters.page = 1
      void this.fetchReferralsList()
    },

    fetchInvoiceDetail(id: string): Promise<AdminInvoiceDetail> {
      return apiFetch<AdminInvoiceDetail>(`/admin/invoices/${id}`)
    },

    async voidInvoice(id: string, reason: string): Promise<void> {
      await apiFetch(`/admin/invoices/${id}/void`, { method: 'POST', body: { reason } })
      await this.fetchInvoices()
    },

    async unvoidInvoice(id: string): Promise<void> {
      await apiFetch(`/admin/invoices/${id}/unvoid`, { method: 'POST' })
      await this.fetchInvoices()
    },

    async fetchSettings(): Promise<void> {
      try {
        this.settings = await apiFetch<AdminSettings>('/admin/settings')
        this.settingsError = null
      } catch (e) {
        this.settingsError = errMsg(e)
      }
    },

    async updateSettings(input: Partial<AdminSettings>): Promise<void> {
      this.settings = await apiFetch<AdminSettings>('/admin/settings', {
        method: 'PATCH',
        body: input,
      })
    },

    broadcastMaintenance(input: { title: string; message: string }): Promise<{ notified: number }> {
      return apiFetch('/admin/maintenance/broadcast', { method: 'POST', body: input })
    },

    fetchReferrals(
      params: { status?: 'pending' | 'rewarded'; page?: number; pageSize?: number } = {},
    ): Promise<AdminReferralsPage> {
      const p = new URLSearchParams()
      if (params.status) p.set('status', params.status)
      if (params.page) p.set('page', String(params.page))
      if (params.pageSize) p.set('pageSize', String(params.pageSize))
      const qs = p.toString()
      return apiFetch<AdminReferralsPage>(`/admin/referrals${qs ? `?${qs}` : ''}`)
    },

    fetchUser(id: string): Promise<AdminUserDetail> {
      return apiFetch<AdminUserDetail>(`/admin/users/${id}`)
    },

    /** Paginated/filterable Activity-tab history — the user-detail payload
     *  above only ever embeds the most recent 20 with no filters; this is
     *  what "search by id" / "load more" there call into. */
    /** Same user transaction history as a downloadable PDF — plain href,
     *  session cookie rides along, same shape as the owner-facing exports. */
    userTransactionsExportUrl(
      id: string,
      filters: { type?: string; search?: string } = {},
    ): string {
      const p = new URLSearchParams()
      if (filters.type) p.set('type', filters.type)
      if (filters.search) p.set('search', filters.search)
      const q = p.toString() ? `?${p.toString()}` : ''
      return `${BASE_URL}/admin/users/${id}/transactions/export${q}`
    },

    companiesExportUrl(): string {
      const f = this.businessFilters
      const p = new URLSearchParams()
      if (f.search.trim()) p.set('search', f.search.trim())
      if (f.status) p.set('status', f.status)
      if (f.campaign) p.set('campaign', f.campaign)
      if (f.pendingDeletion) p.set('pendingDeletion', 'true')
      const q = p.toString() ? `?${p.toString()}` : ''
      return `${BASE_URL}/admin/companies/export${q}`
    },

    referralsExportUrl(): string {
      const p = new URLSearchParams()
      if (this.referralFilters.status) p.set('status', this.referralFilters.status)
      const q = p.toString() ? `?${p.toString()}` : ''
      return `${BASE_URL}/admin/referrals/export${q}`
    },

    listUserTransactions(
      id: string,
      opts: { cursor?: string; type?: string; search?: string } = {},
    ): Promise<{ items: AdminUserTxn[]; nextCursor: string | null }> {
      const params = new URLSearchParams()
      if (opts.cursor) params.set('cursor', opts.cursor)
      if (opts.type) params.set('type', opts.type)
      if (opts.search) params.set('search', opts.search)
      const qs = params.toString()
      return apiFetch<{ items: AdminUserTxn[]; nextCursor: string | null }>(
        `/admin/users/${id}/transactions${qs ? `?${qs}` : ''}`,
      )
    },

    updateUser(id: string, input: UpdateUserInput): Promise<AdminUserDetail> {
      return apiFetch<AdminUserDetail>(`/admin/users/${id}`, { method: 'PATCH', body: input })
    },

    setUserPassword(id: string, newPassword: string): Promise<{ ok: true }> {
      return apiFetch<{ ok: true }>(`/admin/users/${id}/password`, {
        method: 'POST',
        body: { newPassword },
      })
    },

    /**
     * Staff-side edit of the billing identity a user's invoices are made out
     * to (`PATCH /admin/users/:id/billing-profile`, `admin`+`finance`). Takes
     * exactly the field set the customer's own `/account/billing/profile`
     * accepts, so a staff edit can't produce a shape the self-service form
     * never could. `invoicesIssued` is non-zero when completing the profile
     * also backfilled the user's pending invoices.
     */
    updateUserBillingProfile(
      id: string,
      input: BillingProfileInput,
    ): Promise<{ profile: BillingProfile; isComplete: boolean; invoicesIssued: number }> {
      return apiFetch(`/admin/users/${id}/billing-profile`, { method: 'PATCH', body: input })
    },

    blockWallet(id: string, blocked: boolean, reason?: string): Promise<AdminUserDetail> {
      return apiFetch<AdminUserDetail>(`/admin/users/${id}/wallet/block`, {
        method: 'POST',
        body: { blocked, reason },
      })
    },

    adjustWallet(id: string, credits: number, reason: string): Promise<AdminUserDetail> {
      return apiFetch<AdminUserDetail>(`/admin/users/${id}/wallet/adjust`, {
        method: 'POST',
        body: { credits, reason },
      })
    },

    refundBalance(id: string, credits: number): Promise<AdminUserDetail> {
      return apiFetch<AdminUserDetail>(`/admin/users/${id}/wallet/refund`, {
        method: 'POST',
        body: { credits },
      })
    },

    cancelWalletRefund(id: string, refundId: string): Promise<AdminUserDetail> {
      return apiFetch<AdminUserDetail>(`/admin/users/${id}/wallet/refunds/${refundId}/cancel`, {
        method: 'POST',
      })
    },

    campaignAction(companyId: string, action: CampaignAction): Promise<unknown> {
      return apiFetch(`/admin/companies/${companyId}/campaign`, {
        method: 'POST',
        body: { action },
      })
    },

    setCompanyStatus(companyId: string, status: 'active' | 'suspended'): Promise<unknown> {
      return apiFetch(`/admin/companies/${companyId}/status`, {
        method: 'PATCH',
        body: { status },
      })
    },

    cancelCompanyDeletion(companyId: string): Promise<AdminCompanyDetail> {
      return apiFetch<AdminCompanyDetail>(`/admin/companies/${companyId}/cancel-deletion`, {
        method: 'POST',
      })
    },

    fetchCompany(id: string): Promise<AdminCompanyDetail> {
      return apiFetch<AdminCompanyDetail>(`/admin/companies/${id}`)
    },

    updateCompany(id: string, input: UpdateCompanyInput): Promise<AdminCompanyDetail> {
      return apiFetch<AdminCompanyDetail>(`/admin/companies/${id}`, { method: 'PATCH', body: input })
    },

    saveCompanyCampaign(id: string, input: SaveCampaignInput): Promise<AdminCompanyDetail> {
      return apiFetch<AdminCompanyDetail>(`/admin/companies/${id}/campaign`, {
        method: 'PUT',
        body: input,
      })
    },

    /** Grant the advanced website builder — free, or charged to the owner's
     *  wallet when `charge` is true (rejected if they can't afford it). */
    upgradeCompanyAdvanced(id: string, charge = false): Promise<AdminCompanyDetail> {
      return apiFetch<AdminCompanyDetail>(`/admin/companies/${id}/website/upgrade-advanced`, {
        method: 'POST',
        body: { charge },
      })
    },

    setCompanyLeadStatus(
      id: string,
      leadId: string,
      status: 'new' | 'seen' | 'resolved',
    ): Promise<AdminCompanyDetail> {
      return apiFetch<AdminCompanyDetail>(`/admin/companies/${id}/leads/${leadId}`, {
        method: 'PATCH',
        body: { status },
      })
    },

    setCompanyLocation(
      id: string,
      input: AdminCompanyLocationInput,
    ): Promise<AdminCompanyDetail> {
      return apiFetch<AdminCompanyDetail>(`/admin/companies/${id}/location`, {
        method: 'PATCH',
        body: input,
      })
    },

    setCompanyWebsitePublished(id: string, published: boolean): Promise<AdminCompanyDetail> {
      return apiFetch<AdminCompanyDetail>(`/admin/companies/${id}/website`, {
        method: 'PATCH',
        body: { published },
      })
    },

    companyLeads(
      id: string,
      params: { status?: string; channel?: string; cursor?: string; limit?: number } = {},
    ): Promise<{ items: AdminCompanyLead[]; nextCursor: string | null }> {
      const p = new URLSearchParams()
      if (params.status) p.set('status', params.status)
      if (params.channel) p.set('channel', params.channel)
      if (params.cursor) p.set('cursor', params.cursor)
      if (params.limit) p.set('limit', String(params.limit))
      const qs = p.toString()
      return apiFetch(`/admin/companies/${id}/leads${qs ? `?${qs}` : ''}`)
    },

    fetchCompanyCosts(id: string): Promise<AdminCompanyCosts> {
      return apiFetch(`/admin/companies/${id}/costs`)
    },

    companyCostsLedger(
      id: string,
      params: { category?: string; from?: string; to?: string; search?: string; cursor?: string; limit?: number } = {},
    ): Promise<{ items: ConsumptionEntry[]; nextCursor: string | null }> {
      const p = new URLSearchParams()
      if (params.category) p.set('category', params.category)
      if (params.from) p.set('from', params.from)
      if (params.to) p.set('to', params.to)
      if (params.search) p.set('search', params.search)
      if (params.cursor) p.set('cursor', params.cursor)
      if (params.limit) p.set('limit', String(params.limit))
      const qs = p.toString()
      return apiFetch(`/admin/companies/${id}/costs/ledger${qs ? `?${qs}` : ''}`)
    },

    async fetchCategories(): Promise<void> {
      this.loadingCategories = true
      try {
        const res = await apiFetch<{ data: AdminCategoryGroup[] }>('/admin/categories')
        this.categories = res.data
        this.categoriesError = null
      } catch (e) {
        this.categoriesError = errMsg(e)
      } finally {
        this.loadingCategories = false
      }
    },

    async createCategory(input: CreateCategoryInput): Promise<void> {
      const res = await apiFetch<{ tree: AdminCategoryGroup[] }>('/admin/categories', {
        method: 'POST',
        body: input,
      })
      this.categories = res.tree
    },

    async updateCategory(id: string, input: UpdateCategoryInput): Promise<void> {
      const res = await apiFetch<{ data: AdminCategoryGroup[] }>(`/admin/categories/${id}`, {
        method: 'PATCH',
        body: input,
      })
      this.categories = res.data
    },

    async deleteCategory(id: string): Promise<void> {
      const res = await apiFetch<{ data: AdminCategoryGroup[] }>(`/admin/categories/${id}`, {
        method: 'DELETE',
      })
      this.categories = res.data
    },

    // --- jurnal / audit -------------------------------------------------

    async fetchAuditLog(): Promise<void> {
      this.loadingAuditLog = true
      try {
        const f = this.auditLogFilters
        const p = new URLSearchParams()
        if (f.actor.trim()) p.set('actor', f.actor.trim())
        if (f.action) p.set('action', f.action)
        if (f.targetType) p.set('targetType', f.targetType)
        if (f.dateFrom) p.set('dateFrom', f.dateFrom)
        if (f.dateTo) p.set('dateTo', f.dateTo)
        p.set('page', String(f.page))
        p.set('pageSize', String(f.pageSize))
        const res = await apiFetch<{ items: AdminAuditLogRow[]; total: number }>(
          `/admin/audit-log?${p.toString()}`,
        )
        this.auditLog = res.items
        this.auditLogTotal = res.total
        this.auditLogError = null
      } catch (e) {
        this.auditLogError = errMsg(e)
      } finally {
        this.loadingAuditLog = false
      }
    },

    setAuditLogFilter<K extends keyof AuditLogFilters>(key: K, value: AuditLogFilters[K]): void {
      this.auditLogFilters[key] = value
      if (key !== 'page') this.auditLogFilters.page = 1
      void this.fetchAuditLog()
    },

    async fetchBusinessActionLog(): Promise<void> {
      this.loadingBusinessActionLog = true
      try {
        const f = this.businessActionLogFilters
        const p = new URLSearchParams()
        if (f.companyId) p.set('companyId', f.companyId)
        if (f.company.trim()) p.set('company', f.company.trim())
        if (f.actor.trim()) p.set('actor', f.actor.trim())
        if (f.action) p.set('action', f.action)
        if (f.dateFrom) p.set('dateFrom', f.dateFrom)
        if (f.dateTo) p.set('dateTo', f.dateTo)
        p.set('page', String(f.page))
        p.set('pageSize', String(f.pageSize))
        const res = await apiFetch<{ items: AdminBusinessActionLogRow[]; total: number }>(
          `/admin/business-action-log?${p.toString()}`,
        )
        this.businessActionLog = res.items
        this.businessActionLogTotal = res.total
        this.businessActionLogError = null
      } catch (e) {
        this.businessActionLogError = errMsg(e)
      } finally {
        this.loadingBusinessActionLog = false
      }
    },

    setBusinessActionLogFilter<K extends keyof BusinessActionLogFilters>(
      key: K,
      value: BusinessActionLogFilters[K],
    ): void {
      this.businessActionLogFilters[key] = value
      if (key !== 'page') this.businessActionLogFilters.page = 1
      void this.fetchBusinessActionLog()
    },

    // --- Google Ads agent (docs/ai/GOOGLE-ADS-AGENT-PLAN.md) -------------

    async fetchGoogleAdsAgentOverview(): Promise<void> {
      this.loadingGoogleAdsAgentOverview = true
      try {
        this.googleAdsAgentOverview = await apiFetch<GoogleAdsAgentOverview>(
          '/admin/google-ads-agent/overview',
        )
        this.googleAdsAgentOverviewError = null
      } catch (e) {
        this.googleAdsAgentOverviewError = errMsg(e)
      } finally {
        this.loadingGoogleAdsAgentOverview = false
      }
    },

    async fetchGoogleAdsAgentProposals(): Promise<void> {
      this.loadingGoogleAdsAgentProposals = true
      try {
        this.googleAdsAgentProposals = await apiFetch<GoogleAdsAgentActionRow[]>(
          '/admin/google-ads-agent/proposals',
        )
        this.googleAdsAgentProposalsError = null
      } catch (e) {
        this.googleAdsAgentProposalsError = errMsg(e)
      } finally {
        this.loadingGoogleAdsAgentProposals = false
      }
    },

    async approveGoogleAdsAgentProposal(id: string): Promise<void> {
      await apiFetch(`/admin/google-ads-agent/proposals/${id}/approve`, { method: 'POST' })
      await this.fetchGoogleAdsAgentProposals()
    },

    async rejectGoogleAdsAgentProposal(id: string): Promise<void> {
      await apiFetch(`/admin/google-ads-agent/proposals/${id}/reject`, { method: 'POST' })
      await this.fetchGoogleAdsAgentProposals()
    },

    async fetchGoogleAdsAgentCampaigns(): Promise<void> {
      this.loadingGoogleAdsAgentCampaigns = true
      try {
        this.googleAdsAgentCampaigns = await apiFetch<GoogleAdsAgentCampaignRow[]>(
          '/admin/google-ads-agent/campaigns',
        )
        this.googleAdsAgentCampaignsError = null
      } catch (e) {
        this.googleAdsAgentCampaignsError = errMsg(e)
      } finally {
        this.loadingGoogleAdsAgentCampaigns = false
      }
    },

    async fetchGoogleAdsAgentActions(): Promise<void> {
      this.loadingGoogleAdsAgentActions = true
      try {
        const f = this.googleAdsAgentActionsFilters
        const p = new URLSearchParams()
        if (f.categoryId) p.set('categoryId', f.categoryId)
        if (f.action) p.set('action', f.action)
        if (f.status) p.set('status', f.status)
        if (f.dateFrom) p.set('dateFrom', f.dateFrom)
        if (f.dateTo) p.set('dateTo', f.dateTo)
        p.set('page', String(f.page))
        p.set('pageSize', String(f.pageSize))
        const res = await apiFetch<{ items: GoogleAdsAgentActionRow[]; total: number }>(
          `/admin/google-ads-agent/actions?${p.toString()}`,
        )
        this.googleAdsAgentActions = res.items
        this.googleAdsAgentActionsTotal = res.total
        this.googleAdsAgentActionsError = null
      } catch (e) {
        this.googleAdsAgentActionsError = errMsg(e)
      } finally {
        this.loadingGoogleAdsAgentActions = false
      }
    },

    setGoogleAdsAgentActionsFilter<K extends keyof GoogleAdsAgentActionsFilters>(
      key: K,
      value: GoogleAdsAgentActionsFilters[K],
    ): void {
      this.googleAdsAgentActionsFilters[key] = value
      if (key !== 'page') this.googleAdsAgentActionsFilters.page = 1
      void this.fetchGoogleAdsAgentActions()
    },

    async runGoogleAdsAgentNow(kind: 'structural' | 'content' | 'intelligence'): Promise<void> {
      await apiFetch(`/admin/google-ads-agent/run/${kind}`, { method: 'POST' })
      await this.fetchGoogleAdsAgentOverview()
    },

    async fetchGoogleAdsCredentials(): Promise<void> {
      this.loadingGoogleAdsCredentials = true
      try {
        this.googleAdsCredentials = await apiFetch<GoogleAdsCredentials>(
          '/admin/google-ads-agent/credentials',
        )
        this.googleAdsCredentialsError = null
      } catch (e) {
        this.googleAdsCredentialsError = errMsg(e)
      } finally {
        this.loadingGoogleAdsCredentials = false
      }
    },

    async updateGoogleAdsCredentials(input: GoogleAdsCredentialsInput): Promise<void> {
      this.googleAdsCredentials = await apiFetch<GoogleAdsCredentials>(
        '/admin/google-ads-agent/credentials',
        { method: 'PATCH', body: input },
      )
    },
  },
})
