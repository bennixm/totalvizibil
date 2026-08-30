<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import InfoHint from '@/components/InfoHint.vue'
import { useCompaniesStore } from '@/stores/companies'
import { useCampaignStore, type CampaignTier } from '@/stores/campaign'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const campaign = useCampaignStore()
const { data, loading, working, error } = storeToRefs(campaign)

const companyId = ref<string | null>(null)
const dailyBudget = ref(20)
const cpc = ref(1)
const appearFirst = ref(false)
const dirty = ref(false)
// True only while hydrate() writes the fields, so the field watcher doesn't
// flag a fresh load as an edit.
const hydrating = ref(false)

const balance = computed(() => data.value?.wallet.balance.credits ?? 0)
const consumed = computed(() => data.value?.consumed.credits ?? 0)
const required = computed(() => (dirty.value ? dailyBudget.value : data.value?.required.credits ?? 0))
const funded = computed(() => balance.value >= required.value)
const status = computed(() => data.value?.campaign?.status ?? null)
const isLive = computed(() => status.value === 'active')
const hasCampaign = computed(() => !!data.value?.campaign)
const configured = computed(() => hasCampaign.value && status.value !== 'draft')
const cpcValid = computed(() => cpc.value >= 0.05 && cpc.value <= dailyBudget.value)

function fmt(v: number): string {
  return n(v, { maximumFractionDigits: 2 })
}

const KNOWN_ERRORS = ['insufficient_credits', 'set_budget_first']
function errText(code: string): string {
  return KNOWN_ERRORS.includes(code) ? t('campaign.err.' + code) : code
}

function applyTier(tier: CampaignTier, first: boolean): void {
  dailyBudget.value = tier.dailyBudget.credits
  cpc.value = tier.cpc.credits
  appearFirst.value = first
  dirty.value = true
}

/** Toggle "appear first" on its own, without touching the budget/CPC numbers. */
function toggleFirst(v: boolean): void {
  appearFirst.value = v
  dirty.value = true
}

function hydrate(): void {
  hydrating.value = true
  const c = data.value?.campaign
  if (c) {
    dailyBudget.value = c.dailyBudget.credits
    cpc.value = c.cpc.credits
    appearFirst.value = c.appearFirst
  } else if (data.value) {
    dailyBudget.value = data.value.suggestions.standard.dailyBudget.credits
    cpc.value = data.value.suggestions.standard.cpc.credits
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
  })
  if (ok) dirty.value = false
}

function activate(): void {
  if (companyId.value) void campaign.activate(companyId.value)
}

function pause(): void {
  if (companyId.value) void campaign.pause(companyId.value)
}

watch([dailyBudget, cpc, appearFirst], () => {
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
</script>

<template>
  <v-container class="camp">
    <header class="camp__head">
      <div>
        <p class="camp__eyebrow">{{ t('campaign.eyebrow') }}</p>
        <h1>{{ t('campaign.title') }}</h1>
      </div>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'dashboard' }">
        {{ t('campaign.back') }}
      </v-btn>
    </header>

    <div v-if="loading && !data" class="camp__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="data">
      <div v-if="isLive" class="camp__live">
        <v-icon icon="mdi-broadcast" size="18" /> {{ t('campaign.liveNote') }}
      </div>
      <div v-else-if="status === 'depleted'" class="camp__depleted">
        <v-icon icon="mdi-alert-outline" size="18" /> {{ t('campaign.depletedNote') }}
      </div>
      <div v-else-if="status === 'paused'" class="camp__depleted">
        <v-icon icon="mdi-pause-circle-outline" size="18" /> {{ t('campaign.pausedNote') }}
      </div>

      <!-- Placement — a real toggle: pick a tier, it sets the suggested numbers -->
      <section class="camp__suggest">
        <h2>
          {{ t('campaign.suggestTitle') }}
          <InfoHint :text="t('campaign.appearFirstHint')" />
        </h2>
        <div class="camp__tiers" role="radiogroup" :aria-label="t('campaign.suggestTitle')">
          <button
            type="button"
            class="tier"
            role="radio"
            :aria-checked="!appearFirst"
            :class="{ 'tier--active': !appearFirst }"
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
            :aria-checked="appearFirst"
            :class="{ 'tier--active': appearFirst }"
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
            step="0.05"
            :label="t('campaign.cpc')"
            suffix="cr"
            variant="outlined"
            density="comfortable"
            :error="!cpcValid"
            :hint="!cpcValid ? t('campaign.cpcInvalid') : ''"
            persistent-hint
          />
        </div>
        <div class="camp__first">
          <v-checkbox-btn
            :model-value="appearFirst"
            :label="t('campaign.appearFirst')"
            color="primary"
            @update:model-value="toggleFirst"
          />
          <InfoHint :text="t('campaign.appearFirstHint')" />
        </div>

        <div class="camp__funding" :class="{ 'is-short': !funded }">
          <span>
            {{ t('campaign.needCredits', { need: fmt(required), balance: fmt(balance) }) }}
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

        <div v-if="data.campaign" class="camp__stats">
          <div>
            <span>{{ t('campaign.spentToday') }}</span>
            <strong>{{ fmt(data.campaign.spentToday.credits) }} / {{ fmt(data.campaign.dailyBudget.credits) }}</strong>
          </div>
          <div>
            <span>{{ t('campaign.clicks') }}</span>
            <strong>{{ data.campaign.clicks }}</strong>
          </div>
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
            v-else-if="isLive"
            variant="tonal"
            :loading="working"
            prepend-icon="mdi-pause"
            @click="pause"
          >
            {{ t('campaign.pause') }}
          </v-btn>

          <v-btn
            v-else-if="hasCampaign"
            color="primary"
            :loading="working"
            :disabled="!cpcValid || !funded"
            append-icon="mdi-broadcast"
            @click="activate"
          >
            {{ t('campaign.activate') }}
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

.camp__suggest h2,
.camp__form h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.05rem;
  margin: 0 0 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.camp__tiers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
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
