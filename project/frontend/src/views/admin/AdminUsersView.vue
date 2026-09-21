<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

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
  { value: 'active', title: t('dashboard.statusActive') },
  { value: 'suspended', title: t('dashboard.statusSuspended') },
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
  return iso ? new Date(iso).toLocaleDateString() : t('admin.never')
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
      :eyebrow="t('admin.navGroupManage')"
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
        :label="t('dashboard.statusActive')"
        :value="n(s.active)"
        icon="mdi-check-circle-outline"
        tone="success"
        :active="admin.filters.status === 'active'"
        @click="toggleStatus('active')"
      />
      <AdminFilterChip
        :label="t('dashboard.statusSuspended')"
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
    <p v-else-if="!admin.users.length" class="au__empty">{{ t('admin.usersNone') }}</p>

    <ul v-else class="au__grid">
      <li
        v-for="u in admin.users"
        :key="u.id"
        class="ucard"
        :class="{ 'ucard--suspended': u.status === 'suspended' }"
        role="button"
        tabindex="0"
        @click="open(u.id)"
        @keydown.enter="open(u.id)"
      >
        <div class="ucard__top">
          <span class="ucard__av">{{ initials(u.name) }}</span>
          <div class="ucard__id">
            <p class="ucard__name">{{ u.name }}</p>
            <p class="ucard__mail">{{ u.email }}</p>
          </div>
          <span
            class="ucard__status"
            :class="u.status === 'suspended' ? 'is-err' : 'is-ok'"
          >
            {{ u.status === 'suspended' ? t('dashboard.statusSuspended') : t('dashboard.statusActive') }}
          </span>
        </div>

        <div v-if="u.platformRoles.length" class="ucard__roles">
          <span v-for="r in u.platformRoles" :key="r" class="tag tag--role">{{ r }}</span>
        </div>

        <div class="ucard__stats">
          <div class="ucard__stat">
            <b>
              <v-icon v-if="u.walletBlocked" icon="mdi-lock" size="11" color="error" />
              {{ credits(u.walletCredits) }}
            </b>
            <em>{{ t('admin.colWallet') }}</em>
          </div>
          <div class="ucard__stat">
            <b>{{ u.companyCount }}</b>
            <em>{{ t('admin.colCompanies') }}</em>
          </div>
          <div class="ucard__stat">
            <b>
              <v-icon
                :icon="u.twoFactorEnabled ? 'mdi-shield-check' : 'mdi-shield-off-outline'"
                :color="u.twoFactorEnabled ? 'success' : undefined"
                size="14"
              />
            </b>
            <em>2FA</em>
          </div>
          <div class="ucard__stat">
            <b class="ucard__login">{{ lastLogin(u.lastLoginAt) }}</b>
            <em>{{ t('admin.colLastLogin') }}</em>
          </div>
        </div>
      </li>
    </ul>

    <AdminPager
      :page="admin.filters.page"
      :page-size="admin.filters.pageSize"
      :total="admin.usersTotal"
      @update:page="admin.setFilter('page', $event)"
    />
  </div>
</template>

<style scoped>
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
.au__empty {
  padding: 3rem 1rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.au__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  gap: 0.9rem;
}
.ucard {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.1rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  transition:
    border-color 0.14s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.14s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}
.ucard:hover,
.ucard:focus-visible {
  outline: none;
  border-color: rgba(var(--v-theme-primary), 0.4);
  transform: translateY(-2px);
  box-shadow: var(--tvz-shadow-sm);
}
.ucard--suspended {
  border-color: rgba(var(--v-theme-error), 0.3);
}
.ucard__top {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}
.ucard__av {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 50%;
  font-size: 0.82rem;
  font-weight: 700;
  color: #fff;
  background: var(--tvz-gradient-brand, linear-gradient(115deg, #3f63e8, #6d5ef0));
}
.ucard__id {
  flex: 1;
  min-width: 0;
}
.ucard__name {
  margin: 0;
  font-weight: 600;
  font-size: 0.92rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ucard__mail {
  margin: 0.1rem 0 0;
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ucard__status {
  flex: none;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  margin-top: 0.15rem;
}
.ucard__status.is-ok {
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}
.ucard__status.is-err {
  background: rgba(var(--v-theme-error), 0.16);
  color: rgb(var(--v-theme-error));
}
.ucard__roles {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.ucard__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.4rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--tvz-hairline);
}
.ucard__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  text-align: center;
}
.ucard__stat b {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 0.86rem;
  font-variant-numeric: tabular-nums;
}
.ucard__stat em {
  font-style: normal;
  font-size: 0.58rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ucard__login {
  font-size: 0.72rem !important;
  font-weight: 500 !important;
}

.tag {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.tag--err {
  background: rgba(var(--v-theme-error), 0.16);
  color: rgb(var(--v-theme-error));
}
.tag--role {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
</style>
