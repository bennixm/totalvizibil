<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminHint from '@/components/admin/AdminHint.vue'
import {
  useAdminStore,
  type GoogleAdsAgentActionRow,
  type GoogleAdsAgentCategoryRef,
} from '@/stores/admin'
import type { LocalizedName } from '@/stores/companies'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useMoney } from '@/composables/useMoney'
import { ApiError } from '@/services/api'

const { t, locale } = useI18n()
const admin = useAdminStore()
const confirm = useConfirmStore()
const toasts = useToastStore()
const { credits } = useMoney()

function flash(text: string, color: 'success' | 'error' = 'success') {
  toasts.push(color === 'error' ? 'error' : 'success', text)
}
function errText(e: unknown, fb: string) {
  return e instanceof ApiError ? e.message : fb
}
function localName(n: LocalizedName | undefined, fallback: string): string {
  return n?.[locale.value as 'ro' | 'en' | 'de'] ?? n?.en ?? n?.ro ?? fallback
}
function nm(c?: GoogleAdsAgentCategoryRef | null): string {
  if (!c) return ''
  const name = localName(c.nameI18n, c.slug)
  return c.parent ? `${localName(c.parent.nameI18n, c.parent.slug)} / ${name}` : name
}

const tab = ref<'overview' | 'proposals' | 'campaigns' | 'history' | 'settings'>('overview')
const busy = ref<string | null>(null)

onMounted(() => {
  void admin.fetchGoogleAdsAgentOverview()
  // Also fetched eagerly (not just lazily on tab switch, as the `watch`
  // below still does for a fresh visit to that tab): the tab's own pending-
  // count badge needs this list before the admin ever clicks into it.
  void admin.fetchGoogleAdsAgentProposals()
  // Tiny static payload — fetched eagerly so Proposals/History can render
  // friendly recommendation labels even if the admin never opens Settings.
  void admin.fetchGoogleAdsRecommendationTypes()
})

watch(tab, (v) => {
  if (v === 'proposals' && !admin.googleAdsAgentProposals.length) void admin.fetchGoogleAdsAgentProposals()
  if (v === 'campaigns' && !admin.googleAdsAgentCampaigns.length) void admin.fetchGoogleAdsAgentCampaigns()
  if (v === 'history' && !admin.googleAdsAgentActions.length) void admin.fetchGoogleAdsAgentActions()
  if (v === 'settings' && !admin.settings) void admin.fetchSettings()
  if (v === 'settings' && !admin.googleAdsCredentials) void admin.fetchGoogleAdsCredentials()
  if (v === 'settings') void admin.fetchGoogleAdsRecommendationTypes()
})

// --- overview ------------------------------------------------------------

const RUN_KINDS = ['structural', 'content', 'intelligence'] as const

function runTone(status?: string): 'success' | 'error' | 'warning' | undefined {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'partial') return 'warning'
  return undefined
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function runNow(kind: (typeof RUN_KINDS)[number]) {
  confirm.ask(
    t('adminGoogleAds.runConfirmTitle'),
    t('adminGoogleAds.runConfirmText', { kind: t(`adminGoogleAds.run.${kind}`) }),
    async () => {
      busy.value = `run-${kind}`
      try {
        await admin.runGoogleAdsAgentNow(kind)
        flash(t('adminGoogleAds.runStarted'))
      } catch (e) {
        flash(errText(e, t('admin.genericError')), 'error')
      } finally {
        busy.value = null
      }
    },
  )
}

// --- proposals -------------------------------------------------------------

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function proposalBudget(p: GoogleAdsAgentActionRow) {
  return {
    before: num((p.before as Record<string, unknown> | null)?.dailyBudgetCredits),
    after: num((p.after as Record<string, unknown> | null)?.proposedDailyBudgetCredits),
  }
}
function proposalCpc(p: GoogleAdsAgentActionRow) {
  return {
    before: num((p.before as Record<string, unknown> | null)?.maxCpcCredits),
    after: num((p.after as Record<string, unknown> | null)?.proposedMaxCpcCredits),
  }
}
// Direction 4 (Google Ads Recommendations) proposals have no budget/CPC
// before-after shape — they carry a recommendation `type` instead. Rendered
// separately below rather than falling through to proposalBudget/proposalCpc,
// which would otherwise show a meaningless "0 → 0" for every one of these.
function isRecommendationProposal(p: GoogleAdsAgentActionRow): boolean {
  return p.action.startsWith('recommendation.')
}
/** The handful of non-`recommendation.*` action codes this agent writes —
 *  mirrors `ACTION_LABELS_RO` in `admin-google-ads.service.ts` backend-side
 *  (kept in sync manually; the set is small and static). */
const ACTION_LABELS_RO: Record<string, string> = {
  'campaign.create': 'Campanie creată',
  'campaign.pause': 'Campanie pusă pe pauză',
  'campaign.resume': 'Campanie repornită',
  'geo_targeting.updated': 'Targetare geografică actualizată',
  'keywords.updated': 'Cuvinte cheie actualizate',
  'cpc.adjusted': 'CPC maxim ajustat',
  'budget.increase.proposed': 'Propunere de creștere a bugetului',
}
/** A per-row icon for the History list — gives each action type a visual
 *  identity instead of every row reading as identical text, since this is
 *  the one tab with no icon at all otherwise. Mirrors `RECO_ICONS` below
 *  for `recommendation.*` actions. */
const ACTION_ICONS_RO: Record<string, string> = {
  'campaign.create': 'mdi-rocket-launch-outline',
  'campaign.pause': 'mdi-pause-circle-outline',
  'campaign.resume': 'mdi-play-circle-outline',
  'geo_targeting.updated': 'mdi-map-marker-radius-outline',
  'keywords.updated': 'mdi-key-outline',
  'cpc.adjusted': 'mdi-cursor-default-click-outline',
  'budget.increase.proposed': 'mdi-trending-up',
}
function historyRowIcon(action: string): string {
  if (action.startsWith('recommendation.')) return recoIcon(action.replace('recommendation.', ''))
  return ACTION_ICONS_RO[action] ?? 'mdi-circle-small'
}
/** A friendly label for an action code — e.g. `recommendation.CALLOUT_ASSET`
 *  becomes "Adaugă fraze scurte de încredere (callout-uri)" via the same
 *  catalog the Settings tab's toggles use, instead of the raw enum string;
 *  a fixed set of other action codes (budget/CPC proposals, campaign
 *  lifecycle, …) get a label from `ACTION_LABELS_RO`. Falls back to the
 *  raw action only for a genuinely unrecognized code. */
