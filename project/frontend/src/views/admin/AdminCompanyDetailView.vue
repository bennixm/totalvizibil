<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import VisibilityMeter from '@/components/VisibilityMeter.vue'
import TrendChart from '@/components/TrendChart.vue'
import { useMoney } from '@/composables/useMoney'
import { useAdminStore, type AdminCompanyDetail, type AdminCompanyLead } from '@/stores/admin'
import type { CampaignTier, CampaignStatus } from '@/stores/campaign'
import type { LocalizedName } from '@/stores/companies'
import { ApiError } from '@/services/api'
import { companyRoute } from '@/services/routes'

const { t, n, locale } = useI18n()
const route = useRoute()
const admin = useAdminStore()

const id = computed(() => String(route.params.id))
const data = ref<AdminCompanyDetail | null>(null)
const loading = ref(true)
const busy = ref<string | null>(null)

const toast = reactive({ show: false, text: '', color: 'success' })
function flash(text: string, color: 'success' | 'error' = 'success') {
  Object.assign(toast, { show: true, text, color })
}
function errText(e: unknown, fb: string) {
  return e instanceof ApiError ? e.message : fb
}
function fmt(v: number) {
  return n(v, { maximumFractionDigits: 2 })
}
function fmtInt(v: number) {
  return n(v, { maximumFractionDigits: 0 })
}
const money = useMoney()
/** A credit amount's equivalent in this business owner's chosen wallet currency. */
function ownerEq(v: number): string {
  const cur = data.value?.campaign.wallet.currency === 'RON' ? 'RON' : 'EUR'
  return money.approx(v, cur)
}
function nm(x: LocalizedName) {
  return x[locale.value as keyof LocalizedName] ?? x.en
}
function dt(s: string | null) {
  return s ? new Date(s).toLocaleString() : '—'
}
function fmtMinutes(m: number | null): string {
  if (m == null) return '—'
  if (m < 60) return `${m} min`
  if (m < 60 * 24) return `${Math.round(m / 60)} h`
  return `${Math.round(m / 1440)} ${t('dashboard.days')}`
}

// --- profile form ---
const profile = reactive({ displayName: '', legalName: '', description: '' })
const savingProfile = ref(false)

// --- campaign editor ---
const budget = ref(20)
const cpc = ref(1)
const appearFirst = ref(false)
const auto = ref(false)
const dirty = ref(false)
const hydrating = ref(false)

