<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { usePreferencesStore } from '@/stores/preferences'
import { SUPPORTED_LOCALES, type AppLocale } from '@/plugins/i18n'

const { t } = useI18n()
const prefs = usePreferencesStore()

const flags: Record<AppLocale, string> = {
  ro: '🇷🇴',
  en: '🇬🇧',
  de: '🇩🇪',
}

function select(locale: AppLocale) {
  prefs.setLocale(locale)
}
</script>

<template>
  <v-menu location="bottom end">
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        variant="text"
        class="text-none"
        :aria-label="t('language.label')"
        prepend-icon="mdi-translate"
      >
        {{ prefs.locale.toUpperCase() }}
      </v-btn>
    </template>

    <v-list density="compact" min-width="180" nav>
      <v-list-subheader>{{ t('language.label') }}</v-list-subheader>
      <v-list-item
        v-for="locale in SUPPORTED_LOCALES"
        :key="locale"
        :active="prefs.locale === locale"
        :title="`${flags[locale]}  ${t(`language.${locale}`)}`"
        @click="select(locale)"
      />
    </v-list>
  </v-menu>
</template>
