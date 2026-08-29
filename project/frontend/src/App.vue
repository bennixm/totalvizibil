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
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </v-main>

    <AppFooter />
  </v-app>
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
