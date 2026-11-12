<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
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
})

watch(tab, (v) => {
  if (v === 'proposals' && !admin.googleAdsAgentProposals.length) void admin.fetchGoogleAdsAgentProposals()
  if (v === 'campaigns' && !admin.googleAdsAgentCampaigns.length) void admin.fetchGoogleAdsAgentCampaigns()
  if (v === 'history' && !admin.googleAdsAgentActions.length) void admin.fetchGoogleAdsAgentActions()
  if (v === 'settings' && !admin.settings) void admin.fetchSettings()
  if (v === 'settings' && !admin.googleAdsCredentials) void admin.fetchGoogleAdsCredentials()
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
          <AdminStatCard
            :label="t('adminGoogleAds.statEnabled')"
            :value="admin.googleAdsAgentOverview.enabled ? t('adminGoogleAds.enabledOn') : t('adminGoogleAds.enabledOff')"
            :tone="admin.googleAdsAgentOverview.enabled ? 'success' : undefined"
            icon="mdi-power"
          />
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
          <AdminStatCard
            :label="t('adminGoogleAds.statSubcategoriesWithout')"
            :value="admin.googleAdsAgentOverview.subcategoriesWithoutCampaign"
            :tone="admin.googleAdsAgentOverview.subcategoriesWithoutCampaign > 0 ? 'warning' : undefined"
            icon="mdi-shape-outline"
          />

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

          <AdminSection :title="t('adminGoogleAds.feedCpcTitle')" icon="mdi-currency-usd" wide>
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
            <p class="gaa__hint">
              {{ t('adminGoogleAds.feedCpcHint', { minutes: admin.googleAdsAgentOverview.feedCpc.staleAfterMinutes }) }}
            </p>
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
            <p v-if="p.reasoning" class="prow__reason">{{ p.reasoning }}</p>
            <div class="prow__deltas">
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
            :label="t('adminGoogleAds.historyFilterAction')"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            class="hfilters__field"
          />
          <v-select
            v-model="historyStatus"
            :items="statusItems"
            :label="t('admin.colStatus')"
            density="compact"
            variant="outlined"
            hide-details
            class="hfilters__field"
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
              <code>{{ a.action }}</code>
              <strong>{{ nm(a.category) }}</strong>
              <span class="chip" :class="`chip--${historyStatusTone(a.status) ?? 'neutral'}`">
                {{ historyStatusLabel(a.status) }}
              </span>
              <v-spacer />
              <span class="hrow__date">{{ fmtDate(a.createdAt) }}</span>
            </div>
            <p v-if="a.reasoning" class="hrow__reason">{{ a.reasoning }}</p>
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
          <v-switch
            v-model="settingsForm.googleAdsAgentEnabled"
            color="primary"
            :label="t('adminGoogleAds.settingEnabled')"
            hide-details
            class="mb-4"
          />
          <p class="gaa__hint">{{ t('adminGoogleAds.settingEnabledHint') }}</p>

          <div class="gaa__settingsGrid">
            <v-text-field
              v-model.number="settingsForm.googleAdsAgentDefaultDailyBudgetCredits"
              type="number"
              step="0.5"
              :label="t('adminGoogleAds.settingDefaultBudget')"
              variant="outlined"
              density="compact"
            />
            <v-text-field
              v-model.number="settingsForm.googleAdsAgentDefaultMaxCpcCredits"
              type="number"
              step="0.01"
              :label="t('adminGoogleAds.settingDefaultCpc')"
              variant="outlined"
              density="compact"
            />
            <v-text-field
              v-model.number="settingsForm.googleAdsAgentMaxDailyBudgetCapCredits"
              type="number"
              step="0.5"
              :label="t('adminGoogleAds.settingBudgetCap')"
              variant="outlined"
              density="compact"
            />
            <v-text-field
              v-model.number="settingsForm.googleAdsAgentMaxCpcCapCredits"
              type="number"
              step="0.01"
              :label="t('adminGoogleAds.settingCpcCap')"
              variant="outlined"
              density="compact"
            />
          </div>

          <h3 class="gaa__subhead">{{ t('adminGoogleAds.cadenceTitle') }}</h3>
          <p class="gaa__hint">{{ t('adminGoogleAds.cadenceHint') }}</p>
          <div class="gaa__settingsGrid">
            <v-text-field
              v-model.number="settingsForm.googleAdsAgentStructuralIntervalMinutes"
              type="number"
              step="15"
              :label="t('adminGoogleAds.cadenceStructural')"
              :hint="t('adminGoogleAds.cadenceMinutesHint')"
              persistent-hint
              variant="outlined"
              density="compact"
            />
            <v-text-field
              v-model.number="settingsForm.googleAdsAgentContentIntervalMinutes"
              type="number"
              step="15"
              :label="t('adminGoogleAds.cadenceContent')"
              :hint="t('adminGoogleAds.cadenceMinutesHint')"
              persistent-hint
              variant="outlined"
              density="compact"
            />
            <v-text-field
              v-model.number="settingsForm.googleAdsAgentIntelligenceIntervalMinutes"
              type="number"
              step="15"
              :label="t('adminGoogleAds.cadenceIntelligence')"
              :hint="t('adminGoogleAds.cadenceMinutesHint')"
              persistent-hint
              variant="outlined"
              density="compact"
            />
          </div>

          <v-btn color="primary" variant="flat" :loading="savingSettings" @click="saveSettings">
            {{ t('common.save') }}
          </v-btn>
        </AdminSection>

        <AdminSection :title="t('adminGoogleAds.accountTitle')" icon="mdi-google" class="mt-4">
          <p class="gaa__hint">{{ t('adminGoogleAds.accountHint') }}</p>

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
.gaa__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.9rem;
}
.gaa__hint {
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin: -0.5rem 0 1.2rem;
}
.gaa__subhead {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  margin: 1.4rem 0 0.3rem;
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
.prow__date,
.hrow__date {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.prow__reason,
.hrow__reason {
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin: 0.4rem 0 0;
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
  max-width: 40rem;
}
.hfilters__field {
  flex: 1;
  min-width: 10rem;
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
