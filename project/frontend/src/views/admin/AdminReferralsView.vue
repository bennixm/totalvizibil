<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminFilterChip from '@/components/admin/AdminFilterChip.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import { useAdminStore } from '@/stores/admin'

const { t, n } = useI18n()
const admin = useAdminStore()

function toggleStatus(status: 'pending' | 'rewarded'): void {
  admin.setReferralFilter('status', admin.referralFilters.status === status ? null : status)
}
function cr(v: number): string {
  return n(v, { maximumFractionDigits: 2 })
}
function dt(s: string | null): string {
  return s ? new Date(s).toLocaleDateString() : 'N/A'
}

const hasRows = computed(() => admin.referrals.length > 0)

onMounted(() => admin.fetchReferralsList())
</script>

<template>
  <div class="ar">
    <AdminPageHeader
      :title="t('admin.navReferrals')"
      :eyebrow="t('admin.navGroupManage')"
      :count="admin.referralsTotal"
      :sub="t('adminRef.lead')"
    >
      <template #actions>
        <v-btn
          v-if="hasRows"
          :href="admin.referralsExportUrl()"
          variant="tonal"
          size="small"
          prepend-icon="mdi-file-pdf-box"
        >
          {{ t('transactions.exportPdf') }}
        </v-btn>
      </template>
    </AdminPageHeader>

    <div class="ar__chips">
      <AdminFilterChip
        :label="t('adminRef.total')"
        :value="n(admin.referralsTotal)"
        icon="mdi-account-multiple-plus-outline"
        :active="admin.referralFilters.status === null"
        @click="admin.setReferralFilter('status', null)"
      />
      <AdminFilterChip
        :label="t('adminRef.pending')"
        :value="n(admin.referralsTotal - admin.referralsTotalRewarded)"
        icon="mdi-clock-outline"
        tone="warning"
        :active="admin.referralFilters.status === 'pending'"
        @click="toggleStatus('pending')"
      />
      <AdminFilterChip
        :label="t('adminRef.rewarded')"
        :value="n(admin.referralsTotalRewarded)"
        icon="mdi-check-circle-outline"
        tone="success"
        :active="admin.referralFilters.status === 'rewarded'"
        @click="toggleStatus('rewarded')"
      />
      <AdminFilterChip
        :label="t('adminRef.creditsPaid')"
        :value="cr(admin.referralsCreditsPaid)"
        icon="mdi-poker-chip"
        tone="primary"
      />
    </div>

    <div v-if="admin.loadingReferrals && !hasRows" class="ar__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <AdminEmptyState v-else-if="!hasRows" icon="mdi-account-multiple-plus-outline" :text="t('adminRef.none')" />

    <div v-else class="rtable">
      <div class="rtable__head" aria-hidden="true">
        <span>{{ t('adminRef.colReferrer') }}</span>
        <span>{{ t('adminRef.colReferred') }}</span>
        <span>{{ t('adminRef.colStatus') }}</span>
        <span>{{ t('adminRef.colReward') }}</span>
        <span>{{ t('adminRef.colDate') }}</span>
      </div>

      <ul class="ar__list">
        <li v-for="r in admin.referrals" :key="r.id" class="rrow">
          <router-link :to="{ name: 'admin-user', params: { id: r.referrer.id } }" class="rrow__person">
            <span class="rrow__name">{{ r.referrer.name }}</span>
            <span class="rrow__email">{{ r.referrer.email }}</span>
          </router-link>
          <router-link :to="{ name: 'admin-user', params: { id: r.referred.id } }" class="rrow__person">
            <span class="rrow__name">{{ r.referred.name }}</span>
            <span class="rrow__email">{{ r.referred.email }}</span>
          </router-link>
          <span class="rrow__cell">
            <span class="rrow__cellLbl">{{ t('adminRef.colStatus') }}</span>
            <span class="chip" :class="r.status === 'rewarded' ? 'chip--ok' : 'chip--warn'">
              {{ r.status === 'rewarded' ? t('adminRef.rewarded') : t('adminRef.pending') }}
            </span>
          </span>
          <span class="rrow__cell">
            <span class="rrow__cellLbl">{{ t('adminRef.colReward') }}</span>
            <b v-if="r.rewardCredits != null">{{ cr(r.rewardCredits) }} cr</b>
            <span v-else class="rrow__muted">—</span>
          </span>
          <span class="rrow__cell">
            <span class="rrow__cellLbl">{{ t('adminRef.colDate') }}</span>
            {{ dt(r.rewardedAt ?? r.createdAt) }}
          </span>
        </li>
      </ul>
    </div>

    <AdminPager
      :page="admin.referralFilters.page"
      :page-size="admin.referralFilters.pageSize"
      :total="admin.referralsTotal"
      @update:page="admin.setReferralFilter('page', $event)"
    />
  </div>
</template>

<style scoped>
.ar {
  max-width: 1100px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.ar__chips {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.7rem;
  margin: 1.2rem 0 1.4rem;
}
.ar__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.ar__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.rrow__muted {
  color: rgba(var(--v-theme-on-surface), 0.4);
}

/* Table shell — same grid-row pattern as the invoices list. */
.rtable {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
}
.rtable__head,
.rrow {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.4fr) minmax(0, 0.8fr) minmax(0, 0.7fr) minmax(0, 0.8fr);
  align-items: center;
  gap: 1rem;
}
.rtable__head {
  padding: 0.65rem 1.1rem;
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-bottom: 1px solid var(--tvz-hairline);
}
.rrow {
  padding: 0.85rem 1.1rem;
  border-bottom: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
  transition: background var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.rrow:last-child {
  border-bottom: none;
}
.rrow:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.rrow__person {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.rrow__name {
  font-weight: 600;
  font-size: 0.88rem;
  color: rgb(var(--v-theme-on-surface));
}
.rrow__email {
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rrow__cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  font-size: 0.86rem;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.rrow__cell b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rrow__cellLbl {
  display: none;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.chip {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.chip--ok {
  background: rgba(var(--v-theme-success), 0.16);
  color: rgb(var(--v-theme-success));
}
.chip--warn {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}

@media (max-width: 860px) {
  .ar__chips {
    grid-template-columns: repeat(2, 1fr);
  }
  .rtable__head {
    display: none;
  }
  .rrow {
    grid-template-columns: 1fr;
    row-gap: 0.5rem;
  }
  .rrow__cell {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 0.3rem 0;
    border-top: 1px dashed var(--tvz-hairline);
  }
  .rrow__cellLbl {
    display: inline;
  }
}
</style>
