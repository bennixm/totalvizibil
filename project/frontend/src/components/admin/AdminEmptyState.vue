<script setup lang="ts">
defineProps<{ text: string; icon?: string }>()
</script>

<template>
  <div class="aes">
    <v-icon :icon="icon || 'mdi-tray-remove'" size="20" />
    <span>{{ text }}</span>
  </div>
</template>

<style scoped>
.aes {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 1.4rem 0.25rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  font-size: 0.85rem;
}
</style>
