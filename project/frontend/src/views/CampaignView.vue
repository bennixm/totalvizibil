<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import InfoHint from '@/components/InfoHint.vue'
import { useMoney } from '@/composables/useMoney'
import { useCompaniesStore } from '@/stores/companies'
import { useCampaignStore, type CampaignTier } from '@/stores/campaign'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const campaign = useCampaignStore()
const money = useMoney()
const { data, loading, working, error } = storeToRefs(campaign)

const companyId = ref<string | null>(null)
const dailyBudget = ref(20)
const cpc = ref(1)
const appearFirst = ref(false)
const auto = ref(false)
const dirty = ref(false)
// True only while hydrate() writes the fields, so the field watcher doesn't
// flag a fresh load as an edit.
const hydrating = ref(false)

/** A number input can transiently hold '' / NaN while being typed. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
const budgetN = computed(() => num(dailyBudget.value))
const cpcN = computed(() => num(cpc.value))

const balance = computed(() => data.value?.wallet.balance.credits ?? 0)
const consumed = computed(() => data.value?.consumed.credits ?? 0)
const required = computed(() => (dirty.value ? budgetN.value : data.value?.required.credits ?? 0))
const funded = computed(() => balance.value >= required.value)
const status = computed(() => data.value?.campaign?.status ?? null)
const isLive = computed(() => status.value === 'active')
const hasCampaign = computed(() => !!data.value?.campaign)
const configured = computed(() => hasCampaign.value && status.value !== 'draft')
const marketCpc = computed(() => data.value?.marketCpc.credits ?? 0)
// Advanced-plan business whose website builder isn't finished — activation is
// blocked (server-side too) until it is.
const builderPending = computed(() => !!data.value?.requiresWebsiteBuilder)

// Credit-comparison epsilon — two credit amounts within this are "the same".
const CR_EPS = 0.005

// Live "Budget (CPC)" sub-score preview — mirrors backend cpcScore(): the bid
// against the recommended (category-leading) CPC, capped by budget adequacy
// (20 cr/day funding reference). Moves the instant CPC drops below recommended.
const recommendedCpc = computed(() => data.value?.suggestions.appearFirst.cpc.credits ?? 0)

// The recommended CPC is also the ceiling: bidding above it buys no extra
// ranking (the CPC sub-score is already maxed there, the feed sort ignores raw
// CPC beyond the score), so the backend trims anything higher on save.
const cpcMax = computed(() => recommendedCpc.value || Infinity)
const cpcOverMax = computed(() => !auto.value && cpcN.value > cpcMax.value + CR_EPS)
// In AUTO mode the CPC is platform-managed, so its bounds don't gate saving.
const cpcValid = computed(
  () =>
    auto.value ||
    (cpcN.value >= 0.05 && cpcN.value <= budgetN.value && cpcN.value <= cpcMax.value + CR_EPS),
)
const cpcHint = computed(() => {
  if (auto.value) return t('campaign.cpcAuto')
  if (cpcOverMax.value) return t('campaign.cpcOverMax', { n: fmt(cpcMax.value) })
  if (!cpcValid.value) return t('campaign.cpcInvalid')
  if (recommendedCpc.value > 0) return t('campaign.cpcMaxHint', { n: fmt(recommendedCpc.value) })
  return ''
})

// The recommended CPC moves with the competition. A campaign that opted into
// competing for the top slot ("appear first") but whose *saved* bid has since
// fallen behind the market gets a nudge to catch up — otherwise the CPC
// sub-score quietly erodes with every new rival. (A deliberately cheaper
// "standard" campaign is left alone.)
const savedCpc = computed(() => data.value?.campaign?.cpc.credits ?? 0)
const cpcBelowMarket = computed(
  () =>
    configured.value &&
    !auto.value &&
    !dirty.value &&
    appearFirst.value &&
    recommendedCpc.value > 0 &&
    savedCpc.value < recommendedCpc.value - CR_EPS,
)
function matchRecommendedCpc(): void {
  cpc.value = recommendedCpc.value
  dirty.value = true
}

const projectedCpcPart = computed(() => {
  if (auto.value) return 100
  const rc = recommendedCpc.value
  const competitiveness = rc > 0 ? Math.min(1, cpcN.value / rc) : cpcN.value > 0 ? 1 : 0
  const budgetAdequacy = Math.min(1, budgetN.value / 20)
  return Math.round(Math.min(competitiveness, budgetAdequacy) * 100)
})

// Which preset the current numbers actually equal — so the tier cards reflect
// reality instead of just the `appearFirst` flag. Any manual edit that moves a
// value off a preset drops this to 'custom' and no card stays lit.
function sameCr(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < CR_EPS
}
const activeTier = computed<'standard' | 'first' | 'custom'>(() => {
  const s = data.value?.suggestions
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

function fmt(v: number): string {
  return n(v, { maximumFractionDigits: 2 })
}

const KNOWN_ERRORS = [
  'insufficient_credits',
  'set_budget_first',
  'wallet_blocked',
  'company_suspended',
  'website_builder_incomplete',
]

function errText(code: string): string {
  return KNOWN_ERRORS.includes(code) ? t('campaign.err.' + code) : code
}

function applyTier(tier: CampaignTier, first: boolean): void {
  auto.value = false
  dailyBudget.value = tier.dailyBudget.credits
  cpc.value = tier.cpc.credits
  appearFirst.value = first
  dirty.value = true
}

/** Flip AUTO mode. Turning it on implies competing for the top slot. */
function setAuto(v: boolean | null): void {
  auto.value = !!v
  if (v) appearFirst.value = true
  dirty.value = true
}

