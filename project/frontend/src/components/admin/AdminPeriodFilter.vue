<script setup lang="ts">
/**
 * The period picker every finance report page needs: quick presets (this
 * month / 3 months / 12 months / lifetime) plus an exact custom range, and a
 * visible confirmation of what's actually applied right now. One shared
 * component so every finance page behaves (and looks) the same way, instead
 * of each page growing its own slightly-different filter bar.
 *
 * Dumb/presentational on purpose — it owns no state, just emits what the
 * admin did; the page decides what that means for its own fetch.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

export type PeriodPreset =
  | 'month'
  | 'lastMonth'
  | '3months'
  | 'year'
  | '12months'
  | 'lifetime'
  | 'custom'

defineProps<{
  preset: PeriodPreset
  customFrom: string
  customTo: string
  /** The resolved range actually being shown right now (usually the
   *  backend's own `range.from`/`range.to` echoed back) — shown so the
   *  admin never has to guess what a preset or custom range resolved to. */
  activeRangeLabel?: string
  canApplyCustom: boolean
  /** Show the "whole month" / "whole year" pickers (closing periods). */
  calendarPickers?: boolean
}>()

const emit = defineEmits<{
  'update:customFrom': [value: string]
  'update:customTo': [value: string]
  preset: [value: Exclude<PeriodPreset, 'custom'>]
  apply: []
  pickMonth: [value: string]
  pickYear: [value: number]
}>()

const { t } = useI18n()

const currentYear = new Date().getUTCFullYear()
/** The platform's books start in 2025; nothing older can have data. */
const YEARS = Array.from({ length: Math.max(1, currentYear - 2024) }, (_, i) => currentYear - i)
const monthModel = ref('')
const yearModel = ref<number | null>(null)
function onMonth(v: string): void {
  monthModel.value = v
  yearModel.value = null
  if (v) emit('pickMonth', v)
}
function onYear(v: number | null): void {
  yearModel.value = v
  monthModel.value = ''
  if (v) emit('pickYear', v)
}
</script>

<template>
  <div class="apf">
    <v-btn-toggle :model-value="preset" density="compact" mandatory color="primary" divided>
      <v-btn size="small" value="month" @click="emit('preset', 'month')">
        {{ t('adminFinance.thisMonth') }}
      </v-btn>
      <v-btn size="small" value="lastMonth" @click="emit('preset', 'lastMonth')">
        {{ t('adminFinance.lastMonth') }}
      </v-btn>
      <v-btn size="small" value="3months" @click="emit('preset', '3months')">
        {{ t('adminFinance.last3Months') }}
      </v-btn>
      <v-btn size="small" value="year" @click="emit('preset', 'year')">
        {{ t('adminFinance.thisYear') }}
      </v-btn>
      <v-btn size="small" value="12months" @click="emit('preset', '12months')">
        {{ t('adminFinance.last12Months') }}
      </v-btn>
      <v-btn size="small" value="lifetime" @click="emit('preset', 'lifetime')">
        {{ t('adminFinance.lifetime') }}
      </v-btn>
    </v-btn-toggle>

    <div class="apf__custom">
      <template v-if="calendarPickers">
        <label class="apf__field">
          <span>{{ t('adminFinance.periodMonth') }}</span>
          <input
            :value="monthModel"
            type="month"
            @change="onMonth(($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="apf__field">
          <span>{{ t('adminFinance.periodYear') }}</span>
          <select
            :value="yearModel ?? ''"
            @change="onYear(Number(($event.target as HTMLSelectElement).value) || null)"
          >
            <option value="">-</option>
            <option v-for="y in YEARS" :key="y" :value="y">{{ y }}</option>
          </select>
        </label>
        <span class="apf__sep" aria-hidden="true" />
      </template>
      <label class="apf__field">
        <span>{{ t('adminFinance.periodFrom') }}</span>
        <input
          :value="customFrom"
          type="date"
          @input="emit('update:customFrom', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="apf__field">
        <span>{{ t('adminFinance.periodTo') }}</span>
        <input
          :value="customTo"
          type="date"
          @input="emit('update:customTo', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <v-btn
        size="small"
        variant="tonal"
        color="primary"
        :disabled="!canApplyCustom"
        @click="emit('apply')"
      >
        {{ t('adminFinance.periodApply') }}
      </v-btn>
      <span v-if="activeRangeLabel" class="apf__active">
        <v-icon icon="mdi-calendar-check-outline" size="15" />
        {{ t('adminFinance.periodShowing') }}: <b>{{ activeRangeLabel }}</b>
      </span>
    </div>
  </div>
</template>

<style scoped>
.apf {
  margin: 0.9rem 0 1.4rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--tvz-hairline);
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
/* Seven presets: let them wrap on a narrow screen instead of overflowing. */
.apf :deep(.v-btn-toggle) {
  flex-wrap: wrap;
  row-gap: 0.35rem;
  height: auto;
  max-width: 100%;
}
.apf__custom {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.7rem;
}
.apf__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.apf__field input,
.apf__field select {
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  /* Form-field size (16px on phones: no iOS focus zoom). */
  font-size: var(--tvz-fs-input);
}
.apf__sep {
  width: 1px;
  align-self: stretch;
  background: var(--tvz-hairline);
}
.apf__active {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.apf__active b {
  font-family: 'Space Grotesk Variable', sans-serif;
  color: rgb(var(--v-theme-on-surface));
}

@media (max-width: 640px) {
  .apf__active {
    margin-left: 0;
    width: 100%;
  }
}
</style>
