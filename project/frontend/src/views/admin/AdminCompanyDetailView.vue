<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import VisibilityMeter from '@/components/VisibilityMeter.vue'
import TrendChart from '@/components/TrendChart.vue'
import WebsiteRenderer from '@/components/WebsiteRenderer.vue'
import AdminDetailHeader from '@/components/admin/AdminDetailHeader.vue'
import AdminMetaItem from '@/components/admin/AdminMetaItem.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import { useMoney } from '@/composables/useMoney'
import { useAdminStore, type AdminCompanyDetail, type AdminCompanyLead } from '@/stores/admin'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import type { CampaignTier, CampaignStatus } from '@/stores/campaign'
import type { LocalizedName } from '@/stores/companies'
import { ApiError } from '@/services/api'
import { searchCities, type GeoCity } from '@/services/geo'

const { t, n, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const admin = useAdminStore()
const confirm = useConfirmStore()

const id = computed(() => String(route.params.id))
const data = ref<AdminCompanyDetail | null>(null)
const loading = ref(true)
const busy = ref<string | null>(null)

const tab = ref<'overview' | 'website' | 'campaign' | 'requests' | 'stats'>('overview')

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
}
const isEasy = computed(() => data.value?.company.website?.mode !== 'advanced')
/** The advanced builder is paid-for / granted and ready to edit — distinct from
 *  the plan being merely *selected* (`mode === 'advanced'` with no unlock). */
const advancedReady = computed(() => !!data.value?.company.advancedUnlockedAt)

