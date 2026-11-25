<script setup lang="ts">
defineProps<{
  title: string
  eyebrow?: string
  count?: number | string
  sub?: string
}>()
</script>

<template>
  <header class="aph">
    <div class="aph__main">
      <p v-if="eyebrow" class="aph__eyebrow">{{ eyebrow }}</p>
      <h1 class="aph__title">
        {{ title }}
        <span v-if="count !== undefined" class="aph__count">{{ count }}</span>
      </h1>
      <p v-if="sub" class="aph__sub">{{ sub }}</p>
    </div>
    <div v-if="$slots.actions" class="aph__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.aph {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}
.aph__main {
  min-width: 0;
  max-width: 100%;
}
.aph__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: var(--tvz-fs-micro);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin: 0 0 0.35rem;
}
.aph__title {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: var(--tvz-fs-title);
  letter-spacing: -0.02em;
  margin: 0;
  /* Names without spaces (campaigns, domains) wrap instead of leaving the page. */
  overflow-wrap: anywhere;
}
.aph__count {
  font-size: var(--tvz-fs-section);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: rgba(var(--v-theme-on-surface), 0.07);
  padding: 0.1rem 0.55rem;
  border-radius: 0;
  clip-path: var(--tvz-hex-xs);
  font-variant-numeric: tabular-nums;
}
.aph__sub {
  margin: 0.4rem 0 0;
  font-size: var(--tvz-fs-body);
  color: rgba(var(--v-theme-on-surface), 0.6);
  max-width: 60ch;
}
.aph__actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
