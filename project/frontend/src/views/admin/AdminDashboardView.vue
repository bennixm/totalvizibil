<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import TrendChart from '@/components/TrendChart.vue'
import { useAdminStore } from '@/stores/admin'

const { t, n } = useI18n()
const admin = useAdminStore()
const loading = ref(true)

onMounted(async () => {
  try {
    await admin.fetchStats()
  } finally {
    loading.value = false
  }
})

const s = computed(() => admin.stats)

function int(v: number) {
  return n(v, { maximumFractionDigits: 0 })
}
function cr(v: number) {
  return n(v, { maximumFractionDigits: v >= 100 ? 0 : 2 })
}
function ron(v: number) {
  return n(v, { maximumFractionDigits: 0 }) + ' RON'
}
/** RON equivalent of a credit amount at the live platform rate (1 cr = 1 €). */
function ronEq(credits: number) {
  return '≈ ' + ron(credits * (s.value?.eurRonRate ?? 0))
}

// --- Hero KPIs -------------------------------------------------------------
const heroKpis = computed(() => {
  if (!s.value) return []
  const { users, companies, economy } = s.value
  return [
    {
      key: 'usersTotal',
      value: int(users.total),
      delta: users.new30d,
      tone: 'primary' as const,
      icon: 'mdi-account-multiple-outline',
    },
    {
      key: 'coTotal',
      value: int(companies.total),
      delta: companies.new30d,
      tone: 'primary' as const,
      icon: 'mdi-domain',
    },
    {
      key: 'ecoSold',
      value: cr(economy.creditsSold30d.credits) + ' cr',
      sub: ronEq(economy.creditsSold30d.credits),
      tone: 'success' as const,
      icon: 'mdi-cart-outline',
    },
    {
      key: 'ecoConsumed',
      value: cr(economy.cpcConsumed30d.credits) + ' cr',
      sub: ronEq(economy.cpcConsumed30d.credits),
      tone: 'warning' as const,
      icon: 'mdi-fire',
    },
  ]
})

// --- Compact breakdowns -------------------------------------------------
const userRows = computed(() => {
  if (!s.value) return []
  const u = s.value.users
  return [
    { k: 'usersActive', v: int(u.active), tone: 'success' },
    { k: 'usersSuspended', v: int(u.suspended), tone: u.suspended ? 'error' : '' },
    { k: 'users2fa', v: int(u.withTwoFactor), tone: '' },
    { k: 'usersStaff', v: int(u.staff), tone: 'primary' },
    { k: 'sessions', v: int(s.value.activeSessions), tone: '' },
  ]
})
const companyRows = computed(() => {
  if (!s.value) return []
  const c = s.value.companies
  return [
    { k: 'coActive', v: int(c.active), tone: 'success' },
    { k: 'coDraft', v: int(c.draft), tone: '' },
    { k: 'coSuspended', v: int(c.suspended), tone: c.suspended ? 'error' : '' },
    { k: 'coWebsites', v: int(c.websitesPublished), tone: '' },
  ]
})
const economyRows = computed(() => {
  if (!s.value) return []
  const e = s.value.economy
  const c = s.value.campaigns
  return [
    { k: 'soldAll', v: cr(e.creditsSold.credits) + ' cr', sub: t('admin.stat.allTimeShort') },
    { k: 'revenueAll', v: ron(e.ronCollected), sub: t('admin.stat.allTimeShort') },
    { k: 'ecoCommitted', v: cr(c.committedDailyBudget.credits) + ' cr', sub: t('admin.stat.perDay') },
    { k: 'ecoActive', v: int(c.active), sub: t('admin.stat.autoN', { n: c.autoOptimize }) },
    { k: 'ecoPending', v: int(e.pendingPurchases), sub: '' },
    { k: 'blockedWallets', v: int(e.walletsBlocked), sub: '' },
  ]
})

const campaignMix = computed(() => {
  const c = s.value?.campaigns
  if (!c) return []
  const rows = [
    { k: 'active', v: c.active, color: 'success' },
    { k: 'paused', v: c.paused, color: 'warning' },
    { k: 'depleted', v: c.depleted, color: 'error' },
    { k: 'draft', v: c.draft, color: 'default' },
  ]
  const total = Math.max(1, rows.reduce((a, r) => a + r.v, 0))
  return rows.map((r) => ({ ...r, pct: (r.v / total) * 100 }))
})

