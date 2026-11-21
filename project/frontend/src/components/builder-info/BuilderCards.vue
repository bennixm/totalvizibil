<script setup lang="ts">
/** The three builders as cards, each opening its information page. Used
 *  by the `/ghid` hub and the homepage sections. */
import { useI18n } from 'vue-i18n'
import { BUILDERS, BUILDER_ORDER } from './builders'

const { t } = useI18n()
</script>

<template>
  <div class="bcards">
    <RouterLink
      v-for="(k, i) in BUILDER_ORDER"
      :key="k"
      :to="{ name: BUILDERS[k].infoRoute }"
      class="hcard"
      :style="{ '--d': `${i * 90}ms` }"
    >
      <span class="hcard__icon"><v-icon :icon="BUILDERS[k].icon" size="26" /></span>
      <p class="hcard__eyebrow">{{ t(`binfo.${k}.eyebrow`) }}</p>
      <h3>{{ t(`binfo.${k}.title`) }}</h3>
      <p class="hcard__lead">{{ t(`binfo.${k}.lead`) }}</p>
      <ul>
        <li v-for="b in 3" :key="b"><v-icon icon="mdi-check" size="14" /> {{ t(`binfo.${k}.badges.${b - 1}`) }}</li>
      </ul>
      <span class="hcard__cta">{{ t('binfo.common.learnMore') }} <v-icon icon="mdi-arrow-right" size="17" /></span>
    </RouterLink>
  </div>
</template>

<style scoped>
.bcards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.25rem;
}
.hcard {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1.5rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: var(--tvz-glass-bg);
  backdrop-filter: blur(var(--tvz-glass-blur));
  box-shadow: var(--tvz-shadow-sm);
  color: inherit;
  text-decoration: none;
  transition:
    transform 0.25s,
    box-shadow 0.25s,
    border-color 0.25s;
  animation: up 0.5s var(--d) ease both;
}
.hcard:hover,
.hcard:focus-visible {
  transform: translateY(-4px);
  box-shadow: var(--tvz-shadow-lg);
  border-color: rgba(var(--v-theme-primary), 0.45);
}
@keyframes up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}
.hcard__icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 15px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
.hcard__eyebrow {
  margin: 0.4rem 0 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--tvz-ai);
}
.hcard h3 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  letter-spacing: -0.02em;
  font-size: 1.25rem;
  line-height: 1.2;
}
.hcard__lead {
  margin: 0;
  font-size: 0.92rem;
  color: rgba(var(--v-theme-on-surface), 0.66);
}
.hcard ul {
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.88rem;
}
.hcard li .v-icon {
  color: rgb(var(--v-theme-success));
}
.hcard__cta {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: auto;
  padding-top: 0.8rem;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
}
@media (max-width: 900px) {
  .bcards {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .hcard {
    animation: none;
  }
}
</style>
