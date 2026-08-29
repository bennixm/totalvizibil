<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import PagePlaceholder from '@/components/PagePlaceholder.vue'

const { t } = useI18n()
const query = ref('')
</script>

<template>
  <PagePlaceholder icon="mdi-magnify" :title="t('search.title')" chip="MVP · Phase 6">
    <v-text-field
      v-model="query"
      :placeholder="t('search.placeholder')"
      prepend-inner-icon="mdi-magnify"
      hide-details
      class="w-100"
      style="max-width: 520px"
    />
    <p class="text-caption text-medium-emphasis">{{ t('search.aiHint') }}</p>
  </PagePlaceholder>
</template>
