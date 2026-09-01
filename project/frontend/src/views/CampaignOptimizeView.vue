<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import { useCompaniesStore } from '@/stores/companies'
import { useCampaignStore, type OptimizationArea } from '@/stores/campaign'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const campaign = useCampaignStore()
const { loading } = storeToRefs(campaign)

const companyId = ref<string | null>(null)
const o = computed(() => campaign.optimization)

const partRows = computed(() => {
  const p = o.value?.visibility.parts
  if (!p) return []
  return [
    { key: 'cpc', label: 'analytics.vsCpc', score: p.cpc },
    { key: 'response', label: 'analytics.vsResponse', score: p.response },
    { key: 'plan', label: 'analytics.vsPlan', score: p.plan },
    { key: 'age', label: 'analytics.vsAge', score: p.age },
  ]
})

const AREA_META: Record<OptimizationArea, { icon: string; to: string | null }> = {
  cpc: { icon: 'mdi-cash-multiple', to: 'campaign' },
  response: { icon: 'mdi-message-fast-outline', to: 'leads' },
  plan: { icon: 'mdi-rocket-launch-outline', to: 'website-builder' },
  age: { icon: 'mdi-timer-sand', to: null },
}

function fmt(v: number): string {
  return n(v, { maximumFractionDigits: 2 })
}

function fmtMinutes(m: number | null): string {
  if (m == null) return '—'
  if (m < 60) return `${m} min`
  if (m < 60 * 24) return `${Math.round(m / 60)} h`
  return `${Math.round(m / 1440)} ${t('dashboard.days')}`
}

function findingText(area: OptimizationArea): string {
  if (!o.value) return ''
  if (area === 'age') {
    return t('optimize.age.text', { full: o.value.ageFullDays, days: o.value.activeDays })
  }
  if (area === 'cpc') {
    return t('optimize.cpc.text', {
      budget: fmt(o.value.recommended.dailyBudget.credits),
      cpc: fmt(o.value.recommended.cpc.credits),
    })
  }
  return t(`optimize.${area}.text`)
}

async function loadFor(id: string): Promise<void> {
  companyId.value = id
  companies.select(id)
  await campaign.loadOptimization(id)
}

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  await loadFor(id)
})

watch(
  () => route.query.c,
  (raw) => {
    const next = typeof raw === 'string' ? raw : null
    if (next && next !== companyId.value) void loadFor(next)
  },
)
</script>

<template>
  <v-container class="opt">
    <header class="opt__head">
      <div>
        <p class="opt__eyebrow">{{ t('optimize.eyebrow') }}</p>
        <h1>{{ t('optimize.title') }}</h1>
      </div>
      <v-btn
        variant="text"
        size="small"
        prepend-icon="mdi-arrow-left"
        :to="{ name: 'campaign', query: { c: companyId } }"
      >
        {{ t('optimize.back') }}
      </v-btn>
    </header>

    <div v-if="loading && !o" class="opt__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="o">
      <p class="opt__lead">{{ t('optimize.lead') }}</p>

      <section class="opt__hero">
        <div class="opt__rank">
          <p v-if="o.rank" class="opt__rankLine">
            {{ t('optimize.rankLine', { n: o.rank.position, total: o.rank.total }) }}
            <span>{{ t('optimize.rankScope') }}</span>
          </p>
          <p v-else-if="o.status !== 'active'" class="opt__rankLine opt__rankLine--muted">
            {{ t('optimize.notInFeed') }}
          </p>
          <p v-else class="opt__rankLine opt__rankLine--muted">
            {{ t('optimize.rankUnknown') }}
          </p>
        </div>
        <div class="opt__scoreChip">
          <strong>{{ o.visibility.score }}<span>%</span></strong>
          <span>{{ t('optimize.scoreLabel') }}</span>
        </div>
      </section>

      <div class="opt__bars">
        <div v-for="p in partRows" :key="p.key" class="obar">
          <span class="obar__k">{{ t(p.label) }}</span>
          <span class="obar__track"><span class="obar__fill" :style="{ width: p.score + '%' }" /></span>
          <span class="obar__v">{{ p.score }}%</span>
        </div>
      </div>

      <div v-if="o.findings.length" class="opt__list">
        <article
          v-for="f in o.findings"
          :key="f.area"
          class="ocard"
          :class="`ocard--${f.severity}`"
        >
          <div class="ocard__ic">
            <v-icon :icon="AREA_META[f.area].icon" size="22" />
          </div>
          <div class="ocard__body">
            <div class="ocard__top">
              <span class="ocard__sev">
                {{ f.severity === 'high' ? t('optimize.sevHigh') : t('optimize.sevMedium') }}
              </span>
              <span class="ocard__gain">{{ t('optimize.gain', { n: f.gainPct }) }}</span>
            </div>
            <h3>{{ t(`optimize.${f.area}.title`) }}</h3>
            <p class="ocard__text">{{ findingText(f.area) }}</p>
            <p
              v-if="f.area === 'response' && o.response.total > 0"
              class="ocard__stat"
            >
              {{
                t('optimize.response.stat', {
                  responded: o.response.responded,
                  total: o.response.total,
                  avg: fmtMinutes(o.response.avgMinutes),
                })
              }}
            </p>
            <p class="ocard__weight">
              {{ t('optimize.weightNow', { weight: f.weightPct, score: f.scorePct }) }}
            </p>
            <v-btn
              v-if="AREA_META[f.area].to"
              class="ocard__cta"
              size="small"
              variant="tonal"
              color="primary"
              :to="{ name: AREA_META[f.area].to as string, query: { c: companyId } }"
            >
              {{ t(`optimize.${f.area}.cta`) }}
            </v-btn>
          </div>
        </article>
      </div>

      <div v-else class="opt__done">
        <v-icon icon="mdi-check-decagram-outline" size="30" color="success" />
        <h3>{{ t('optimize.allGood') }}</h3>
        <p>{{ t('optimize.allGoodText') }}</p>
      </div>
    </template>
  </v-container>
