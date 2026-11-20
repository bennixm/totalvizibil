<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import GoogleAdsProposalPreview from '@/components/admin/GoogleAdsProposalPreview.vue'
import GoogleAdsOptimizationPanel from '@/components/admin/google-ads/GoogleAdsOptimizationPanel.vue'
import GoogleAdsCampaignTable from '@/components/admin/google-ads/GoogleAdsCampaignTable.vue'
import GoogleAdsActivityFeed from '@/components/admin/google-ads/GoogleAdsActivityFeed.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import GoogleAdsActionOutcome from '@/components/admin/google-ads/GoogleAdsActionOutcome.vue'
import GoogleAdsReviseDialog from '@/components/admin/google-ads/GoogleAdsReviseDialog.vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminHintText from '@/components/admin/AdminHintText.vue'
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
import {
  googleAdsOptimizationApi,
  type GoogleAdsOptimizationSummary,
} from '@/services/google-ads-optimization'

const { t, locale } = useI18n()
const admin = useAdminStore()
const confirm = useConfirmStore()
const toasts = useToastStore()
// `approx` = the "≈" equivalent in the top-nav EUR/RON display currency.
const { credits, approx } = useMoney()

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

type Tab = 'overview' | 'campaigns' | 'proposals' | 'activity' | 'history' | 'settings'
const TABS: Tab[] = ['overview', 'campaigns', 'proposals', 'activity', 'history', 'settings']
const route = useRoute()
const router = useRouter()
// `gcampaigns` = the former separate "Google Ads campaigns" tab; old links
// keep working and land on the merged Campaigns tab.
const initialTab = String(route.query.tab ?? '').replace('gcampaigns', 'campaigns')
const tab = ref<Tab>((TABS as string[]).includes(initialTab) ? (initialTab as Tab) : 'overview')
/** Campaigns tab: the Google Ads campaigns (default) or the per-subcategory
 *  campaign mappings (formerly their own tab). */
const campaignsView = ref<'google' | 'subcategories'>(
  route.query.view === 'subcategories' ? 'subcategories' : 'google',
)
// Keeps the open tab/view in the URL so a reload / back link returns to it.
watch([tab, campaignsView], ([v, cv]) => {
  void router.replace({
    query: {
      ...route.query,
      tab: v === 'overview' ? undefined : v,
      view: v === 'campaigns' && cv === 'subcategories' ? 'subcategories' : undefined,
    },
  })
})
watch(
  [tab, campaignsView],
  ([v, cv]) => {
    if (v === 'campaigns' && cv === 'subcategories' && !admin.googleAdsAgentCampaigns.length)
      void admin.fetchGoogleAdsAgentCampaigns()
  },
  { immediate: true },
)

// --- optimization summary (header status + overview) ---------------------

const summary = ref<GoogleAdsOptimizationSummary | null>(null)
const summaryError = ref<string | null>(null)
const agentRunning = ref(false)
const panel = ref<{ refreshFeed: () => void } | null>(null)
async function loadSummary() {
  try {
    summary.value = await googleAdsOptimizationApi.summary()
    summaryError.value = null
  } catch (e) {
    summaryError.value = errText(e, t('admin.genericError'))
  }
}
let summaryTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void loadSummary()
  summaryTimer = setInterval(() => void loadSummary(), 60_000)
})
onBeforeUnmount(() => clearInterval(summaryTimer))
/** The activity feed reports whether the agent is working; when a cycle
 *  ends, the numbers it produced are reloaded. */
function onRunning(v: boolean) {
  const ended = agentRunning.value && !v
  agentRunning.value = v
  if (ended) void loadSummary()
}
const isRunning = computed(() => agentRunning.value || !!summary.value?.running)
const startingCycle = ref(false)
function runMonitor() {
  confirm.ask(
    t('adminGoogleAdsOpt.runMonitorConfirmTitle'),
    t('adminGoogleAdsOpt.runMonitorConfirmText'),
    async () => {
      startingCycle.value = true
      try {
        await googleAdsOptimizationApi.runMonitor()
        flash(t('adminGoogleAdsOpt.runStarted'))
        agentRunning.value = true
        setTimeout(() => panel.value?.refreshFeed(), 600)
      } catch (e) {
        flash(errText(e, t('admin.genericError')), 'error')
      } finally {
        startingCycle.value = false
      }
    },
  )
}
const cycleHours = computed(() => {
  const m = summary.value?.monitorIntervalMinutes ?? 0
  return m % 60 === 0 ? String(m / 60) : (m / 60).toFixed(1)
})
const showTechDetails = ref(false)
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

// `immediate`: a deep link (?tab=history) must load that tab's data on
// first render too, not only on a later tab switch.
watch(
  tab,
  (v) => {
    if (v === 'proposals' && !admin.googleAdsAgentProposals.length)
      void admin.fetchGoogleAdsAgentProposals()
    if (v === 'history' && !admin.googleAdsAgentActions.length)
      void admin.fetchGoogleAdsAgentActions()
    if (v === 'settings' && !admin.settings) void admin.fetchSettings()
    if (v === 'settings' && !admin.googleAdsCredentials) void admin.fetchGoogleAdsCredentials()
    if (v === 'settings') void admin.fetchGoogleAdsRecommendationTypes()
  },
  { immediate: true },
)

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
  'creative.rsa_gap_fill': 'Titluri/descrieri adăugate în reclamă',
  'creative.assets_gap_fill': 'Extensii adăugate (sitelink-uri, callout-uri, snippet, nume)',
  'creative.images_gap_fill': 'Imagini adăugate (Pexels)',
  'creative.replace_text': 'Înlocuire text (performanță / Ad Strength)',
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
  'creative.rsa_gap_fill': 'mdi-format-title',
  'creative.assets_gap_fill': 'mdi-link-box-variant-outline',
  'creative.images_gap_fill': 'mdi-image-plus-outline',
  'creative.replace_text': 'mdi-swap-horizontal',
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
        const res = await admin.approveGoogleAdsAgentProposal(p.id, p.contentHash)
        // Show what Google actually reported, not a generic success.
        flash(res?.executionResult ? res.executionResult : t('adminGoogleAdsOpt.approvedResult'))
      } catch (e) {
        flash(errText(e, t('admin.genericError')), 'error')
      } finally {
        busy.value = null
      }
    },
  )
}

