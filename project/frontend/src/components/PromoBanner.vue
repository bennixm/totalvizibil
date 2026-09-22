<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

defineProps<{
  tone: 'primary' | 'success' | 'warning'
  badge: string
  sub: string
  ctaText: string
  ctaTo: RouteLocationRaw
}>()
</script>

<template>
  <section class="promo" :class="`promo--${tone}`">
    <div class="promo__body">
      <p class="promo__eyebrow">{{ badge }}</p>
      <h2 class="promo__title"><slot /></h2>
      <p class="promo__sub">{{ sub }}</p>
    </div>
    <v-btn class="promo__cta" :color="tone" variant="flat" :to="ctaTo" append-icon="mdi-arrow-right">
      {{ ctaText }}
    </v-btn>
  </section>
</template>

<style scoped>
.promo {
  --acc: var(--v-theme-primary);
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 1.2rem;
  padding: 1.3rem 1.5rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-hairline);
  border-left: 3px solid rgb(var(--acc));
  background: rgb(var(--v-theme-surface));
}
.promo--success {
  --acc: var(--v-theme-success);
}
.promo--warning {
  --acc: var(--v-theme-warning);
}
.promo__body {
  flex: 1;
  min-width: 220px;
}
.promo__eyebrow {
  margin: 0 0 0.3rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--acc));
}
.promo__title {
  margin: 0;
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: clamp(1.15rem, 2.6vw, 1.5rem);
  letter-spacing: -0.01em;
  line-height: 1.25;
  text-wrap: balance;
}
.promo__sub {
  margin: 0.35rem 0 0;
  max-width: 48ch;
  font-size: 0.9rem;
  color: rgba(var(--v-theme-on-surface), 0.68);
}
.promo__cta {
  flex: none;
}
</style>
