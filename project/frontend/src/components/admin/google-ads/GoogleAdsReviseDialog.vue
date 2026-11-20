<script setup lang="ts">
/**
 * "Recomandă manual": the admin tells the agent what to do differently.
 * The agent prepares a corrected proposal, validates it and queues it for
 * approval again; nothing is ever executed from this dialog.
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ modelValue: boolean; loading?: boolean; title?: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'submit', instructions: string): void
}>()
const { t } = useI18n()
const text = ref('')
watch(
  () => props.modelValue,
  (open) => {
    if (open) text.value = ''
  },
)
function submit() {
  const v = text.value.trim()
  if (v.length >= 5) emit('submit', v)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <v-card class="grd">
      <v-card-title class="grd__title">{{ t('adminGoogleAdsOpt.reviseTitle') }}</v-card-title>
      <v-card-text>
        <p v-if="title" class="grd__for">{{ title }}</p>
        <p class="grd__hint">{{ t('adminGoogleAdsOpt.reviseHint') }}</p>
        <v-textarea
          v-model="text"
          :placeholder="t('adminGoogleAdsOpt.revisePlaceholder')"
          variant="outlined"
          rows="4"
          auto-grow
          counter="2000"
          maxlength="2000"
          autofocus
          hide-details="auto"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="loading" @click="emit('update:modelValue', false)">{{
          t('common.cancel')
        }}</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="loading"
          :disabled="text.trim().length < 5"
          prepend-icon="mdi-send-outline"
          @click="submit"
        >
          {{ t('adminGoogleAdsOpt.reviseSubmit') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.grd__title {
  font-size: 1.05rem;
  font-weight: 700;
  white-space: normal;
}
.grd__for {
  margin: 0 0 0.4rem;
  font-weight: 600;
  font-size: var(--tvz-fs-small);
}
.grd__hint {
  margin: 0 0 0.75rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
</style>
