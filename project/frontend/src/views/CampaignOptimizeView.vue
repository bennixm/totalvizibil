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
const { loading, error } = storeToRefs(campaign)
const { overview } = storeToRefs(companies)

const companyId = ref<string | null>(null)
const o = computed(() => campaign.optimization)

// `loadOptimization` swallows its failure into the store's `error` field,
// which this page never read — the template only had "loading" and "has
// data" branches, so a failed load rendered just the header on an otherwise
// blank page. Show the failure with a retry instead.
const loadFailed = computed(() => !loading.value && !o.value && !!error.value)

const AREA_ICON: Record<OptimizationArea, string> = {
  cpc: 'mdi-cash-multiple',
  response: 'mdi-message-fast-outline',
  plan: 'mdi-rocket-launch-outline',
  age: 'mdi-timer-sand',
}

// Has the one-time advanced-builder unlock fee been paid for this business?
const builderUnlocked = computed(
  () => !!overview.value.find((c) => c.id === companyId.value)?.builderUnlocked,
)

/**
 * Where each finding's CTA goes.
 *  - `cpc` → the budget/CPC EDITOR, not the read-only campaign hub. The hub
 *    can't action this suggestion at all, and DashboardView's equivalent
 *    alert already pointed at the editor — the two now agree.
 *  - `plan` → the builder once unlocked; otherwise the unlock-payment step
 *    directly, tagged `flow=upgrade`. Routing an already-live easy-plan
 *    business at the builder made it bounce through that same pay screen in
 *    full brand-new-signup onboarding dress (step strip, and on success a
 *    `flow=onboarding` hand-off back into wizard sequencing). The flag marks
 *    this as an upgrade rather than a first run. NOTE: CreateUnlockView
 *    doesn't branch on it yet — it's owned by another agent this round.
 */
function areaTo(area: OptimizationArea): { name: string; query: Record<string, string> } | null {
  const c = companyId.value
  if (!c) return null
  if (area === 'cpc') return { name: 'campaign-budget', query: { c } }
  if (area === 'response') return { name: 'leads', query: { c } }
  if (area === 'plan') {
    return builderUnlocked.value
      ? { name: 'website-builder', query: { c } }
      : { name: 'create-unlock', query: { c, flow: 'upgrade' } }
  }
  return null
}

function fmt(v: number): string {
  return n(v, { maximumFractionDigits: 2 })
}

function fmtMinutes(m: number | null): string {
  if (m == null) return 'N/A'
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

async function retry(): Promise<void> {
  if (!companyId.value || loading.value) return
  await campaign.loadOptimization(companyId.value)
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
        <p v-if="o.status !== 'active'" class="opt__rankLine opt__rankLine--muted">
          {{ t('optimize.notInFeed') }}
        </p>
        <p v-else class="opt__rankLine opt__rankLine--muted">
          {{ t('optimize.scoreLead') }}
        </p>
        <div class="opt__scoreChip">
          <strong>{{ o.visibility.score }}<span>%</span></strong>
          <span>{{ t('optimize.scoreLabel') }}</span>
        </div>
      </section>

      <div v-if="o.findings.length" class="opt__list">
        <article
          v-for="f in o.findings"
          :key="f.area"
          class="ocard"
          :class="`ocard--${f.severity}`"
        >
          <div class="ocard__ic">
            <v-icon :icon="AREA_ICON[f.area]" size="22" />
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
              v-if="areaTo(f.area)"
              class="ocard__cta"
              size="small"
              variant="tonal"
              color="primary"
              :to="areaTo(f.area)!"
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

    <!-- The load failed: without this the page was just the header. -->
    <div v-else-if="loadFailed" class="opt__failed">
      <v-icon icon="mdi-cloud-off-outline" size="30" />
      <h3>{{ t('optimize.errorTitle') }}</h3>
      <p>{{ t('optimize.errorText') }}</p>
      <v-btn
        color="primary"
        variant="flat"
        size="small"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="retry"
      >
        {{ t('optimize.retry') }}
      </v-btn>
    </div>
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
  color: rgba(var(--v-theme-on-surface), 0.45);
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
  color: rgba(var(--v-theme-on-surface), 0.66);
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
    radial-gradient(140% 120% at 100% 0%, rgba(var(--v-theme-primary), 0.1), transparent 55%),
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
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.opt__rankLine--muted {
  font-weight: 500;
  font-size: 0.95rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
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
  color: rgba(var(--v-theme-on-surface), 0.5);
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
  border-left: 3px solid rgba(var(--v-theme-primary), 0.6);
}
.ocard__ic {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.1);
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
  color: rgba(var(--v-theme-on-surface), 0.5);
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
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.ocard__stat {
  margin: 0.4rem 0 0;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ocard__weight {
  margin: 0.5rem 0 0;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.ocard__cta {
  margin-top: 0.7rem;
}

.opt__failed {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
  margin-top: 1.5rem;
  padding: 2.25rem 1.5rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-glass-border);
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.opt__failed > .v-icon {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.opt__failed h3 {
  font-family: 'Space Grotesk Variable', sans-serif;
  margin: 0.2rem 0 0;
}
.opt__failed p {
  margin: 0 0 0.5rem;
  max-width: 42ch;
  font-size: 0.86rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
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
  background: rgba(var(--v-theme-success), 0.08);
}
.opt__done h3 {
  font-family: 'Space Grotesk Variable', sans-serif;
  margin: 0.2rem 0 0;
}
.opt__done p {
  margin: 0;
  font-size: 0.86rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

@media (max-width: 560px) {
  .opt__hero {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }
}
</style>
