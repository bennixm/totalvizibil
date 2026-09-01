<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

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

    <ul v-else class="au__list">
      <li
        v-for="u in admin.users"
        :key="u.id"
        class="urow"
        :class="{ 'urow--suspended': u.status === 'suspended' }"
        role="button"
        tabindex="0"
        @click="open(u.id)"
        @keydown.enter="open(u.id)"
      >
        <span class="urow__av">{{ initials(u.name) }}</span>
        <div class="urow__id">
          <span class="urow__name">
            {{ u.name }}
            <span v-if="u.status === 'suspended'" class="tag tag--err">{{
              t('dashboard.statusSuspended')
            }}</span>
          </span>
          <span class="urow__mail">{{ u.email }}</span>
          <span v-if="u.platformRoles.length" class="urow__roles">
            <span v-for="r in u.platformRoles" :key="r" class="tag tag--role">{{ r }}</span>
          </span>
        </div>
        <div class="urow__stats">
          <span class="urow__stat">
            <v-icon v-if="u.walletBlocked" icon="mdi-lock" size="12" color="error" />
            <b>{{ credits(u.walletCredits) }}</b>
            <em>{{ t('admin.colWallet') }}</em>
          </span>
          <span class="urow__stat">
            <b>{{ u.companyCount }}</b>
            <em>{{ t('admin.colCompanies') }}</em>
          </span>
          <span class="urow__stat">
            <v-icon
              :icon="u.twoFactorEnabled ? 'mdi-shield-check' : 'mdi-shield-off-outline'"
              :color="u.twoFactorEnabled ? 'success' : undefined"
              size="15"
            />
            <em>2FA</em>
          </span>
          <span class="urow__stat urow__stat--wide">
            <b class="urow__login">{{ lastLogin(u.lastLoginAt) }}</b>
            <em>{{ t('admin.colLastLogin') }}</em>
          </span>
        </div>
        <v-icon icon="mdi-chevron-right" size="18" class="urow__chev" />
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
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.au__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.urow {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.9rem 1.1rem;
  border: 1px solid var(--tvz-hairline);
  border-left: 3px solid transparent;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  transition:
    border-color 0.14s cubic-bezier(0.22, 1, 0.36, 1),
    background 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}
.urow:hover,
.urow:focus-visible {
  outline: none;
  border-color: rgb(var(--v-theme-primary) / 0.45);
  border-left-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.03);
}
.urow--suspended {
  border-left-color: rgb(var(--v-theme-error) / 0.6);
}
.urow__av {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 11px;
  font-size: 0.8rem;
  font-weight: 700;
  color: #fff;
  background: var(--tvz-gradient-brand, linear-gradient(115deg, #3f63e8, #6d5ef0));
}
.urow__id {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.urow__name {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 600;
  font-size: 0.92rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.urow__mail {
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.urow__roles {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
  margin-top: 0.15rem;
}
.urow__stats {
  display: flex;
  align-items: center;
  gap: 1.4rem;
  flex: none;
}
.urow__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  min-width: 3rem;
}
.urow__stat b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
}
.urow__stat em {
  font-style: normal;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.urow__login {
  font-size: 0.8rem !important;
  font-weight: 500 !important;
}
.urow__chev {
  color: rgb(var(--v-theme-on-surface) / 0.3);
  flex: none;
}

.tag {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.tag--err {
  background: rgb(var(--v-theme-error) / 0.16);
  color: rgb(var(--v-theme-error));
}
.tag--role {
  background: rgb(var(--v-theme-primary) / 0.14);
  color: rgb(var(--v-theme-primary));
}

@media (max-width: 780px) {
  .urow__stats {
    display: none;
  }
}
</style>