// "Recomandă manual"
const reviseFor = ref<GoogleAdsAgentActionRow | null>(null)
const reviseOpen = computed({
  get: () => !!reviseFor.value,
  set: (v: boolean) => {
    if (!v) reviseFor.value = null
  },
})
const revising = ref(false)
async function submitRevision(instructions: string) {
  const p = reviseFor.value
  if (!p) return
  revising.value = true
  try {
    await admin.reviseGoogleAdsAgentProposal(p.id, instructions)
    reviseFor.value = null
    flash(t('adminGoogleAdsOpt.revised'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    revising.value = false
  }
}
const expandedPrevious = ref<Set<string>>(new Set())
/** Proposals whose "Why?" (reasoning, revision details) is open. */
const openWhy = ref<Set<string>>(new Set())
function toggleWhy(id: string) {
  if (openWhy.value.has(id)) openWhy.value.delete(id)
  else openWhy.value.add(id)
}
function togglePrevious(id: string) {
  const s = expandedPrevious.value
  if (s.has(id)) s.delete(id)
  else s.add(id)
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
  { value: 'failed', title: t('adminGoogleAdsOpt.statusFailed') },
  { value: 'approved', title: t('adminGoogleAdsOpt.statusApproved') },
  { value: 'superseded', title: t('adminGoogleAdsOpt.statusSuperseded') },
])
const historyStatus = computed({
  get: () => admin.googleAdsAgentActionsFilters.status,
  set: (
    v: '' | 'applied' | 'pending_approval' | 'rejected' | 'failed' | 'approved' | 'superseded',
  ) => admin.setGoogleAdsAgentActionsFilter('status', v),
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
  if (status === 'rejected' || status === 'failed') return 'error'
  if (status === 'approved') return 'warning'
  return undefined
}
function historyStatusLabel(status: string): string {
  if (status === 'applied') return t('adminGoogleAds.statusApplied')
  if (status === 'pending_approval') return t('adminGoogleAds.statusPendingApproval')
  if (status === 'rejected') return t('adminGoogleAds.statusRejected')
  if (status === 'failed') return t('adminGoogleAdsOpt.statusFailed')
  if (status === 'approved') return t('adminGoogleAdsOpt.statusApproved')
  if (status === 'superseded') return t('adminGoogleAdsOpt.statusSuperseded')
  return status
}
/** History rows whose details are open. */
const openHistory = ref<Set<string>>(new Set())
function toggleHistory(id: string) {
  if (openHistory.value.has(id)) openHistory.value.delete(id)
  else openHistory.value.add(id)
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
  googleAdsAgentMonitorIntervalMinutes: 360,
  googleAdsAgentAutoFillGapsEnabled: true,
  googleAdsAgentCreativeCooldownDays: 14,
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
    settingsForm.googleAdsAgentIntelligenceIntervalMinutes =
      s.googleAdsAgentIntelligenceIntervalMinutes
    settingsForm.googleAdsAgentMonitorIntervalMinutes =
      s.googleAdsAgentMonitorIntervalMinutes ?? 360
    settingsForm.googleAdsAgentAutoFillGapsEnabled = s.googleAdsAgentAutoFillGapsEnabled ?? true
    settingsForm.googleAdsAgentCreativeCooldownDays = s.googleAdsAgentCreativeCooldownDays ?? 14
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
    <AdminPageHeader :title="t('admin.navGoogleAdsAgent')" :eyebrow="t('adminGoogleAds.eyebrow')">
      <template #actions>
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-play-circle-outline"
          :loading="startingCycle"
          :disabled="isRunning"
          @click="runMonitor"
        >
          {{ t('adminGoogleAdsOpt.runMonitor') }}
        </v-btn>
      </template>
    </AdminPageHeader>

    <!-- One status line instead of banners -->
    <div v-if="summary" class="gaa__status">
      <span class="st" :class="summary.enabled ? 'st--ok' : 'st--off'">
        <i class="st__dot" />
        {{ summary.enabled ? t('adminGoogleAdsOpt.agentOn') : t('adminGoogleAdsOpt.agentOff') }}
        <button v-if="!summary.enabled" type="button" class="st__link" @click="tab = 'settings'">
          {{ t('adminGoogleAds.statusActivateCta') }}
        </button>
      </span>
      <span v-if="isRunning" class="st st--live">
        <i class="st__dot" />{{ t('adminGoogleAdsOpt.running') }}
      </span>
      <v-tooltip
        v-if="!summary.writesAllowed"
        :text="t('adminGoogleAdsOpt.readOnlyBanner')"
        location="bottom"
        max-width="340"
      >
        <template #activator="{ props }">
          <span v-bind="props" class="st st--warn" tabindex="0">
            <v-icon icon="mdi-shield-lock-outline" size="15" />{{
              t('adminGoogleAdsOpt.readOnlyChip')
            }}
          </span>
        </template>
      </v-tooltip>
      <span v-if="summary.enabled" class="st">
        <v-icon icon="mdi-timer-sync-outline" size="15" />
        {{ t('adminGoogleAdsOpt.cycleEvery', { hours: cycleHours }) }}
      </span>
      <span class="st">
        <v-icon icon="mdi-auto-fix" size="15" />
        {{
          summary.autoFillEnabled
            ? t('adminGoogleAdsOpt.autoFillOn')
            : t('adminGoogleAdsOpt.autoFillOff')
        }}
      </span>
      <span class="st st--muted">
        {{ t('adminGoogleAdsOpt.lastOptimization') }}:
        {{
          summary.lastOptimization
            ? fmtDate(summary.lastOptimization.at)
            : t('adminGoogleAdsOpt.never')
        }}
      </span>
      <span v-if="summary.lastSyncAt" class="st st--muted">
        {{ t('adminGoogleAdsOpt.syncedAt', { when: fmtDate(summary.lastSyncAt) }) }}
      </span>
    </div>

    <v-tabs v-model="tab" color="primary" class="gaa__tabs" show-arrows density="comfortable">
      <v-tab value="overview">{{ t('adminGoogleAds.tabOverview') }}</v-tab>
      <v-tab value="campaigns">{{ t('adminGoogleAds.tabCampaigns') }}</v-tab>
      <v-tab value="proposals">
        {{ t('adminGoogleAds.tabProposals') }}
        <span v-if="admin.googleAdsAgentProposals.length" class="gaa__count">
          {{ admin.googleAdsAgentProposals.length }}
        </span>
      </v-tab>
      <v-tab value="activity">{{ t('adminGoogleAdsOpt.tabActivity') }}</v-tab>
      <v-tab value="history">{{ t('adminGoogleAds.tabHistory') }}</v-tab>
      <v-tab value="settings">{{ t('adminGoogleAds.tabSettings') }}</v-tab>
    </v-tabs>

    <v-window v-model="tab" class="gaa__window">
      <!-- ============ Overview ============ -->
      <v-window-item value="overview">
        <p v-if="summaryError" class="gaa__error">{{ summaryError }}</p>
        <div v-if="!summary && !summaryError" class="d-flex justify-center py-16">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <GoogleAdsOptimizationPanel
          v-if="summary"
          ref="panel"
          :summary="summary"
          @goto="(v) => (tab = v)"
          @running="onRunning"
        />

        <template v-if="admin.googleAdsAgentOverview">
          <!-- Spend: compact, always visible -->
          <section class="gaa__sec">
            <h3 class="gaa__h">{{ t('adminGoogleAds.overviewGroupSpend') }}</h3>
            <dl class="mrow">
              <div>
                <dt>{{ t('adminGoogleAds.statDailyBudget') }}</dt>
                <dd>{{ credits(admin.googleAdsAgentOverview.totalActiveDailyBudgetCredits) }}</dd>
                <span>{{
                  approx(admin.googleAdsAgentOverview.totalActiveDailyBudgetCredits)
                }}</span>
              </div>
              <div>
                <dt>{{ t('adminGoogleAds.statSpendToday') }}</dt>
                <dd>{{ credits(admin.googleAdsAgentOverview.spendTodayCredits) }}</dd>
                <span>{{ approx(admin.googleAdsAgentOverview.spendTodayCredits) }}</span>
              </div>
              <div>
                <dt>{{ t('adminGoogleAds.statSpendMonth') }}</dt>
                <dd>{{ credits(admin.googleAdsAgentOverview.spendThisMonthCredits) }}</dd>
                <span>{{ approx(admin.googleAdsAgentOverview.spendThisMonthCredits) }}</span>
              </div>
            </dl>
          </section>

          <!-- Technical details: collapsed by default -->
          <section class="gaa__sec">
            <button
              type="button"
              class="gaa__disclosure"
              :aria-expanded="showTechDetails"
              @click="showTechDetails = !showTechDetails"
            >
              <v-icon
                :icon="showTechDetails ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                size="20"
              />
              <span class="gaa__disclosureTitle">{{ t('adminGoogleAdsOpt.techDetails') }}</span>
              <span class="gaa__disclosureSub">{{ t('adminGoogleAdsOpt.techDetailsSub') }}</span>
            </button>

            <div v-if="showTechDetails" class="tech">
              <div class="tech__block">
                <h4 class="tech__h">{{ t('adminGoogleAds.overviewGroupCampaigns') }}</h4>
                <dl class="mrow mrow--small">
                  <div>
                    <dt>{{ t('adminGoogleAds.statActiveCampaigns') }}</dt>
                    <dd class="tone-success">
                      {{ admin.googleAdsAgentOverview.campaigns.active }}
                    </dd>
                  </div>
                  <div>
                    <dt>{{ t('adminGoogleAds.statPausedCampaigns') }}</dt>
                    <dd>{{ admin.googleAdsAgentOverview.campaigns.paused }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('adminGoogleAds.statPendingCampaigns') }}</dt>
                    <dd
                      :class="{
                        'tone-warning': admin.googleAdsAgentOverview.campaigns.pendingCreation,
                      }"
                    >
                      {{ admin.googleAdsAgentOverview.campaigns.pendingCreation }}
                    </dd>
                  </div>
                  <div>
                    <dt>{{ t('adminGoogleAds.statSubcategoriesWithout') }}</dt>
                    <dd
                      :class="{
                        'tone-warning': admin.googleAdsAgentOverview.subcategoriesWithoutCampaign,
                      }"
                    >
                      {{ admin.googleAdsAgentOverview.subcategoriesWithoutCampaign }}
                    </dd>
                  </div>
                </dl>
              </div>

              <div class="tech__block">
                <h4 class="tech__h">{{ t('adminGoogleAds.lastRunsTitle') }}</h4>
                <ul class="runs">
                  <li v-for="kind in RUN_KINDS" :key="kind" class="runs__row">
                    <span class="runs__name">{{ t(`adminGoogleAds.run.${kind}`) }}</span>
                    <span
                      class="chip"
                      :class="`chip--${runTone(admin.googleAdsAgentOverview.lastRuns[kind]?.status) ?? 'neutral'}`"
                    >
                      {{
                        admin.googleAdsAgentOverview.lastRuns[kind]
                          ? t(
                              `adminGoogleAds.runStatus.${admin.googleAdsAgentOverview.lastRuns[kind]?.status}`,
                            )
                          : t('adminGoogleAds.runNever')
                      }}
                    </span>
                    <span class="runs__meta">
                      {{ fmtDate(admin.googleAdsAgentOverview.lastRuns[kind]?.startedAt) }} ·
                      {{
                        t('adminGoogleAds.runActionsTaken', {
                          n: admin.googleAdsAgentOverview.lastRuns[kind]?.actionsTaken ?? 0,
                        })
                      }}
                    </span>
                    <v-btn
                      size="small"
                      variant="text"
                      color="primary"
                      :loading="busy === `run-${kind}`"
                      @click="runNow(kind)"
                    >
                      {{ t('adminGoogleAds.runNowCta') }}
                    </v-btn>
                  </li>
                </ul>
              </div>

              <div class="tech__block">
                <h4 class="tech__h">
                  <AdminHintText
                    :label="t('adminGoogleAds.feedCpcTitle')"
                    :hint="
                      t('adminGoogleAds.feedCpcHint', {
                        minutes: admin.googleAdsAgentOverview.feedCpc.staleAfterMinutes,
                      })
                    "
                  />
                </h4>
                <dl class="facts">
                  <dt>{{ t('adminGoogleAds.feedCpcActive') }}</dt>
                  <dd>
                    <b>{{
                      credits(admin.googleAdsAgentOverview.feedCpc.activeCostPromovareCredits)
                    }}</b>
                    <span
                      class="chip"
                      :class="
                        admin.googleAdsAgentOverview.feedCpc.fresh
                          ? 'chip--success'
                          : 'chip--warning'
                      "
                    >
                      {{
                        t(
                          admin.googleAdsAgentOverview.feedCpc.fresh
                            ? 'adminGoogleAds.feedCpcFresh'
                            : 'adminGoogleAds.feedCpcStale',
                        )
                      }}
                    </span>
                  </dd>
                  <dt>{{ t('adminGoogleAds.feedCpcRaw') }}</dt>
                  <dd>
                    {{
                      admin.googleAdsAgentOverview.feedCpc.rawAvgCpcCredits != null
                        ? credits(admin.googleAdsAgentOverview.feedCpc.rawAvgCpcCredits)
                        : '–'
                    }}
                  </dd>
                  <dt>{{ t('adminGoogleAds.feedCpcBuffer') }}</dt>
                  <dd>{{ admin.googleAdsAgentOverview.feedCpc.bufferPct }}%</dd>
                  <dt>{{ t('adminGoogleAds.feedCpcFallback') }}</dt>
                  <dd>{{ credits(admin.googleAdsAgentOverview.feedCpc.fallbackCredits) }}</dd>
                  <dt>{{ t('adminGoogleAds.feedCpcUpdatedAt') }}</dt>
                  <dd>{{ fmtDate(admin.googleAdsAgentOverview.feedCpc.updatedAt) }}</dd>
                </dl>
              </div>
            </div>
          </section>
        </template>
        <p v-else-if="admin.googleAdsAgentOverviewError" class="gaa__error">
          {{ admin.googleAdsAgentOverviewError }}
        </p>
      </v-window-item>

      <!-- ============ Campaigns ============ -->
      <v-window-item value="campaigns">
        <v-btn-toggle
          v-model="campaignsView"
          mandatory
          density="compact"
          variant="outlined"
          divided
          color="primary"
          class="gaa__segment"
        >
          <v-btn value="google" size="small">{{ t('adminGoogleAdsOpt.viewGoogleAds') }}</v-btn>
          <v-btn value="subcategories" size="small">{{
            t('adminGoogleAdsOpt.tabSubcategories')
          }}</v-btn>
        </v-btn-toggle>

        <GoogleAdsCampaignTable v-if="tab === 'campaigns' && campaignsView === 'google'" />

        <template v-else-if="campaignsView === 'subcategories'">
          <div
            v-if="admin.loadingGoogleAdsAgentCampaigns && !admin.googleAdsAgentCampaigns.length"
            class="d-flex justify-center py-16"
          >
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
          <div v-else class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>{{ t('adminGoogleAds.colSubcategory') }}</th>
                  <th>{{ t('admin.colStatus') }}</th>
                  <th class="num">{{ t('adminGoogleAds.colBudget') }}</th>
                  <th class="num">{{ t('adminGoogleAds.colMaxCpc') }}</th>
                  <th class="num">{{ t('adminGoogleAds.colActiveCompanies') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in admin.googleAdsAgentCampaigns" :key="c.id">
                  <td :data-label="t('adminGoogleAds.colSubcategory')" class="tbl__main">
                    {{ nm(c.category) }}
                  </td>
                  <td :data-label="t('admin.colStatus')">
                    <span
                      class="chip"
                      :class="`chip--${campaignStatusTone(c.status) ?? 'neutral'}`"
                    >
                      {{ campaignStatusLabel(c.status) }}
                    </span>
                  </td>
                  <td :data-label="t('adminGoogleAds.colBudget')" class="num">
                    {{ credits(c.dailyBudgetMinor / 100) }}
                  </td>
                  <td :data-label="t('adminGoogleAds.colMaxCpc')" class="num">
                    {{ credits(c.maxCpcMinor / 100) }}
                  </td>
                  <td :data-label="t('adminGoogleAds.colActiveCompanies')" class="num">
                    {{ c.activeCompanyCount }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </v-window-item>

      <!-- ============ Proposals ============ -->
      <v-window-item value="proposals">
        <div
          v-if="admin.loadingGoogleAdsAgentProposals && !admin.googleAdsAgentProposals.length"
          class="d-flex justify-center py-16"
        >
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
          <li v-for="p in admin.googleAdsAgentProposals" :key="p.id" class="prop">
            <header class="prop__head">
              <v-icon :icon="historyRowIcon(p.action)" size="18" class="prop__icon" />
              <div class="prop__titles">
                <div class="prop__title">
                  {{ actionLabel(p.action) }}
                  <GaChip v-if="p.revisionOfId" tone="primary" icon="mdi-account-edit-outline">
                    {{ t('adminGoogleAdsOpt.revisionBadge') }}
                  </GaChip>
                </div>
                <div class="prop__target">
                  <template v-if="p.target?.googleCampaignId">
                    <RouterLink
                      :to="{
                        name: 'admin-google-ads-campaign',
                        params: { googleCampaignId: p.target.googleCampaignId },
                      }"
                    >
                      {{ p.target.campaignName ?? p.target.googleCampaignId }}
                    </RouterLink>
                    · {{ p.target.level }}
                  </template>
                  <template v-else
                    >{{ nm(p.category)
                    }}<template v-if="p.target"> · {{ p.target.level }}</template></template
                  >
                </div>
              </div>
              <time class="prop__date">{{ fmtDate(p.createdAt) }}</time>
            </header>

            <!-- The exact change: the main content of a proposal -->
            <GoogleAdsProposalPreview v-if="p.preview?.sections.length" :preview="p.preview" />
            <div v-else-if="!isRecommendationProposal(p)" class="prop__deltas">
              <span>
                {{ t('adminGoogleAds.colBudget') }}:
                <b
                  >{{ credits(proposalBudget(p).before) }} →
                  {{ credits(proposalBudget(p).after) }}</b
                >
              </span>
              <span>
                {{ t('adminGoogleAds.colMaxCpc') }}:
                <b>{{ credits(proposalCpc(p).before) }} → {{ credits(proposalCpc(p).after) }}</b>
              </span>
            </div>

            <div v-if="openWhy.has(p.id)" class="prop__why">
              <p v-if="p.reasoning" class="prop__reason">{{ p.reasoning }}</p>
              <GoogleAdsActionOutcome v-if="p.revisionOfId" :action="p" />
              <template v-if="p.revisionOf?.preview?.sections.length">
                <button type="button" class="linkbtn" @click="togglePrevious(p.id)">
                  <v-icon
                    :icon="expandedPrevious.has(p.id) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                    size="16"
                  />
                  {{ t('adminGoogleAdsOpt.previousVersion') }}
                </button>
                <GoogleAdsProposalPreview
                  v-if="expandedPrevious.has(p.id)"
                  :preview="p.revisionOf.preview"
                  compact
                />
              </template>
            </div>

            <footer class="prop__foot">
              <button
                type="button"
                class="linkbtn"
                :aria-expanded="openWhy.has(p.id)"
                @click="toggleWhy(p.id)"
              >
                <v-icon
                  :icon="openWhy.has(p.id) ? 'mdi-chevron-up' : 'mdi-help-circle-outline'"
                  size="16"
                />
                {{
                  openWhy.has(p.id)
                    ? t('adminGoogleAdsOpt.hideDetails')
                    : t('adminGoogleAdsOpt.why')
                }}
              </button>
              <div class="prop__actions">
                <v-btn
                  size="small"
                  variant="text"
                  color="error"
                  :disabled="busy === p.id"
                  @click="reject(p)"
                >
                  {{ t('adminGoogleAds.rejectCta') }}
                </v-btn>
                <v-btn
                  size="small"
                  variant="tonal"
                  color="primary"
                  :disabled="busy === p.id"
                  @click="reviseFor = p"
                >
                  {{ t('adminGoogleAdsOpt.reviseCta') }}
                </v-btn>
                <v-btn
                  size="small"
                  variant="flat"
                  color="success"
                  :loading="busy === p.id"
                  @click="approve(p)"
                >
                  {{ t('adminGoogleAds.approveCta') }}
                </v-btn>
              </div>
            </footer>
          </li>
        </ul>
        <GoogleAdsReviseDialog
          v-model="reviseOpen"
          :loading="revising"
          :title="
            reviseFor ? `${nm(reviseFor.category)} · ${actionLabel(reviseFor.action)}` : undefined
          "
          @submit="submitRevision"
        />
      </v-window-item>

      <!-- ============ Activity ============ -->
      <v-window-item value="activity">
        <GoogleAdsActivityFeed v-if="tab === 'activity'" :limit="200" @running="onRunning" />
        <p class="gaa__foot">{{ t('adminGoogleAdsOpt.activityHint') }}</p>
      </v-window-item>

      <!-- ============ History ============ -->
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

        <div
          v-if="admin.loadingGoogleAdsAgentActions && !admin.googleAdsAgentActions.length"
          class="d-flex justify-center py-16"
        >
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
          <li
            v-for="a in admin.googleAdsAgentActions"
            :key="a.id"
            class="hrow"
            :class="{ 'hrow--open': openHistory.has(a.id) }"
          >
            <button
              type="button"
              class="hrow__line"
              :aria-expanded="openHistory.has(a.id)"
              @click="toggleHistory(a.id)"
            >
              <v-icon :icon="historyRowIcon(a.action)" size="16" class="hrow__icon" />
              <span class="hrow__label">{{ actionLabel(a.action) }}</span>
              <span class="hrow__cat">{{ nm(a.category) }}</span>
              <span class="hrow__flags">
                <v-icon
                  v-if="a.verifiedAt"
                  icon="mdi-check-decagram"
                  size="15"
                  color="success"
                  :title="t('adminGoogleAdsOpt.historyVerified')"
                />
                <v-icon
                  :icon="a.requiredApproval ? 'mdi-account-check-outline' : 'mdi-robot-outline'"
                  size="15"
                  class="hrow__mode"
                  :title="
                    a.requiredApproval
                      ? t('adminGoogleAdsOpt.historyRequiredApproval')
                      : t('adminGoogleAdsOpt.historyAutomatic')
                  "
                />
              </span>
              <span class="chip" :class="`chip--${historyStatusTone(a.status) ?? 'neutral'}`">
                {{ historyStatusLabel(a.status) }}
              </span>
              <time class="hrow__date">{{ fmtDate(a.createdAt) }}</time>
              <v-icon
                :icon="openHistory.has(a.id) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                size="18"
                class="hrow__chev"
              />
            </button>
            <div v-if="openHistory.has(a.id)" class="hrow__body">
              <p v-if="a.reasoning" class="hrow__reason">{{ a.reasoning }}</p>
              <div class="hrow__meta">
                <span>
                  {{
                    a.requiredApproval
                      ? t('adminGoogleAdsOpt.historyRequiredApproval')
                      : t('adminGoogleAdsOpt.historyAutomatic')
                  }}
                </span>
                <span v-if="a.verifiedAt">· {{ t('adminGoogleAdsOpt.historyVerified') }}</span>
                <span v-if="a.approvedBy">
                  ·
                  {{
                    t('adminGoogleAds.decidedBy', {
                      name: a.approvedBy.name,
                      date: fmtDate(a.approvedAt),
                    })
                  }}
                </span>
                <RouterLink
                  v-if="a.googleCampaignId"
                  :to="{
                    name: 'admin-google-ads-campaign',
                    params: { googleCampaignId: a.googleCampaignId },
                  }"
                >
                  {{ t('adminGoogleAdsOpt.open') }}
                </RouterLink>
              </div>
              <GoogleAdsActionOutcome :action="a" />
              <GoogleAdsProposalPreview
                v-if="a.preview?.sections.length"
                :preview="a.preview"
                compact
              />
            </div>
          </li>
        </ul>

        <AdminPager
          :page="admin.googleAdsAgentActionsFilters.page"
          :page-size="admin.googleAdsAgentActionsFilters.pageSize"
          :total="admin.googleAdsAgentActionsTotal"
          @update:page="(p) => admin.setGoogleAdsAgentActionsFilter('page', p)"
        />
      </v-window-item>

      <!-- ============ Settings ============ -->
      <v-window-item value="settings">
        <div class="settings">
          <section class="sset">
            <h3 class="sset__h">{{ t('adminGoogleAdsOpt.general') }}</h3>
            <div class="srow">
              <AdminHintText
                :label="t('adminGoogleAds.settingEnabled')"
                :hint="t('adminGoogleAds.settingEnabledHint')"
              />
              <v-switch
                v-model="settingsForm.googleAdsAgentEnabled"
                color="primary"
                density="compact"
                hide-details
                inset
              />
            </div>
            <div class="srow">
              <AdminHintText
                :label="t('adminGoogleAdsOpt.autoFill')"
                :hint="t('adminGoogleAdsOpt.autoFillHint')"
              />
              <v-switch
                v-model="settingsForm.googleAdsAgentAutoFillGapsEnabled"
                color="primary"
                density="compact"
                hide-details
                inset
              />
            </div>
            <div class="srow">
              <label for="gaaMonitor">
                <AdminHintText
                  :label="t('adminGoogleAdsOpt.monitorInterval')"
                  :hint="t('adminGoogleAdsOpt.monitorIntervalHint')"
                />
              </label>
              <v-text-field
                id="gaaMonitor"
                v-model.number="settingsForm.googleAdsAgentMonitorIntervalMinutes"
                type="number"
                step="60"
                min="60"
                suffix="min"
                variant="outlined"
                density="compact"
                hide-details
                class="sinput"
              />
            </div>
            <div class="srow">
              <label for="gaaCooldown">
                <AdminHintText
                  :label="t('adminGoogleAdsOpt.cooldown')"
                  :hint="t('adminGoogleAdsOpt.cooldownHint')"
                />
              </label>
              <v-text-field
                id="gaaCooldown"
                v-model.number="settingsForm.googleAdsAgentCreativeCooldownDays"
                type="number"
                min="7"
                max="90"
                variant="outlined"
                density="compact"
                hide-details
                class="sinput"
              />
            </div>
          </section>

          <section class="sset">
            <h3 class="sset__h">
              {{ t('adminGoogleAds.settingsGroupDefaults') }} ·
              {{ t('adminGoogleAds.settingsGroupCaps') }}
            </h3>
            <div class="sgrid">
              <label class="sfield">
                <AdminHintText
                  :label="t('adminGoogleAds.settingDefaultBudget')"
                  :hint="t('adminGoogleAds.settingDefaultBudgetHint')"
                />
                <v-text-field
                  v-model.number="settingsForm.googleAdsAgentDefaultDailyBudgetCredits"
                  type="number"
                  step="0.5"
                  suffix="cr"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </label>
              <label class="sfield">
                <AdminHintText
                  :label="t('adminGoogleAds.settingDefaultCpc')"
                  :hint="
                    admin.googleAdsAgentOverview?.feedCpc.rawAvgCpcCredits != null
                      ? t('adminGoogleAds.settingDefaultCpcHintWithAvg', {
                          avg: credits(admin.googleAdsAgentOverview.feedCpc.rawAvgCpcCredits),
                        })
                      : t('adminGoogleAds.settingDefaultCpcHint')
                  "
                />
                <v-text-field
                  v-model.number="settingsForm.googleAdsAgentDefaultMaxCpcCredits"
                  type="number"
                  step="0.01"
                  suffix="cr"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </label>
              <label class="sfield">
                <AdminHintText
                  :label="t('adminGoogleAds.settingBudgetCap')"
                  :hint="t('adminGoogleAds.settingBudgetCapHint')"
                />
                <v-text-field
                  v-model.number="settingsForm.googleAdsAgentMaxDailyBudgetCapCredits"
                  type="number"
                  step="0.5"
                  suffix="cr"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </label>
              <label class="sfield">
                <AdminHintText
                  :label="t('adminGoogleAds.settingCpcCap')"
                  :hint="t('adminGoogleAds.settingCpcCapHint')"
                />
                <v-text-field
                  v-model.number="settingsForm.googleAdsAgentMaxCpcCapCredits"
                  type="number"
                  step="0.01"
                  suffix="cr"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </label>
            </div>
          </section>

          <section class="sset">
            <h3 class="sset__h">
              <AdminHintText
                :label="t('adminGoogleAds.recommendationsTitle')"
                :hint="t('adminGoogleAds.recommendationsHint')"
              />
            </h3>
            <div
              v-if="admin.loadingGoogleAdsRecommendationTypes"
              class="d-flex justify-center py-4"
            >
              <v-progress-circular indeterminate color="primary" size="24" />
            </div>
            <template v-else>
              <div v-for="r in recommendationAdQualityTypes" :key="r.type" class="srow">
                <span class="srow__lbl">
                  <v-icon :icon="recoIcon(r.type)" size="17" class="srow__icon" />
                  <AdminHintText :label="r.labelRo" :hint="r.descriptionRo" />
                  <v-icon
                    v-if="boostsAdStrength(r.type)"
                    icon="mdi-trending-up"
                    size="15"
                    color="success"
                    :title="t('adminGoogleAds.recoBoostsAdStrength')"
                  />
                </span>
                <v-switch
                  :model-value="isRecommendationTypeOn(r.type)"
                  color="primary"
                  density="compact"
                  hide-details
                  inset
                  @update:model-value="(v) => toggleRecommendationType(r.type, !!v)"
                />
              </div>
            </template>
            <p v-if="hasNeverApplyRecommendations" class="sset__note">
              <AdminHintText
                :label="t('adminGoogleAds.recoNeverApplyLabel')"
                :hint="t('adminGoogleAds.recoNeverApplyHint')"
              />
            </p>
          </section>

          <section class="sset">
            <button
              type="button"
              class="gaa__disclosure"
              :aria-expanded="showAdvancedSettings"
              @click="showAdvancedSettings = !showAdvancedSettings"
            >
              <v-icon
                :icon="showAdvancedSettings ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                size="20"
              />
              <span class="gaa__disclosureTitle">{{ t('adminGoogleAds.advancedToggle') }}</span>
            </button>
            <div v-if="showAdvancedSettings" class="sgrid sgrid--3">
              <label class="sfield">
                <AdminHintText
                  :label="t('adminGoogleAds.cadenceStructural')"
                  :hint="t('adminGoogleAds.cadenceHint')"
                />
                <v-text-field
                  v-model.number="settingsForm.googleAdsAgentStructuralIntervalMinutes"
                  type="number"
                  step="15"
                  suffix="min"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </label>
              <label class="sfield">
                <AdminHintText
                  :label="t('adminGoogleAds.cadenceContent')"
                  :hint="t('adminGoogleAds.cadenceHint')"
                />
                <v-text-field
                  v-model.number="settingsForm.googleAdsAgentContentIntervalMinutes"
                  type="number"
                  step="15"
                  suffix="min"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </label>
              <label class="sfield">
                <AdminHintText
                  :label="t('adminGoogleAds.cadenceIntelligence')"
                  :hint="t('adminGoogleAds.cadenceHint')"
                />
                <v-text-field
                  v-model.number="settingsForm.googleAdsAgentIntelligenceIntervalMinutes"
                  type="number"
                  step="15"
                  suffix="min"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </label>
            </div>
          </section>

          <div class="settings__save">
            <v-btn color="primary" variant="flat" :loading="savingSettings" @click="saveSettings">
              {{ t('common.save') }}
            </v-btn>
          </div>

          <section class="sset">
            <h3 class="sset__h">
              <AdminHintText
                :label="t('adminGoogleAds.accountTitle')"
                :hint="t('adminGoogleAds.accountHint')"
              />
            </h3>
            <!-- Only one account is ever connected: a summary once it is. -->
            <div v-if="isGoogleAdsConnected && !editingCredentials">
              <dl class="facts">
                <dt>{{ t('admin.colStatus') }}</dt>
                <dd>
                  <span class="chip chip--success">{{ t('adminGoogleAds.accountConnected') }}</span>
                  <span v-if="admin.googleAdsCredentials?.serviceAccountEmail" class="muted">
                    {{ admin.googleAdsCredentials.serviceAccountEmail }}
                  </span>
                </dd>
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
                <template v-if="admin.settings?.googleAdsConversionActionResourceName">
                  <dt>{{ t('adminGoogleAds.conversionActionLabel') }}</dt>
                  <dd>
                    <code>{{ admin.settings.googleAdsConversionActionResourceName }}</code>
                  </dd>
                </template>
              </dl>
              <v-btn size="small" variant="tonal" class="mt-3" @click="editingCredentials = true">
                {{ t('adminGoogleAds.accountChange') }}
              </v-btn>
            </div>

            <div v-else>
              <p v-if="!isGoogleAdsConnected" class="mb-3">
                <span class="chip chip--neutral">{{
                  t('adminGoogleAds.accountNotConnected')
                }}</span>
              </p>
              <div class="sgrid sgrid--3">
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
                class="mt-3"
              />
              <div class="settings__save">
                <v-btn v-if="isGoogleAdsConnected" variant="text" @click="cancelEditCredentials">
                  {{ t('common.cancel') }}
                </v-btn>
                <v-btn
                  color="primary"
                  variant="flat"
                  :loading="savingCredentials"
                  @click="saveCredentials"
                >
                  {{ t('common.save') }}
                </v-btn>
              </div>
            </div>
          </section>
        </div>
      </v-window-item>
    </v-window>
  </div>
</template>

<style scoped>
/* ---------- header status line ---------- */
.gaa__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 1.1rem;
  margin: -0.75rem 0 1.25rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.st {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
}
.st .v-icon {
  opacity: 0.6;
}
.st__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.3);
}
.st--ok {
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}
.st--ok .st__dot {
  background: rgb(var(--v-theme-success));
}
.st--off {
  font-weight: 600;
}
.st--live {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.st--live .st__dot {
  background: rgb(var(--v-theme-success));
  animation: st-pulse 1.6s infinite;
}
@keyframes st-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-success), 0.55);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(var(--v-theme-success), 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-success), 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .st--live .st__dot {
    animation: none;
  }
}
.st--warn {
  color: rgb(var(--v-theme-warning));
  cursor: help;
}
.st--warn .v-icon {
  opacity: 1;
}
.st--muted {
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.st__link {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}

/* ---------- tabs ---------- */
.gaa__tabs {
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.gaa__count {
  margin-left: 0.4rem;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-warning));
  color: rgb(var(--v-theme-on-warning, 255, 255, 255));
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1.25rem;
  text-align: center;
}
.gaa__error {
  color: rgb(var(--v-theme-error));
  font-size: var(--tvz-fs-small);
}
.gaa__foot {
  margin: 0.75rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* ---------- shared bits ---------- */
.gaa__sec {
  margin-top: 1.75rem;
}
.gaa__h {
  margin: 0 0 0.6rem;
  font-size: var(--tvz-fs-body, 1rem);
  font-weight: 600;
}
.tone-success {
  color: rgb(var(--v-theme-success));
}
.tone-warning {
  color: rgb(var(--v-theme-warning));
}
.muted {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: var(--tvz-fs-small);
}
.chip {
  display: inline-flex;
  align-items: center;
  font-size: var(--tvz-fs-micro);
  font-weight: 600;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  white-space: nowrap;
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
.linkbtn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-size: var(--tvz-fs-small);
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.65);
  cursor: pointer;
}
.linkbtn:hover {
  color: rgb(var(--v-theme-primary));
}

