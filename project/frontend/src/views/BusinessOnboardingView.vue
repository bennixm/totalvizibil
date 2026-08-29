<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import PagePlaceholder from '@/components/PagePlaceholder.vue'

const { t } = useI18n()
</script>

<template>
  <PagePlaceholder
    icon="mdi-account-voice"
    :title="t('onboarding.title')"
    :text="t('onboarding.intro')"
    chip="Phase 3 · AI"
  >
    <v-btn color="primary" variant="flat" prepend-icon="mdi-play">
      {{ t('onboarding.start') }}
    </v-btn>
  </PagePlaceholder>
</template>
