<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import PagePlaceholder from '@/components/PagePlaceholder.vue'

const { t } = useI18n()

const areas = ['financial', 'traffic', 'businesses', 'ai'] as const
</script>

<template>
  <PagePlaceholder icon="mdi-shield-crown-outline" :title="t('admin.title')" chip="Admin">
    <div class="d-flex ga-2 flex-wrap">
      <v-chip v-for="area in areas" :key="area" variant="outlined">
        {{ t(`admin.${area}`) }}
      </v-chip>
    </div>
  </PagePlaceholder>
</template>
