<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppSidebar, { type SidebarNavGroup } from '@/components/AppSidebar.vue'
import SidebarModeSwitch from '@/components/SidebarModeSwitch.vue'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const auth = useAuthStore()

const groups = computed<SidebarNavGroup[]>(() => [
  {
    label: t('admin.navGroupOverview'),
    items: [
      { to: { name: 'admin-dashboard' }, label: t('admin.navDashboard'), icon: 'mdi-view-dashboard-outline' },
    ],
  },
  {
    label: t('admin.navGroupManage'),
    items: [
      { to: { name: 'admin-users' }, label: t('admin.navUsers'), icon: 'mdi-account-multiple-outline' },
      { to: { name: 'admin-businesses' }, label: t('admin.navBusinesses'), icon: 'mdi-domain' },
      { to: { name: 'admin-invoices' }, label: t('admin.navInvoices'), icon: 'mdi-receipt-text-outline' },
      { to: { name: 'admin-categories' }, label: t('admin.navCategories'), icon: 'mdi-shape-outline' },
      { to: { name: 'support' }, label: t('admin.navSupport'), icon: 'mdi-face-agent' },
    ],
  },
  {
    label: t('admin.navGroupConfig'),
    items: [
      { to: { name: 'admin-settings' }, label: t('admin.navSettings'), icon: 'mdi-tune-variant' },
    ],
  },
])
</script>

<template>
  <v-layout class="admin">
    <AppSidebar :groups="groups">
      <template #top>
        <SidebarModeSwitch />
      </template>
      <template #footer>
        <div class="admin__me">
          <span class="admin__me-roles">
            <v-chip
              v-for="r in auth.user?.platformRoles ?? []"
              :key="r"
              size="x-small"
              color="primary"
              variant="tonal"
            >
              {{ r }}
            </v-chip>
          </span>
          <span class="admin__me-email">{{ auth.user?.email }}</span>
        </div>
      </template>
    </AppSidebar>

    <v-main>
      <div class="admin__content">
        <router-view />
      </div>
    </v-main>
  </v-layout>
</template>

<style scoped>
.admin {
  min-height: calc(100vh - var(--tvz-topbar-h));
}
.admin__content {
  padding: clamp(1.2rem, 3vw, 2.2rem);
  min-width: 0;
}
.admin__me {
  padding: 0 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.72rem;
}
.admin__me-roles {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}
.admin__me-email {
  color: rgba(var(--v-theme-on-surface), 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
