<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  icon?: string
  tone?: 'primary' | 'success' | 'error' | 'warning'
  active?: boolean
}>()
defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    class="afc"
    :class="[tone ? `afc--${tone}` : '', { 'is-active': active }]"
    @click="$emit('click')"
  >
    <span class="afc__top">
      <span class="afc__label">{{ label }}</span>
      <v-icon v-if="icon" :icon="icon" size="15" class="afc__icon" />
    </span>
    <span class="afc__value">{{ value }}</span>
  </button>
</template>

<style scoped>
.afc {
  --afc-acc: var(--v-theme-on-surface);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  text-align: left;
  flex: 1 1 128px;
  min-width: 110px;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 0.7rem 0.9rem;
  cursor: pointer;
  transition:
    border-color var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease),
    background var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease),
    transform var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.afc--primary {
  --afc-acc: var(--v-theme-primary);
}
.afc--success {
  --afc-acc: var(--v-theme-success);
}
.afc--error {
  --afc-acc: var(--v-theme-error);
}
.afc--warning {
  --afc-acc: var(--v-theme-warning);
}
.afc:hover {
  border-color: rgba(var(--afc-acc), 0.4);
  transform: translateY(-1px);
}
.afc.is-active {
  border-color: rgba(var(--afc-acc), 0.55);
  background: rgba(var(--afc-acc), 0.08);
}
.afc__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}
.afc__label {
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.is-active .afc__label {
  color: rgb(var(--afc-acc));
  font-weight: 600;
}
.afc__icon {
  color: rgba(var(--afc-acc), 0.85);
}
.afc__value {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 1.3rem;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--afc-acc));
}
</style>