/** A number input can transiently hold '' / NaN while being typed. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
const budgetN = computed(() => num(budget.value))
const cpcN = computed(() => num(cpc.value))

const camp = computed(() => data.value?.campaign.campaign ?? null)
const status = computed<CampaignStatus | null>(() => camp.value?.status ?? null)
const hasCampaign = computed(() => !!camp.value)
const isLive = computed(() => status.value === 'active')
// Advanced-plan site whose builder isn't finished — can't be listed yet.
const builderPending = computed(() => !!data.value?.campaign.requiresWebsiteBuilder)
// This campaign competes for the top slot but its saved CPC has fallen behind
// the current recommended CPC (competitors raised the market).
const cpcBelowMarket = computed(
  () =>
    !!camp.value &&
    !camp.value.autoOptimize &&
    camp.value.appearFirst &&
    !dirty.value &&
    !!data.value &&
    data.value.campaign.suggestions.appearFirst.cpc.credits > camp.value.cpc.credits + 0.005,
)
const ownerBalance = computed(() => data.value?.campaign.wallet.balance.credits ?? 0)
const required = computed(() =>
  dirty.value ? budgetN.value : data.value?.campaign.required.credits ?? 0,
)
const funded = computed(() => ownerBalance.value >= required.value)
const marketCpc = computed(() => data.value?.campaign.marketCpc.credits ?? 0)

// Live "Budget (CPC)" sub-score preview — mirrors backend cpcScore(): the bid
// against the recommended (category-leading) CPC, capped by budget adequacy
// (20 cr/day funding reference = DEFAULT_REFS.budgetRefMinor). Lets the meter
// react the instant the CPC is dragged below the recommendation.
const CPC_BUDGET_REF_CR = 20
const recommendedCpc = computed(
  () => data.value?.campaign.suggestions.appearFirst.cpc.credits ?? 0,
)

// The recommended CPC doubles as the ceiling — bidding above it earns no extra
// ranking, so the backend trims anything higher on save.
const cpcMax = computed(() => recommendedCpc.value || Infinity)
const cpcOverMax = computed(() => !auto.value && cpcN.value > cpcMax.value + 0.005)
const cpcValid = computed(
  () =>
    auto.value ||
    (cpcN.value >= 0.05 && cpcN.value <= budgetN.value && cpcN.value <= cpcMax.value + 0.005),
)
const cpcHint = computed(() => {
  if (auto.value) return t('campaign.cpcAuto')
  if (cpcOverMax.value) return t('campaign.cpcOverMax', { n: fmt(cpcMax.value) })
  if (!cpcValid.value) return t('campaign.cpcInvalid')
  if (recommendedCpc.value > 0) return t('campaign.cpcMaxHint', { n: fmt(recommendedCpc.value) })
  return ''
})

const projectedCpcPart = computed(() => {
  if (auto.value) return 100
  const rc = recommendedCpc.value
  const competitiveness = rc > 0 ? Math.min(1, cpcN.value / rc) : cpcN.value > 0 ? 1 : 0
  const budgetAdequacy = Math.min(1, budgetN.value / CPC_BUDGET_REF_CR)
  return Math.round(Math.min(competitiveness, budgetAdequacy) * 100)
})

// The tier cards reflect whether the live numbers actually equal a preset —
// not just the `appearFirst` flag. A manual edit drops this to 'custom'.
function sameCr(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005
}
const activeTier = computed<'standard' | 'first' | 'custom'>(() => {
  const s = data.value?.campaign.suggestions
  if (!s || auto.value) return 'custom'
  if (
    !appearFirst.value &&
    sameCr(cpcN.value, s.standard.cpc.credits) &&
    sameCr(budgetN.value, s.standard.dailyBudget.credits)
  ) {
    return 'standard'
  }
  if (
    appearFirst.value &&
    sameCr(cpcN.value, s.appearFirst.cpc.credits) &&
    sameCr(budgetN.value, s.appearFirst.dailyBudget.credits)
  ) {
    return 'first'
  }
  return 'custom'
})
const meterParts = computed(() => {
  const base = data.value?.analytics.visibility.parts ?? { cpc: 0, response: 0, plan: 0, age: 0 }
  return dirty.value ? { ...base, cpc: projectedCpcPart.value } : base
})
const meterScore = computed(() => {
  const v = data.value?.analytics.visibility
  if (!v) return 0
  if (!dirty.value) return v.score
  // Swap the projected CPC part in at its fixed 0.35 weight.
  return Math.max(0, Math.min(100, Math.round(v.score + 0.35 * (projectedCpcPart.value - v.parts.cpc))))
})

function hydrate() {
  const d = data.value
  if (!d) return
  hydrating.value = true
  profile.displayName = d.company.displayName
  profile.legalName = d.company.legalName ?? ''
  profile.description = d.company.description ?? ''
  const c = d.campaign.campaign
  if (c) {
    budget.value = c.dailyBudget.credits
    // Trim a saved CPC now above the recommended ceiling (market moved lower).
    const recMax = d.campaign.suggestions.appearFirst.cpc.credits ?? Infinity
    cpc.value = c.autoOptimize ? c.cpc.credits : Math.min(c.cpc.credits, recMax)
    appearFirst.value = c.appearFirst
    auto.value = c.autoOptimize
  } else {
    budget.value = d.campaign.suggestions.standard.dailyBudget.credits
    cpc.value = d.campaign.suggestions.standard.cpc.credits
    appearFirst.value = false
    auto.value = false
  }
  dirty.value = false
  void nextTick(() => (hydrating.value = false))
}

async function load() {
  loading.value = true
  try {
    data.value = await admin.fetchCompany(id.value)
    hydrate()
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    loading.value = false
  }
}
onMounted(load)

watch([budget, cpc, appearFirst, auto], () => {
  if (!hydrating.value) dirty.value = true
})

function applyTier(tier: CampaignTier, first: boolean) {
  auto.value = false
  budget.value = tier.dailyBudget.credits
  cpc.value = tier.cpc.credits
  appearFirst.value = first
  dirty.value = true
}
function setAuto(v: boolean | null) {
  auto.value = !!v
  if (v) appearFirst.value = true
  dirty.value = true
}

async function act<T>(key: string, fn: () => Promise<T>, okMsg: string) {
  busy.value = key
  try {
    await fn()
    await load()
    flash(okMsg)
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    busy.value = null
  }
}

async function saveProfile() {
  savingProfile.value = true
  try {
    data.value = await admin.updateCompany(id.value, {
      displayName: profile.displayName.trim(),
      legalName: profile.legalName.trim(),
      description: profile.description.trim(),
    })
    flash(t('adminCo.profileSaved'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    savingProfile.value = false
  }
}

function saveCampaign() {
  if (!cpcValid.value) return
  void act(
    'campSave',
    async () => {
      data.value = await admin.saveCompanyCampaign(id.value, {
        dailyBudget: budget.value,
        cpc: cpc.value,
        appearFirst: appearFirst.value,
        autoOptimize: auto.value,
      })
      hydrate()
    },
    t('adminCo.campSaved'),
  )
}
function campaignAction(action: 'pause' | 'activate' | 'delete') {
  const go = () =>
    act('camp-' + action, () => admin.campaignAction(id.value, action), t('admin.campaign_' + action + 'd'))
  if (action === 'delete') {
    confirmState.title = t('admin.deleteCampaign')
    confirmState.text = t('admin.deleteCampaignConfirm', { name: data.value?.company.displayName ?? '' })
    confirmState.run = go
    confirmState.show = true
  } else {
    void go()
  }
}
function toggleSuspend() {
  const suspend = data.value?.company.status !== 'suspended'
  const go = () =>
    act(
      'suspend',
      () => admin.setCompanyStatus(id.value, suspend ? 'suspended' : 'active'),
      t(suspend ? 'admin.bizSuspended' : 'admin.bizUnsuspended'),
    )
  if (suspend) {
    confirmState.title = t('admin.suspendBiz')
    confirmState.text = t('admin.suspendBizConfirm', { name: data.value?.company.displayName ?? '' })
    confirmState.run = go
    confirmState.show = true
  } else {
    void go()
  }
}

const confirmState = reactive({ show: false, title: '', text: '', run: async () => {} })
async function doConfirm() {
  const fn = confirmState.run
  confirmState.show = false
  await fn()
}

// --- leads ---
const leadRows = ref<AdminCompanyLead[]>([])
const leadCursor = ref<string | null>(null)
const leadFilter = reactive({ channel: '' as '' | 'form' | 'call', status: '' as '' | 'new' | 'seen' | 'resolved' })
const loadingLeads = ref(false)

watch(
  data,
  (d) => {
    if (d) {
      leadRows.value = d.leads.items
      leadCursor.value = d.leads.nextCursor
    }
  },
  { immediate: true },
)
async function reloadLeads() {
  loadingLeads.value = true
  try {
    const res = await admin.companyLeads(id.value, {
      channel: leadFilter.channel || undefined,
      status: leadFilter.status || undefined,
      limit: 30,
    })
    leadRows.value = res.items
    leadCursor.value = res.nextCursor
  } finally {
    loadingLeads.value = false
  }
}
async function moreLeads() {
  if (!leadCursor.value) return
  loadingLeads.value = true
  try {
    const res = await admin.companyLeads(id.value, {
      channel: leadFilter.channel || undefined,
      status: leadFilter.status || undefined,
      cursor: leadCursor.value,
      limit: 30,
    })
    leadRows.value = [...leadRows.value, ...res.items]
    leadCursor.value = res.nextCursor
  } finally {
    loadingLeads.value = false
  }
}
watch(leadFilter, reloadLeads)

const chartSeries = computed(() => {
  const a = data.value?.analytics
  return a
    ? [
        { label: t('analytics.clicks'), values: a.series.clicks },
        { label: t('analytics.messages'), values: a.series.messages },
      ]
    : []
})
// An empty trend line (flat zero) reads as broken, not "no data yet" — hide
// the chart until at least one of its two series has a real point.
const hasChartData = computed(() => {
  const a = data.value?.analytics
  return !!a && (a.series.clicks.some((v) => v > 0) || a.series.messages.some((v) => v > 0))
})

const campColor: Record<string, string> = {
  active: 'success',
  paused: 'warning',
  depleted: 'error',
  draft: 'default',
}
const bizColor: Record<string, string> = { active: 'success', suspended: 'error', draft: 'default' }
const leadStatusColor: Record<string, string> = { new: 'primary', seen: 'default', resolved: 'success' }
</script>

<template>
  <div class="ac">
    <v-btn
      v-if="data"
      :to="{ name: 'admin-user', params: { id: data.company.owner.id } }"
      variant="text"
      size="small"
      prepend-icon="mdi-arrow-left"
    >
      {{ t('adminCo.backToOwner', { name: data.company.owner.name }) }}
    </v-btn>

    <div v-if="loading" class="d-flex justify-center py-16">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="data">
      <header class="ac__head">
        <div>
          <h1>{{ data.company.displayName }}</h1>
          <div class="ac__chips">
            <v-chip size="small" :color="bizColor[data.company.status]" variant="tonal">
              {{ t(`dashboard.status${data.company.status.charAt(0).toUpperCase()}${data.company.status.slice(1)}`) }}
            </v-chip>
            <v-chip v-if="camp" size="small" :color="campColor[camp.status]" variant="flat">
              {{ t('admin.camp_' + camp.status) }}
            </v-chip>
            <v-chip v-if="camp?.autoOptimize" size="small" color="primary" variant="tonal" prepend-icon="mdi-robot-outline">
              {{ t('dashboard.campaignAuto') }}
            </v-chip>
          </div>
        </div>
        <div class="ac__headActions">
          <v-btn
            :to="companyRoute({ slug: data.company.slug, category: data.company.category })"
            target="_blank"
            variant="tonal"
            size="small"
            prepend-icon="mdi-open-in-new"
          >
            {{ t('adminCo.viewSite') }}
          </v-btn>
          <v-btn
            :color="data.company.status === 'suspended' ? 'success' : 'error'"
            :variant="data.company.status === 'suspended' ? 'tonal' : 'flat'"
            size="small"
            :loading="busy === 'suspend'"
            :prepend-icon="data.company.status === 'suspended' ? 'mdi-store-check-outline' : 'mdi-store-off-outline'"
            @click="toggleSuspend"
          >
            {{ data.company.status === 'suspended' ? t('admin.unsuspendBiz') : t('admin.suspendBiz') }}
          </v-btn>
        </div>
      </header>

      <div class="ac__grid">
        <!-- Profile -->
        <section class="card">
          <h2>{{ t('adminCo.profileTitle') }}</h2>
          <v-text-field v-model="profile.displayName" :label="t('adminCo.displayName')" density="comfortable" />
          <v-text-field v-model="profile.legalName" :label="t('adminCo.legalName')" density="comfortable" />
          <v-textarea v-model="profile.description" :label="t('adminCo.description')" rows="3" auto-grow density="comfortable" />
          <dl class="ac__meta">
            <div>
              <dt>{{ t('adminCo.category') }}</dt>
              <dd>
                <template v-if="data.company.category">
                  <span v-if="data.company.category.parent">{{ nm(data.company.category.parent.name) }} › </span>
                  {{ nm(data.company.category.name) }}
                </template>
                <template v-else>—</template>
              </dd>
            </div>
            <div>
              <dt>{{ t('adminCo.location') }}</dt>
              <dd>
                <template v-if="data.company.location">
                  <template v-if="data.company.location.nationwide">{{ t('feed.coverageCountry') }}</template>
                  <template v-else>
                    {{ data.company.location.city }}
                    <template v-if="data.company.location.radiusKm"> · {{ t('feed.coverageKm', { n: data.company.location.radiusKm }) }}</template>
                  </template>
                </template>
                <template v-else>—</template>
              </dd>
            </div>
            <div>
              <dt>{{ t('adminCo.website') }}</dt>
              <dd>
                <template v-if="data.company.website">
                  {{ data.company.website.mode === 'advanced' ? t('dashboard.modeAdvanced') : t('dashboard.modeEasy') }}
                  · {{ data.company.website.status }}
                </template>
                <template v-else>—</template>
              </dd>
            </div>
            <div>
              <dt>{{ t('adminCo.owner') }}</dt>
              <dd>
                <router-link :to="{ name: 'admin-user', params: { id: data.company.owner.id } }">
                  {{ data.company.owner.name }}
                </router-link>
                <span class="ac__muted"> · {{ data.company.owner.email }}</span>
              </dd>
            </div>
            <div>
              <dt>{{ t('adminCo.created') }}</dt>
              <dd>{{ dt(data.company.createdAt) }}</dd>
            </div>
          </dl>
          <v-btn color="primary" variant="flat" class="mt-2" :loading="savingProfile" @click="saveProfile">
            {{ t('common.save') }}
          </v-btn>
        </section>

        <!-- Campaign -->
        <section class="card">
          <h2>{{ t('adminCo.campaignTitle') }}</h2>

          <div class="ac__auto" :class="{ 'is-on': auto }">
            <div class="ac__autoRow">
              <v-icon icon="mdi-robot-outline" size="20" />
              <span>{{ t('campaign.autoTitle') }}</span>
              <v-switch :model-value="auto" color="primary" hide-details density="compact" inset @update:model-value="setAuto" />
            </div>
            <p v-if="auto" class="ac__autoNote">
              {{ marketCpc > 0 ? t('campaign.autoMarket', { n: fmt(marketCpc) }) : t('campaign.autoMarketNone') }}
            </p>
          </div>

          <div v-if="!auto" class="ac__tiers">
            <button type="button" class="tier" :class="{ 'tier--on': activeTier === 'standard' }" @click="applyTier(data.campaign.suggestions.standard, false)">
              <strong>{{ t('campaign.tierStandard') }}</strong>
              <span>CPC {{ fmt(data.campaign.suggestions.standard.cpc.credits) }} · {{ t('campaign.perDay', { n: fmt(data.campaign.suggestions.standard.dailyBudget.credits) }) }}</span>
            </button>
            <button type="button" class="tier tier--rec" :class="{ 'tier--on': activeTier === 'first' }" @click="applyTier(data.campaign.suggestions.appearFirst, true)">
              <strong><v-icon icon="mdi-rocket-launch-outline" size="14" /> {{ t('campaign.tierFirst') }}</strong>
              <span>CPC {{ fmt(data.campaign.suggestions.appearFirst.cpc.credits) }} · {{ t('campaign.perDay', { n: fmt(data.campaign.suggestions.appearFirst.dailyBudget.credits) }) }}</span>
            </button>
          </div>
          <p v-if="!auto && activeTier === 'custom'" class="ac__tierCustom">
            <v-icon icon="mdi-pencil-outline" size="12" /> {{ t('campaign.tierCustom') }}
          </p>

          <div class="ac__row">
            <v-text-field v-model.number="budget" type="number" :min="1" :label="t('campaign.dailyBudget')" suffix="cr" variant="outlined" density="comfortable" hide-details />
            <v-text-field
              v-model.number="cpc"
              type="number"
              :min="0.05"
              :max="Number.isFinite(cpcMax) ? cpcMax : undefined"
              step="0.05"
              :label="t('campaign.cpc')"
              suffix="cr"
              variant="outlined"
              density="comfortable"
              :disabled="auto"
              :error="!cpcValid"
              :hint="cpcHint"
              persistent-hint
            />
          </div>
          <v-checkbox-btn v-if="!auto" :model-value="appearFirst" :label="t('campaign.appearFirst')" color="primary" @update:model-value="(v) => { appearFirst = !!v; dirty = true }" />

          <p v-if="!auto" class="ac__cpcLive" :class="{ 'is-low': projectedCpcPart < 100 }">
            <v-icon :icon="projectedCpcPart < 100 ? 'mdi-trending-down' : 'mdi-check-circle-outline'" size="15" />
            {{ t('campaign.cpcScoreLive', { n: projectedCpcPart }) }}
            <span class="ac__cpcLiveHint">{{ t('campaign.cpcScoreLiveHint') }}</span>
          </p>

          <div class="ac__funding" :class="{ 'is-short': !funded }">
            {{ t('adminCo.ownerFunding', { need: fmt(required), balance: fmt(ownerBalance) }) }}
            <span class="ac__fundEq">{{ ownerEq(ownerBalance) }}</span>
          </div>

          <div v-if="camp" class="ac__campStats">
            <div>
              <span>{{ t('campaign.spentToday') }}</span>
              <strong>{{ fmt(camp.spentToday.credits) }} / {{ fmt(camp.dailyBudget.credits) }}</strong>
              <em class="ac__eq">{{ ownerEq(camp.dailyBudget.credits) }}</em>
            </div>
            <div><span>{{ t('campaign.clicks') }}</span><strong>{{ camp.clicks }}</strong></div>
            <div>
              <span>{{ t('adminCo.consumed') }}</span>
              <strong>{{ fmt(camp.consumed.credits) }} cr</strong>
              <em class="ac__eq">{{ ownerEq(camp.consumed.credits) }}</em>
            </div>
          </div>

          <div class="ac__campActions">
            <v-btn v-if="dirty" color="primary" size="small" :loading="busy === 'campSave'" :disabled="!cpcValid" prepend-icon="mdi-content-save-outline" @click="saveCampaign">
              {{ t('campaign.saveChanges') }}
            </v-btn>
            <v-btn v-if="hasCampaign && isLive" size="small" variant="tonal" :loading="busy === 'camp-pause'" prepend-icon="mdi-pause" @click="campaignAction('pause')">
              {{ t('admin.campPause') }}
            </v-btn>
            <v-btn v-else-if="hasCampaign" size="small" color="primary" :loading="busy === 'camp-activate'" :disabled="builderPending" prepend-icon="mdi-broadcast" @click="campaignAction('activate')">
              {{ t('admin.campActivate') }}
            </v-btn>
            <v-btn v-if="hasCampaign" size="small" variant="text" color="error" :loading="busy === 'camp-delete'" prepend-icon="mdi-trash-can-outline" @click="campaignAction('delete')">
              {{ t('admin.campDelete') }}
            </v-btn>
            <p v-if="!hasCampaign" class="ac__muted">{{ t('admin.noCampaign') }}</p>
            <p v-else-if="builderPending" class="ac__muted ac__builderNote">
              <v-icon icon="mdi-alert-outline" size="13" /> {{ t('adminCo.builderRequired') }}
            </p>
            <p v-else-if="cpcBelowMarket" class="ac__muted ac__builderNote">
              <v-icon icon="mdi-trending-up" size="13" />
              {{
                t('adminCo.cpcBelowMarket', {
                  rec: fmt(data.campaign.suggestions.appearFirst.cpc.credits),
                  cur: fmt(camp?.cpc.credits ?? 0),
                })
              }}
            </p>
          </div>
        </section>

        <!-- Analytics -->
        <section class="card card--wide">
          <h2>{{ t('adminCo.analyticsTitle') }}</h2>
          <div class="ac__ana">
            <div class="ac__anaMeter">
              <VisibilityMeter :score="meterScore" :parts="meterParts" />
              <p v-if="dirty" class="ac__projected">
                <v-icon icon="mdi-eye-outline" size="13" /> {{ t('adminCo.projectedTag') }}
              </p>
              <p class="ac__rank">
                {{ data.analytics.feedRank
                  ? t('analytics.feedRank', { n: data.analytics.feedRank.position, total: data.analytics.feedRank.total })
                  : t('analytics.feedRankNone') }}
              </p>
            </div>
            <div class="ac__stats">
              <div class="stat"><span>{{ t('analytics.clicks') }}</span><strong>{{ fmtInt(data.analytics.clicks.total) }}</strong><em>{{ t('analytics.today', { n: fmtInt(data.analytics.clicks.today) }) }}</em></div>
              <div class="stat"><span>{{ t('analytics.calls') }}</span><strong>{{ fmtInt(data.analytics.calls.total) }}</strong><em>{{ t('analytics.fromSite') }}</em></div>
              <div class="stat"><span>{{ t('analytics.messages') }}</span><strong>{{ fmtInt(data.analytics.messages.total) }}</strong><em>{{ t('analytics.newN', { n: data.analytics.messages.new }) }}</em></div>
              <div class="stat">
                <span>{{ t('analytics.responseTime') }}</span>
                <strong>{{ fmtMinutes(data.analytics.response.avgMinutes) }}</strong>
                <em>{{ data.analytics.response.ratePct != null ? t('analytics.rate', { p: data.analytics.response.ratePct }) : t('analytics.noData') }}</em>
              </div>
              <div class="stat">
                <span>{{ t('analytics.spend') }}</span>
                <strong>{{ fmt(data.analytics.campaign.consumedTotal.credits) }} cr</strong>
                <em>
                  {{ ownerEq(data.analytics.campaign.consumedTotal.credits) }} ·
                  {{ t('analytics.today', { n: fmt(data.analytics.campaign.consumedToday.credits) + ' cr' }) }}
                </em>
              </div>
              <div class="stat"><span>{{ t('analytics.activeDays') }}</span><strong>{{ data.analytics.campaign.activeDays }}</strong><em>{{ t('dashboard.days') }}</em></div>
            </div>
          </div>
          <div v-if="hasChartData" class="ac__chart">
            <p class="ac__chartHead">{{ t('analytics.last14') }}</p>
            <TrendChart :labels="data.analytics.series.days" :series="chartSeries" />
          </div>
        </section>

        <!-- Leads -->
        <section class="card card--wide">
          <div class="ac__leadHead">
            <h2>{{ t('adminCo.leadsTitle') }} ({{ data.leads.summary.total }})</h2>
            <div class="ac__leadFilters">
              <v-btn-toggle v-model="leadFilter.channel" density="compact" variant="outlined" divided>
                <v-btn value="">{{ t('adminCo.leadAll') }}</v-btn>
                <v-btn value="form">{{ t('adminCo.leadForm') }}</v-btn>
                <v-btn value="call">{{ t('adminCo.leadCall') }}</v-btn>
              </v-btn-toggle>
            </div>
          </div>
          <div class="ac__leadSummary">
            <span>{{ t('adminCo.leadNew', { n: data.leads.summary.new }) }}</span>
            <span>{{ t('adminCo.leadResolved', { n: data.leads.summary.resolved }) }}</span>
            <span>{{ t('adminCo.leadResponded', { n: data.leads.summary.responded }) }}</span>
            <span>{{ t('adminCo.leadAvg', { v: fmtMinutes(data.leads.summary.avgResponseMinutes) }) }}</span>
          </div>

          <p v-if="!leadRows.length" class="ac__muted">{{ t('adminCo.noLeads') }}</p>
          <table v-else class="lead">
            <tbody>
              <tr v-for="l in leadRows" :key="l.id">
                <td>
                  <v-icon :icon="l.channel === 'call' ? 'mdi-phone' : 'mdi-email-outline'" size="15" />
                </td>
                <td>
                  <v-chip size="x-small" :color="leadStatusColor[l.status]" variant="tonal">{{ l.status }}</v-chip>
                </td>
                <td class="lead__who">
                  <strong>{{ l.name || t('adminCo.leadAnon') }}</strong>
                  <span v-if="l.email || l.phone" class="ac__muted">{{ l.email || l.phone }}</span>
                </td>
                <td class="lead__msg">{{ l.message || '—' }}</td>
                <td class="lead__resp">{{ l.responseMinutes != null ? fmtMinutes(l.responseMinutes) : t('adminCo.leadNoResp') }}</td>
                <td class="lead__date">{{ dt(l.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
          <v-btn v-if="leadCursor" variant="text" size="small" :loading="loadingLeads" class="mt-2" @click="moreLeads">
            {{ t('adminCo.loadMore') }}
          </v-btn>
        </section>
      </div>
    </template>

    <v-dialog v-model="confirmState.show" max-width="420">
      <v-card rounded="lg">
        <v-card-title>{{ confirmState.title }}</v-card-title>
        <v-card-text>{{ confirmState.text }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmState.show = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="doConfirm">{{ t('admin.confirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="toast.show" :color="toast.color" timeout="2600">{{ toast.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.ac__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  margin: 0.6rem 0 1.5rem;
}
.ac__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.3rem, 3vw, 1.75rem);
  letter-spacing: -0.02em;
  margin: 0 0 0.5rem;
}
.ac__chips {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.ac__headActions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.ac__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
}
.card {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 1.3rem;
}
.card--wide {
  grid-column: 1 / -1;
}
.card h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.98rem;
  font-weight: 600;
  margin: 0 0 1rem;
}
.ac__muted {
  color: rgb(var(--v-theme-on-surface) / 0.5);
  font-size: 0.82rem;
}

.ac__meta {
  margin: 0.8rem 0 0;
  display: grid;
  gap: 0.5rem;
}
.ac__meta > div {
  display: grid;
  grid-template-columns: 5.5rem 1fr;
  gap: 0.6rem;
  font-size: 0.84rem;
}
.ac__meta dt {
  color: rgb(var(--v-theme-on-surface) / 0.5);
  text-transform: uppercase;
  font-size: 0.68rem;
  letter-spacing: 0.05em;
  padding-top: 0.15rem;
}
.ac__meta dd {
  margin: 0;
}

/* campaign editor */
.ac__auto {
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  padding: 0.7rem 0.9rem;
  margin-bottom: 0.9rem;
}
.ac__auto.is-on {
  border-color: rgb(var(--v-theme-primary) / 0.5);
  background: rgb(var(--v-theme-primary) / 0.06);
}
.ac__autoRow {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-weight: 600;
  font-size: 0.88rem;
}
.ac__autoRow .v-switch {
  margin-left: auto;
}
.ac__autoNote {
  margin: 0.5rem 0 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}
