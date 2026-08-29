<script setup lang="ts">
import AppBar from '@/components/AppBar.vue'
import AppFooter from '@/components/AppFooter.vue'
import { useLocaleSync } from '@/composables/useLocaleSync'
import { useThemeSync } from '@/composables/useThemeSync'

// Keep Vuetify theme + i18n locale in sync with the persisted preferences store.
useThemeSync()
useLocaleSync()
</script>

<template>
  <v-app>
    <AppBar />

    <v-main>
      <router-view v-slot="{ Component, route }">
        <component :is="Component" :key="route.path" />
      </router-view>
    </v-main>

    <AppFooter />
  </v-app>
</template>
