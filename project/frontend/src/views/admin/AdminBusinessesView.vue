<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import { useAdminStore } from '@/stores/admin'
import type { BusinessStatus, CampaignFilter } from '@/stores/admin'
import type { LocalizedName } from '@/stores/companies'

const { t, n, locale } = useI18n()
const router = useRouter()
const admin = useAdminStore()

const search = ref(admin.businessFilters.search)
let deb: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(deb)
  deb = setTimeout(() => admin.setBusinessFilter('search', v), 300)
})

const statusItems = computed(() => [
  { value: null, title: t('admin.filterAnyStatus') },
  { value: 'active', title: t('dashboard.statusActive') },
  { value: 'draft', title: t('dashboard.statusDraft') },
  { value: 'suspended', title: t('dashboard.statusSuspended') },
])
const campaignItems = computed(() => [
  { value: null, title: t('adminBiz.anyCampaign') },
  { value: 'active', title: t('admin.camp_active') },
  { value: 'paused', title: t('admin.camp_paused') },
  { value: 'depleted', title: t('admin.camp_depleted') },
  { value: 'draft', title: t('admin.camp_draft') },
  { value: 'none', title: t('adminBiz.noCampaign') },
])

const bizTone: Record<string, string> = { active: 'ok', suspended: 'err', draft: '' }
const campTone: Record<string, string> = {
  active: 'ok',
  paused: 'warn',
  depleted: 'err',
  draft: '',
}
function nm(x: LocalizedName | null): string {
  if (!x) return '—'
  return x[locale.value as keyof LocalizedName] ?? x.en ?? '—'
}
function cr(v: number) {
  return n(v, { maximumFractionDigits: v >= 100 ? 0 : 2 })
}

onMounted(() => admin.fetchBusinesses())

function open(id: string): void {
  void router.push({ name: 'admin-company', params: { id } })
}
</script>

<template>
  <div class="ab">
    <AdminPageHeader
      :title="t('admin.navBusinesses')"
      :eyebrow="t('admin.navGroupManage')"
      :count="admin.businessesTotal"
      :sub="t('adminBiz.lead')"
    />

    <div class="ab__filters">
      <v-text-field
        v-model="search"
        :placeholder="t('adminBiz.searchPlaceholder')"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        class="ab__search"
      />
      <v-select
        :model-value="admin.businessFilters.status"
        :items="statusItems"
        variant="outlined"
        density="compact"
        hide-details
        class="ab__sel"
        @update:model-value="admin.setBusinessFilter('status', $event as BusinessStatus | null)"
      />
      <v-select
        :model-value="admin.businessFilters.campaign"
        :items="campaignItems"
        variant="outlined"
        density="compact"
        hide-details
        class="ab__sel"
        @update:model-value="admin.setBusinessFilter('campaign', $event as CampaignFilter | null)"
      />
    </div>

    <div v-if="admin.loadingBusinesses && !admin.businesses.length" class="ab__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <p v-else-if="!admin.businesses.length" class="ab__empty">{{ t('adminBiz.none') }}</p>

    <ul v-else class="ab__list">
      <li
        v-for="b in admin.businesses"
        :key="b.id"
        class="brow"
        :class="`brow--${bizTone[b.status] || 'idle'}`"
        role="button"
        tabindex="0"
        @click="open(b.id)"
        @keydown.enter="open(b.id)"
      >
        <span class="brow__ic"><v-icon icon="mdi-storefront-outline" size="18" /></span>
        <div class="brow__id">
          <span class="brow__name">
            {{ b.displayName }}
            <span class="chip" :class="`chip--${bizTone[b.status] || 'idle'}`">{{
              t(`dashboard.status${b.status.charAt(0).toUpperCase()}${b.status.slice(1)}`)
            }}</span>
          </span>
          <span class="brow__meta">
            /{{ b.slug }}
            <template v-if="b.city"> · {{ b.city }}</template>
            <template v-else-if="b.category"> · {{ nm(b.category) }}</template>
          </span>
          <span class="brow__owner">{{ b.owner.name }} · {{ b.owner.email }}</span>
        </div>

        <div class="brow__mid">
          <template v-if="b.campaign">
            <span class="chip" :class="`chip--${campTone[b.campaign.status] || 'idle'}`">
              {{ t('admin.camp_' + b.campaign.status) }}
            </span>
            <v-icon
              v-if="b.campaign.autoOptimize"
              icon="mdi-robot-outline"
              size="13"
              color="primary"
              :title="t('dashboard.campaignAuto')"
            />
            <span class="brow__budget">
              {{
                t('admin.campBudget', {
                  b: cr(b.campaign.dailyBudget.credits),
                  c: cr(b.campaign.cpc.credits),
                })
              }}
            </span>
          </template>
          <span v-else class="brow__nocamp">{{ t('adminBiz.noCampaign') }}</span>
        </div>

        <div class="brow__stats">
          <span class="brow__stat"><b>{{ b.leadCount }}</b><em>{{ t('adminBiz.colLeads') }}</em></span>
          <span class="brow__stat"><b>{{ b.clickCount }}</b><em>{{ t('adminBiz.colClicks') }}</em></span>
          <span class="brow__stat">
            <b>{{ cr(b.consumed.credits) }} cr</b><em>{{ t('adminBiz.colConsumed') }}</em>
          </span>
        </div>
        <v-icon icon="mdi-chevron-right" size="18" class="brow__chev" />
      </li>
    </ul>

    <AdminPager
      :page="admin.businessFilters.page"
      :page-size="admin.businessFilters.pageSize"
      :total="admin.businessesTotal"
      @update:page="admin.setBusinessFilter('page', $event)"
    />
  </div>