function actionLabel(action: string): string {
  if (!action.startsWith('recommendation.')) return ACTION_LABELS_RO[action] ?? action
  const type = action.replace('recommendation.', '')
  return admin.googleAdsRecommendationTypes.find((r) => r.type === type)?.labelRo ?? action
}

function approve(p: GoogleAdsAgentActionRow) {
  confirm.ask(
    t('adminGoogleAds.approveConfirmTitle'),
    t('adminGoogleAds.approveConfirmText', { name: nm(p.category) }),
    async () => {
      busy.value = p.id
      try {
        await admin.approveGoogleAdsAgentProposal(p.id)
        flash(t('adminGoogleAds.approved'))
      } catch (e) {
        flash(errText(e, t('admin.genericError')), 'error')
      } finally {
        busy.value = null
      }
    },
  )
}

function reject(p: GoogleAdsAgentActionRow) {
  confirm.ask(
    t('adminGoogleAds.rejectConfirmTitle'),
    t('adminGoogleAds.rejectConfirmText', { name: nm(p.category) }),
    async () => {
      busy.value = p.id
      try {
        await admin.rejectGoogleAdsAgentProposal(p.id)
        flash(t('adminGoogleAds.rejected'))
      } catch (e) {
        flash(errText(e, t('admin.genericError')), 'error')
      } finally {
        busy.value = null
      }
    },
  )
}

// --- campaigns ---------------------------------------------------------

function campaignStatusLabel(status: string): string {
  return t(`adminGoogleAds.campaignStatus.${status}`)
}
function campaignStatusTone(status: string): 'success' | 'warning' | undefined {
  if (status === 'active') return 'success'
  if (status === 'pending_creation') return 'warning'
  return undefined
}

// --- history -------------------------------------------------------------

const statusItems = computed(() => [
  { value: '', title: t('adminGoogleAds.historyFilterAnyStatus') },
  { value: 'applied', title: t('adminGoogleAds.statusApplied') },
  { value: 'pending_approval', title: t('adminGoogleAds.statusPendingApproval') },
  { value: 'rejected', title: t('adminGoogleAds.statusRejected') },
])
const historyStatus = computed({
  get: () => admin.googleAdsAgentActionsFilters.status,
  set: (v: '' | 'applied' | 'pending_approval' | 'rejected') =>
    admin.setGoogleAdsAgentActionsFilter('status', v),
})
const historyAction = ref(admin.googleAdsAgentActionsFilters.action)
let historyActionDeb: ReturnType<typeof setTimeout> | undefined
watch(historyAction, (v) => {
  clearTimeout(historyActionDeb)
  historyActionDeb = setTimeout(() => admin.setGoogleAdsAgentActionsFilter('action', v), 300)
})
function historyStatusTone(status: string): 'success' | 'warning' | 'error' | undefined {
  if (status === 'applied') return 'success'
  if (status === 'pending_approval') return 'warning'
  if (status === 'rejected') return 'error'
  return undefined
}
function historyStatusLabel(status: string): string {
  if (status === 'applied') return t('adminGoogleAds.statusApplied')
  if (status === 'pending_approval') return t('adminGoogleAds.statusPendingApproval')
  if (status === 'rejected') return t('adminGoogleAds.statusRejected')
  return status
}
// Reasoning sentences are often long and repeat the same shape across many
// rows (Proposals and History both) — clamped to one line by default so a
// long list reads as scannable instead of a wall of text; a click reveals
// that one row's full text. Action ids are unique across both lists, so one
// shared set works for both.
const expandedReasonRows = ref<Set<string>>(new Set())
function toggleReason(id: string): void {
  const s = expandedReasonRows.value
  if (s.has(id)) s.delete(id)
  else s.add(id)
}

// --- settings --------------------------------------------------------------

