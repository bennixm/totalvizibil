<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  /** Shows the dedicated credits-unit icon right after `value`, instead of
   *  spelling out "Credite"/"cr" in the string itself. */
  valueIsCredits?: boolean
}>()
</script>

<template>
  <span class="ami">
    <span class="ami__label">{{ label }}</span>
    <span class="ami__value">
      {{ value }}
      <v-icon v-if="valueIsCredits" icon="mdi-poker-chip" size="0.65em" class="ami__unit" />
    </span>
  </span>
</template>

<style scoped>
.ami {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.ami__label {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.ami__value {
  font-size: 0.86rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ami__unit {
  margin-left: 0.1em;
  opacity: 0.7;
}
</style>
