<script setup lang="ts">
defineProps<{ label: string; value: string | number }>()
</script>

<template>
  <span class="ami">
    <span class="ami__label">{{ label }}</span>
    <span class="ami__value">{{ value }}</span>
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
</style>
