<script setup lang="ts">
/**
 * The campaign hub. Landing page for "campaign" — consumption stats at a glance,
 * the campaign-level activate / stop control, and links out to the optimiser and
 * the budget & CPC editor. (Was the dedicated spend page; generalised in place.)
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import TrendChart from '@/components/TrendChart.vue'
import { useMoney } from '@/composables/useMoney'
import { useCompaniesStore } from '@/stores/companies'
import { useCampaignStore } from '@/stores/campaign'

const { t, n, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const campaign = useCampaignStore()
const money = useMoney()
const { overview } = storeToRefs(companies)
const { spend, loading, error } = storeToRefs(campaign)

const companyId = ref<string | null>(null)
const busy = ref(false)
const s = computed(() => spend.value)
// A business scheduled for deletion can't be (re)activated during its grace
// window (see `campaign.service.ts` `activate()`'s `company_pending_deletion`).
const pendingDeletion = computed(
  () => !!overview.value.find((c) => c.id === companyId.value)?.deletionScheduledAt,
)

// Live clock so the "runs out in ~X" line ticks without a refetch.
const clientNow = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (clientNow.value = Date.now()), 30_000)
})
onBeforeUnmount(() => clearInterval(timer))

function cr(v: number): string {
  return n(v, { maximumFractionDigits: 2 }) + ' cr'
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
}
function fmtActive(seconds: number): string {
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3_600)
  if (d <= 0) return t('spend.hoursN', { n: h })
  return t('spend.daysHours', { d, h })
}
function shortDur(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? t('spend.durHM', { h, m }) : t('spend.durM', { m })
}

const status = computed(() => s.value?.status ?? null)
const statusColor: Record<string, string> = {
  active: 'success',
  paused: 'warning',
  depleted: 'error',
  draft: 'default',
}
const isLive = computed(() => status.value === 'active')
const builderPending = computed(() => !!s.value?.requiresWebsiteBuilder)
const lowFunds = computed(
  () => !!s.value && !s.value.canActivate && !builderPending.value && !isLive.value,
)

const KNOWN_ERR = [
  'insufficient_credits',
  'website_builder_incomplete',
  'company_suspended',
  'company_pending_deletion',
  'wallet_blocked',
  'set_budget_first',
]
const errText = computed(() => {
  const c = error.value
  if (!c) return ''
  return KNOWN_ERR.includes(c) ? t('campaign.err.' + c) : c
})

/** ms until the projected exhaustion, off the live client clock. */
const untilExhaust = computed(() => {
  if (!s.value?.today.projectedExhaustAt) return null
  return new Date(s.value.today.projectedExhaustAt).getTime() - clientNow.value
})

const runwayDays = computed(() => {
  const r = s.value?.runway
  if (!r) return null
  return r.daysAtRecentPace ?? r.daysAtBudget
})
const runwayLow = computed(
  () => status.value === 'active' && runwayDays.value != null && runwayDays.value < 5,
)

// Supporting tiles beside the clicks hero.
const keyTiles = computed(() => {
  const d = s.value
  if (!d) return []
  return [
    {
      k: 'kSpentToday',
      main: `${n(d.today.spent.credits, { maximumFractionDigits: 2 })} / ${n(d.dailyBudget.credits, { maximumFractionDigits: 2 })}`,
      sub: `${d.today.pct}%`,
    },
    { k: 'kCpc', main: cr(d.cpcSet.credits), sub: money.approx(d.cpcSet.credits) },
    {
      k: 'kFeedRank',
      main: d.feedRank
        ? t('spend.feedRankValue', { n: d.feedRank.position, total: d.feedRank.total })
        : '—',
      sub: d.feedRank ? t('spend.feedRankOf') : t('spend.feedRankIdle'),
    },
  ]
})

const lifetime = computed(() => {
  const d = s.value
  if (!d) return []
  return [
    { k: 'lSpent', v: cr(d.lifetime.consumed.credits), x: money.approx(d.lifetime.consumed.credits) },
    { k: 'lClicks', v: String(d.lifetime.clicks), x: '' },
    { k: 'lRunning', v: fmtActive(d.lifetime.activeSeconds), x: '' },
  ]
})

