<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useConfirmStore } from '@/stores/confirm'

const { t } = useI18n()
const store = useConfirmStore()
const busy = ref(false)

async function onConfirm(): Promise<void> {
  busy.value = true
  try {
    await store.confirm()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="store.show"
    max-width="420"
    @update:model-value="(v: boolean) => !v && store.cancel()"
  >
    <v-card rounded="lg">
      <v-card-title>{{ store.title }}</v-card-title>
      <v-card-text>{{ store.text }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="busy" @click="store.cancel()">
          {{ store.cancelLabel || t('common.cancel') }}
        </v-btn>
        <v-btn :color="store.tone" variant="flat" :loading="busy" @click="onConfirm">
          {{ store.confirmLabel || t('common.confirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