</template>

<style scoped>
.opt {
  max-width: 680px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.opt__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.opt__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}
.opt__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin: 0 0 0.3rem;
}
.opt__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.opt__lead {
  margin: 0 0 1.25rem;
  color: rgb(var(--v-theme-on-surface) / 0.66);
  font-size: 0.92rem;
}

.opt__hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
  padding: 1.25rem 1.4rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-glass-border);
  background:
    radial-gradient(140% 120% at 100% 0%, rgb(var(--v-theme-primary) / 0.1), transparent 55%),
    rgb(var(--v-theme-surface));
  margin-bottom: 1rem;
}
.opt__rankLine {
  margin: 0;
  font-weight: 700;
  font-size: 1.05rem;
}
.opt__rankLine span {
  display: block;
  font-weight: 500;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.opt__rankLine--muted {
  font-weight: 500;
  font-size: 0.95rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.opt__scoreChip {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1;
}
.opt__scoreChip strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 2.1rem;
  font-weight: 700;
}
.opt__scoreChip strong span {
  font-size: 1rem;
  opacity: 0.55;
}
.opt__scoreChip > span {
  margin-top: 0.3rem;
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

.opt__bars {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 1.1rem 1.4rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
}
.obar {
  display: grid;
  grid-template-columns: 8.5rem 1fr 2.6rem;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.8rem;
}
.obar__k {
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.obar__track {
  height: 7px;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.1);
  overflow: hidden;
}
.obar__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgb(var(--v-theme-primary)),
    rgb(var(--v-theme-secondary, var(--v-theme-primary)))
  );
}
.obar__v {
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.opt__list {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-top: 1.5rem;
}
.ocard {
  display: flex;
  gap: 0.9rem;
  padding: 1.05rem 1.2rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
}
.ocard--high {
  border-left: 3px solid rgb(var(--v-theme-warning));
}
.ocard--medium {
  border-left: 3px solid rgb(var(--v-theme-primary) / 0.6);
}
.ocard__ic {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: rgb(var(--v-theme-primary) / 0.1);
  color: rgb(var(--v-theme-primary));
}
.ocard__body {
  flex: 1;
  min-width: 0;
}
.ocard__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.ocard__sev {
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.ocard__gain {
  font-size: 0.75rem;
  font-weight: 700;
  color: rgb(var(--v-theme-success));
}
.ocard__body h3 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1rem;
  margin: 0 0 0.25rem;
}
.ocard__text {
  margin: 0;
  font-size: 0.86rem;
  color: rgb(var(--v-theme-on-surface) / 0.75);
}
.ocard__stat {
  margin: 0.4rem 0 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.ocard__weight {
  margin: 0.5rem 0 0;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--v-theme-on-surface) / 0.42);
}
.ocard__cta {
  margin-top: 0.7rem;
}

.opt__done {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.4rem;
  margin-top: 1.5rem;
  padding: 2rem 1.5rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-success) / 0.08);
}
.opt__done h3 {
  font-family: 'Space Grotesk Variable', sans-serif;
  margin: 0.2rem 0 0;
}
.opt__done p {
  margin: 0;
  font-size: 0.86rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
}

@media (max-width: 560px) {
  .opt__hero {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }
}
</style>
