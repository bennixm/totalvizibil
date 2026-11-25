<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import { dateTime } from '@/components/ads/format'
import { ApiError } from '@/services/api'
import { adminGoogleAdsUserApi, type AdminAllCampaigns } from '@/services/googleAdsUser'

/** Every customer's Google Ads campaign; a row opens it on its owner's page. */
const { t, locale } = useI18n()

const filters = reactive({ search: '', status: '', problem: false, page: 1 })
const data = ref<AdminAllCampaigns | null>(null)
const error = ref('')
const loading = ref(false)
let seq = 0

const statusItems = computed(() => [
  { value: '', title: t('adminAdsOpt.anyStatus') },
  ...(['active', 'paused', 'disconnected'] as const).map((v) => ({ value: v, title: t(`ads.campaignStatus.${v}`) })),
])

async function load(): Promise<void> {
  const mine = ++seq
  loading.value = true
  try {
    const res = await adminGoogleAdsUserApi.campaigns(filters)
    if (mine !== seq) return
    data.value = res
    error.value = ''
  } catch (e) {
    if (mine === seq) error.value = e instanceof ApiError ? e.message : t('admin.genericError')
  } finally {
    if (mine === seq) loading.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => filters.search,
  () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      filters.page = 1
      void load()
    }, 300)
  },
)
watch([() => filters.status, () => filters.problem], () => {
  filters.page = 1
  void load()
})
function go(page: number): void {
  filters.page = page
  void load()
}
onMounted(load)

const tone = (s: string) => (s === 'active' ? 'success' : s === 'paused' ? 'neutral' : 'error')
</script>

<template>
  <div>
    <div class="aac__filters">
      <v-text-field
        v-model="filters.search"
        :placeholder="t('adminAdsOpt.searchCampaigns')"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        hide-details
        class="aac__search"
      />
      <v-select v-model="filters.status" :items="statusItems" variant="outlined" density="compact" hide-details class="aac__sel" />
      <v-checkbox v-model="filters.problem" :label="t('adminAdsOpt.onlyProblems')" density="compact" hide-details color="primary" />
    </div>

    <AdminSection>
      <div v-if="loading && !data" class="aac__center"><v-progress-circular indeterminate color="primary" /></div>
      <AdminEmptyState v-else-if="error" icon="mdi-alert-circle-outline" :text="error" />
      <AdminEmptyState v-else-if="!data?.items.length" icon="mdi-google-ads" :text="t('adminAdsOpt.noCampaigns')" />
      <ul v-else class="aac__list">
        <li v-for="c in data.items" :key="c.id">
          <RouterLink :to="{ name: 'admin-user', params: { id: c.user.id }, query: { tab: 'google-ads', ads: c.id } }" class="aac__row">
            <span class="aac__main">
              <b>{{ c.name }}</b>
              <small>{{ c.user.name }} · {{ c.user.email }}</small>
              <small>{{ c.customerName ?? c.customerId }}<template v-if="c.googleEmail"> · {{ c.googleEmail }}</template></small>
            </span>
            <span class="aac__side">
              <span class="aac__chips">
                <span v-if="c.score != null" class="aac__score">{{ c.score }}/100</span>
                <GaChip v-if="c.pendingApprovals" tone="warning">{{ t('ads.list.approve', { n: c.pendingApprovals }) }}</GaChip>
                <GaChip v-if="c.lastCycle?.status === 'failed'" tone="error">{{ t('ads.cycle.failed') }}</GaChip>
                <GaChip :tone="tone(c.status)">{{ t(`ads.campaignStatus.${c.status}`) }}</GaChip>
              </span>
              <small>{{ c.lastCycle ? t('adminAdsOpt.lastCycle', { when: dateTime(c.lastCycle.startedAt, locale) }) : t('adminAdsOpt.noCycle') }}</small>
              <small v-if="c.lastError || c.lastCycle?.errorMessage" class="aac__err">{{ c.lastError || c.lastCycle?.errorMessage }}</small>
            </span>
            <v-icon icon="mdi-chevron-right" size="18" class="aac__go" />
          </RouterLink>
        </li>
      </ul>
      <AdminPager v-if="data" :page="data.page" :page-size="data.pageSize" :total="data.total" @update:page="go" />
    </AdminSection>
  </div>
</template>

<style scoped>
.aac__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
}
.aac__search {
  flex: 1 1 240px;
}
.aac__sel {
  flex: 0 1 200px;
}
.aac__center {
  display: grid;
  place-items: center;
  min-height: 160px;
}
.aac__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.aac__list li + li {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.aac__row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.8rem 0.2rem;
  color: inherit;
  text-decoration: none;
}
.aac__row:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.aac__main,
.aac__side {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.aac__main {
  flex: 1;
}
.aac__main b,
.aac__main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aac__side {
  flex: 0 1 50%;
  align-items: flex-end;
  text-align: right;
}
.aac__row small {
  font-size: var(--tvz-fs-xs, 0.78rem);
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.aac__row .aac__err {
  color: rgb(var(--v-theme-error));
  overflow-wrap: anywhere;
}
.aac__chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.35rem;
}
.aac__score {
  font-weight: 600;
}
.aac__go {
  flex: none;
  opacity: 0.5;
}
@media (max-width: 640px) {
  .aac__row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .aac__side {
    align-items: flex-start;
    text-align: left;
  }
  .aac__chips {
    justify-content: flex-start;
  }
  .aac__go {
    display: none;
  }
}
</style>
