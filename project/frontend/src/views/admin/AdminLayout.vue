<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const auth = useAuthStore()

const nav = [
  { to: { name: 'admin-dashboard' }, key: 'admin.navDashboard', icon: 'mdi-view-dashboard-outline' },
  { to: { name: 'admin-users' }, key: 'admin.navUsers', icon: 'mdi-account-multiple-outline' },
]
</script>

<template>
  <div class="admin">
    <aside class="admin__rail">
      <div class="admin__brand">
        <v-icon icon="mdi-shield-crown-outline" size="20" />
        <span>{{ t('admin.title') }}</span>
      </div>
      <nav class="admin__nav">
        <router-link
          v-for="item in nav"
          :key="item.key"
          :to="item.to"
          class="admin__link"
        >
          <v-icon :icon="item.icon" size="18" />
          <span>{{ t(item.key) }}</span>
        </router-link>
      </nav>
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
    </aside>

    <main class="admin__content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.admin {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  min-height: calc(100vh - var(--tvz-topbar-h));
}
.admin__rail {
  border-right: 1px solid var(--tvz-hairline);
  padding: 1.4rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
  position: sticky;
  top: var(--tvz-topbar-h);
  align-self: start;
  height: calc(100vh - var(--tvz-topbar-h));
}
.admin__brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: -0.01em;
  padding-inline: 0.4rem;
}
.admin__nav {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.admin__link {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  color: rgb(var(--v-theme-on-surface) / 0.66);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 500;
}
.admin__link:hover {
  background: rgb(var(--v-theme-on-surface) / 0.05);
  color: rgb(var(--v-theme-on-surface));
}
.admin__link.router-link-active {
  background: rgb(var(--v-theme-primary) / 0.12);
  color: rgb(var(--v-theme-primary));
}
.admin__me {
  margin-top: auto;
  padding: 0.7rem;
  border-radius: 10px;
  background: rgb(var(--v-theme-on-surface) / 0.04);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.72rem;
}
.admin__me-roles {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}
.admin__me-email {
  color: rgb(var(--v-theme-on-surface) / 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
}
.admin__content {
  padding: clamp(1.2rem, 3vw, 2.2rem);
  min-width: 0;
}

@media (max-width: 860px) {
  .admin {
    grid-template-columns: 1fr;
  }
  .admin__rail {
    position: static;
    height: auto;
    flex-direction: row;
    align-items: center;
    gap: 0.6rem;
    border-right: none;
    border-bottom: 1px solid var(--tvz-hairline);
    overflow-x: auto;
    padding: 0.8rem;
  }
  .admin__brand {
    flex-shrink: 0;
  }
  .admin__nav {
    flex-direction: row;
    gap: 0.4rem;
  }
  .admin__link {
    white-space: nowrap;
  }
  .admin__me {
    display: none;
  }
}
</style>
