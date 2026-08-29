<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useAdminStore } from '@/stores/admin'
import type { PlatformRole } from '@/stores/auth'
import type { UserStatus } from '@/stores/admin'

const { t } = useI18n()
const router = useRouter()
const admin = useAdminStore()

const search = ref(admin.filters.search)
let deb: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(deb)
  deb = setTimeout(() => admin.setFilter('search', v), 300)
})

const statusItems = [
  { value: null, title: t('admin.filterAnyStatus') },
  { value: 'active', title: t('dashboard.statusActive') },
  { value: 'suspended', title: t('dashboard.statusSuspended') },
]
const roleItems = [
  { value: null, title: t('admin.filterAnyRole') },
  { value: 'admin', title: 'admin' },
  { value: 'support', title: 'support' },
  { value: 'finance', title: 'finance' },
  { value: 'moderator', title: 'moderator' },
]

const headers = [
  { title: t('admin.colUser'), key: 'name', sortable: false },
  { title: t('admin.colStatus'), key: 'status', sortable: false },
  { title: t('admin.colRoles'), key: 'platformRoles', sortable: false },
  { title: '2FA', key: 'twoFactorEnabled', sortable: false, align: 'center' as const },
  { title: t('admin.colCompanies'), key: 'companyCount', sortable: false, align: 'end' as const },
  { title: t('admin.colLastLogin'), key: 'lastLoginAt', sortable: false },
]

function onOptions(o: { page: number; itemsPerPage: number }) {
  admin.filters.pageSize = o.itemsPerPage
  admin.setFilter('page', o.page)
}

onMounted(() => admin.fetchUsers())

function openUser(_e: unknown, row: { item: { id: string } }) {
  router.push({ name: 'admin-user', params: { id: row.item.id } })
}
</script>

<template>
  <div class="au">
    <h1>{{ t('admin.navUsers') }}</h1>

    <div class="au__filters">
      <v-text-field
        v-model="search"
        :placeholder="t('admin.searchUsers')"
        prepend-inner-icon="mdi-magnify"
        variant="solo-filled"
        flat
        rounded="lg"
        hide-details
        density="comfortable"
        class="au__search"
      />
      <v-select
        :model-value="admin.filters.status"
        :items="statusItems"
        variant="solo-filled"
        flat
        rounded="lg"
        hide-details
        density="comfortable"
        style="max-width: 190px"
        @update:model-value="admin.setFilter('status', $event as UserStatus | null)"
      />
      <v-select
        :model-value="admin.filters.role"
        :items="roleItems"
        variant="solo-filled"
        flat
        rounded="lg"
        hide-details
        density="comfortable"
        style="max-width: 190px"
        @update:model-value="admin.setFilter('role', $event as PlatformRole | null)"
      />
    </div>

    <v-data-table-server
      :headers="headers"
      :items="admin.users"
      :items-length="admin.usersTotal"
      :loading="admin.loadingUsers"
      :items-per-page="admin.filters.pageSize"
      :page="admin.filters.page"
      hover
      class="au__table"
      @update:options="onOptions"
      @click:row="openUser"
    >
      <template #[`item.name`]="{ item }">
        <div class="au__u">
          <span class="au__u-name">{{ item.name }}</span>
          <span class="au__u-mail">{{ item.email }}</span>
        </div>
      </template>
      <template #[`item.status`]="{ item }">
        <v-chip
          size="x-small"
          :color="item.status === 'active' ? 'success' : 'error'"
          variant="tonal"
        >
          {{ t(`dashboard.status${item.status.charAt(0).toUpperCase()}${item.status.slice(1)}`) }}
        </v-chip>
      </template>
      <template #[`item.platformRoles`]="{ item }">
        <span v-if="!item.platformRoles.length" class="text-medium-emphasis">—</span>
        <v-chip
          v-for="r in item.platformRoles"
          :key="r"
          size="x-small"
          color="primary"
          variant="tonal"
          class="me-1"
        >
          {{ r }}
        </v-chip>
      </template>
      <template #[`item.twoFactorEnabled`]="{ item }">
        <v-icon
          :icon="item.twoFactorEnabled ? 'mdi-shield-check' : 'mdi-minus'"
          :color="item.twoFactorEnabled ? 'success' : undefined"
          size="18"
        />
      </template>
      <template #[`item.lastLoginAt`]="{ item }">
        <span class="text-caption">
          {{ item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleDateString() : t('admin.never') }}
        </span>
      </template>
    </v-data-table-server>
  </div>
</template>

<style scoped>
.au h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.4rem, 3.5vw, 1.9rem);
  letter-spacing: -0.02em;
  margin: 0 0 1.2rem;
}
.au__filters {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.au__search {
  flex: 1 1 240px;
}
.au__table {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.au__table :deep(tbody tr) {
  cursor: pointer;
}
.au__u {
  display: flex;
  flex-direction: column;
  padding-block: 0.3rem;
}
.au__u-name {
  font-weight: 600;
  font-size: 0.88rem;
}
.au__u-mail {
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
</style>