/**
 * "Apply the recommendation": ticking it drops in the recommended CPC + budget
 * (the numbers that top out the visibility score); unticking it just steps off
 * the recommended tier and leaves the current numbers alone.
 */
function toggleFirst(v: boolean | null): void {
  const on = !!v
  if (on && data.value) {
    applyTier(data.value.suggestions.appearFirst, true)
  } else {
    appearFirst.value = on
    dirty.value = true
  }
}

function hydrate(): void {
  hydrating.value = true
  const c = data.value?.campaign
  if (c) {
    dailyBudget.value = c.dailyBudget.credits
    // Trim a saved CPC that now sits above the recommended ceiling (market
    // moved lower) so the field matches what the backend would keep.
    const recMax = data.value?.suggestions.appearFirst.cpc.credits ?? Infinity
    cpc.value = c.autoOptimize ? c.cpc.credits : Math.min(c.cpc.credits, recMax)
    appearFirst.value = c.appearFirst
    auto.value = c.autoOptimize
  } else if (data.value) {
    dailyBudget.value = data.value.suggestions.standard.dailyBudget.credits
    cpc.value = data.value.suggestions.standard.cpc.credits
    appearFirst.value = false
    auto.value = false
  }
  dirty.value = false
  void nextTick(() => {
    hydrating.value = false
  })
}

/** Save the numbers. A live campaign is paused by the backend on any edit. */
async function save(): Promise<void> {
  if (!companyId.value || !cpcValid.value) return
  const ok = await campaign.save(companyId.value, {
    dailyBudget: dailyBudget.value,
    cpc: cpc.value,
    appearFirst: appearFirst.value,
    autoOptimize: auto.value,
  })
  if (ok) dirty.value = false
}

watch([dailyBudget, cpc, appearFirst, auto], () => {
  if (!hydrating.value) dirty.value = true
})
watch(data, hydrate)

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  companyId.value = id
  await campaign.load(id)
  hydrate()
})

// Switching business from the nav dropdown only moves ?c= — reload the campaign
// for the newly selected company instead of showing the previous one's numbers.
watch(
  () => route.query.c,
  async (raw) => {
    const next = typeof raw === 'string' ? raw : null
    if (!next || next === companyId.value) return
    companyId.value = next
    companies.select(next)
    await campaign.load(next)
    hydrate()
  },
)
</script>