const toasts = useToastStore()
function flash(text: string, color: 'success' | 'error' = 'success') {
  toasts.push(color === 'error' ? 'error' : 'success', text)
}
function errText(e: unknown, fb: string) {
  if (e instanceof ApiError) {
    if (e.message === 'owner_wallet_cannot_afford_upgrade') return t('adminCo.upgradeUnaffordable')
    return e.message
  }
  return fb
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
function dOnly(s: string | null) {
  return s ? new Date(s).toLocaleDateString() : '—'
}
const statusLabel = computed(() => {
  const s = data.value?.company.status ?? 'draft'
  return s === 'active'
    ? t('dashboard.statusActive')
    : s === 'suspended'
      ? t('dashboard.statusSuspended')
      : t('dashboard.statusDraft')
})
const categoryLabel = computed(() => {
  const c = data.value?.company.category
  if (!c) return '—'
  return c.parent ? `${nm(c.parent.name)} › ${nm(c.name)}` : nm(c.name)
})
const locationLabel = computed(() => {
  const l = data.value?.company.location
  if (!l) return '—'
  if (l.nationwide) return t('feed.coverageCountry')
  return l.radiusKm
    ? `${l.city ?? '—'} · ${t('feed.coverageKm', { n: l.radiusKm })}`
    : l.city ?? '—'
})
function fmtMinutes(m: number | null): string {
  if (m == null) return '—'
  if (m < 60) return `${m} min`
  if (m < 60 * 24) return `${Math.round(m / 60)} h`
  return `${Math.round(m / 1440)} ${t('dashboard.days')}`
}

// --- profile form ---
const profile = reactive({ displayName: '', legalName: '', description: '', categoryId: '' })
const savingProfile = ref(false)

// leaf categories for the profile picker
function catName(x: Record<string, string>): string {
  return x[locale.value] ?? x.en ?? Object.values(x)[0] ?? ''
}
const categoryOptions = computed(() =>
  admin.categories.flatMap((g) =>
    g.children.map((c) => ({ value: c.id, title: `${catName(g.name)} › ${catName(c.name)}` })),
  ),
)

// --- location editor ---
const loc = reactive({
  nationwide: false,
  city: '' as string,
  region: '' as string,
  lat: null as number | null,
  lng: null as number | null,
  radiusKm: 15,
})
const savingLoc = ref(false)
const citySearch = ref('')
const cityResults = ref<GeoCity[]>([])
const cityItems = computed(() =>
  cityResults.value.map((c) => ({ title: `${c.name}, ${c.county}`, value: c })),
)
let cityDeb: ReturnType<typeof setTimeout> | undefined
watch(citySearch, (q) => {
  clearTimeout(cityDeb)
  if (!q || q.trim().length < 2) {
    cityResults.value = []
    return
  }
  cityDeb = setTimeout(async () => {
    cityResults.value = await searchCities(q).catch(() => [])
  }, 250)
})
function pickCity(c: GeoCity | null) {
  if (!c) return
  loc.city = c.name
  loc.region = c.county
  loc.lat = c.lat
  loc.lng = c.lng
}
const locValid = computed(
  () =>
    loc.nationwide ||
    (!!loc.city.trim() &&
      loc.lat != null &&
      loc.lng != null &&
      loc.radiusKm >= 1 &&
      loc.radiusKm <= 200),
)
async function saveLocation() {
  if (!locValid.value) return
  savingLoc.value = true
  try {
    data.value = await admin.setCompanyLocation(id.value, {
      nationwide: loc.nationwide,
      city: loc.nationwide ? undefined : loc.city.trim(),
      region: loc.nationwide ? undefined : loc.region.trim() || undefined,
      country: data.value?.company.country || 'RO',
      lat: loc.nationwide ? undefined : (loc.lat ?? undefined),
      lng: loc.nationwide ? undefined : (loc.lng ?? undefined),
      radiusKm: loc.nationwide ? undefined : loc.radiusKm,
    })
    flash(t('adminCo.locSaved'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    savingLoc.value = false
  }
}

// --- website builder / publish / preview ---
const showSite = ref(false)
const siteIsPublic = computed(
  () =>
    data.value?.company.status === 'active' &&
    data.value?.company.website?.status === 'published',
)
function openBuilder() {
  void router.push({ name: 'website-builder', query: { companyId: id.value } })
}
function toggleWebsitePublished() {
  const publish = data.value?.company.website?.status !== 'published'
  void act(
    'webpub',
    async () => {
      data.value = await admin.setCompanyWebsitePublished(id.value, publish)
    },
    t(publish ? 'adminCo.webPublished' : 'adminCo.webUnpublished'),
  )
}

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
function hydrate() {
  const d = data.value
  if (!d) return
  hydrating.value = true
  profile.displayName = d.company.displayName
  profile.legalName = d.company.legalName ?? ''
  profile.description = d.company.description ?? ''
  profile.categoryId = d.company.category
    ? (admin.categories
        .flatMap((g) => g.children)
        .find((c) => c.slug === d.company.category?.slug)?.id ?? '')
    : ''
  const l = d.company.location
  loc.nationwide = l?.nationwide ?? false
  loc.city = l?.city ?? ''
  loc.region = l?.region ?? ''
  loc.lat = l?.lat ?? null
  loc.lng = l?.lng ?? null
  loc.radiusKm = l?.radiusKm ?? 15
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
    if (!admin.categories.length) await admin.fetchCategories().catch(() => {})
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
      categoryId: profile.categoryId || undefined,
    })
    hydrate()
    flash(t('adminCo.profileSaved'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    savingProfile.value = false
  }
}

const ownerCanAffordUpgrade = computed(
  () => ownerBalance.value >= (data.value?.company.advancedPriceCredits ?? 0),
)
function upgradeAdvanced(charge = false) {
  void act(
    charge ? 'upgrade-paid' : 'upgrade',
    async () => {
      data.value = await admin.upgradeCompanyAdvanced(id.value, charge)
      hydrate()
    },
    t(charge ? 'adminCo.webUpgradedPaid' : 'adminCo.webUpgraded'),
  )
}

async function setLeadStatus(leadId: string, status: 'new' | 'seen' | 'resolved') {
  busy.value = 'lead-' + leadId
  try {
    const fresh = await admin.setCompanyLeadStatus(id.value, leadId, status)
    // patch the row in place so the current filter view is preserved
    const i = leadRows.value.findIndex((l) => l.id === leadId)
    const updated = fresh.leads.items.find((l) => l.id === leadId)
    if (i !== -1 && updated) leadRows.value[i] = updated
    if (data.value) data.value.leads.summary = fresh.leads.summary
    flash(t('adminCo.leadStatusSet'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    busy.value = null
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
    confirm.ask(
      t('admin.deleteCampaign'),
      t('admin.deleteCampaignConfirm', { name: data.value?.company.displayName ?? '' }),
      go,
    )
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
    confirm.ask(t('admin.suspendBiz'), t('admin.suspendBizConfirm', { name: data.value?.company.displayName ?? '' }), go)
  } else {
    void go()
  }
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
  draft: 'grey',
}
const bizColor: Record<string, string> = { active: 'success', suspended: 'error', draft: 'grey' }
const leadStatusItems = computed(() => [
  { value: 'new', title: t('adminCo.leadStatusNew') },
  { value: 'seen', title: t('adminCo.leadStatusSeen') },
  { value: 'resolved', title: t('adminCo.leadStatusResolved') },
])
</script>

<template>
  <div class="ac">
    <div v-if="loading" class="ac__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="data">
      <AdminDetailHeader
        :back-to="{ name: 'admin-user', params: { id: data.company.owner.id } }"
        :back-label="t('adminCo.backToOwner', { name: data.company.owner.name })"
        :avatar="initials(data.company.displayName)"
        :title="data.company.displayName"
        :subtitle="`/${data.company.slug}`"
        :id="data.company.id"
      >
        <template #pills>
          <v-chip size="small" :color="bizColor[data.company.status]" variant="tonal">{{ statusLabel }}</v-chip>
          <v-chip v-if="camp" size="small" :color="campColor[camp.status]" variant="flat">
            {{ t('admin.camp_' + camp.status) }}
          </v-chip>
          <v-chip v-if="camp?.autoOptimize" size="small" color="primary" variant="tonal" prepend-icon="mdi-robot-outline">
            {{ t('dashboard.campaignAuto') }}
          </v-chip>
          <v-chip size="small" variant="outlined" :prepend-icon="isEasy ? 'mdi-flash-outline' : 'mdi-tune-vertical'">
            {{ isEasy ? t('dashboard.modeEasy') : t('dashboard.modeAdvanced') }}
          </v-chip>
        </template>

        <template #actions>
          <v-btn
            v-if="data.company.website"
            variant="tonal"
            size="small"
            rounded="pill"
            prepend-icon="mdi-eye-outline"
            @click="showSite = true"
          >
            {{ t('adminCo.viewSite') }}
          </v-btn>
          <v-btn
            :color="data.company.status === 'suspended' ? 'success' : 'error'"
            :variant="data.company.status === 'suspended' ? 'flat' : 'tonal'"
            size="small"
            rounded="pill"
            :loading="busy === 'suspend'"
            :prepend-icon="data.company.status === 'suspended' ? 'mdi-store-check-outline' : 'mdi-store-off-outline'"
            @click="toggleSuspend"
          >
            {{ data.company.status === 'suspended' ? t('admin.unsuspendBiz') : t('admin.suspendBiz') }}
          </v-btn>
        </template>

        <template #meta>
          <AdminMetaItem :label="t('adminCo.owner')" :value="data.company.owner.name" />
          <AdminMetaItem :label="t('adminCo.category')" :value="categoryLabel" />
          <AdminMetaItem :label="t('adminCo.location')" :value="locationLabel" />
          <AdminMetaItem :label="t('adminCo.created')" :value="dOnly(data.company.createdAt)" />
        </template>
      </AdminDetailHeader>

      <v-tabs v-model="tab" color="primary" class="ac__tabs" show-arrows>
        <v-tab value="overview" prepend-icon="mdi-store-cog-outline">{{ t('adminCo.tabOverview') }}</v-tab>
        <v-tab value="website" prepend-icon="mdi-web">{{ t('adminCo.tabWebsite') }}</v-tab>
        <v-tab value="campaign" prepend-icon="mdi-bullhorn-outline">{{ t('adminCo.tabCampaign') }}</v-tab>
        <v-tab value="requests" prepend-icon="mdi-inbox-outline">
          {{ t('adminCo.tabRequests') }} ({{ data.leads.summary.total }})
        </v-tab>
        <v-tab value="stats" prepend-icon="mdi-chart-box-outline">{{ t('adminCo.tabStats') }}</v-tab>
      </v-tabs>

      <v-window v-model="tab" class="ac__window">
        <!-- ============ OVERVIEW ============ -->
        <v-window-item value="overview">
          <div class="ac__stack ac__stack--narrow">
            <AdminSection :title="t('adminCo.profileTitle')" icon="mdi-card-account-details-outline">
              <div class="ac__form">
                <v-text-field v-model="profile.displayName" :label="t('adminCo.displayName')" variant="outlined" density="comfortable" hide-details />
                <v-text-field v-model="profile.legalName" :label="t('adminCo.legalName')" variant="outlined" density="comfortable" hide-details />
                <v-textarea v-model="profile.description" :label="t('adminCo.description')" rows="3" auto-grow variant="outlined" density="comfortable" hide-details />
                <v-select
                  v-model="profile.categoryId"
                  :items="categoryOptions"
                  :label="t('adminCo.categoryLabel')"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                />
                <div>
                  <v-btn color="primary" variant="flat" rounded="pill" :loading="savingProfile" prepend-icon="mdi-content-save-outline" @click="saveProfile">
                    {{ t('common.save') }}
                  </v-btn>
                </div>
              </div>
            </AdminSection>

            <AdminSection :title="t('adminCo.locTitle')" icon="mdi-map-marker-radius-outline">
              <div class="ac__form">
                <div class="ac__locRow">
                  <div>
                    <p class="ac__secLabel">{{ t('adminCo.locNationwide') }}</p>
                    <p class="ac__muted ac__mt0">{{ t('adminCo.locNationwideHint') }}</p>
                  </div>
                  <v-switch v-model="loc.nationwide" color="primary" density="compact" hide-details inset />
                </div>

                <template v-if="!loc.nationwide">
                  <v-autocomplete
                    :model-value="null"
                    :items="cityItems"
                    :label="t('adminCo.locCity')"
                    :placeholder="loc.city || t('adminCo.locCityPlaceholder')"
                    persistent-placeholder
                    variant="outlined"
                    density="comfortable"
                    hide-details
                    no-filter
                    hide-no-data
                    @update:search="citySearch = $event"
                    @update:model-value="pickCity"
                  />
                  <p v-if="loc.city" class="ac__muted ac__mt0">
                    {{ loc.city }}<template v-if="loc.region">, {{ loc.region }}</template>
                    <template v-if="loc.lat != null"> · {{ loc.lat.toFixed(3) }}, {{ loc.lng?.toFixed(3) }}</template>
                  </p>
                  <v-text-field
                    v-model.number="loc.radiusKm"
                    type="number"
                    :min="1"
                    :max="200"
                    :label="t('adminCo.locRadius')"
                    suffix="km"
                    variant="outlined"
                    density="comfortable"
                    hide-details
                  />
                </template>

                <div>
                  <v-btn
                    color="primary"
                    variant="flat"
                    rounded="pill"
                    :loading="savingLoc"
                    :disabled="!locValid"
                    prepend-icon="mdi-content-save-outline"
                    @click="saveLocation"
                  >
                    {{ t('common.save') }}
                  </v-btn>
                </div>
              </div>
            </AdminSection>

            <AdminSection :title="t('adminCo.factsTitle')" icon="mdi-information-outline">
              <div class="ac__facts">
                <div class="ac__fact">
                  <span class="ac__factLabel">{{ t('adminCo.owner') }}</span>
                  <router-link :to="{ name: 'admin-user', params: { id: data.company.owner.id } }" class="ac__link">
                    {{ data.company.owner.name }}
                  </router-link>
                  <span class="ac__muted">{{ data.company.owner.email }}</span>
                </div>
                <AdminMetaItem :label="t('adminCo.category')" :value="categoryLabel" />
                <AdminMetaItem :label="t('adminCo.location')" :value="locationLabel" />
                <AdminMetaItem :label="t('adminCo.country')" :value="data.company.country" />
                <AdminMetaItem :label="t('adminCo.created')" :value="dt(data.company.createdAt)" />
              </div>
              <div class="ac__counts">
                <AdminStatCard :label="t('adminCo.cServices')" :value="data.company.counts.services" />
                <AdminStatCard :label="t('adminCo.cContacts')" :value="data.company.counts.contacts" />
                <AdminStatCard :label="t('adminCo.cLeads')" :value="data.company.counts.leads" />
                <AdminStatCard :label="t('adminCo.cClicks')" :value="data.company.counts.clicks" />
              </div>
            </AdminSection>
          </div>
        </v-window-item>

        <!-- ============ WEBSITE ============ -->
        <v-window-item value="website">
          <div class="ac__stack ac__stack--narrow">
            <AdminSection :title="t('adminCo.webTitle')" icon="mdi-web">
              <template v-if="data.company.website" #actions>
                <v-btn
                  :color="data.company.website.status === 'published' ? 'warning' : 'primary'"
                  variant="tonal"
                  size="small"
                  rounded="pill"
                  :loading="busy === 'webpub'"
                  :prepend-icon="data.company.website.status === 'published' ? 'mdi-eye-off-outline' : 'mdi-earth'"
                  @click="toggleWebsitePublished"
                >
                  {{ data.company.website.status === 'published' ? t('adminCo.webUnpublish') : t('adminCo.webPublish') }}
                </v-btn>
              </template>
              <div class="ac__webMode">
                <span class="ac__webPlan" :class="{ 'is-adv': !isEasy }">
                  <v-icon :icon="isEasy ? 'mdi-flash-outline' : 'mdi-tune-vertical'" size="15" />
                  {{ isEasy ? t('dashboard.modeEasy') : t('dashboard.modeAdvanced') }}
                </span>
                <span v-if="data.company.website" class="ac__muted">
                  {{ t('adminCo.webStatus_' + data.company.website.status) }} ·
                  {{ t('adminCo.webUpdated', { d: dOnly(data.company.website.updatedAt) }) }}
                </span>
                <span v-else class="ac__muted">{{ t('adminCo.webNone') }}</span>
              </div>

              <p v-if="advancedReady" class="ac__webUnlocked">
                <v-icon icon="mdi-check-decagram-outline" size="14" />
                {{ t('adminCo.webUnlockedOn', { d: dOnly(data.company.advancedUnlockedAt) }) }}
              </p>

              <div v-if="builderPending" class="ac__webWarn">
                <v-icon icon="mdi-alert-outline" size="15" />
                {{ t('adminCo.builderRequired') }}
              </div>

              <!-- Not unlocked yet (easy plan, or advanced picked but the fee was
                   never paid). Admin chooses: grant free, or bill the owner. -->
              <div v-if="!advancedReady" class="ac__webUpgrade">
                <p class="ac__secLabel">
                  {{ isEasy ? t('adminCo.webUpgradeTitleEasy') : t('adminCo.webUpgradeTitlePending') }}
                </p>
                <p class="ac__muted ac__mt0 ac__webHint">{{ t('adminCo.webUpgradeHint') }}</p>
                <div class="ac__webUpgradeBtns">
                  <v-btn
                    color="primary"
                    variant="flat"
                    rounded="pill"
                    :loading="busy === 'upgrade'"
                    prepend-icon="mdi-gift-outline"
                    @click="upgradeAdvanced(false)"
                  >
                    {{ t('adminCo.webUpgradeFree') }}
                  </v-btn>
                  <v-btn
                    color="primary"
                    variant="tonal"
                    rounded="pill"
                    :loading="busy === 'upgrade-paid'"
                    :disabled="!ownerCanAffordUpgrade"
                    prepend-icon="mdi-wallet-outline"
                    @click="upgradeAdvanced(true)"
                  >
                    {{ t('adminCo.webUpgradeCharge', { n: data.company.advancedPriceCredits }) }}
                  </v-btn>
                </div>
                <p class="ac__muted ac__webHint">
                  {{ t('adminCo.webUpgradeOwnerBalance', { n: fmt(ownerBalance) }) }}
                  <template v-if="!ownerCanAffordUpgrade"> · {{ t('adminCo.webUpgradeShort') }}</template>
                </p>
              </div>
            </AdminSection>

            <AdminSection :title="t('adminCo.webEditTitle')" icon="mdi-pencil-ruler-outline">
              <template v-if="advancedReady">
                <p class="ac__muted ac__mt0">{{ t('adminCo.webEditNoteAdv') }}</p>
                <div class="ac__webActions">
                  <v-btn
                    color="primary"
                    variant="flat"
                    size="small"
                    rounded="pill"
                    prepend-icon="mdi-pencil-ruler"
                    @click="openBuilder"
                  >
                    {{ t('adminCo.webEditBuilder') }}
                  </v-btn>
                  <v-btn
                    v-if="data.company.website"
                    variant="tonal"
                    size="small"
                    rounded="pill"
                    prepend-icon="mdi-eye-outline"
                    @click="showSite = true"
                  >
                    {{ t('adminCo.viewSite') }}
                  </v-btn>
                </div>
              </template>
              <template v-else>
                <p class="ac__muted ac__mt0">
                  {{ isEasy ? t('adminCo.webEditNoteEasy') : t('adminCo.webEditNotePending') }}
                </p>
                <v-btn
                  v-if="data.company.website"
                  variant="tonal"
                  size="small"
                  rounded="pill"
                  prepend-icon="mdi-eye-outline"
                  class="mt-3"
                  @click="showSite = true"
                >
                  {{ t('adminCo.viewSite') }}
                </v-btn>
              </template>
            </AdminSection>
          </div>
        </v-window-item>

        <!-- ============ CAMPAIGN ============ -->
        <v-window-item value="campaign">
          <div class="ac__stack ac__stack--narrow">
            <AdminSection :title="t('adminCo.campaignTitle')" icon="mdi-bullhorn-outline">
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
            </AdminSection>
          </div>
        </v-window-item>

        <!-- ============ REQUESTS ============ -->
        <v-window-item value="requests">
          <AdminSection :title="t('adminCo.leadsTitle')" icon="mdi-inbox-outline">
            <template #actions>
              <v-btn-toggle v-model="leadFilter.channel" density="compact" variant="outlined" divided>
                <v-btn value="">{{ t('adminCo.leadAll') }}</v-btn>
                <v-btn value="form">{{ t('adminCo.leadForm') }}</v-btn>
                <v-btn value="call">{{ t('adminCo.leadCall') }}</v-btn>
              </v-btn-toggle>
            </template>

            <div class="ac__leadStats">
              <AdminStatCard :label="t('adminCo.leadTotalLbl')" :value="data.leads.summary.total" />
              <AdminStatCard :label="t('adminCo.leadNewLbl')" :value="data.leads.summary.new" tone="primary" />
              <AdminStatCard :label="t('adminCo.leadResolvedLbl')" :value="data.leads.summary.resolved" tone="success" />
              <AdminStatCard :label="t('adminCo.leadAvgLbl')" :value="fmtMinutes(data.leads.summary.avgResponseMinutes)" />
            </div>

            <AdminEmptyState v-if="!leadRows.length" :text="t('adminCo.noLeads')" icon="mdi-inbox-outline" />
            <div v-else class="ac__tableWrap">
              <table class="ac__table">
                <thead>
                  <tr>
                    <th>{{ t('adminCo.leadCol') }}</th>
                    <th>{{ t('invoice.colDescription') }}</th>
                    <th>{{ t('adminCo.leadRespCol') }}</th>
                    <th class="num">{{ t('admin.colDate') }}</th>
                    <th>{{ t('admin.colStatus') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="l in leadRows" :key="l.id">
                    <td class="ac__leadWho">
                      <v-icon :icon="l.channel === 'call' ? 'mdi-phone' : 'mdi-email-outline'" size="14" />
                      <span>
                        <strong>{{ l.name || t('adminCo.leadAnon') }}</strong>
                        <span v-if="l.email || l.phone" class="ac__muted">{{ l.email || l.phone }}</span>
                      </span>
                    </td>
                    <td class="ac__leadMsg">{{ l.message || '—' }}</td>
                    <td class="ac__muted">
                      {{ l.responseMinutes != null ? fmtMinutes(l.responseMinutes) : t('adminCo.leadNoResp') }}
                    </td>
                    <td class="num ac__date">{{ dOnly(l.createdAt) }}</td>
                    <td>
                      <v-select
                        :model-value="l.status"
                        :items="leadStatusItems"
                        density="compact"
                        variant="outlined"
                        hide-details
                        class="ac__leadSel"
                        :loading="busy === 'lead-' + l.id"
                        @update:model-value="(v) => setLeadStatus(l.id, v)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <v-btn v-if="leadCursor" variant="text" size="small" :loading="loadingLeads" class="mt-2" @click="moreLeads">
              {{ t('adminCo.loadMore') }}
            </v-btn>
          </AdminSection>
        </v-window-item>

        <!-- ============ STATISTICS ============ -->
        <v-window-item value="stats">
          <div class="ac__stack">
            <AdminSection :title="t('adminCo.visibilityTitle')" icon="mdi-eye-outline">
              <div class="ac__ana">
                <div class="ac__anaMeter">
                  <VisibilityMeter
                    :score="data.analytics.visibility.score"
                    :parts="data.analytics.visibility.parts"
                  />
                  <p class="ac__rank">
                    {{
                      data.analytics.feedRank
                        ? t('analytics.feedRank', {
                            n: data.analytics.feedRank.position,
                            total: data.analytics.feedRank.total,
                          })
                        : t('analytics.feedRankNone')
                    }}
                  </p>
                </div>
                <div class="ac__statGrid">
                  <AdminStatCard
                    :label="t('analytics.clicks')"
                    :value="fmtInt(data.analytics.clicks.total)"
                    :sub="t('analytics.today', { n: fmtInt(data.analytics.clicks.today) })"
                  />
                  <AdminStatCard
                    :label="t('analytics.calls')"
                    :value="fmtInt(data.analytics.calls.total)"
                    :sub="t('analytics.fromSite')"
                  />
                  <AdminStatCard
                    :label="t('analytics.messages')"
                    :value="fmtInt(data.analytics.messages.total)"
                    :sub="t('analytics.newN', { n: data.analytics.messages.new })"
                  />
                  <AdminStatCard
                    :label="t('analytics.responseTime')"
                    :value="fmtMinutes(data.analytics.response.avgMinutes)"
                    :sub="data.analytics.response.ratePct != null ? t('analytics.rate', { p: data.analytics.response.ratePct }) : t('analytics.noData')"
                  />
                  <AdminStatCard
                    :label="t('analytics.spend')"
                    :value="`${fmt(data.analytics.campaign.consumedTotal.credits)} cr`"
                    :sub="ownerEq(data.analytics.campaign.consumedTotal.credits)"
                  />
                  <AdminStatCard
                    :label="t('analytics.activeDays')"
                    :value="data.analytics.campaign.activeDays"
                    :sub="t('dashboard.days')"
                  />
                </div>
              </div>
            </AdminSection>

            <AdminSection v-if="hasChartData" :title="t('analytics.last14')" icon="mdi-chart-line">
              <TrendChart :labels="data.analytics.series.days" :series="chartSeries" />
            </AdminSection>
          </div>
        </v-window-item>
      </v-window>
    </template>

    <!-- In-app site preview — the public URL 404s for non-active businesses,
         so admins view the rendered site here regardless of publish state. -->
    <v-dialog v-model="showSite" max-width="1040" scrollable>
      <v-card rounded="lg">
        <div class="ac__siteHead">
          <span class="ac__muted">
            {{ t('adminCo.previewOf', { name: data?.company.displayName ?? '' }) }} ·
            {{ data?.company.website ? t('adminCo.webStatus_' + data.company.website.status) : '' }}
          </span>
          <v-spacer />
          <v-btn
            v-if="siteIsPublic && data"
            :href="`/${[data.company.category?.parent?.slug, data.company.category?.slug, data.company.slug].filter(Boolean).join('/')}`"
            target="_blank"
            variant="text"
            size="small"
            prepend-icon="mdi-open-in-new"
          >
            {{ t('adminCo.openPublic') }}
          </v-btn>
          <v-btn icon="mdi-close" variant="text" size="small" @click="showSite = false" />
        </div>
        <v-card-text class="pa-2">
          <WebsiteRenderer
            v-if="data?.company.website"
            :content="data.company.website.content"
            :theme="data.company.website.theme"
            framed
          />
        </v-card-text>
      </v-card>
    </v-dialog>

  </div>
</template>

<style scoped>
.ac {
  max-width: 1000px;
}
.ac__center {
  display: grid;
  place-items: center;
  min-height: 320px;
}
.ac__tabs {
  border-bottom: 1px solid var(--tvz-hairline);
  margin-bottom: 1.4rem;
}
.ac__stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.ac__stack--narrow {
  max-width: 720px;
}
.ac__muted {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.82rem;
}
.ac__mt0 {
  margin-top: 0;
}
.ac__link {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}

/* overview */
.ac__form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.ac__facts {
  display: flex;
  gap: 1.75rem;
  flex-wrap: wrap;
}
.ac__fact {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.ac__factLabel {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.ac__fact .ac__muted {
  font-size: 0.76rem;
}
.ac__counts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.7rem;
  margin-top: 1.1rem;
}

/* website */
.ac__webMode {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  flex-wrap: wrap;
}
.ac__webPlan {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0.25rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--tvz-hairline);
}
.ac__webPlan.is-adv {
  color: rgb(var(--v-theme-primary));
  border-color: rgba(var(--v-theme-primary), 0.4);
  background: rgba(var(--v-theme-primary), 0.08);
}
.ac__webUnlocked {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.9rem 0 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-success));
}
.ac__webWarn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.9rem;
  padding: 0.55rem 0.8rem;
  border-radius: 10px;
  background: rgba(var(--v-theme-warning), 0.13);
  color: rgb(var(--v-theme-warning));
  font-size: 0.8rem;
}
.ac__webUpgrade {
  margin-top: 1.1rem;
}
.ac__webHint {
  margin: 0.5rem 0 0;
  max-width: 46ch;
}
.ac__webActions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.9rem;
}
.ac__webUpgradeBtns {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin: 0.7rem 0 0.3rem;
}
.ac__siteHead {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.ac__locRow {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.ac__secLabel {
  margin: 0;
  font-weight: 600;
  font-size: 0.88rem;
}

/* requests */
.ac__leadStats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.7rem;
  margin-bottom: 1.1rem;
}
.ac__tableWrap {
  overflow-x: auto;
}
.ac__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.ac__table th {
  text-align: left;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
  padding: 0.35rem 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
  white-space: nowrap;
}
.ac__table td {
  padding: 0.55rem 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
  vertical-align: middle;
}
.ac__table tr:last-child td {
  border-bottom: none;
}
.ac__table .num {
  text-align: right;
  white-space: nowrap;
}
.ac__leadWho {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  min-width: 150px;
}
.ac__leadWho strong {
  display: block;
}
.ac__leadWho .ac__muted {
  font-size: 0.74rem;
}
.ac__leadMsg {
  color: rgba(var(--v-theme-on-surface), 0.78);
  max-width: 320px;
}
.ac__date {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.74rem;
}
.ac__leadSel {
  width: 142px;
}

/* stats */
.ac__ana {
  display: grid;
  grid-template-columns: minmax(240px, 320px) 1fr;
  gap: 1.5rem;
  align-items: start;
}
.ac__anaMeter {
  display: flex;
  flex-direction: column;
}
.ac__rank {
  margin: 0.7rem 0 0;
  font-weight: 700;
  font-size: 0.9rem;
}
.ac__statGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.7rem;
}

/* campaign editor */
.ac__auto {
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  padding: 0.7rem 0.9rem;
  margin-bottom: 0.9rem;
}
.ac__auto.is-on {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.06);
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
  background: rgba(var(--v-theme-primary), 0.08);
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
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 0.82rem;
}
.ac__funding.is-short {
  background: rgba(var(--v-theme-warning), 0.14);
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
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ac__campStats strong {
  font-size: 0.95rem;
}
.ac__campStats .ac__eq {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.68rem;
  font-style: normal;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ac__fundEq {
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-left: 0.35rem;
}
.ac__campActions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-top: 1rem;
  align-items: center;
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
  color: rgba(var(--v-theme-on-surface), 0.55);
}
@media (max-width: 760px) {
  .ac__ana {
    grid-template-columns: 1fr;
  }
}
</style>