const signupChart = computed(() => {
  const days = s.value?.signups ?? []
  return {
    labels: days.map((d) => d.date.slice(5)),
    series: [
      { label: t('admin.legendUsers'), values: days.map((d) => d.users) },
      { label: t('admin.legendCompanies'), values: days.map((d) => d.companies) },
    ],
  }
})
const economyChart = computed(() => {
  const days = s.value?.economySeries ?? []
  return {
    labels: days.map((d) => d.date.slice(5)),
    series: [
      { label: t('admin.legendSold'), values: days.map((d) => Math.round(d.sold)) },
      { label: t('admin.legendConsumed'), values: days.map((d) => Math.round(d.consumed)) },
    ],
  }
})
</script>

<template>
  <div class="adash">
    <AdminPageHeader
      :title="t('admin.navDashboard')"
      :eyebrow="t('admin.navGroupOverview')"
      :sub="s ? t('admin.updated') + ' ' + new Date(s.generatedAt).toLocaleTimeString() : undefined"
    />

    <div v-if="loading" class="d-flex justify-center py-16">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="s">
      <!-- Hero KPIs -->
      <div class="adash__kpis">
        <div v-for="k in heroKpis" :key="k.key" class="kpi" :class="`kpi--${k.tone}`">
          <div class="kpi__head">
            <span class="kpi__label">{{ t('admin.stat.' + k.key) }}</span>
            <span class="kpi__ic"><v-icon :icon="k.icon" size="17" /></span>
          </div>
          <strong class="kpi__value">{{ k.value }}</strong>
          <span v-if="k.delta !== undefined" class="kpi__delta" :class="{ 'is-up': k.delta > 0 }">
            <v-icon :icon="k.delta > 0 ? 'mdi-trending-up' : 'mdi-trending-neutral'" size="14" />
            {{ t('admin.new30', { n: k.delta }) }}
          </span>
          <span v-else-if="k.sub" class="kpi__sub">{{ k.sub }}</span>
        </div>
      </div>

      <!-- Trends -->
      <div class="adash__charts">
        <AdminSection :title="t('admin.signups14')">
          <TrendChart :labels="signupChart.labels" :series="signupChart.series" />
        </AdminSection>
        <AdminSection :title="t('admin.economy14')">
          <TrendChart :labels="economyChart.labels" :series="economyChart.series" />
        </AdminSection>
      </div>

      <!-- At a glance -->
      <h2 class="adash__group">{{ t('admin.groupAtAGlance') }}</h2>
      <div class="adash__cols3">
        <AdminSection :title="t('admin.groupUsers')">
          <ul class="rows">
            <li v-for="r in userRows" :key="r.k">
              <span class="rows__k">{{ t('admin.stat.' + r.k) }}</span>
              <span class="rows__v" :class="r.tone ? `rows__v--${r.tone}` : ''">{{ r.v }}</span>
            </li>
          </ul>
        </AdminSection>

        <AdminSection :title="t('admin.groupCompanies')">
          <ul class="rows">
            <li v-for="r in companyRows" :key="r.k">
              <span class="rows__k">{{ t('admin.stat.' + r.k) }}</span>
              <span class="rows__v" :class="r.tone ? `rows__v--${r.tone}` : ''">{{ r.v }}</span>
            </li>
          </ul>
        </AdminSection>

        <AdminSection :title="t('admin.campaignMix')">
          <div class="seg">
            <span
              v-for="r in campaignMix"
              :key="r.k"
              class="seg__part"
              :class="`seg__part--${r.color}`"
              :style="{ width: r.pct + '%' }"
            />
          </div>
          <ul class="seglegend">
            <li v-for="r in campaignMix" :key="r.k">
              <span class="seglegend__dot" :class="`seg__part--${r.color}`" />
              <span class="seglegend__k">{{ t('admin.camp_' + r.k) }}</span>
              <span class="seglegend__v">{{ r.v }}</span>
            </li>
          </ul>
          <p class="seg__foot">
            {{
              t('admin.campaignActivity', {
                clicks: s.campaigns.clicks30d,
                leads: s.campaigns.leads30d,
              })
            }}
          </p>
        </AdminSection>
      </div>

      <!-- Economy + countries -->
      <div class="adash__cols2">
        <AdminSection :title="t('admin.groupEconomy')">
          <div class="figs">
            <div v-for="r in economyRows" :key="r.k" class="fig">
              <span class="fig__k">{{ t('admin.stat.' + r.k) }}</span>
              <strong class="fig__v">{{ r.v }}</strong>
              <span v-if="r.sub" class="fig__s">{{ r.sub }}</span>
            </div>
          </div>
        </AdminSection>

        <AdminSection :title="t('admin.byCountry')">
          <ul class="bars">
            <li v-for="row in s.companies.byCountry" :key="row.country">
              <span class="bars__k">{{ row.country }}</span>
              <span class="bars__track">
                <span
                  class="bars__fill"
                  :style="{ width: (row.count / Math.max(1, s.companies.total)) * 100 + '%' }"
                />
              </span>
              <span class="bars__v">{{ row.count }}</span>
            </li>
          </ul>
        </AdminSection>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Hero KPIs -------------------------------------------------------------- */