</template>

<style scoped>
.ab__filters {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 1.1rem;
}
.ab__search {
  flex: 1 1 240px;
}
.ab__sel {
  max-width: 12rem;
}
.ab__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.ab__empty {
  padding: 3rem 1rem;
  text-align: center;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.ab__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.brow {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.9rem 1.1rem;
  border: 1px solid var(--tvz-hairline);
  border-left: 3px solid rgb(var(--v-theme-on-surface) / 0.12);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  transition:
    border-color 0.14s cubic-bezier(0.22, 1, 0.36, 1),
    background 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}
.brow--ok {
  border-left-color: rgb(var(--v-theme-success));
}
.brow--err {
  border-left-color: rgb(var(--v-theme-error));
}
.brow:hover,
.brow:focus-visible {
  outline: none;
  border-color: rgb(var(--v-theme-primary) / 0.45);
  background: rgb(var(--v-theme-primary) / 0.03);
}
.brow__ic {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 10px;
  background: rgb(var(--v-theme-on-surface) / 0.06);
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.brow__id {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}
.brow__name {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 600;
  font-size: 0.92rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.brow__meta,
.brow__owner {
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.brow__mid {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  flex: none;
  width: 12rem;
}
.brow__budget {
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.brow__nocamp {
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.4);
}
.brow__stats {
  display: flex;
  align-items: center;
  gap: 1.3rem;
  flex: none;
}
.brow__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  min-width: 3rem;
}
.brow__stat b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.brow__stat em {
  font-style: normal;
  font-size: 0.58rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.brow__chev {
  color: rgb(var(--v-theme-on-surface) / 0.3);
  flex: none;
}

.chip {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.chip--ok {
  background: rgb(var(--v-theme-success) / 0.16);
  color: rgb(var(--v-theme-success));
}
.chip--warn {
  background: rgb(var(--v-theme-warning) / 0.16);
  color: rgb(var(--v-theme-warning));
}
.chip--err {
  background: rgb(var(--v-theme-error) / 0.16);
  color: rgb(var(--v-theme-error));
}

@media (max-width: 1000px) {
  .brow__mid {
    display: none;
  }
}
@media (max-width: 780px) {
  .brow__stats {
    display: none;
  }
}
</style>