// One chart, toggled between spend and clicks.
type ChartMode = 'spend' | 'clicks'
const chartMode = ref<ChartMode>('clicks')
const chart = computed(() => {
  const pts = s.value?.series ?? []
  const spendMode = chartMode.value === 'spend'
  return {
    labels: pts.map((p) => p.date.slice(5)),
    series: [
      {
        label: spendMode ? t('spend.legendSpend') : t('spend.legendClicks'),
        values: pts.map((p) => (spendMode ? p.spent : p.clicks)),
      },
    ],
  }
})

const tableRows = computed(() =>
  [...(s.value?.series ?? [])].reverse().filter((p) => p.spent > 0 || p.clicks > 0),
)

async function loadFor(id: string): Promise<void> {
  companyId.value = id
  companies.select(id)
  await campaign.loadSpend(id)
}

async function activate(): Promise<void> {
  if (!companyId.value || busy.value) return
  busy.value = true
  if (await campaign.activate(companyId.value)) await campaign.loadSpend(companyId.value)
  busy.value = false
}
// Pausing for over 24h drops the banked "run time" (Age Score) back to zero
// (see `effectiveActiveSeconds`/`RUN_SCORE_GRACE_MS` server-side) — worth a
// heads-up before stopping a campaign that's actually banked some run time.
const showPauseDialog = ref(false)
function askStop(): void {
  if ((s.value?.lifetime.activeSeconds ?? 0) > 0) {
    showPauseDialog.value = true
  } else {
    void stop()
  }
}
async function stop(): Promise<void> {
  if (!companyId.value || busy.value) return
  busy.value = true
  showPauseDialog.value = false
  if (await campaign.pause(companyId.value)) await campaign.loadSpend(companyId.value)
  busy.value = false
}

// --- Delete campaign (immediate) -------------------------------------------
const showDeleteDialog = ref(false)

