<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useBuilderStore } from '@/stores/builder'

const props = defineProps<{ companyId: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const store = useBuilderStore()
const { working, view } = storeToRefs(store)

const brief = ref('')
const confirmed = ref(false)

// AI is metered per site (manual editing stays unlimited).
const planLeft = computed(() => view.value?.aiLimits?.planLeft ?? null)
const planLimit = computed(() => view.value?.aiLimits?.plan ?? 6)
const outOfQuota = computed(() => planLeft.value !== null && planLeft.value <= 0)

function generate(): void {
  const b = brief.value.trim()
  if (b.length < 4 || working.value || outOfQuota.value) return
  // Fire and close straight away — the full-screen AiLoader takes over and
  // any error surfaces in the builder view once it resolves.
  void store.aiPlan(props.companyId, b)
  emit('close')
}
</script>

<template>
  <div class="ab" role="dialog" aria-modal="true" @click.self="emit('close')">
    <div class="ab__panel">
      <header class="ab__head">
        <strong><v-icon icon="mdi-creation" size="18" /> {{ t('builder.aiTitle') }}</strong>
        <button type="button" class="ab__x" @click="emit('close')">
          <v-icon icon="mdi-close" size="20" />
        </button>
      </header>

      <div class="ab__body">
        <p class="ab__lead">{{ t('builder.aiLead') }}</p>
        <textarea
          v-model="brief"
          class="ab__ta"
          rows="6"
          :placeholder="t('builder.aiPlaceholder')"
          maxlength="2000"
        />
        <p v-if="view && !view.aiConfigured" class="ab__note">
          <v-icon icon="mdi-information-outline" size="14" /> {{ t('builder.aiNoKey') }}
        </p>
        <p v-if="planLeft !== null" class="ab__note" :class="{ 'ab__note--warn': outOfQuota }">
          <v-icon icon="mdi-creation" size="14" />
          {{
            outOfQuota
              ? t('builder.aiQuotaOut')
              : t('builder.aiQuota', { left: planLeft, limit: planLimit })
          }}
        </p>
        <label class="ab__chk">
          <input v-model="confirmed" type="checkbox" />
          {{ t('builder.aiConfirm') }}
        </label>
      </div>

      <footer class="ab__foot">
        <button type="button" class="ab__cancel" @click="emit('close')">{{ t('builder.cancel') }}</button>
        <button
          type="button"
          class="ab__go"
          :disabled="!confirmed || brief.trim().length < 4 || working || outOfQuota"
          @click="generate"
        >
          <v-progress-circular v-if="working" indeterminate size="15" width="2" />
          <template v-else><v-icon icon="mdi-creation" size="15" /> {{ t('builder.aiGo') }}</template>
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ab {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(0 0 0 / 0.45);
}
.ab__panel {
  width: min(560px, 100%);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--tvz-glass-border);
  box-shadow: var(--tvz-shadow-lg);
  overflow: hidden;
}
.ab__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.ab__head strong {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'Space Grotesk Variable', sans-serif;
}
.ab__x {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.ab__body {
  padding: 1rem 1.1rem;
}
.ab__lead {
  margin: 0 0 0.6rem;
  font-size: 0.86rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.ab__ta {
  width: 100%;
  padding: 0.7rem 0.85rem;
  border-radius: 10px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-background));
  color: inherit;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1.5;
  resize: vertical;
}
.ab__ta:focus {
  outline: 2px solid rgb(var(--v-theme-primary) / 0.4);
  outline-offset: 1px;
}
.ab__note {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.5rem 0 0;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.ab__note--warn {
  color: rgb(var(--v-theme-warning, 217 119 6));
  font-weight: 600;
}
.ab__chk {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-top: 0.9rem;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.8);
}
.ab__foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0.8rem 1.1rem;
  border-top: 1px solid var(--tvz-hairline);
}
.ab__cancel {
  padding: 0.45rem 0.9rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.ab__go {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 1rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 700;
  color: #fff;
  background: rgb(var(--v-theme-primary));
}
.ab__go:disabled {
  opacity: 0.5;
}
</style>