<template>
  <v-container class="camp">
    <header class="camp__head">
      <div>
        <p class="camp__eyebrow">{{ t('campaign.eyebrow') }}</p>
        <h1>{{ t('campaign.title') }}</h1>
      </div>
      <div class="camp__headActions">
        <v-btn
          variant="text"
          size="small"
          prepend-icon="mdi-arrow-left"
          :to="{ name: 'campaign', query: { c: companyId } }"
        >
          {{ t('campaign.back') }}
        </v-btn>
      </div>
    </header>

    <div v-if="loading && !data" class="camp__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="data">
      <div v-if="isLive" class="camp__live">
        <v-icon icon="mdi-broadcast" size="18" /> {{ t('campaign.liveNote') }}
      </div>
      <div v-else-if="status === 'depleted'" class="camp__depleted">
        <v-icon icon="mdi-alert-outline" size="18" />
        {{ data.campaign?.autoOptimize ? t('campaign.autoDepletedNote') : t('campaign.depletedNote') }}
      </div>
      <div v-else-if="status === 'paused'" class="camp__depleted">
        <v-icon icon="mdi-pause-circle-outline" size="18" /> {{ t('campaign.pausedNote') }}
      </div>

      <div v-if="builderPending" class="camp__builder">
        <v-icon icon="mdi-alert-outline" size="18" />
        <div>
          <strong>{{ t('campaign.builderRequiredTitle') }}</strong>
          <p>{{ t('campaign.builderRequiredNote') }}</p>
        </div>
        <v-btn
          size="small"
          variant="flat"
          color="primary"
          append-icon="mdi-arrow-right"
          :to="{ name: 'website-builder', query: { c: companyId } }"
        >
          {{ t('campaign.builderRequiredCta') }}
        </v-btn>
      </div>

      <div v-if="cpcBelowMarket" class="camp__market">
        <v-icon icon="mdi-trending-up" size="18" />
        <div>
          <strong>{{ t('campaign.cpcBelowMarketTitle') }}</strong>
          <p>
            {{
              t('campaign.cpcBelowMarketNote', {
                rec: fmt(recommendedCpc),
                cur: fmt(savedCpc),
                pct: projectedCpcPart,
              })
            }}
          </p>
        </div>
        <v-btn size="small" variant="flat" color="primary" @click="matchRecommendedCpc">
          {{ t('campaign.cpcBelowMarketCta', { n: fmt(recommendedCpc) }) }}
        </v-btn>
      </div>

      <!-- AUTO mode -->
      <section class="camp__auto" :class="{ 'is-on': auto }">
        <div class="camp__autoHead">
          <v-icon icon="mdi-robot-outline" size="22" />
          <div class="camp__autoText">
            <strong>{{ t('campaign.autoTitle') }}</strong>
            <p>{{ t('campaign.autoLead') }}</p>
          </div>
          <v-switch
            :model-value="auto"
            color="primary"
            hide-details
            density="compact"
            inset
            @update:model-value="setAuto"
          />
        </div>
        <template v-if="auto">
          <ul class="camp__autoPoints">
            <li>{{ t('campaign.autoP1') }}</li>
            <li>{{ t('campaign.autoP2') }}</li>
            <li>{{ t('campaign.autoP3') }}</li>
          </ul>
          <p class="camp__autoMarket">
            {{
              marketCpc > 0
                ? t('campaign.autoMarket', { n: fmt(marketCpc) })
                : t('campaign.autoMarketNone')
            }}
          </p>
          <p v-if="data.autoBudgetLimited" class="camp__autoWarn">
            <v-icon icon="mdi-alert-outline" size="14" /> {{ t('campaign.autoBudgetLimited') }}
          </p>
        </template>
      </section>

      <!-- Placement — a real toggle: pick a tier, it sets the suggested numbers -->
      <section v-if="!auto" class="camp__suggest">
        <h2>
          {{ t('campaign.suggestTitle') }}
          <InfoHint :text="t('campaign.appearFirstHint')" />
        </h2>
        <div class="camp__tiers" role="radiogroup" :aria-label="t('campaign.suggestTitle')">
          <button
            type="button"
            class="tier"
            role="radio"
            :aria-checked="activeTier === 'standard'"
            :class="{ 'tier--active': activeTier === 'standard' }"
            @click="applyTier(data.suggestions.standard, false)"
          >
            <span class="tier__dot" />
            <span class="tier__name">{{ t('campaign.tierStandard') }}</span>
            <span class="tier__cpc">CPC {{ fmt(data.suggestions.standard.cpc.credits) }}</span>
            <span class="tier__budget">
              {{ t('campaign.perDay', { n: fmt(data.suggestions.standard.dailyBudget.credits) }) }}
            </span>
          </button>
          <button
            type="button"
            class="tier tier--first"
            role="radio"
            :aria-checked="activeTier === 'first'"
            :class="{ 'tier--active': activeTier === 'first' }"
            @click="applyTier(data.suggestions.appearFirst, true)"
          >
            <span class="tier__dot" />
            <span class="tier__name">
              <v-icon icon="mdi-rocket-launch-outline" size="15" /> {{ t('campaign.tierFirst') }}
            </span>
            <span class="tier__cpc">CPC {{ fmt(data.suggestions.appearFirst.cpc.credits) }}</span>
            <span class="tier__budget">
              {{ t('campaign.perDay', { n: fmt(data.suggestions.appearFirst.dailyBudget.credits) }) }}
            </span>
          </button>
        </div>
        <p v-if="activeTier === 'custom'" class="camp__tierCustom">
          <v-icon icon="mdi-pencil-outline" size="13" /> {{ t('campaign.tierCustom') }}
        </p>
      </section>

      <!-- Form -->
      <section class="camp__form">
        <div class="camp__row">
          <v-text-field
            v-model.number="dailyBudget"
            type="number"
            :min="1"
            :label="t('campaign.dailyBudget')"
            suffix="cr"
            variant="outlined"
            density="comfortable"
            hide-details
          />
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
        <div v-if="!auto" class="camp__first">
          <v-checkbox-btn
            :model-value="appearFirst"
            :label="t('campaign.appearFirst')"
            color="primary"
            @update:model-value="toggleFirst"
          />
          <InfoHint :text="t('campaign.appearFirstHint')" />
        </div>

        <p v-if="!auto" class="camp__cpcLive" :class="{ 'is-low': projectedCpcPart < 100 }">
          <v-icon
            :icon="projectedCpcPart < 100 ? 'mdi-trending-down' : 'mdi-check-circle-outline'"
            size="15"
          />
          {{ t('campaign.cpcScoreLive', { n: projectedCpcPart }) }}
          <span class="camp__cpcLiveHint">{{ t('campaign.cpcScoreLiveHint') }}</span>
        </p>

        <div class="camp__funding" :class="{ 'is-short': !funded }">
          <span>
            {{ t('campaign.needCredits', { need: fmt(required), balance: fmt(balance) }) }}
            <span class="camp__fundEq">{{ money.approx(balance) }}</span>
            <InfoHint :text="t('campaign.consumedNote', { n: fmt(consumed) })" />
          </span>
          <v-btn
            v-if="!funded"
            size="x-small"
            variant="tonal"
            color="primary"
            :to="{ name: 'wallet' }"
          >
            {{ t('campaign.addCredits') }}
          </v-btn>
        </div>

        <div v-if="error" class="camp__error">
          <v-icon icon="mdi-alert-circle-outline" size="16" />
          {{ errText(error) }}
        </div>

        <p v-if="dirty && configured" class="camp__editnote">
          <v-icon icon="mdi-information-outline" size="15" /> {{ t('campaign.editStopsNote') }}
        </p>

        <div class="camp__actions">
          <v-btn
            v-if="dirty"
            color="primary"
            :loading="working"
            :disabled="!cpcValid || working"
            prepend-icon="mdi-content-save-outline"
            @click="save"
          >
            {{ t('campaign.saveChanges') }}
          </v-btn>
          <v-btn
            v-else
            variant="tonal"
            color="primary"
            append-icon="mdi-arrow-right"
            :to="{ name: 'campaign', query: { c: companyId } }"
          >
            {{ t('campaign.toOverview') }}
          </v-btn>
        </div>
      </section>
    </template>
  </v-container>