async function removeCampaign(): Promise<void> {
  if (!companyId.value || busy.value) return
  busy.value = true
  const ok = await campaign.remove(companyId.value)
  busy.value = false
  showDeleteDialog.value = false
  if (ok) void router.push({ name: 'dashboard', query: { c: companyId.value } })
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
  <v-container class="ov">
    <header class="ov__head">
      <div>
        <p class="ov__eyebrow">{{ t('spend.eyebrow') }}</p>
        <h1>{{ t('spend.title') }}</h1>
      </div>
      <v-btn
        variant="text"
        size="small"
        prepend-icon="mdi-arrow-left"
        :to="{ name: 'dashboard' }"
      >
        {{ t('spend.back') }}
      </v-btn>
    </header>

    <div v-if="loading && !s" class="ov__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="error && !s" class="ov__error">
      <v-icon icon="mdi-alert-circle-outline" size="16" /> {{ errText }}
    </div>

    <div v-else-if="s && !s.hasCampaign" class="ov__empty">
      <v-icon icon="mdi-bullhorn-outline" size="34" />
      <p>{{ t('spend.noCampaign') }}</p>
      <span>{{ t('spend.noCampaignHint') }}</span>
      <v-btn
        color="primary"
        variant="flat"
        class="mt-3"
        :to="{ name: 'campaign-budget', query: { c: companyId } }"
      >
        {{ t('spend.noCampaignCta') }}
      </v-btn>
    </div>

    <template v-else-if="s">
      <!-- Control bar: status + activate/stop + links to optimise / budget -->
      <section class="ov__control card">
        <div class="ov__controlTop">
          <div class="ctl__chips">
            <span class="chip" :class="`chip--${statusColor[status ?? 'draft']}`">
              {{ t(`dashboard.campaignStatus.${status ?? 'draft'}`) }}
            </span>
            <span v-if="s.autoOptimize" class="chip chip--auto">
              <v-icon icon="mdi-robot-outline" size="12" /> {{ t('dashboard.campaignAuto') }}
            </span>
          </div>
          <v-btn
            v-if="isLive"
            variant="tonal"
            :loading="busy"
            prepend-icon="mdi-pause"
            @click="askStop"
          >
            {{ t('campaign.pause') }}
          </v-btn>
          <v-btn
            v-else
            color="primary"
            :loading="busy"
            :disabled="!s.canActivate || pendingDeletion"
            append-icon="mdi-broadcast"
            @click="activate"
          >
            {{ t('campaign.activate') }}
          </v-btn>
        </div>

        <div class="ov__controlLinks">
          <v-btn
            variant="text"
            size="small"
            prepend-icon="mdi-tune-variant"
            :to="{ name: 'campaign-optimize', query: { c: companyId } }"
          >
            {{ t('dashboard.optimizeCta') }}
          </v-btn>
          <v-btn
            variant="text"
            size="small"
            prepend-icon="mdi-currency-usd"
            :to="{ name: 'campaign-budget', query: { c: companyId } }"
          >
            {{ t('spend.budgetCta') }}
          </v-btn>
        </div>

        <p v-if="errText" class="ctl__err">
          <v-icon icon="mdi-alert-circle-outline" size="15" /> {{ errText }}
        </p>
      </section>

      <!-- Gate banners -->
      <div v-if="builderPending" class="ov__banner ov__banner--ai">
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

      <div v-else-if="lowFunds" class="ov__banner ov__banner--warn">
        <v-icon icon="mdi-wallet-outline" size="18" />
        <div>
          <strong>{{ t('spend.lowFunds') }}</strong>
          <p>
            {{ t('spend.runwayLineShort', { bal: cr(s.runway.walletBalance.credits) }) }} ·
            {{ t('spend.dailyBudgetEq', { n: cr(s.dailyBudget.credits) }) }}
          </p>
        </div>
        <v-btn size="small" variant="flat" color="primary" :to="{ name: 'wallet' }">
          {{ t('spend.addCredits') }}
        </v-btn>
      </div>

      <!-- Principal info: clicks today (hero) + supporting tiles -->
      <section class="ov__key">
        <div class="khero">
          <span class="khero__k">{{ t('spend.hClicksToday') }}</span>
          <strong class="khero__v">{{ s.today.clicks }}</strong>
          <span class="khero__x">{{ t('spend.kClicksLifeSub', { n: s.lifetime.clicks }) }}</span>
        </div>
        <div class="ktiles">
          <div v-for="tile in keyTiles" :key="tile.k" class="kt">
            <span class="kt__k">{{ t('spend.' + tile.k) }}</span>
            <strong class="kt__v">{{ tile.main }}</strong>
            <span v-if="tile.sub" class="kt__x">{{ tile.sub }}</span>
          </div>
        </div>
      </section>

      <!-- Today's budget: progress + projection + runway -->
      <section class="card ov__today">
        <p class="today__label">{{ t('spend.todayTitle') }}</p>
        <p class="today__big">
          {{ n(s.today.spent.credits, { maximumFractionDigits: 2 }) }}<span class="today__slash">
            / {{ n(s.dailyBudget.credits, { maximumFractionDigits: 2 }) }} cr</span>
          <span class="today__pct" :class="{ 'is-full': s.today.pct >= 100 }">{{ s.today.pct }}%</span>
        </p>
        <p class="today__eq">
          {{ money.approx(s.today.spent.credits) }}
          <span class="today__eqSep">·</span>
          {{ t('spend.dailyBudgetEq', { n: money.approx(s.dailyBudget.credits) }) }}
        </p>

        <div class="today__track">
          <span
            class="today__fill"
            :class="{ 'is-full': s.today.pct >= 100 }"
            :style="{ width: Math.min(100, s.today.pct) + '%' }"
          />
        </div>

        <p v-if="s.today.depleted" class="today__proj today__proj--bad">
          <v-icon icon="mdi-alert-octagon-outline" size="15" />
          {{
            s.today.capHitAt
              ? t('spend.capReached', { time: fmtTime(s.today.capHitAt) })
              : t('spend.depletedNow')
          }}
        </p>
        <p v-else-if="s.today.projectedExhaustAt" class="today__proj today__proj--warn">
          <v-icon icon="mdi-timer-sand" size="15" />
          {{ t('spend.projExhaust', { time: fmtTime(s.today.projectedExhaustAt) }) }}
          <span v-if="untilExhaust != null && untilExhaust > 0" class="today__projIn">
            · {{ t('spend.exhaustIn', { d: shortDur(untilExhaust) }) }}
          </span>
        </p>
        <p v-else-if="isLive" class="today__proj today__proj--ok">
          <v-icon icon="mdi-check-circle-outline" size="15" /> {{ t('spend.projSafe') }}
        </p>

        <div class="today__runway" :class="{ 'is-low': runwayLow }">
          <span>
            <v-icon icon="mdi-wallet-outline" size="14" />
            {{
              runwayDays != null
                ? t('spend.runwayLine', {
                    bal: cr(s.runway.walletBalance.credits),
                    days: n(runwayDays, { maximumFractionDigits: 1 }),
                  })
                : t('spend.runwayLineShort', { bal: cr(s.runway.walletBalance.credits) })
            }}
          </span>
          <v-btn
            v-if="runwayLow"
            size="x-small"
            color="primary"
            variant="tonal"
            :to="{ name: 'wallet' }"
          >
            {{ t('spend.addCredits') }}
          </v-btn>
        </div>
      </section>

      <!-- One chart, toggled -->
      <section class="card ov__chart">
        <div class="ov__chartHead">
          <h3>{{ t('spend.trendTitle') }}</h3>
          <div class="seg" role="group" :aria-label="t('spend.trendTitle')">
            <button
              type="button"
              :class="{ 'is-on': chartMode === 'clicks' }"
              @click="chartMode = 'clicks'"
            >
              {{ t('spend.legendClicks') }}
            </button>
            <button
              type="button"
              :class="{ 'is-on': chartMode === 'spend' }"
              @click="chartMode = 'spend'"
            >
              {{ t('spend.legendSpend') }}
            </button>
          </div>
        </div>
        <TrendChart :labels="chart.labels" :series="chart.series" />
      </section>

      <!-- Lifetime strip -->
      <section class="ov__life">
        <p class="ov__lifeTitle">{{ t('spend.lifetimeTitle') }}</p>
        <div class="ov__lifeGrid">
          <div v-for="l in lifetime" :key="l.k" class="lf">
            <span class="lf__k">{{ t('spend.' + l.k) }}</span>
            <strong class="lf__v">{{ l.v }}</strong>
            <span v-if="l.x" class="lf__x">{{ l.x }}</span>
          </div>
        </div>
      </section>

      <!-- Daily history (folded) -->
      <details v-if="tableRows.length" class="ov__fold">
        <summary>
          <v-icon icon="mdi-chevron-right" size="18" class="ov__foldChevron" />
          {{ t('spend.histToggle', { n: tableRows.length }) }}
        </summary>
        <div class="ov__foldBody ov__table">
          <table>
            <thead>
              <tr>
                <th>{{ t('spend.colDay') }}</th>
                <th class="num">{{ t('spend.colClicks') }}</th>
                <th class="num">{{ t('spend.colSpend') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in tableRows" :key="p.date">
                <td>{{ p.date.slice(5) }}</td>
                <td class="num">{{ p.clicks }}</td>
                <td class="num">{{ n(p.spent, { maximumFractionDigits: 2 }) }}</td>
                <td>
                  <span v-if="p.capped" class="capchip">{{ t('spend.capYes') }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <!-- Insights -->
      <section v-if="s.insights.length" class="card ov__insights">
        <h3>{{ t('spend.insightsTitle') }}</h3>
        <p v-for="ins in s.insights.slice(0, 2)" :key="ins.key" class="insight">
          <v-icon icon="mdi-lightbulb-on-outline" size="15" />
          {{ t('spend.insight.' + ins.key, { n: ins.value }) }}
        </p>
      </section>

      <!-- Danger zone: delete the campaign -->
      <section class="ov__danger">
        <div>
          <strong>{{ t('spend.deleteTitle') }}</strong>
          <p>{{ t('spend.deleteDangerNote') }}</p>
        </div>
        <v-btn
          variant="tonal"
          color="error"
          size="small"
          prepend-icon="mdi-trash-can-outline"
          @click="showDeleteDialog = true"
        >
          {{ t('spend.deleteBtn') }}
        </v-btn>
      </section>
    </template>

    <v-dialog v-model="showDeleteDialog" max-width="420">
      <v-card>
        <v-card-title class="text-h6">{{ t('spend.deleteConfirmTitle') }}</v-card-title>
        <v-card-text>{{ t('spend.deleteConfirmText') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="busy" @click="showDeleteDialog = false">
            {{ t('spend.deleteKeep') }}
          </v-btn>
          <v-btn color="error" variant="flat" :loading="busy" @click="removeCampaign">
            {{ t('spend.deleteConfirmCta') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showPauseDialog" max-width="420">
      <v-card>
        <v-card-title class="text-h6">{{ t('campaign.pauseConfirmTitle') }}</v-card-title>
        <v-card-text>{{ t('campaign.pauseConfirmText') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="busy" @click="showPauseDialog = false">
            {{ t('campaign.pauseKeep') }}
          </v-btn>
          <v-btn color="warning" variant="flat" :loading="busy" @click="stop">
            {{ t('campaign.pause') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.ov {
  max-width: 680px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.ov__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.ov__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.ov__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin: 0 0 0.3rem;
}
.ov__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.ov__error {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: rgb(var(--v-theme-error));
  font-size: 0.85rem;
}
.ov__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.4rem;
  padding: 3rem 1rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.ov__empty p {
  margin: 0.4rem 0 0;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.8);
}
.ov__empty span {
  font-size: 0.85rem;
}

.card {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 1.2rem 1.3rem;
}
.card h3 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.92rem;
  font-weight: 600;
  margin: 0 0 0.9rem;
}

/* Control bar ------------------------------------------------------- */
.ov__control {
  margin-bottom: 1rem;
}
.ov__controlTop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.ctl__chips {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.chip {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
  color: rgb(var(--v-theme-on-surface) / 0.65);
}
.chip--success {
  background: rgb(var(--v-theme-success) / 0.16);
  color: rgb(var(--v-theme-success));
}
.chip--warning {
  background: rgb(var(--v-theme-warning) / 0.16);
  color: rgb(var(--v-theme-warning));
}
.chip--error {
  background: rgb(var(--v-theme-error) / 0.16);
  color: rgb(var(--v-theme-error));
}
.chip--auto {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: rgb(var(--v-theme-primary) / 0.14);
  color: rgb(var(--v-theme-primary));
}
.ov__controlLinks {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-top: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--tvz-hairline);
}
.ctl__err {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.7rem 0 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-error));
}

/* Banners -------------------------------------------------------- */
.ov__banner {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.85rem 1rem;
  border-radius: var(--tvz-radius-md);
  margin-bottom: 1rem;
}
.ov__banner > .v-icon {
  flex: none;
}
.ov__banner > div {
  flex: 1;
  min-width: 0;
}
.ov__banner strong {
  font-size: 0.9rem;
}
.ov__banner p {
  margin: 0.1rem 0 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.ov__banner--ai {
  background: var(--tvz-ai-soft);
  border: 1px solid rgb(var(--v-theme-primary) / 0.35);
}
.ov__banner--ai > .v-icon {
  color: rgb(var(--v-theme-primary));
}
.ov__banner--warn {
  background: rgb(var(--v-theme-warning) / 0.12);
  border: 1px solid rgb(var(--v-theme-warning) / 0.4);
}
.ov__banner--warn > .v-icon {
  color: rgb(var(--v-theme-warning));
}
.ov__banner--danger {
  background: rgb(var(--v-theme-error) / 0.1);
  border: 1px solid rgb(var(--v-theme-error) / 0.4);
}
.ov__banner--danger > .v-icon {
  color: rgb(var(--v-theme-error));
}

/* Danger zone ----------------------------------------------------- */
.ov__danger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 1.25rem;
  padding: 0.9rem 1.1rem;
  border: 1px solid rgb(var(--v-theme-error) / 0.3);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-error) / 0.04);
}
.ov__danger strong {
  font-size: 0.86rem;
}
.ov__danger p {
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}

/* Principal info ---------------------------------------------------- */
.ov__key {
  display: grid;
  grid-template-columns: 1.15fr 2fr;
  gap: 0.7rem;
  margin-bottom: 1rem;
}
.khero {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 1rem 1.1rem;
  border-radius: 14px;
  background: rgb(var(--v-theme-primary) / 0.1);
  border: 1px solid rgb(var(--v-theme-primary) / 0.3);
}
.khero__k {
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-primary));
  font-weight: 700;
}
.khero__v {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 2.6rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
  margin: 0.2rem 0;
  color: rgb(var(--v-theme-primary));
  font-variant-numeric: tabular-nums;
}
.khero__x {
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.ktiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.6rem;
}
.kt {
  padding: 0.7rem 0.8rem;
  border-radius: 12px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
}
.kt__k {
  display: block;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.kt__v {
  display: block;
  margin-top: 0.2rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}
.kt__x {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.68rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

/* Today ---------------------------------------------------------- */
.ov__today {
  margin-bottom: 1rem;
}
.today__label {
  margin: 0;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.today__big {
  margin: 0.3rem 0 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 1.7rem;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.today__slash {
  font-size: 0.95rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.today__pct {
  font-size: 0.95rem;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  margin-left: 0.5rem;
}
.today__pct.is-full {
  color: rgb(var(--v-theme-error));
}
.today__eq {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.today__eqSep {
  margin: 0 0.15rem;
  opacity: 0.5;
}
.today__track {
  height: 8px;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.1);
  overflow: hidden;
  margin: 0.8rem 0 0;
}
.today__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: rgb(var(--v-theme-primary));
  transition: width var(--tvz-dur-med, 0.3s) var(--tvz-ease-out, ease);
}
.today__fill.is-full {
  background: rgb(var(--v-theme-error));
}
.today__proj {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin: 0.9rem 0 0;
  font-size: 0.83rem;
  font-weight: 600;
}
.today__proj--bad {
  color: rgb(var(--v-theme-error));
}
.today__proj--warn {
  color: rgb(var(--v-theme-warning));
}
.today__proj--ok {
  color: rgb(var(--v-theme-success));
}
.today__projIn {
  font-weight: 400;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.today__runway {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 0.9rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--tvz-hairline);
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.75);
}
.today__runway.is-low {
  color: rgb(var(--v-theme-warning));
  font-weight: 600;
}

/* Chart ------------------------------------------------------------- */
.ov__chart {
  margin-bottom: 1rem;
}
.ov__chartHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
}
.ov__chartHead h3 {
  margin: 0;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 999px;
  overflow: hidden;
}
.seg button {
  padding: 0.3rem 0.85rem;
  font-size: 0.76rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.seg button + button {
  border-left: 1px solid var(--tvz-glass-border);
}
.seg button.is-on {
  background: rgb(var(--v-theme-primary) / 0.14);
  color: rgb(var(--v-theme-primary));
}

/* Lifetime -------------------------------------------------------------- */
.ov__life {
  margin-bottom: 1rem;
}
.ov__lifeTitle {
  margin: 0 0 0.5rem;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.ov__lifeGrid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.6rem;
}
.lf {
  padding: 0.7rem 0.8rem;
  border-radius: 12px;
  border: 1px solid var(--tvz-hairline);
}
.lf__k {
  display: block;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.lf__v {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
}
.lf__x {
  display: block;
  font-size: 0.7rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

/* Folds ------------------------------------------------------------- */
.ov__fold {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  margin-bottom: 1rem;
}
.ov__fold summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.9rem 1.1rem;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}
.ov__fold summary::-webkit-details-marker {
  display: none;
}
.ov__foldChevron {
  transition: transform var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.ov__fold[open] .ov__foldChevron {
  transform: rotate(90deg);
}
.ov__foldBody {
  padding: 0 1.1rem 1.1rem;
}

.ov__table {
  overflow-x: auto;
}
.ov__table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.ov__table th {
  text-align: left;
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  padding: 0 0.5rem 0.4rem;
}
.ov__table td {
  padding: 0.42rem 0.5rem;
  border-top: 1px solid var(--tvz-hairline);
}
.ov__table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.capchip {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-warning) / 0.16);
  color: rgb(var(--v-theme-warning));
}

.ov__insights {
  margin-bottom: 1rem;
}
.ov__insights .insight {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  margin: 0 0 0.5rem;
  font-size: 0.86rem;
  color: rgb(var(--v-theme-on-surface) / 0.82);
}
.ov__insights .insight:last-child {
  margin-bottom: 0;
}

@media (max-width: 620px) {
  .ov__key {
    grid-template-columns: 1fr;
  }
  .ov__lifeGrid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 420px) {
  .ktiles {
    grid-template-columns: 1fr;
  }
}
</style>