/* metric row (spend, campaign counts) */
.mrow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin: 0;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.mrow > div {
  padding: 0.75rem 1rem;
  border-left: 1px solid var(--tvz-hairline);
}
.mrow > div:first-child {
  border-left: 0;
}
.mrow dt {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.mrow dd {
  margin: 0.1rem 0 0;
  font-size: 1.15rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.mrow span {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.mrow--small {
  border: 0;
  background: none;
}
.mrow--small > div {
  padding: 0.25rem 1rem 0.25rem 0;
  border-left: 0;
}

/* disclosure (technical details, advanced settings) */
.gaa__disclosure {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0;
  border: 0;
  border-top: 1px solid var(--tvz-hairline);
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.gaa__disclosure .v-icon {
  align-self: center;
  opacity: 0.6;
}
.gaa__disclosureTitle {
  font-weight: 600;
}
.gaa__disclosureSub {
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.tech {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem 2rem;
  padding: 0.75rem 0 0 1.75rem;
}
.tech__block:first-child {
  grid-column: 1 / -1;
}
.tech__h {
  margin: 0 0 0.5rem;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.runs {
  list-style: none;
  margin: 0;
  padding: 0;
}
.runs__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: 'name btn' 'meta btn';
  align-items: center;
  column-gap: 0.75rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--tvz-hairline);
}
.runs__row:last-child {
  border-bottom: 0;
}
.runs__name {
  grid-area: name;
  font-size: var(--tvz-fs-small);
  font-weight: 500;
}
.runs__row .chip {
  grid-area: name;
  justify-self: end;
  margin-right: 0.25rem;
}
.runs__meta {
  grid-area: meta;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.runs__row .v-btn {
  grid-area: btn;
}
.facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.4rem 1.25rem;
  margin: 0;
  font-size: var(--tvz-fs-small);
}
.facts dt {
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.facts dd {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  overflow-wrap: anywhere;
}
.facts code {
  font-size: var(--tvz-fs-caption);
}

/* ---------- campaigns ---------- */
.gaa__segment {
  margin-bottom: 1rem;
}
.table-wrap {
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--tvz-fs-small);
}
.tbl th {
  text-align: left;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  padding: 0.6rem 0.9rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.tbl td {
  padding: 0.6rem 0.9rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.tbl tbody tr:last-child td {
  border-bottom: 0;
}
.tbl__main {
  font-weight: 500;
}
.num {
  text-align: right !important;
  font-variant-numeric: tabular-nums;
}

/* ---------- proposals ---------- */
.plist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.prop {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.15rem;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
}
.prop__head {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
}
.prop__icon {
  margin-top: 0.15rem;
  opacity: 0.6;
}
.prop__titles {
  flex: 1;
  min-width: 0;
}
.prop__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-weight: 600;
}
.prop__target {
  margin-top: 0.1rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
  overflow-wrap: anywhere;
}
.prop__target a {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}
.prop__date {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.45);
  white-space: nowrap;
}
.prop :deep(.gpp) {
  margin-top: 0;
}
.prop__deltas {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  font-size: var(--tvz-fs-small);
}
.prop__why {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.65rem 0.8rem;
  border-radius: var(--tvz-radius-sm);
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.prop__reason {
  margin: 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.prop__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.prop__actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: auto;
}

/* ---------- history ---------- */
.hfilters {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.hfilters__search {
  flex: 1;
}
.hfilters__sel {
  flex: 0 0 220px;
}
.hlist {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.hrow + .hrow {
  border-top: 1px solid var(--tvz-hairline);
}
.hrow__line {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.6rem 0.9rem;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.hrow__line:hover {
  background: rgba(var(--v-theme-on-surface), 0.025);
}
.hrow__icon,
.hrow__mode,
.hrow__chev {
  opacity: 0.55;
  flex: none;
}
.hrow__label {
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.hrow__cat {
  flex: 1;
  min-width: 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hrow__flags {
  display: inline-flex;
  gap: 0.3rem;
  flex: none;
}
.hrow__date {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.45);
  white-space: nowrap;
  flex: none;
}
.hrow__body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0 0.9rem 0.9rem 2.6rem;
}
.hrow__reason {
  margin: 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.hrow__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.hrow__meta a {
  margin-left: auto;
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
  font-weight: 600;
}

/* ---------- settings ---------- */
.settings {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 880px;
}
.sset {
  padding: 1.1rem 1.25rem;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
}
.sset .gaa__disclosure {
  border-top: 0;
  padding: 0;
}
.sset__h {
  margin: 0 0 0.6rem;
  font-size: var(--tvz-fs-body, 1rem);
  font-weight: 600;
}
.sset__note {
  margin: 0.6rem 0 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.srow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 2.75rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--tvz-hairline);
  font-size: var(--tvz-fs-small);
}
.srow:last-of-type {
  border-bottom: 0;
}
.srow .v-switch {
  flex: none;
}
.srow__lbl {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.srow__icon {
  opacity: 0.55;
}
.sinput {
  flex: 0 0 150px;
}
.sgrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem 1.25rem;
}
.sgrid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 0.85rem;
}
.sfield {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: var(--tvz-fs-small);
}
.settings__save {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

/* ---------- responsive ---------- */
@media (max-width: 760px) {
  .gaa__status {
    gap: 0.35rem 0.85rem;
  }
  .hfilters {
    flex-direction: column;
  }
  .hfilters__sel {
    flex: none;
  }
  .hrow__cat,
  .hrow__flags {
    display: none;
  }
  .hrow__body {
    padding-left: 0.9rem;
  }
  .prop__head {
    flex-wrap: wrap;
  }
  .prop__date {
    order: 3;
    flex-basis: 100%;
    padding-left: 1.85rem;
  }
  .prop__foot {
    flex-direction: column-reverse;
    align-items: stretch;
  }
  .prop__actions {
    margin-left: 0;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .sgrid,
  .sgrid--3 {
    grid-template-columns: 1fr;
  }
  .srow {
    flex-wrap: wrap;
  }
  .sinput {
    flex: 1 1 140px;
  }
  .tech {
    padding-left: 0;
    grid-template-columns: 1fr;
  }
  /* subcategories table → stacked rows */
  .tbl thead {
    display: none;
  }
  .tbl tr {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.35rem 1rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--tvz-hairline);
  }
  .tbl tbody tr:last-child {
    border-bottom: 0;
  }
  .tbl td {
    padding: 0;
    border: 0;
    text-align: left !important;
  }
  .tbl td::before {
    content: attr(data-label);
    display: block;
    font-size: var(--tvz-fs-caption);
    color: rgba(var(--v-theme-on-surface), 0.5);
  }
  .tbl td.tbl__main {
    grid-column: 1 / -1;
  }
  .tbl td.tbl__main::before {
    display: none;
  }
}
</style>
