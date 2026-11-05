<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePreferencesStore } from '@/stores/preferences'

withDefaults(defineProps<{ size?: string | number }>(), { size: 'small' })

const { t } = useI18n()
const prefs = usePreferencesStore()

const icon = computed(() => (prefs.bgEffectEnabled ? 'mdi-blur' : 'mdi-blur-off'))
const label = computed(() => t(prefs.bgEffectEnabled ? 'theme.bgEffectOn' : 'theme.bgEffectOff'))

function toggle() {
  prefs.setBgEffectEnabled(!prefs.bgEffectEnabled)
}
</script>

<template>
  <v-btn
    :icon="icon"
    :size="size"
    variant="text"
    :aria-label="`${t('theme.bgEffectToggle')}: ${label}`"
    :title="label"
    @click="toggle"
  />
</template>