.adash__kpis {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  margin-bottom: 1.5rem;
}
.kpi {
  --acc: var(--v-theme-on-surface);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 1.1rem 1.2rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  border-top: 2px solid rgb(var(--acc) / 0.5);
}
.kpi--primary {
  --acc: var(--v-theme-primary);
}
.kpi--success {
  --acc: var(--v-theme-success);
}
.kpi--warning {
  --acc: var(--v-theme-warning);
}
.kpi__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.kpi__label {
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.kpi__ic {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgb(var(--acc) / 0.12);
  color: rgb(var(--acc));
}
.kpi__value {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 1.85rem;
  letter-spacing: -0.02em;
  margin-top: 0.45rem;
  font-variant-numeric: tabular-nums;
}
.kpi__delta,
.kpi__sub {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.74rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.kpi__delta.is-up {
  color: rgb(var(--v-theme-success));
}

/* Charts --------------------------------------------------------------- */
.adash__charts {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr 1fr;
}
.adash__group {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin: 1.8rem 0 0.85rem;
}
.adash__cols3 {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(3, 1fr);
}
.adash__cols2 {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr 1fr;
  margin-top: 1.5rem;
}
@media (max-width: 1000px) {
  .adash__charts,
  .adash__cols3,
  .adash__cols2 {
    grid-template-columns: 1fr;
  }
}

/* Breakdown rows --------------------------------------------------------- */
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.rows li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem 0;
  font-size: 0.88rem;
}
.rows li + li {
  border-top: 1px solid var(--tvz-hairline);
}
.rows__k {
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.rows__v {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rows__v--success {
  color: rgb(var(--v-theme-success));
}
.rows__v--error {
  color: rgb(var(--v-theme-error));
}
.rows__v--primary {
  color: rgb(var(--v-theme-primary));
}

/* Campaign mix — stacked segmented bar --------------------------------- */
.seg {
  display: flex;
  height: 12px;
  border-radius: 5px;
  overflow: hidden;
  background: rgb(var(--v-theme-on-surface) / 0.06);
}
.seg__part {
  display: block;
  height: 100%;
}
.seg__part--success {
  background: rgb(var(--v-theme-success));
}
.seg__part--warning {
  background: rgb(var(--v-theme-warning));
}
.seg__part--error {
  background: rgb(var(--v-theme-error));
}
.seg__part--default {
  background: rgb(var(--v-theme-on-surface) / 0.28);
}
.seglegend {
  list-style: none;
  margin: 0.9rem 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem 1rem;
}
.seglegend li {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.82rem;
}
.seglegend__dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  flex: none;
}
.seglegend__k {
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.seglegend__v {
  margin-left: auto;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.seg__foot {
  margin: 1rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

/* Economy figures ----------------------------------------------------- */
.figs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.9rem 1rem;
}
.fig {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.fig__k {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.fig__v {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}
.fig__s {
  font-size: 0.7rem;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
@media (max-width: 520px) {
  .figs {
    grid-template-columns: 1fr 1fr;
  }
}

/* Country bars ------------------------------------------------------------- */
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.bars li {
  display: grid;
  grid-template-columns: 3rem 1fr 2.2rem;
  align-items: center;
  gap: 0.7rem;
  font-size: 0.85rem;
}
.bars__track {
  height: 8px;
  border-radius: 4px;
  background: rgb(var(--v-theme-on-surface) / 0.07);
  overflow: hidden;
}
.bars__fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: rgb(var(--v-theme-primary));
}
.bars__v {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
</style>
