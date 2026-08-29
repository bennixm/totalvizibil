<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { Placement } from '@/stores/feed'

const props = defineProps<{ placement: Placement }>()
const { t } = useI18n()

const meta = computed(() => {
  switch (props.placement) {
    case 'sponsored':
      return { label: t('feed.sponsored'), icon: 'mdi-bullhorn-variant-outline', color: 'primary' }
    case 'exploration':
      return { label: t('feed.new'), icon: 'mdi-sprout-outline', color: 'success' }
    default:
      return { label: t('feed.recommended'), icon: 'mdi-thumb-up-outline', color: 'default' }
  }
})
</script>

<template>
  <v-chip
    size="x-small"
    variant="tonal"
    :color="meta.color === 'default' ? undefined : meta.color"
    :prepend-icon="meta.icon"
    class="text-uppercase"
    style="letter-spacing: 0.08em; font-size: 10px"
  >
    {{ meta.label }}
  </v-chip>
</template>
