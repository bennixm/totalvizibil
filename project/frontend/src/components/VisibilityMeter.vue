<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  score: number
  parts: { cpc: number; response: number; plan: number; age: number }
}>()

const { t } = useI18n()

const bars = computed(() => [
  { key: 'cpc', value: props.parts.cpc, label: t('analytics.vsCpc') },
  { key: 'response', value: props.parts.response, label: t('analytics.vsResponse') },
  { key: 'plan', value: props.parts.plan, label: t('analytics.vsPlan') },
  { key: 'age', value: props.parts.age, label: t('analytics.vsAge') },
])
const clamped = computed(() => Math.max(0, Math.min(100, Math.round(props.score))))
</script>

<template>
  <div class="vm">
    <div class="vm__score">
      <strong>{{ clamped }}</strong>
      <span>/ 100</span>
      <p>{{ t('analytics.vsTitle') }}</p>
    </div>
    <div class="vm__bars">
      <div v-for="b in bars" :key="b.key" class="vm__bar">
        <div class="vm__row">
          <span class="vm__label">{{ b.label }}</span>
          <span class="vm__val">{{ b.value }}</span>
        </div>
        <div class="vm__track">
          <div class="vm__fill" :style="{ width: b.value + '%' }" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vm {
  display: flex;
  align-items: center;
  gap: 1.9rem;
}
@media (max-width: 560px) {
  .vm {
    flex-direction: column;
    align-items: stretch;
    gap: 1.1rem;
  }
}
.vm__score {
  flex: none;
  text-align: center;
  padding-right: 1.6rem;
  border-right: 1px solid rgb(var(--v-theme-on-surface) / 0.12);
}
@media (max-width: 560px) {
  .vm__score {
    border-right: 0;
    border-bottom: 1px solid rgb(var(--v-theme-on-surface) / 0.12);
    padding: 0 0 0.9rem;
  }
}
.vm__score strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 3rem;
  font-weight: 700;
  line-height: 1;
  background: linear-gradient(
    135deg,
    rgb(var(--v-theme-primary)),
    rgb(var(--v-theme-secondary))
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.vm__score span {
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.vm__score p {
  margin: 0.35rem 0 0;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.vm__bars {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 0.75rem;
}
.vm__row {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  margin-bottom: 0.3rem;
}
.vm__label {
  color: rgb(var(--v-theme-on-surface) / 0.72);
}
.vm__val {
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.vm__track {
  height: 8px;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
  overflow: hidden;
}
.vm__fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgb(var(--v-theme-primary)),
    rgb(var(--v-theme-secondary))
  );
  transition: width var(--tvz-dur-med) var(--tvz-ease-out);
}
@media (prefers-reduced-motion: reduce) {
  .vm__fill {
    transition: none;
  }
}
</style>