</template>

<style scoped>
.camp {
  max-width: 640px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.camp__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.camp__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.camp__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin: 0 0 0.3rem;
}
.camp__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.camp__headActions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.camp__live,
.camp__depleted {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.7rem 1rem;
  border-radius: var(--tvz-radius-md);
  font-size: 0.85rem;
  margin-bottom: 1.25rem;
}
.camp__live {
  background: rgb(var(--v-theme-success) / 0.14);
  color: rgb(var(--v-theme-success));
}
.camp__depleted {
  background: rgb(var(--v-theme-warning) / 0.16);
  color: rgb(var(--v-theme-warning));
}
.camp__builder {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.85rem 1rem;
  border-radius: var(--tvz-radius-md);
  margin-bottom: 1.25rem;
  background: var(--tvz-ai-soft);
  border: 1px solid rgb(var(--v-theme-primary) / 0.35);
}
.camp__builder > .v-icon {
  color: rgb(var(--v-theme-primary));
  flex: none;
}
.camp__builder > div {
  flex: 1;
  min-width: 0;
}
.camp__builder strong {
  font-size: 0.9rem;
}
.camp__builder p {
  margin: 0.1rem 0 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
}

.camp__market {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.85rem 1rem;
  border-radius: var(--tvz-radius-md);
  margin-bottom: 1.25rem;
  background: rgb(var(--v-theme-warning) / 0.12);
  border: 1px solid rgb(var(--v-theme-warning) / 0.4);
}
.camp__market > .v-icon {
  color: rgb(var(--v-theme-warning));
  flex: none;
}
.camp__market > div {
  flex: 1;
  min-width: 0;
}
.camp__market strong {
  font-size: 0.9rem;
}
.camp__market p {
  margin: 0.1rem 0 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
}