const settingsForm = reactive({
  googleAdsAgentEnabled: false,
  googleAdsAgentDefaultDailyBudgetCredits: 5,
  googleAdsAgentDefaultMaxCpcCredits: 1,
  googleAdsAgentMaxDailyBudgetCapCredits: 50,
  googleAdsAgentMaxCpcCapCredits: 5,
  googleAdsAgentStructuralIntervalMinutes: 360,
  googleAdsAgentContentIntervalMinutes: 360,
  googleAdsAgentIntelligenceIntervalMinutes: 1440,
  googleAdsAgentAutoApplyRecommendationTypes: [] as string[],
})
watch(
  () => admin.settings,
  (s) => {
    if (!s) return
    settingsForm.googleAdsAgentEnabled = s.googleAdsAgentEnabled
    settingsForm.googleAdsAgentDefaultDailyBudgetCredits = s.googleAdsAgentDefaultDailyBudgetCredits
    settingsForm.googleAdsAgentDefaultMaxCpcCredits = s.googleAdsAgentDefaultMaxCpcCredits
    settingsForm.googleAdsAgentMaxDailyBudgetCapCredits = s.googleAdsAgentMaxDailyBudgetCapCredits
    settingsForm.googleAdsAgentMaxCpcCapCredits = s.googleAdsAgentMaxCpcCapCredits
    settingsForm.googleAdsAgentStructuralIntervalMinutes = s.googleAdsAgentStructuralIntervalMinutes
    settingsForm.googleAdsAgentContentIntervalMinutes = s.googleAdsAgentContentIntervalMinutes
    settingsForm.googleAdsAgentIntelligenceIntervalMinutes = s.googleAdsAgentIntelligenceIntervalMinutes
    settingsForm.googleAdsAgentAutoApplyRecommendationTypes = [
      ...s.googleAdsAgentAutoApplyRecommendationTypes,
    ]
  },
  { immediate: true },
)
const savingSettings = ref(false)
async function saveSettings() {
  savingSettings.value = true
  try {
    await admin.updateSettings({ ...settingsForm })
    flash(t('admin.saved'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    savingSettings.value = false
  }
}

const showAdvancedSettings = ref(false)

// --- recomandări Google Ads (toggle list, never a raw enum string) -------

const recommendationAdQualityTypes = computed(() =>
  admin.googleAdsRecommendationTypes.filter((r) => r.category === 'ad_quality'),
)
// Budget/targeting/keyword/not-applicable types are never rendered as a
// toggle — one compact note (detail in its own tooltip) instead of a
// per-group bullet list, so the admin isn't left wondering if the option
// exists but is hidden, without the page reading as a wall of text.
const hasNeverApplyRecommendations = computed(() =>
  admin.googleAdsRecommendationTypes.some((r) => r.category !== 'ad_quality'),
)
function isRecommendationTypeOn(type: string): boolean {
  return settingsForm.googleAdsAgentAutoApplyRecommendationTypes.includes(type)
}
function toggleRecommendationType(type: string, on: boolean): void {
  const list = settingsForm.googleAdsAgentAutoApplyRecommendationTypes
  const i = list.indexOf(type)
  if (on && i === -1) list.push(type)
  else if (!on && i !== -1) list.splice(i, 1)
}
const RECO_ICONS: Record<string, string> = {
  CALLOUT_ASSET: 'mdi-text-box-plus-outline',
  CALL_ASSET: 'mdi-phone-outline',
  DYNAMIC_IMAGE_EXTENSION_OPT_IN: 'mdi-image-auto-adjust',
  OPTIMIZE_AD_ROTATION: 'mdi-autorenew',
  RESPONSIVE_SEARCH_AD: 'mdi-plus-box-outline',
  RESPONSIVE_SEARCH_AD_ASSET: 'mdi-text-box-multiple-outline',
  RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH: 'mdi-trending-up',
  SITELINK_ASSET: 'mdi-link-variant-plus',
}
function recoIcon(type: string): string {
  return RECO_ICONS[type] ?? 'mdi-cog-outline'
}
/** The 3 recommendation types that directly raise Google's "Ad Strength"
 *  score (per Google's own scoring docs: headlines, descriptions and
 *  sitelinks — not callouts/images) — surfaced as a small badge on their
 *  toggle instead of making the admin open a tooltip to learn that. */
const AD_STRENGTH_RECOMMENDATION_TYPES = new Set([
  'RESPONSIVE_SEARCH_AD_ASSET',
  'RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH',
  'SITELINK_ASSET',
])
function boostsAdStrength(type: string): boolean {
  return AD_STRENGTH_RECOMMENDATION_TYPES.has(type)
}

// --- Google Ads account (credentials) ---------------------------------

const credentialsForm = reactive({
  customerId: '',
  loginCustomerId: '',
  campaignId: '',
  serviceAccountKeyBase64: '',
})
// Only one Google Ads account can ever be connected here — once it is, the
// page shows a summary instead of open input fields, so there's no visual
// suggestion that a second account could be "added". The form only
// reappears if the admin explicitly asks to change the connected account.
const editingCredentials = ref(false)
const isGoogleAdsConnected = computed(() => !!admin.googleAdsCredentials?.configured)
watch(
  () => admin.googleAdsCredentials,
  (c) => {
    if (!c) return
    credentialsForm.customerId = c.customerId
    credentialsForm.loginCustomerId = c.loginCustomerId
    credentialsForm.campaignId = c.campaignId
  },
  { immediate: true },
)
const savingCredentials = ref(false)
async function saveCredentials() {
  savingCredentials.value = true
  try {
    const input: Record<string, string> = {
      customerId: credentialsForm.customerId.trim(),
      loginCustomerId: credentialsForm.loginCustomerId.trim(),
      campaignId: credentialsForm.campaignId.trim(),
    }
    // Only sent when the admin actually pasted something — omitting it
    // leaves the stored secret untouched (see GoogleAdsCredentialsInput).
    if (credentialsForm.serviceAccountKeyBase64.trim()) {
      input.serviceAccountKeyBase64 = credentialsForm.serviceAccountKeyBase64.trim()
    }
    await admin.updateGoogleAdsCredentials(input)
    credentialsForm.serviceAccountKeyBase64 = ''
    editingCredentials.value = false
    flash(t('admin.saved'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    savingCredentials.value = false
  }
}
function cancelEditCredentials() {
  const c = admin.googleAdsCredentials
  if (c) {
    credentialsForm.customerId = c.customerId
    credentialsForm.loginCustomerId = c.loginCustomerId
    credentialsForm.campaignId = c.campaignId
  }
  credentialsForm.serviceAccountKeyBase64 = ''
  editingCredentials.value = false
}
</script>

<template>
  <div class="gaa">
    <AdminPageHeader
      :title="t('admin.navGoogleAdsAgent')"
      :eyebrow="t('adminGoogleAds.eyebrow')"
      :sub="t('adminGoogleAds.pageSub')"
    />

    <v-tabs v-model="tab" color="primary" class="gaa__tabs" show-arrows>
      <v-tab value="overview" prepend-icon="mdi-view-dashboard-outline">{{ t('adminGoogleAds.tabOverview') }}</v-tab>
      <v-tab value="proposals" prepend-icon="mdi-clock-alert-outline">
        {{ t('adminGoogleAds.tabProposals') }}
        <v-chip
          v-if="admin.googleAdsAgentProposals.length"
          size="x-small"
          color="warning"
          class="ml-1 gaa__proposalsBadge"
        >
          {{ admin.googleAdsAgentProposals.length }}
        </v-chip>
      </v-tab>
      <v-tab value="campaigns" prepend-icon="mdi-bullhorn-outline">{{ t('adminGoogleAds.tabCampaigns') }}</v-tab>
      <v-tab value="history" prepend-icon="mdi-clipboard-text-clock-outline">{{ t('adminGoogleAds.tabHistory') }}</v-tab>
      <v-tab value="settings" prepend-icon="mdi-tune-variant">{{ t('adminGoogleAds.tabSettings') }}</v-tab>
    </v-tabs>

    <v-window v-model="tab" class="gaa__window">
      <!-- Overview -->
      <v-window-item value="overview">
        <div v-if="admin.loadingGoogleAdsAgentOverview && !admin.googleAdsAgentOverview" class="d-flex justify-center py-16">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <AdminEmptyState
          v-else-if="admin.googleAdsAgentOverviewError"
          icon="mdi-alert-circle-outline"
          :text="admin.googleAdsAgentOverviewError"
        />
        <div v-else-if="admin.googleAdsAgentOverview" class="gaa__grid">
          <div
            class="gaa__statusBanner"
            :class="{ 'gaa__statusBanner--off': !admin.googleAdsAgentOverview.enabled }"
          >
            <v-icon :icon="admin.googleAdsAgentOverview.enabled ? 'mdi-check-decagram' : 'mdi-power-off'" size="22" />
            <strong class="gaa__statusText">
              {{ t('adminGoogleAds.statEnabled') }}:
              {{ admin.googleAdsAgentOverview.enabled ? t('adminGoogleAds.enabledOn') : t('adminGoogleAds.enabledOff') }}
            </strong>
            <button
              v-if="!admin.googleAdsAgentOverview.enabled"
              type="button"
              class="gaa__statusCta"
              @click="tab = 'settings'"
            >
              {{ t('adminGoogleAds.statusActivateCta') }}
              <v-icon icon="mdi-arrow-right" size="14" />
            </button>
          </div>

          <h3 class="gaa__subhead gaa__subhead--first">{{ t('adminGoogleAds.overviewGroupCampaigns') }}</h3>
          <div class="gaa__cardRow">
            <AdminStatCard
              :label="t('adminGoogleAds.statActiveCampaigns')"
              :value="admin.googleAdsAgentOverview.campaigns.active"
              tone="success"
              icon="mdi-bullhorn-outline"
            />
            <AdminStatCard
              :label="t('adminGoogleAds.statPausedCampaigns')"
              :value="admin.googleAdsAgentOverview.campaigns.paused"
              icon="mdi-pause-circle-outline"
            />
            <AdminStatCard
              :label="t('adminGoogleAds.statPendingCampaigns')"
              :value="admin.googleAdsAgentOverview.campaigns.pendingCreation"
              tone="warning"
              icon="mdi-progress-clock"
            />
            <AdminStatCard
              :label="t('adminGoogleAds.statSubcategoriesWithout')"
              :value="admin.googleAdsAgentOverview.subcategoriesWithoutCampaign"
              :tone="admin.googleAdsAgentOverview.subcategoriesWithoutCampaign > 0 ? 'warning' : undefined"
              icon="mdi-shape-outline"
            />
          </div>

          <h3 class="gaa__subhead">{{ t('adminGoogleAds.overviewGroupSpend') }}</h3>
          <div class="gaa__cardRow">
            <AdminStatCard
              :label="t('adminGoogleAds.statDailyBudget')"
              :value="credits(admin.googleAdsAgentOverview.totalActiveDailyBudgetCredits)"
              value-is-credits
              icon="mdi-wallet-outline"
            />
            <AdminStatCard
              :label="t('adminGoogleAds.statSpendToday')"
              :value="credits(admin.googleAdsAgentOverview.spendTodayCredits)"
              value-is-credits
              icon="mdi-cash-minus"
            />
            <AdminStatCard
              :label="t('adminGoogleAds.statSpendMonth')"
              :value="credits(admin.googleAdsAgentOverview.spendThisMonthCredits)"
              value-is-credits
              icon="mdi-calendar-month-outline"
            />
          </div>

          <AdminSection :title="t('adminGoogleAds.lastRunsTitle')" icon="mdi-history" wide>
            <div class="runs">
              <div v-for="kind in RUN_KINDS" :key="kind" class="runs__row">
                <div class="runs__name">
                  <v-icon icon="mdi-cog-outline" size="16" />
                  {{ t(`adminGoogleAds.run.${kind}`) }}
                </div>
                <span
                  v-if="admin.googleAdsAgentOverview.lastRuns[kind]"
                  class="chip"
                  :class="`chip--${runTone(admin.googleAdsAgentOverview.lastRuns[kind]?.status) ?? 'neutral'}`"
                >
                  {{ t(`adminGoogleAds.runStatus.${admin.googleAdsAgentOverview.lastRuns[kind]?.status}`) }}
                </span>
                <span v-else class="chip chip--neutral">{{ t('adminGoogleAds.runNever') }}</span>
                <span class="runs__meta">
                  {{ fmtDate(admin.googleAdsAgentOverview.lastRuns[kind]?.startedAt) }}
                </span>
                <span class="runs__meta">
                  {{ t('adminGoogleAds.runActionsTaken', { n: admin.googleAdsAgentOverview.lastRuns[kind]?.actionsTaken ?? 0 }) }}
                </span>
                <v-spacer />
                <v-btn
                  size="small"
                  variant="tonal"
                  :loading="busy === `run-${kind}`"
                  @click="runNow(kind)"
                >
                  {{ t('adminGoogleAds.runNowCta') }}
                </v-btn>
              </div>
            </div>
          </AdminSection>

          <AdminSection
            :title="t('adminGoogleAds.feedCpcTitle')"
            icon="mdi-currency-usd"
            wide
            :hint="t('adminGoogleAds.feedCpcHint', { minutes: admin.googleAdsAgentOverview.feedCpc.staleAfterMinutes })"
          >
            <div class="feedcpc">
              <div class="feedcpc__row">
                <span class="feedcpc__label">{{ t('adminGoogleAds.feedCpcActive') }}</span>
                <span class="feedcpc__value feedcpc__value--main">
                  {{ credits(admin.googleAdsAgentOverview.feedCpc.activeCostPromovareCredits) }}
                </span>
                <span
                  class="chip"
                  :class="admin.googleAdsAgentOverview.feedCpc.fresh ? 'chip--success' : 'chip--warning'"
                >
                  {{ t(admin.googleAdsAgentOverview.feedCpc.fresh ? 'adminGoogleAds.feedCpcFresh' : 'adminGoogleAds.feedCpcStale') }}
                </span>
              </div>
              <div class="feedcpc__row">
                <span class="feedcpc__label">{{ t('adminGoogleAds.feedCpcRaw') }}</span>
                <span class="feedcpc__value">
                  {{ admin.googleAdsAgentOverview.feedCpc.rawAvgCpcCredits != null
                    ? credits(admin.googleAdsAgentOverview.feedCpc.rawAvgCpcCredits)
                    : '—' }}
                </span>
              </div>
              <div class="feedcpc__row">
                <span class="feedcpc__label">{{ t('adminGoogleAds.feedCpcBuffer') }}</span>
                <span class="feedcpc__value">{{ admin.googleAdsAgentOverview.feedCpc.bufferPct }}%</span>
              </div>
              <div class="feedcpc__row">
                <span class="feedcpc__label">{{ t('adminGoogleAds.feedCpcFallback') }}</span>
                <span class="feedcpc__value">{{ credits(admin.googleAdsAgentOverview.feedCpc.fallbackCredits) }}</span>
              </div>
              <div class="feedcpc__row">
                <span class="feedcpc__label">{{ t('adminGoogleAds.feedCpcUpdatedAt') }}</span>
                <span class="feedcpc__value">{{ fmtDate(admin.googleAdsAgentOverview.feedCpc.updatedAt) }}</span>
              </div>
            </div>
          </AdminSection>
        </div>
      </v-window-item>

      <!-- Proposals -->
      <v-window-item value="proposals">
        <div v-if="admin.loadingGoogleAdsAgentProposals && !admin.googleAdsAgentProposals.length" class="d-flex justify-center py-16">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <AdminEmptyState
          v-else-if="admin.googleAdsAgentProposalsError"
          icon="mdi-alert-circle-outline"
          :text="admin.googleAdsAgentProposalsError"
        />
        <AdminEmptyState
          v-else-if="!admin.googleAdsAgentProposals.length"
          icon="mdi-check-circle-outline"
          :text="t('adminGoogleAds.proposalsNone')"
        />
        <ul v-else class="plist">
          <li v-for="p in admin.googleAdsAgentProposals" :key="p.id" class="prow">
            <div class="prow__head">
              <strong>{{ nm(p.category) }}</strong>
              <span class="prow__date">{{ fmtDate(p.createdAt) }}</span>
            </div>
            <button
              v-if="p.reasoning"
              type="button"
              class="prow__reason"
              :class="{ 'prow__reason--expanded': expandedReasonRows.has(p.id) }"
              @click="toggleReason(p.id)"
            >
              {{ p.reasoning }}
            </button>
            <div v-if="isRecommendationProposal(p)" class="prow__deltas">
              <span class="prow__delta">
                {{ t('adminGoogleAds.colRecommendationType') }}:
                <b>{{ actionLabel(p.action) }}</b>
              </span>
            </div>
            <div v-else class="prow__deltas">
              <span class="prow__delta">
                {{ t('adminGoogleAds.colBudget') }}:
                <b>{{ credits(proposalBudget(p).before) }} → {{ credits(proposalBudget(p).after) }}</b>
              </span>
              <span class="prow__delta">
                {{ t('adminGoogleAds.colMaxCpc') }}:
                <b>{{ credits(proposalCpc(p).before) }} → {{ credits(proposalCpc(p).after) }}</b>
              </span>
            </div>
            <div class="prow__actions">
              <v-btn size="small" color="success" variant="flat" :loading="busy === p.id" @click="approve(p)">
                {{ t('adminGoogleAds.approveCta') }}
              </v-btn>
              <v-btn size="small" color="error" variant="tonal" :loading="busy === p.id" @click="reject(p)">
                {{ t('adminGoogleAds.rejectCta') }}
              </v-btn>
            </div>
          </li>
        </ul>
      </v-window-item>

      <!-- Campaigns -->
      <v-window-item value="campaigns">
        <div v-if="admin.loadingGoogleAdsAgentCampaigns && !admin.googleAdsAgentCampaigns.length" class="d-flex justify-center py-16">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <AdminEmptyState
          v-else-if="admin.googleAdsAgentCampaignsError"
          icon="mdi-alert-circle-outline"
          :text="admin.googleAdsAgentCampaignsError"
        />
        <AdminEmptyState
          v-else-if="!admin.googleAdsAgentCampaigns.length"
          icon="mdi-bullhorn-outline"
          :text="t('adminGoogleAds.campaignsNone')"
        />
        <div v-else class="ctable">
          <div class="ctable__head" aria-hidden="true">
            <span>{{ t('adminGoogleAds.colSubcategory') }}</span>
            <span>{{ t('admin.colStatus') }}</span>
            <span>{{ t('adminGoogleAds.colBudget') }}</span>
            <span>{{ t('adminGoogleAds.colMaxCpc') }}</span>
            <span>{{ t('adminGoogleAds.colActiveCompanies') }}</span>
          </div>
          <ul class="ctable__list">
            <li v-for="c in admin.googleAdsAgentCampaigns" :key="c.id" class="crow">
              <span class="crow__cell">
                <span class="crow__cellLbl">{{ t('adminGoogleAds.colSubcategory') }}</span>
                {{ nm(c.category) }}
              </span>
              <span class="crow__cell">
                <span class="crow__cellLbl">{{ t('admin.colStatus') }}</span>
                <span class="chip" :class="`chip--${campaignStatusTone(c.status) ?? 'neutral'}`">
                  {{ campaignStatusLabel(c.status) }}
                </span>
              </span>
              <span class="crow__cell">
                <span class="crow__cellLbl">{{ t('adminGoogleAds.colBudget') }}</span>
                {{ credits(c.dailyBudgetMinor / 100) }}
              </span>
              <span class="crow__cell">
                <span class="crow__cellLbl">{{ t('adminGoogleAds.colMaxCpc') }}</span>
                {{ credits(c.maxCpcMinor / 100) }}
              </span>
              <span class="crow__cell">
                <span class="crow__cellLbl">{{ t('adminGoogleAds.colActiveCompanies') }}</span>
                {{ c.activeCompanyCount }}
              </span>
            </li>
          </ul>
        </div>
      </v-window-item>

      <!-- History -->
      <v-window-item value="history">
        <div class="hfilters">
          <v-text-field
            v-model="historyAction"
            :placeholder="t('adminGoogleAds.historyFilterAction')"
            prepend-inner-icon="mdi-magnify"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            class="hfilters__search"
          />
          <v-select
            v-model="historyStatus"
            :items="statusItems"
            density="compact"
            variant="outlined"
            hide-details
            class="hfilters__sel"
          />
        </div>

        <div v-if="admin.loadingGoogleAdsAgentActions && !admin.googleAdsAgentActions.length" class="d-flex justify-center py-16">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <AdminEmptyState
          v-else-if="admin.googleAdsAgentActionsError"
          icon="mdi-alert-circle-outline"
          :text="admin.googleAdsAgentActionsError"
        />
        <AdminEmptyState
          v-else-if="!admin.googleAdsAgentActions.length"
          icon="mdi-clipboard-text-clock-outline"
          :text="t('adminGoogleAds.historyNone')"
        />
        <ul v-else class="hlist">
          <li v-for="a in admin.googleAdsAgentActions" :key="a.id" class="hrow">
            <div class="hrow__head">
              <v-icon :icon="historyRowIcon(a.action)" size="16" class="hrow__icon" />
              <strong>{{ actionLabel(a.action) }}</strong>
              <span class="hrow__cat">{{ nm(a.category) }}</span>
              <span class="chip" :class="`chip--${historyStatusTone(a.status) ?? 'neutral'}`">
                {{ historyStatusLabel(a.status) }}
              </span>
              <v-spacer />
              <span class="hrow__date">{{ fmtDate(a.createdAt) }}</span>
            </div>
            <button
              v-if="a.reasoning"
              type="button"
              class="hrow__reason"
              :class="{ 'hrow__reason--expanded': expandedReasonRows.has(a.id) }"
              @click="toggleReason(a.id)"
            >
              {{ a.reasoning }}
            </button>
            <p v-if="a.approvedBy" class="hrow__approver">
              {{ t('adminGoogleAds.decidedBy', { name: a.approvedBy.name, date: fmtDate(a.approvedAt) }) }}
            </p>
          </li>
        </ul>

        <AdminPager
          :page="admin.googleAdsAgentActionsFilters.page"
          :page-size="admin.googleAdsAgentActionsFilters.pageSize"
          :total="admin.googleAdsAgentActionsTotal"
          @update:page="(p) => admin.setGoogleAdsAgentActionsFilter('page', p)"
        />
      </v-window-item>

      <!-- Settings -->
      <v-window-item value="settings">
        <AdminSection :title="t('adminGoogleAds.tabSettings')" icon="mdi-tune-variant">
          <div class="gaa__fields">
            <div class="gaa__field">
              <span class="gaa__ic"><v-icon icon="mdi-power" size="18" /></span>
              <div class="gaa__body">
                <label class="gaa__label">
                  {{ t('adminGoogleAds.settingEnabled') }}
                  <AdminHint :text="t('adminGoogleAds.settingEnabledHint')" size="sm" />
                </label>
              </div>
              <v-switch
                v-model="settingsForm.googleAdsAgentEnabled"
                color="primary"
                density="compact"
                hide-details
                inset
              />
            </div>
          </div>

          <h3 class="gaa__subhead gaa__subhead--first">{{ t('adminGoogleAds.settingsGroupDefaults') }}</h3>
          <div class="gaa__pairGrid">
            <div class="gaa__pairField">
              <label for="gaaBudget" class="gaa__pairLabel">
                <v-icon icon="mdi-wallet-plus-outline" size="16" />
                {{ t('adminGoogleAds.settingDefaultBudget') }}
                <AdminHint :text="t('adminGoogleAds.settingDefaultBudgetHint')" size="sm" />
              </label>
              <v-text-field
                id="gaaBudget"
                v-model.number="settingsForm.googleAdsAgentDefaultDailyBudgetCredits"
                type="number"
                step="0.5"
                suffix="cr"
                variant="outlined"
                density="compact"
                hide-details
                class="gaa__input"
              />
            </div>

            <div class="gaa__pairField">
              <label for="gaaCpc" class="gaa__pairLabel">
                <v-icon icon="mdi-cursor-default-click-outline" size="16" />
                {{ t('adminGoogleAds.settingDefaultCpc') }}
                <AdminHint
                  :text="
                    admin.googleAdsAgentOverview?.feedCpc.rawAvgCpcCredits != null
                      ? t('adminGoogleAds.settingDefaultCpcHintWithAvg', {
                          avg: credits(admin.googleAdsAgentOverview.feedCpc.rawAvgCpcCredits),
                        })
                      : t('adminGoogleAds.settingDefaultCpcHint')
                  "
                  size="sm"
                />
              </label>
              <v-text-field
                id="gaaCpc"
                v-model.number="settingsForm.googleAdsAgentDefaultMaxCpcCredits"
                type="number"
                step="0.01"
                suffix="cr"
                variant="outlined"
                density="compact"
                hide-details
                class="gaa__input"
              />
            </div>
          </div>

          <h3 class="gaa__subhead">{{ t('adminGoogleAds.settingsGroupCaps') }}</h3>
          <div class="gaa__pairGrid">
            <div class="gaa__pairField">
              <label for="gaaBudgetCap" class="gaa__pairLabel">
                <v-icon icon="mdi-shield-check-outline" size="16" />
                {{ t('adminGoogleAds.settingBudgetCap') }}
                <AdminHint :text="t('adminGoogleAds.settingBudgetCapHint')" size="sm" />
              </label>
              <v-text-field
                id="gaaBudgetCap"
                v-model.number="settingsForm.googleAdsAgentMaxDailyBudgetCapCredits"
                type="number"
                step="0.5"
                suffix="cr"
                variant="outlined"
                density="compact"
                hide-details
                class="gaa__input"
              />
            </div>

            <div class="gaa__pairField">
              <label for="gaaCpcCap" class="gaa__pairLabel">
                <v-icon icon="mdi-speedometer" size="16" />
                {{ t('adminGoogleAds.settingCpcCap') }}
                <AdminHint :text="t('adminGoogleAds.settingCpcCapHint')" size="sm" />
              </label>
              <v-text-field
                id="gaaCpcCap"
                v-model.number="settingsForm.googleAdsAgentMaxCpcCapCredits"
                type="number"
                step="0.01"
                suffix="cr"
                variant="outlined"
                density="compact"
                hide-details
                class="gaa__input"
              />
            </div>
          </div>

          <h3 class="gaa__subhead">
            {{ t('adminGoogleAds.recommendationsTitle') }}
            <AdminHint :text="t('adminGoogleAds.recommendationsHint')" size="sm" />
          </h3>
          <div v-if="admin.loadingGoogleAdsRecommendationTypes" class="d-flex justify-center py-4">
            <v-progress-circular indeterminate color="primary" size="24" />
          </div>
          <div v-else class="gaa__toggleGrid">
            <div v-for="r in recommendationAdQualityTypes" :key="r.type" class="gaa__toggleCard">
              <v-icon :icon="recoIcon(r.type)" size="18" class="gaa__toggleIcon" />
              <div class="gaa__toggleBody">
                <span class="gaa__toggleLabel">
                  {{ r.labelRo }}
                  <AdminHint :text="r.descriptionRo" size="sm" />
                </span>
                <span v-if="boostsAdStrength(r.type)" class="gaa__toggleBadge">
                  <v-icon icon="mdi-trending-up" size="12" />
                  {{ t('adminGoogleAds.recoBoostsAdStrength') }}
                </span>
              </div>
              <v-switch
                :model-value="isRecommendationTypeOn(r.type)"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="(v) => toggleRecommendationType(r.type, !!v)"
              />
            </div>
          </div>
          <p v-if="hasNeverApplyRecommendations" class="gaa__note">
            <v-icon icon="mdi-information-outline" size="14" />
            {{ t('adminGoogleAds.recoNeverApplyNote') }}
            <AdminHint :text="t('adminGoogleAds.recoNeverApplyHint')" size="sm" />
          </p>

          <button type="button" class="gaa__advancedToggle" @click="showAdvancedSettings = !showAdvancedSettings">
            <v-icon :icon="showAdvancedSettings ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="18" />
            {{ t('adminGoogleAds.advancedToggle') }}
          </button>
          <div v-if="showAdvancedSettings" class="gaa__advanced">
            <div class="gaa__fields">
              <div class="gaa__field">
                <span class="gaa__ic"><v-icon icon="mdi-radar" size="18" /></span>
                <div class="gaa__body">
                  <label for="gaaCadStruct" class="gaa__label">
                    {{ t('adminGoogleAds.cadenceStructural') }}
                    <AdminHint :text="t('adminGoogleAds.cadenceHint')" size="sm" />
                  </label>
                </div>
                <v-text-field
                  id="gaaCadStruct"
                  v-model.number="settingsForm.googleAdsAgentStructuralIntervalMinutes"
                  type="number"
                  step="15"
                  suffix="min"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="gaa__input"
                />
              </div>
              <div class="gaa__field">
                <span class="gaa__ic"><v-icon icon="mdi-file-document-edit-outline" size="18" /></span>
                <div class="gaa__body">
                  <label for="gaaCadContent" class="gaa__label">
                    {{ t('adminGoogleAds.cadenceContent') }}
                    <AdminHint :text="t('adminGoogleAds.cadenceHint')" size="sm" />
                  </label>
                </div>
                <v-text-field
                  id="gaaCadContent"
                  v-model.number="settingsForm.googleAdsAgentContentIntervalMinutes"
                  type="number"
                  step="15"
                  suffix="min"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="gaa__input"
                />
              </div>
              <div class="gaa__field">
                <span class="gaa__ic"><v-icon icon="mdi-brain" size="18" /></span>
                <div class="gaa__body">
                  <label for="gaaCadIntel" class="gaa__label">
                    {{ t('adminGoogleAds.cadenceIntelligence') }}
                    <AdminHint :text="t('adminGoogleAds.cadenceHint')" size="sm" />
                  </label>
                </div>
                <v-text-field
                  id="gaaCadIntel"
                  v-model.number="settingsForm.googleAdsAgentIntelligenceIntervalMinutes"
                  type="number"
                  step="15"
                  suffix="min"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="gaa__input"
                />
              </div>
            </div>
          </div>

          <v-btn color="primary" variant="flat" :loading="savingSettings" @click="saveSettings" class="mt-2">
            {{ t('common.save') }}
          </v-btn>

          <dl v-if="admin.settings?.googleAdsConversionActionResourceName" class="gaa__accountFacts mt-4">
            <dt>{{ t('adminGoogleAds.conversionActionLabel') }}</dt>
            <dd><code>{{ admin.settings.googleAdsConversionActionResourceName }}</code></dd>
          </dl>
        </AdminSection>

        <AdminSection
          :title="t('adminGoogleAds.accountTitle')"
          icon="mdi-google"
          class="mt-4"
          :hint="t('adminGoogleAds.accountHint')"
        >

          <!-- Only one account is ever connected — once it is, this shows a
               summary instead of open inputs, so there's never a visual
               suggestion that a second account could be added alongside it. -->
          <div v-if="isGoogleAdsConnected && !editingCredentials" class="gaa__accountSummary">
            <div class="gaa__accountStatus">
              <span class="chip chip--success">{{ t('adminGoogleAds.accountConnected') }}</span>
              <span v-if="admin.googleAdsCredentials?.serviceAccountEmail" class="gaa__accountEmail">
                {{ admin.googleAdsCredentials.serviceAccountEmail }}
              </span>
            </div>
            <dl class="gaa__accountFacts">
              <template v-if="admin.googleAdsCredentials?.customerId">
                <dt>{{ t('adminGoogleAds.accountCustomerId') }}</dt>
                <dd>{{ admin.googleAdsCredentials.customerId }}</dd>
              </template>
              <template v-if="admin.googleAdsCredentials?.loginCustomerId">
                <dt>{{ t('adminGoogleAds.accountLoginCustomerId') }}</dt>
                <dd>{{ admin.googleAdsCredentials.loginCustomerId }}</dd>
              </template>
              <template v-if="admin.googleAdsCredentials?.campaignId">
                <dt>{{ t('adminGoogleAds.accountCampaignId') }}</dt>
                <dd>{{ admin.googleAdsCredentials.campaignId }}</dd>
              </template>
            </dl>
            <v-btn size="small" variant="tonal" @click="editingCredentials = true">
              {{ t('adminGoogleAds.accountChange') }}
            </v-btn>
          </div>

          <div v-else>
            <div v-if="!isGoogleAdsConnected" class="gaa__accountStatus">
              <span class="chip chip--neutral">{{ t('adminGoogleAds.accountNotConnected') }}</span>
            </div>

            <div class="gaa__settingsGrid">
              <v-text-field
                v-model="credentialsForm.customerId"
                :label="t('adminGoogleAds.accountCustomerId')"
                :hint="t('adminGoogleAds.accountCustomerIdHint')"
                persistent-hint
                variant="outlined"
                density="compact"
              />
              <v-text-field
                v-model="credentialsForm.loginCustomerId"
                :label="t('adminGoogleAds.accountLoginCustomerId')"
                :hint="t('adminGoogleAds.accountLoginCustomerIdHint')"
                persistent-hint
                variant="outlined"
                density="compact"
              />
              <v-text-field
                v-model="credentialsForm.campaignId"
                :label="t('adminGoogleAds.accountCampaignId')"
                :hint="t('adminGoogleAds.accountCampaignIdHint')"
                persistent-hint
                variant="outlined"
                density="compact"
              />
            </div>

            <v-textarea
              v-model="credentialsForm.serviceAccountKeyBase64"
              :label="t('adminGoogleAds.accountKeyLabel')"
              :placeholder="
                admin.googleAdsCredentials?.serviceAccountKeyConfigured
                  ? t('adminGoogleAds.accountKeyPlaceholderConfigured')
                  : t('adminGoogleAds.accountKeyPlaceholderEmpty')
              "
              :hint="t('adminGoogleAds.accountKeyHint')"
              persistent-hint
              variant="outlined"
              density="compact"
              rows="3"
              auto-grow
              class="mt-2"
            />

            <div class="gaa__accountActions">
              <v-btn
                color="primary"
                variant="flat"
                :loading="savingCredentials"
                @click="saveCredentials"
              >
                {{ t('common.save') }}
              </v-btn>
              <v-btn v-if="isGoogleAdsConnected" variant="text" @click="cancelEditCredentials">
                {{ t('common.cancel') }}
              </v-btn>
            </div>
          </div>
        </AdminSection>
      </v-window-item>
    </v-window>
  </div>
</template>

<style scoped>
.gaa__tabs {
  margin-bottom: 1.2rem;
}
/* The site-wide `.rounded-pill` rule (main.scss) chamfers every pill/chip
   with the "standard button" cut (--tvz-hex-md, 10px) regardless of size —
   fine for a wide text chip, but on a ~20px single-digit counter like this
   one the cut eats so much of each corner the result reads as a lopsided
   diamond with the digit crammed into a corner instead of a badge. Scoped
   here (not in main.scss) to the one badge this actually breaks: the
   smaller chip-sized cut (--tvz-hex-sm, 6px — see tokens.scss) plus an
   explicit centered square box, same shape family, properly legible at
   this size. */
.gaa__proposalsBadge.rounded-pill {
  clip-path: var(--tvz-hex-sm) !important;
}
.gaa__proposalsBadge {
  width: 20px;
  height: 20px;
  padding: 0 !important;
  justify-content: center;
}
.gaa__proposalsBadge :deep(.v-chip__content) {
  justify-content: center;
  width: 100%;
}
/* A vertical stack of groups (status banner, labeled card rows, the
   AdminSections below) rather than one flat grid of lookalike tiles —
   `.gaa__cardRow` is the actual card grid, scoped to one labeled group at a
   time so "campaigns" and "spend" read as two distinct clusters instead of
   8 identical boxes in a row. */
.gaa__grid {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}
.gaa__cardRow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.9rem;
}
/* Pulled out of the stat-card grid — the agent's on/off state is the one
   fact that changes what the rest of the page even means, so it reads as a
   banner/status strip rather than another identical tile. */
.gaa__statusBanner {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.85rem 1.1rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid rgba(var(--v-theme-success), 0.3);
  background: rgba(var(--v-theme-success), 0.08);
  color: rgb(var(--v-theme-success));
}
.gaa__statusBanner--off {
  border-color: var(--tvz-glass-border);
  background: var(--tvz-glass-bg);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.gaa__statusText {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.95rem;
}
.gaa__statusCta {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}
.gaa__statusCta:hover {
  text-decoration: underline;
}
.gaa__subhead {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin: 1.2rem 0 0.5rem;
}
.gaa__subhead--first {
  margin-top: 0;
}
/* Icon chip + label-with-tooltip + control, one per row — same visual
   language as AdminSettingsView's `.as__field`, so every settings page in
   the panel reads consistently. Replaces a denser, always-on-text layout
   (a persistent-hint sentence under every field, a full description line
   under every switch) with a single scannable row per setting. */
.gaa__fields {
  display: flex;
  flex-direction: column;
}
.gaa__field {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.75rem 0.4rem;
  margin-inline: -0.4rem;
  border-bottom: 1px solid var(--tvz-hairline);
  border-radius: 8px;
  transition: background var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.gaa__field:hover {
  background: rgba(var(--v-theme-on-surface), 0.025);
}
.gaa__field:first-child {
  padding-top: 0.2rem;
}
.gaa__field:last-child {
  border-bottom: none;
}
.gaa__ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  flex: none;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.gaa__body {
  flex: 1;
  min-width: 0;
}
.gaa__label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 600;
  font-size: 0.86rem;
}
.gaa__input {
  flex: none;
  width: 130px;
}
.gaa__note {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin: 0.4rem 0 1rem;
}
/* The 4 numeric caps as 2 clearly-paired cards instead of 4 identical
   full-width rows — "new campaign" and "safety cap" each get a budget +
   CPC figure side by side, so the relationship between the two numbers is
   visible instead of implied by reading order alone. */
.gaa__pairGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
  margin-bottom: 0.3rem;
}
.gaa__pairField {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 10px;
}
.gaa__pairLabel {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.gaa__pairField .gaa__input {
  width: 100%;
}
/* The recommendation toggles as a 2-column grid of bordered cards instead
   of 8 stacked identical rows — and a visible badge on the 3 types that
   actually raise Ad Strength, instead of making the admin open a tooltip
   on every row to find that out. */
.gaa__toggleGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 0.6rem;
}
.gaa__toggleCard {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 10px;
  transition: border-color var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.gaa__toggleCard:hover {
  border-color: var(--tvz-glass-border);
}
.gaa__toggleIcon {
  flex: none;
  opacity: 0.75;
}
.gaa__toggleBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.gaa__toggleLabel {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.83rem;
  font-weight: 600;
  line-height: 1.25;
}
.gaa__toggleBadge {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  width: fit-content;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  color: rgb(var(--v-theme-success));
  background: rgba(var(--v-theme-success), 0.12);
}
.gaa__advancedToggle {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.3rem 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.gaa__advanced {
  margin: 0.5rem 0 1rem;
}
.gaa__accountStatus {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.gaa__accountEmail {
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}
.gaa__accountSummary {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
}
.gaa__accountFacts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.3rem 1rem;
  margin: 0 0 1rem;
  font-size: 0.82rem;
  max-width: 100%;
}
.gaa__accountFacts dt {
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.gaa__accountFacts dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}
.gaa__accountActions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.8rem;
}
.gaa__settingsGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.8rem;
  margin-bottom: 1.2rem;
}

.runs {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.runs__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.6rem 0.2rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.runs__row:last-child {
  border-bottom: none;
}
.runs__name {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 600;
  min-width: 11rem;
}
.runs__meta {
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.feedcpc {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.feedcpc__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.5rem 0.2rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.feedcpc__row:last-child {
  border-bottom: none;
}
.feedcpc__label {
  min-width: 14rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.feedcpc__value {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.feedcpc__value--main {
  font-size: 1.1rem;
}

.plist,
.hlist {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.prow,
.hrow {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 0.85rem 1rem;
}
.prow__head,
.hrow__head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.hrow__icon {
  opacity: 0.6;
  flex: none;
}
.prow__date,
.hrow__date {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.hrow__cat {
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
/* A <button>, not a <p> — reasoning is clamped to one line by default
   (most rows share a near-identical sentence shape, so 20+ of them read as
   noise) and a click expands just that row to its full text. */
.prow__reason,
.hrow__reason {
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font: inherit;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin: 0.4rem 0 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
.prow__reason--expanded,
.hrow__reason--expanded {
  -webkit-line-clamp: unset;
}
.hrow__approver {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin: 0.3rem 0 0;
}
.prow__deltas {
  display: flex;
  gap: 1.2rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
  font-size: 0.85rem;
}
.prow__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.7rem;
}

.hfilters {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.hfilters__search {
  flex: 1 1 240px;
}
.hfilters__sel {
  max-width: 12rem;
}

.ctable__head {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
  gap: 0.5rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  padding: 0 0.9rem 0.4rem;
}
@media (max-width: 720px) {
  .ctable__head {
    display: none;
  }
}
.ctable__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.crow {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
  gap: 0.5rem;
  align-items: center;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 0.7rem 0.9rem;
}
@media (max-width: 720px) {
  .crow {
    grid-template-columns: 1fr 1fr;
  }
}
.crow__cellLbl {
  display: none;
  font-size: 0.65rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
@media (max-width: 720px) {
  .crow__cellLbl {
    display: block;
  }
}

.chip {
  display: inline-flex;
  align-items: center;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
}
.chip--success {
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}
.chip--warning {
  background: rgba(var(--v-theme-warning), 0.14);
  color: rgb(var(--v-theme-warning));
}
.chip--error {
  background: rgba(var(--v-theme-error), 0.12);
  color: rgb(var(--v-theme-error));
}
.chip--neutral {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>
