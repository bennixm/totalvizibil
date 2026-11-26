<script setup lang="ts">
import { uiLocale } from '@/plugins/i18n'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminFilterChip from '@/components/admin/AdminFilterChip.vue'
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import { useAdminStore } from '@/stores/admin'
import type { PlatformRole } from '@/stores/auth'
import type { UserStatus } from '@/stores/admin'

const { t, n } = useI18n()
const router = useRouter()
const admin = useAdminStore()

const search = ref(admin.filters.search)
let deb: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(deb)
  deb = setTimeout(() => admin.setFilter('search', v), 300)
})

// Quick-glance counts, independent of the current filter — reuses the same
// aggregate the admin dashboard already fetches. Clicking a chip toggles
// that status straight into the filter (a shortcut for the select below).
void admin.fetchStats()
const s = computed(() => admin.stats?.users)
function toggleStatus(status: UserStatus | null): void {
  admin.setFilter('status', admin.filters.status === status ? null : status)
}

const statusItems = computed(() => [
  { value: null, title: t('admin.filterAnyStatus') },
  { value: 'active', title: t('admin.userStatus.active') },
  { value: 'suspended', title: t('admin.userStatus.suspended') },
])
const roleItems = [
  { value: null, title: t('admin.filterAnyRole') },
  { value: 'admin', title: 'admin' },
  { value: 'support', title: 'support' },
  { value: 'finance', title: 'finance' },
  { value: 'moderator', title: 'moderator' },
]

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
}
function credits(v: number): string {
  return n(Number(v), { maximumFractionDigits: 0 })
}
function lastLogin(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(uiLocale()) : t('admin.never')
}
function joined(iso: string): string {
  return new Date(iso).toLocaleDateString(uiLocale())
}

onMounted(() => admin.fetchUsers())

function open(id: string): void {
  void router.push({ name: 'admin-user', params: { id } })
}
</script>

<template>
  <div class="au">
    <AdminPageHeader
      :title="t('admin.navUsers')"
      :eyebrow="t('admin.navGroupClients')"
      :count="admin.usersTotal"
    />

    <div v-if="s" class="au__chips">
      <AdminFilterChip
        :label="t('admin.filterAnyStatus')"
        :value="n(s.total)"
        icon="mdi-account-multiple-outline"
        :active="admin.filters.status === null"
        @click="toggleStatus(null)"
      />
      <AdminFilterChip
        :label="t('admin.userStatus.active')"
        :value="n(s.active)"
        icon="mdi-check-circle-outline"
        tone="success"
        :active="admin.filters.status === 'active'"
        @click="toggleStatus('active')"
      />
      <AdminFilterChip
        :label="t('admin.userStatus.suspended')"
        :value="n(s.suspended)"
        icon="mdi-cancel"
        tone="error"
        :active="admin.filters.status === 'suspended'"
        @click="toggleStatus('suspended')"
      />
      <AdminFilterChip
        :label="t('admin.stat.users2fa')"
        :value="n(s.withTwoFactor)"
        icon="mdi-shield-check-outline"
      />
    </div>

    <div class="au__filters">
      <v-text-field
        v-model="search"
        :placeholder="t('admin.searchUsers')"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        class="au__search"
      />
      <v-select
        :model-value="admin.filters.status"
        :items="statusItems"
        variant="outlined"
        density="compact"
        hide-details
        class="au__sel"
        @update:model-value="admin.setFilter('status', $event as UserStatus | null)"
      />
      <v-select
        :model-value="admin.filters.role"
        :items="roleItems"
        variant="outlined"
        density="compact"
        hide-details
        class="au__sel"
        @update:model-value="admin.setFilter('role', $event as PlatformRole | null)"
      />
    </div>

    <div v-if="admin.loadingUsers && !admin.users.length" class="au__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <!-- A failed fetch is NOT "no users" — a 403/timeout/500 used to render
         as a calm empty list with nothing to indicate anything broke. -->
    <AdminEmptyState
      v-else-if="admin.usersError"
      icon="mdi-alert-circle-outline"
      :text="admin.usersError"
    />
    <AdminEmptyState
      v-else-if="!admin.users.length"
      icon="mdi-account-search-outline"
      :text="t('admin.usersNone')"
    />

    <div v-else class="au__table">
      <div class="au__head" aria-hidden="true">
        <span>{{ t('admin.colUser') }}</span>
        <span class="num">{{ t('admin.colBusinesses') }}</span>
        <span class="num">{{ t('admin.colAdsCampaigns') }}</span>
        <span class="num">{{ t('admin.colWallet') }}</span>
        <span>2FA</span>
        <span>{{ t('admin.colLastSeen') }}</span>
        <span />
      </div>
      <div
        v-for="u in admin.users"
        :key="u.id"
        class="urow"
        :class="{ 'is-suspended': u.status === 'suspended' }"
        role="button"
        tabindex="0"
        @click="open(u.id)"
        @keydown.enter="open(u.id)"
      >
        <div class="urow__who">
          <span class="urow__av">{{ initials(u.name) }}</span>
          <div class="urow__id">
            <span class="urow__name">{{ u.name }}</span>
            <span class="urow__mail">{{ u.email }}</span>
            <span v-if="u.platformRoles.length || u.status === 'suspended' || !u.emailVerified" class="urow__tags">
              <span v-if="u.status === 'suspended'" class="tag tag--err">{{ t('admin.userStatus.suspended') }}</span>
              <span v-if="!u.emailVerified" class="tag tag--warn">{{ t('admin.userEmailUnverified') }}</span>
              <span v-for="r in u.platformRoles" :key="r" class="tag tag--role">{{ r }}</span>
            </span>
          </div>
        </div>
        <span class="num" :data-label="t('admin.colBusinesses')">{{ u.companyCount }}</span>
        <span class="num" :data-label="t('admin.colAdsCampaigns')">{{ u.adsCampaignCount }}</span>
        <span class="num" :data-label="t('admin.colWallet')">
          <v-icon v-if="u.walletBlocked" icon="mdi-lock" size="12" color="error" :title="t('admin.walletFrozen')" />
          {{ credits(u.walletCredits) }}
        </span>
        <span class="urow__sec" :data-label="'2FA'">
          <v-icon
            :icon="u.twoFactorEnabled ? 'mdi-shield-check' : 'mdi-shield-off-outline'"
            :color="u.twoFactorEnabled ? 'success' : undefined"
            size="15"
          />
          {{ u.twoFactorEnabled ? t('admin.twoFaYes') : t('admin.twoFaNo') }}
        </span>
        <span class="urow__when" :data-label="t('admin.colLastSeen')">
          {{ lastLogin(u.lastLoginAt) }}
          <small>{{ t('admin.joinedOn', { date: joined(u.createdAt) }) }}</small>
        </span>
        <v-icon icon="mdi-chevron-right" size="18" class="urow__chev" />
      </div>
    </div>

    <AdminPager
      :page="admin.filters.page"
      :page-size="admin.filters.pageSize"
      :total="admin.usersTotal"
      @update:page="admin.setFilter('page', $event)"
    />
  </div>
