<script setup lang="ts">
defineProps<{
  title?: string
  icon?: string
  wide?: boolean
}>()
</script>

<template>
  <section class="asec" :class="{ 'asec--wide': wide }">
    <header v-if="title || $slots.actions" class="asec__head">
      <h2 v-if="title" class="asec__title">
        <v-icon v-if="icon" :icon="icon" size="18" />
        {{ title }}
      </h2>
      <div v-if="$slots.actions" class="asec__actions">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.asec {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 1.3rem;
}
.asec--wide {
  grid-column: 1 / -1;
}
.asec__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.asec__title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0;
}
.asec__actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
</style>