.ac__tiers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
  margin-bottom: 0.9rem;
}
.ac__tierCustom {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin: -0.5rem 0 0.9rem;
  font-size: 0.72rem;
  color: rgb(var(--v-theme-primary));
}
.tier {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.7rem 0.85rem;
  text-align: left;
  border-radius: 12px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  font-size: 0.78rem;
}
.tier strong {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.85rem;
}
.tier--on {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.08);
}
.ac__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
.ac__funding {
  margin: 0.9rem 0 0;
  padding: 0.6rem 0.85rem;
  border-radius: 10px;
  background: rgb(var(--v-theme-on-surface) / 0.05);
  font-size: 0.82rem;
}
.ac__funding.is-short {
  background: rgb(var(--v-theme-warning) / 0.14);
  color: rgb(var(--v-theme-warning));
}
.ac__campStats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.ac__campStats > div {
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  border: 1px solid var(--tvz-hairline);
}
.ac__campStats span {
  display: block;
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.ac__campStats strong {
  font-size: 0.95rem;
}
.ac__campStats .ac__eq {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.68rem;
  font-style: normal;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.ac__fundEq {
  color: rgb(var(--v-theme-on-surface) / 0.5);
  margin-left: 0.35rem;
}
.ac__campActions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-top: 1rem;
  align-items: center;
}

/* analytics */
.ac__ana {
  display: grid;
  grid-template-columns: minmax(260px, 340px) 1fr;
  gap: 1.5rem;
  align-items: start;
}
.ac__rank {
  margin: 0.7rem 0 0;
  font-weight: 700;
  font-size: 0.9rem;
}
.ac__projected {
  margin: 0.6rem 0 0;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.1);
}
.ac__cpcLive {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin: 0.7rem 0 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-success));
}
.ac__cpcLive.is-low {
  color: rgb(var(--v-theme-warning));
}
.ac__cpcLiveHint {
  flex-basis: 100%;
  font-weight: 400;
  font-size: 0.74rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.ac__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 0.6rem;
}
.stat {
  padding: 0.7rem 0.85rem;
  border-radius: 12px;
  border: 1px solid var(--tvz-hairline);
}
.stat span {
  display: block;
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.stat strong {
  font-size: 1.15rem;
  font-family: 'Space Grotesk Variable', sans-serif;
}
.stat em {
  display: block;
  font-style: normal;
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.ac__chart {
  margin-top: 1.4rem;
}
.ac__chartHead {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  margin: 0 0 0.6rem;
}

/* leads */
.ac__leadHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.6rem;
}
.ac__leadHead h2 {
  margin: 0;
}
.ac__leadSummary {
  display: flex;
  gap: 1.1rem;
  flex-wrap: wrap;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  margin-bottom: 0.8rem;
}
.lead {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.lead td {
  padding: 0.5rem 0.55rem;
  border-bottom: 1px solid var(--tvz-hairline);
  vertical-align: top;
}
.lead tr:last-child td {
  border-bottom: none;
}
.lead__who {
  min-width: 120px;
}
.lead__who strong {
  display: block;
}
.lead__msg {
  color: rgb(var(--v-theme-on-surface) / 0.78);
  max-width: 340px;
}
.lead__resp,
.lead__date {
  white-space: nowrap;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  text-align: right;
}

@media (max-width: 760px) {
  .ac__ana {
    grid-template-columns: 1fr;
  }
}
</style>
