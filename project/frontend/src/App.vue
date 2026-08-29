<script setup lang="ts">
import { useDisplay } from 'vuetify'

import AppBar from '@/components/AppBar.vue'
import AppFooter from '@/components/AppFooter.vue'
import MobileTabBar from '@/components/MobileTabBar.vue'
import { useLocaleSync } from '@/composables/useLocaleSync'
import { useThemeSync } from '@/composables/useThemeSync'

// Keep Vuetify theme + i18n locale in sync with the persisted preferences store.
useThemeSync()
useLocaleSync()

const { mdAndUp } = useDisplay()
</script>

<template>
  <v-app>
    <AppBar />

    <v-main class="shell" :class="{ 'shell--mobile': !mdAndUp }">
      <router-view />
    </v-main>

    <AppFooter v-if="mdAndUp" />
    <MobileTabBar v-else />
  </v-app>
</template>

<style scoped>
/* Clear the fixed mobile tab bar so page content is never hidden behind it. */
.shell--mobile {
  padding-bottom: calc(var(--tvz-tabbar-h) + env(safe-area-inset-bottom, 0px) + 12px);
}
</style>
