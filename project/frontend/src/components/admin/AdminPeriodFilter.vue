<script setup lang="ts">
import AppDateField from '@/components/AppDateField.vue'
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

const PRESETS: { value: Exclude<PeriodPreset, 'custom'>; label: string }[] = [
  { value: 'month', label: 'adminFinance.thisMonth' },
  { value: 'lastMonth', label: 'adminFinance.lastMonth' },
  { value: '3months', label: 'adminFinance.last3Months' },
  { value: 'year', label: 'adminFinance.thisYear' },
  { value: '12months', label: 'adminFinance.last12Months' },
  { value: 'lifetime', label: 'adminFinance.lifetime' },
]

const currentYear =new Date().getUTCFullYear()
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
    <!-- Segmented control instead of a v-btn-toggle: six tiny buttons can't
         take the house chamfer (at 28px tall the cut turns each one into a
         rhombus), so the presets share one soft track and the active one is
         a raised tab inside it. A 3×2 grid on a phone, one row when wide. -->
    <div class="apf__presets" role="radiogroup" :aria-label="t('adminFinance.periodShowing')">
      <button
        v-for="p in PRESETS"
        :key="p.value"
        type="button"
        role="radio"
        class="apf__preset"
        :class="{ 'is-active': preset === p.value }"
        :aria-checked="preset === p.value"
        @click="emit('preset', p.value)"
      >
        {{ t(p.label) }}
      </button>
    </div>

    <div class="apf__custom" :class="{ 'apf__custom--cal': calendarPickers }">
      <template v-if="calendarPickers">
        <label class="apf__field apf__field--month">
          <span>{{ t('adminFinance.periodMonth') }}</span>
          <input
            :value="monthModel"
            type="month"
            @change="onMonth(($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="apf__field apf__field--year">
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
      <div class="apf__field">
        <span>{{ t('adminFinance.periodFrom') }}</span>
        <AppDateField
          :model-value="customFrom"
          density="compact" variant="outlined" hide-details
          @update:model-value="emit('update:customFrom', $event)"
        />
      </div>
      <div class="apf__field">
        <span>{{ t('adminFinance.periodTo') }}</span>
        <AppDateField
          :model-value="customTo"
          density="compact" variant="outlined" hide-details
          @update:model-value="emit('update:customTo', $event)"
        />
      </div>
      <v-btn
        class="apf__apply"
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
  gap: 0.85rem;
  /* The children lay out by the width the filter actually has (the admin
     content column), not the viewport. */
  container-type: inline-size;
}

/* --- Presets: segmented control ---------------------------------------- */
.apf__presets {
  display: inline-flex;
  align-self: flex-start;
  max-width: 100%;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.035);
}
.apf__preset {
  position: relative;
  min-height: 32px;
  padding: 0.3rem 0.85rem;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font: inherit;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out),
    border-color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.apf__preset:hover:not(.is-active) {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-on-surface));
}
.apf__preset.is-active {
  border-color: rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.16);
  color: rgb(var(--v-theme-primary));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}
.apf__preset:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

/* --- Custom range ------------------------------------------------------ */
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
  min-width: 0;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.apf__field > input,
.apf__field > select {
  box-sizing: border-box;
  height: 38px;
  padding: 0 0.55rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  /* Form-field size (16px on phones: no iOS focus zoom). */
  font-size: var(--tvz-fs-input);
}
/* Same height as the date fields beside it, so the row's bottoms line up. */
.apf__apply {
  height: 38px !important;
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

/* Narrow column (phones, or a tablet beside the sidebar): presets become an
   even 3×2 grid instead of a ragged wrap, and the range fields line up in
   pairs (month | year, from | to) with Apply full width under them. */
@container (max-width: 640px) {
  .apf__presets {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-self: stretch;
  }
  .apf__preset {
    padding-inline: 0.4rem;
    white-space: normal;
    text-align: center;
  }
  .apf__custom {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.6rem;
  }
  .apf__field input,
  .apf__field select {
    width: 100%;
    height: 40px;
  }
  .apf__sep {
    display: none;
  }
  .apf__apply,
  .apf__active {
    grid-column: 1 / -1;
  }
  .apf__apply {
    height: 40px !important;
  }
  .apf__active {
    margin-left: 0;
  }
}
@container (max-width: 340px) {
  .apf__presets {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