</template>

<style scoped>
.au {
  max-width: 1320px;
}
.au__chips {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin-bottom: 1.1rem;
}
.au__filters {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 1.1rem;
}
.au__search {
  flex: 1 1 240px;
}
.au__sel {
  max-width: 12rem;
}
.au__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.au__table {
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.au__head,
.urow {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr) 4.4rem 6.2rem 5rem 3.6rem 8.8rem 18px;
  align-items: center;
  gap: 0.9rem;
  padding: 0.75rem 1rem;
}
.au__head {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.5);
  border-bottom: 1px solid var(--tvz-hairline);
  white-space: nowrap;
}
.au__head span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.au__head .num {
  display: block;
}
.urow {
  position: relative;
  cursor: pointer;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.urow + .urow {
  border-top: 1px solid var(--tvz-hairline);
}
.urow:hover,
.urow:focus-visible {
  outline: none;
  background: rgba(var(--v-theme-primary), 0.05);
}
.urow.is-suspended::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: rgb(var(--v-theme-error));
}
.urow__who {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}
.urow__av {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: none;
  clip-path: var(--tvz-hex-sm);
  font-size: var(--tvz-fs-caption);
  font-weight: 700;
  color: rgb(var(--v-theme-on-primary));
  background: rgb(var(--v-theme-primary));
}
.urow.is-suspended .urow__av {
  background: rgba(var(--v-theme-on-surface), 0.35);
}
.urow__id {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.urow__name {
  font-weight: 600;
  font-size: var(--tvz-fs-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.urow__mail {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.urow__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.2rem;
}
.num {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.urow__sec {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.urow__when {
  display: flex;
  flex-direction: column;
  font-size: var(--tvz-fs-small);
}
.urow__when small {
  white-space: nowrap;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.urow__chev {
  color: rgba(var(--v-theme-on-surface), 0.3);
}
.tag {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.1rem 0.4rem;
  clip-path: var(--tvz-hex-xs);
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.tag--err {
  background: rgba(var(--v-theme-error), 0.16);
  color: rgb(var(--v-theme-error));
}
.tag--warn {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}
.tag--role {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
@media (max-width: 960px) {
  .au__head {
    display: none;
  }
  .urow {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.6rem 0.9rem;
  }
  .urow__who {
    grid-column: 1 / -1;
  }
  .urow__chev {
    display: none;
  }
  .num,
  .urow__sec,
  .urow__when {
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    text-align: left;
  }
  .num::before,
  .urow__sec::before,
  .urow__when::before {
    content: attr(data-label);
    font-size: var(--tvz-fs-micro);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(var(--v-theme-on-surface), 0.5);
  }
  .urow__sec {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }
  .urow__sec::before {
    flex-basis: 100%;
  }
}
</style>