.camp__auto {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 1rem 1.1rem;
  margin-bottom: 1.25rem;
  transition: border-color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.camp__auto.is-on {
  border-color: rgb(var(--v-theme-primary) / 0.55);
  background: rgb(var(--v-theme-primary) / 0.06);
}
.camp__autoHead {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.camp__autoText {
  flex: 1;
  min-width: 0;
}
.camp__autoText strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.98rem;
}
.camp__autoText p {
  margin: 0.1rem 0 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.camp__autoPoints {
  margin: 0.85rem 0 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.8);
}
.camp__autoMarket {
  margin: 0.7rem 0 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}
.camp__autoWarn {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0.5rem 0 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgb(var(--v-theme-warning));
}

.camp__suggest h2,
.camp__form h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.05rem;
  margin: 0 0 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.camp__suggest {
  margin-bottom: 1.5rem;
}
.camp__tiers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}
.camp__tierCustom {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0.55rem 0 0;
  font-size: 0.75rem;
  color: rgb(var(--v-theme-primary));
}
.tier {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 1rem 1rem 1rem 2.1rem;
  text-align: left;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  transition:
    border-color var(--tvz-dur-fast) var(--tvz-ease-out),
    background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.tier:hover {
  border-color: rgb(var(--v-theme-primary) / 0.6);
}
.tier__dot {
  position: absolute;
  left: 0.9rem;
  top: 1.15rem;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid rgb(var(--v-theme-on-surface) / 0.35);
  transition: all var(--tvz-dur-fast) var(--tvz-ease-out);
}
.tier--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.08);
}
.tier--active .tier__dot {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  box-shadow: inset 0 0 0 3px rgb(var(--v-theme-surface));
}
.tier--first {
  background: var(--tvz-ai-soft);
}
.tier--first.tier--active {
  background: rgb(var(--v-theme-primary) / 0.12);
}
.tier__name {
  font-weight: 600;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.tier__cpc {
  font-size: 1.1rem;
  font-weight: 700;
}
.tier__budget {
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}

.camp__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.camp__first {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin: 0.4rem 0 0;
}
.camp__cpcLive {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin: 0.5rem 0 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--v-theme-success));
}
.camp__cpcLive.is-low {
  color: rgb(var(--v-theme-warning));
}
.camp__cpcLiveHint {
  flex-basis: 100%;
  font-weight: 400;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.camp__funding {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 1rem 0 0;
  padding: 0.7rem 1rem;
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-on-surface) / 0.05);
  font-size: 0.85rem;
}
.camp__funding.is-short {
  background: rgb(var(--v-theme-warning) / 0.14);
  color: rgb(var(--v-theme-warning));
}
.camp__error {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.75rem;
  color: rgb(var(--v-theme-error));
  font-size: 0.82rem;
}
.camp__editnote {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.9rem 0 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-warning));
}
.camp__stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-top: 0.75rem;
}
.camp__stats > div {
  padding: 0.7rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-hairline);
}
.camp__stats span {
  display: block;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.camp__stats strong {
  font-size: 1rem;
}
.camp__statEq {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.72rem;
  font-style: normal;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.camp__fundEq {
  color: rgb(var(--v-theme-on-surface) / 0.55);
  font-size: 0.9em;
}
.camp__spendLink {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.75rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}
.camp__spendLink:hover {
  text-decoration: underline;
}
.camp__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.5rem;
  flex-wrap: wrap;
}

@media (max-width: 560px) {
  .camp__tiers,
  .camp__row {
    grid-template-columns: 1fr;
  }
  .camp__actions {
    justify-content: stretch;
  }
  .camp__actions > * {
    flex: 1;
  }
}
</style>
