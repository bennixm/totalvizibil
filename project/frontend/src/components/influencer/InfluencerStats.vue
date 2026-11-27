<script setup lang="ts">
/**
 * An influencer's numbers, the same block in two places: the influencer's
 * own read-only panel and Admin › Influenceri › detail. KPIs, a 6-month
 * performance chart, and the users / deposits / commissions lists.
 * `adminLinks` turns names into links to the admin user page (admin only;
 * the influencer gets masked emails from the API and plain names).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import TrendChart from '@/components/TrendChart.vue'
import type { InfluencerStats } from '@/services/influencers'
import { uiLocale } from '@/plugins/i18n'

const props = defineProps<{ stats: InfluencerStats; adminLinks?: boolean }>()
const { t, n } = useI18n()

const tab = ref<'users' | 'deposits' | 'commissions'>('users')

function eur(minor: number): string {
  return '€' + n(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function cr(minor: number): string {
  return n(minor / 100, { maximumFractionDigits: 2 })
}
function day(iso: string): string {
  return new Date(iso).toLocaleDateString(uiLocale())
}

const chart = computed(() => ({
  labels: props.stats.months.map((m) =>
    new Date(`${m.month}-01T00:00:00`).toLocaleDateString(uiLocale(), { month: 'short', year: '2-digit' }),
  ),
  series: [
    { label: t('influencer.chartSignups'), values: props.stats.months.map((m) => m.signups) },
    { label: t('influencer.chartFirstDeposits'), values: props.stats.months.map((m) => m.firstDeposits) },
  ],
}))
const hasActivity = computed(() => props.stats.months.some((m) => m.signups || m.firstDeposits))
</script>

<template>
  <div class="ist">
    <div class="ist__kpis">
      <AdminStatCard
        :label="t('influencer.kpiUsers')"
        :value="n(stats.totals.users)"
        icon="mdi-account-multiple-outline"
        :hint="t('influencer.kpiUsersHint')"
      />
      <AdminStatCard
        :label="t('influencer.kpiDepositors')"
        :value="n(stats.totals.depositors)"
        icon="mdi-account-cash-outline"
        :sub="t('influencer.kpiConversion', { pct: stats.totals.conversionPct })"
      />
      <AdminStatCard
        :label="t('influencer.kpiDeposits')"
        :value="eur(stats.totals.depositsPaid.minor)"
        icon="mdi-cash-multiple"
        :sub="t('influencer.kpiDepositsSub', { n: stats.totals.deposits })"
        :hint="t('influencer.kpiDepositsHint')"
      />
      <AdminStatCard
        :label="t('influencer.kpiRevenue')"
        :value="eur(stats.totals.firstDepositsPaid.minor)"
        icon="mdi-chart-line"
        :hint="t('influencer.kpiRevenueHint')"
      />
      <AdminStatCard
        :label="t('influencer.kpiCommissions')"
        :value="cr(stats.totals.commissions.minor)"
        value-is-credits
        icon="mdi-gift-outline"
        tone="success"
        :hint="t('influencer.kpiCommissionsHint')"
      />
    </div>

    <AdminSection :title="t('influencer.performanceTitle')" icon="mdi-chart-areaspline">
      <TrendChart v-if="hasActivity" :labels="chart.labels" :series="chart.series" />
      <AdminEmptyState v-else icon="mdi-chart-line-variant" :text="t('influencer.noActivity')" />
    </AdminSection>

    <v-tabs v-model="tab" color="primary" class="ist__tabs" show-arrows>
      <v-tab value="users" prepend-icon="mdi-account-multiple-outline">
        {{ t('influencer.tabUsers') }} ({{ stats.users.length }})
      </v-tab>
      <v-tab value="deposits" prepend-icon="mdi-cash-multiple">
        {{ t('influencer.tabDeposits') }} ({{ stats.deposits.length }})
      </v-tab>
      <v-tab value="commissions" prepend-icon="mdi-gift-outline">
        {{ t('influencer.tabCommissions') }} ({{ stats.commissions.length }})
      </v-tab>
    </v-tabs>

    <!-- Users who used the code -->
    <template v-if="tab === 'users'">
      <AdminEmptyState v-if="!stats.users.length" icon="mdi-account-search-outline" :text="t('influencer.noUsers')" />
      <div v-else class="itable itable--users">
        <div class="itable__head" aria-hidden="true">
          <span>{{ t('influencer.colUser') }}</span>
          <span>{{ t('influencer.colJoined') }}</span>
          <span class="num">{{ t('influencer.colDeposits') }}</span>
          <span class="num">{{ t('influencer.colPaid') }}</span>
          <span class="num">{{ t('influencer.colCommission') }}</span>
        </div>
        <ul class="itable__list">
          <li v-for="u in stats.users" :key="u.id" class="irow">
            <span class="irow__person">
              <router-link v-if="adminLinks" :to="{ name: 'admin-user', params: { id: u.id } }" class="irow__name">
                {{ u.name }}
              </router-link>
              <span v-else class="irow__name">{{ u.name }}</span>
              <span class="irow__sub">{{ u.email }}</span>
            </span>
            <span class="irow__cell" :data-label="t('influencer.colJoined')">{{ day(u.joinedAt) }}</span>
            <span class="irow__cell num" :data-label="t('influencer.colDeposits')">{{ n(u.deposits) }}</span>
            <span class="irow__cell num" :data-label="t('influencer.colPaid')">{{ eur(u.depositsPaid.minor) }}</span>
            <span class="irow__cell num" :data-label="t('influencer.colCommission')">
              <b v-if="u.commission">{{ cr(u.commission.minor) }} cr</b>
              <span v-else class="irow__muted">{{ t('influencer.noDepositYet') }}</span>
            </span>
          </li>
        </ul>
      </div>
    </template>

    <!-- Deposits made by those users -->
    <template v-else-if="tab === 'deposits'">
      <AdminEmptyState v-if="!stats.deposits.length" icon="mdi-cash-remove" :text="t('influencer.noDeposits')" />
      <div v-else class="itable itable--deposits">
        <div class="itable__head" aria-hidden="true">
          <span>{{ t('influencer.colUser') }}</span>
          <span>{{ t('influencer.colDate') }}</span>
          <span class="num">{{ t('influencer.colPaid') }}</span>
          <span class="num">{{ t('influencer.colCredits') }}</span>
          <span class="num">{{ t('influencer.colDiscount') }}</span>
        </div>
        <ul class="itable__list">
          <li v-for="d in stats.deposits" :key="d.id" class="irow">
            <span class="irow__person">
              <span class="irow__name">{{ d.userName ?? stats.users.find((u) => u.id === d.userId)?.name ?? '-' }}</span>
              <span v-if="d.first" class="irow__tag">{{ t('influencer.firstDeposit') }}</span>
            </span>
            <span class="irow__cell" :data-label="t('influencer.colDate')">{{ day(d.createdAt) }}</span>
            <span class="irow__cell num" :data-label="t('influencer.colPaid')">{{ eur(d.paid.minor) }}</span>
            <span class="irow__cell num" :data-label="t('influencer.colCredits')">{{ cr(d.credits.minor) }}</span>
            <span class="irow__cell num" :data-label="t('influencer.colDiscount')">
              {{ d.discountPct ? `-${d.discountPct}%` : '-' }}
            </span>
          </li>
        </ul>
      </div>
    </template>

    <!-- Commissions earned -->
    <template v-else>
      <AdminEmptyState v-if="!stats.commissions.length" icon="mdi-gift-off-outline" :text="t('influencer.noCommissions')" />
      <div v-else class="itable itable--commissions">
        <div class="itable__head" aria-hidden="true">
          <span>{{ t('influencer.colUser') }}</span>
          <span>{{ t('influencer.colDate') }}</span>
          <span class="num">{{ t('influencer.colFirstDeposit') }}</span>
          <span class="num">{{ t('influencer.colRate') }}</span>
          <span class="num">{{ t('influencer.colCommission') }}</span>
        </div>
        <ul class="itable__list">
          <li v-for="c in stats.commissions" :key="c.id" class="irow">
            <span class="irow__person">
              <span class="irow__name">{{ c.userName ?? stats.users.find((u) => u.id === c.userId)?.name ?? '-' }}</span>
            </span>
            <span class="irow__cell" :data-label="t('influencer.colDate')">{{ day(c.createdAt) }}</span>
            <span class="irow__cell num" :data-label="t('influencer.colFirstDeposit')">{{ eur(c.depositPaid.minor) }}</span>
            <span class="irow__cell num" :data-label="t('influencer.colRate')">{{ c.commissionPct }}%</span>
            <span class="irow__cell num" :data-label="t('influencer.colCommission')">
              <b>{{ cr(c.commission.minor) }} cr</b>
            </span>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ist__kpis {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.7rem;
  margin-bottom: 1.2rem;
}
@media (max-width: 1100px) {
  .ist__kpis {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .ist__kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.ist__tabs {
  margin: 1.4rem 0 0.9rem;
  border-bottom: 1px solid var(--tvz-hairline);
}

.itable {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
}
.itable__head,
.irow {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 0.9fr) minmax(0, 0.7fr) minmax(0, 0.9fr) minmax(0, 0.9fr);
  gap: 1rem;
  align-items: center;
}
.itable__head {
  padding: 0.65rem 1.1rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-bottom: 1px solid var(--tvz-hairline);
}
.itable__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.irow {
  padding: 0.7rem 1.1rem;
  border-bottom: 1px solid var(--tvz-hairline);
  font-size: var(--tvz-fs-small);
}
.irow:last-child {
  border-bottom: none;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.irow__person {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.irow__name {
  font-weight: 600;
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
a.irow__name {
  color: rgb(var(--v-theme-primary));
}
.irow__sub {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.irow__tag {
  align-self: flex-start;
  margin-top: 0.2rem;
  padding: 0.05rem 0.45rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 600;
  clip-path: var(--tvz-hex-xs);
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}
.irow__muted {
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* Phone: rows become labelled cards. */
@media (max-width: 640px) {
  .itable__head {
    display: none;
  }
  .irow {
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem 1rem;
  }
  .irow__person {
    grid-column: 1 / -1;
  }
  .irow__cell::before {
    content: attr(data-label);
    display: block;
    font-size: var(--tvz-fs-micro);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(var(--v-theme-on-surface), 0.45);
  }
  .num {
    text-align: left;
  }
}
</style>
