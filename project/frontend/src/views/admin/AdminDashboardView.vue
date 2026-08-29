<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAdminStore } from '@/stores/admin'

const { t } = useI18n()
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

const userCards = computed(() => {
  if (!s.value) return []
  const u = s.value.users
  return [
    { key: 'usersTotal', value: u.total, icon: 'mdi-account-multiple', sub: t('admin.new30', { n: u.new30d }) },
    { key: 'usersActive', value: u.active, icon: 'mdi-account-check-outline', tone: 'success' },
    { key: 'usersSuspended', value: u.suspended, icon: 'mdi-account-cancel-outline', tone: u.suspended ? 'error' : undefined },
    { key: 'users2fa', value: u.withTwoFactor, icon: 'mdi-shield-check-outline' },
    { key: 'usersStaff', value: u.staff, icon: 'mdi-shield-crown-outline', tone: 'primary' },
    { key: 'sessions', value: s.value.activeSessions, icon: 'mdi-devices' },
  ]
})

const companyCards = computed(() => {
  if (!s.value) return []
  const c = s.value.companies
  return [
    { key: 'coTotal', value: c.total, icon: 'mdi-domain', sub: t('admin.new30', { n: c.new30d }) },
    { key: 'coActive', value: c.active, icon: 'mdi-check-decagram-outline', tone: 'success' },
    { key: 'coDraft', value: c.draft, icon: 'mdi-file-outline' },
    { key: 'coWebsites', value: c.websitesPublished, icon: 'mdi-web' },
  ]
})

const maxSignup = computed(() =>
  Math.max(1, ...(s.value?.signups ?? []).map((d) => d.users + d.companies)),
)
</script>

<template>
  <div class="dash">
    <header class="dash__head">
      <h1>{{ t('admin.navDashboard') }}</h1>
      <span v-if="s" class="dash__ts">{{ t('admin.updated') }} {{ new Date(s.generatedAt).toLocaleTimeString() }}</span>
    </header>

    <div v-if="loading" class="d-flex justify-center py-16">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="s">
      <h2 class="dash__group">{{ t('admin.groupUsers') }}</h2>
      <div class="dash__grid">
        <div v-for="c in userCards" :key="c.key" class="stat">
          <v-icon :icon="c.icon" size="20" :color="c.tone" />
          <div class="stat__value">{{ c.value }}</div>
          <div class="stat__label">{{ t(`admin.stat.${c.key}`) }}</div>
          <div v-if="c.sub" class="stat__sub">{{ c.sub }}</div>
        </div>
      </div>

      <h2 class="dash__group">{{ t('admin.groupCompanies') }}</h2>
      <div class="dash__grid">
        <div v-for="c in companyCards" :key="c.key" class="stat">
          <v-icon :icon="c.icon" size="20" :color="c.tone" />
          <div class="stat__value">{{ c.value }}</div>
          <div class="stat__label">{{ t(`admin.stat.${c.key}`) }}</div>
          <div v-if="c.sub" class="stat__sub">{{ c.sub }}</div>
        </div>
      </div>

      <div class="dash__row">
        <section class="panel">
          <h3>{{ t('admin.signups14') }}</h3>
          <div class="chart">
            <div v-for="d in s.signups" :key="d.date" class="chart__col" :title="`${d.date}: ${d.users} users, ${d.companies} companies`">
              <div class="chart__bars">
                <span class="chart__bar chart__bar--u" :style="{ height: (d.users / maxSignup) * 100 + '%' }" />
                <span class="chart__bar chart__bar--c" :style="{ height: (d.companies / maxSignup) * 100 + '%' }" />
              </div>
              <span class="chart__x">{{ d.date.slice(8) }}</span>
            </div>
          </div>
          <div class="chart__legend">
            <span><i class="dot dot--u" /> {{ t('admin.legendUsers') }}</span>
            <span><i class="dot dot--c" /> {{ t('admin.legendCompanies') }}</span>
          </div>
        </section>

        <section class="panel">
          <h3>{{ t('admin.byCountry') }}</h3>
          <ul class="bars">
            <li v-for="row in s.companies.byCountry" :key="row.country">
              <span class="bars__k">{{ row.country }}</span>
              <span class="bars__track">
                <span
                  class="bars__fill"
                  :style="{ width: (row.count / s.companies.total) * 100 + '%' }"
                />
              </span>
              <span class="bars__v">{{ row.count }}</span>
            </li>
          </ul>
        </section>
      </div>

      <section class="panel panel--muted">
        <h3><v-icon icon="mdi-progress-question" size="18" /> {{ t('admin.listingsTitle') }}</h3>
        <p>{{ s.listings.note }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dash__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.dash__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.4rem, 3.5vw, 1.9rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.dash__ts {
  font-size: 0.75rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  font-variant-numeric: tabular-nums;
}
.dash__group {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  margin: 1.6rem 0 0.8rem;
}
.dash__grid {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}
.stat {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 1rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.stat__value {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 1.6rem;
  letter-spacing: -0.02em;
  margin-top: 0.4rem;
  font-variant-numeric: tabular-nums;
}
.stat__label {
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.62);
}
.stat__sub {
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.dash__row {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1.4fr 1fr;
  margin-top: 1.6rem;
}
@media (max-width: 900px) {
  .dash__row {
    grid-template-columns: 1fr;
  }
}
.panel {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 1.2rem 1.3rem;
}
.panel h3 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 1rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.panel--muted {
  margin-top: 1rem;
  background: rgb(var(--v-theme-on-surface) / 0.03);
}
.panel--muted p {
  margin: 0;
  font-size: 0.86rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.chart {
  display: flex;
  align-items: flex-end;
  gap: 0.35rem;
  height: 130px;
}
.chart__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  height: 100%;
}
.chart__bars {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
}
.chart__bar {
  width: 8px;
  min-height: 2px;
  border-radius: 2px 2px 0 0;
}
.chart__bar--u {
  background: rgb(var(--v-theme-primary));
}
.chart__bar--c {
  background: rgb(var(--v-theme-secondary));
}
.chart__x {
  font-size: 0.62rem;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  font-variant-numeric: tabular-nums;
}
.chart__legend {
  display: flex;
  gap: 1rem;
  margin-top: 0.8rem;
  font-size: 0.75rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 0.3rem;
}
.dot--u {
  background: rgb(var(--v-theme-primary));
}
.dot--c {
  background: rgb(var(--v-theme-secondary));
}
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.bars li {
  display: grid;
  grid-template-columns: 3rem 1fr 2rem;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.85rem;
}
.bars__track {
  height: 8px;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
  overflow: hidden;
}
.bars__fill {
  display: block;
  height: 100%;
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
}
.bars__v {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
</style>
