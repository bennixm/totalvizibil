<script setup lang="ts">
/**
 * Animated replica of finding a business on the platform: the homepage
 * "ask" box (real `ask.*` copy, its own example question), the resolved
 * category + county, the feed cards ("{category} {city}", business name,
 * services) and the business site's contact block. Names are examples.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import './demo.css'

defineProps<{ step: number }>()
const { t } = useI18n()
const d = (k: string) => t(`hsec.find.demo.${k}`)
const firms = computed(() => [0, 1, 2].map((i) => d(`firms.${i}`)))
const services = computed(() => [0, 1, 2].map((i) => d(`services.${i}`)))
const cardTitle = computed(() => `${d('category')} ${d('city')}`)
</script>

<template>
  <div class="dm-win df">
    <div class="dm-chrome"><i /><i /><i /><span>totalvizibil.ro{{ step >= 3 ? '/instalatii/…' : '' }}</span></div>

    <!-- 1-2. Ask -->
    <div v-if="step <= 1" key="ask" class="df__ask">
      <h4>{{ t('ask.title') }}</h4>
      <div class="df__box">
        <span class="df__q" :class="{ 'df__q--typing': step === 0 }">{{ t('ask.example2') }}</span>
        <span class="dm-btn" :class="{ 'dm-press': step === 0 }"><v-icon icon="mdi-magnify" size="14" /> {{ t('ask.send') }}</span>
      </div>
      <template v-if="step === 1">
        <p class="df__thinking"><span class="dm-spin" /> {{ t('ask.thinking') }}</p>
        <div class="df__chips">
          <span class="df__chip" style="animation-delay: 1.2s"><v-icon icon="mdi-shape-outline" size="13" /> {{ d('category') }}</span>
          <span class="df__chip" style="animation-delay: 1.5s"><v-icon icon="mdi-map-marker-outline" size="13" /> {{ d('county') }}</span>
        </div>
        <p class="df__applied">{{ t('ask.applied', { what: `${d('category')}, ${d('county')}` }) }}</p>
      </template>
    </div>

    <!-- 3. Feed -->
    <div v-else-if="step === 2" key="feed" class="df__feed">
      <div class="df__filters">
        <span class="df__chip on"><v-icon icon="mdi-shape-outline" size="13" /> {{ d('category') }}</span>
        <span class="df__chip on"><v-icon icon="mdi-map-marker-outline" size="13" /> {{ d('county') }}</span>
      </div>
      <article v-for="(f, i) in firms" :key="f" class="df__card" :style="{ animationDelay: `${0.2 + i * 0.35}s` }">
        <span class="df__logo">{{ f.charAt(0) }}</span>
        <div>
          <b>{{ cardTitle }}</b>
          <small>{{ f }}</small>
          <div class="df__svc">
            <span v-for="s in services.slice(0, 3 - (i % 2))" :key="s">{{ s }}</span>
          </div>
        </div>
        <v-icon icon="mdi-chevron-right" size="18" />
      </article>
    </div>

    <!-- 4. Business site + contact -->
    <div v-else key="site" class="df__site">
      <div class="df__hero">
        <small>{{ firms[0] }}</small>
        <b>{{ cardTitle }}</b>
      </div>
      <div class="df__contact">
        <span class="dm-btn dm-btn--ghost"><v-icon icon="mdi-phone" size="14" /> {{ d('call') }}</span>
        <div class="df__form">
          <span class="df__in">{{ d('name') }}</span>
          <span class="df__in df__in--tall">{{ d('msg') }}</span>
          <span class="dm-btn dm-press">{{ d('send') }}</span>
        </div>
      </div>
      <p class="df__sent"><v-icon icon="mdi-check-circle" size="16" /> {{ d('sent') }}</p>
    </div>
  </div>
</template>

<style scoped>
.df__ask {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  padding: 1.4rem;
}
.df__ask h4 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 19px;
}
.df__box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: min(440px, 100%);
  padding: 0.4rem 0.4rem 0.4rem 0.8rem;
  border-radius: 12px;
  border: 1.5px solid rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-surface));
}
.df__q {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.df__q--typing {
  animation: dfType 1.6s 0.3s steps(30, end) both;
}
@keyframes dfType {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}
.df__thinking {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  animation: dfHide 0.3s 1.1s forwards;
}
@keyframes dfHide {
  to {
    opacity: 0;
    height: 0;
  }
}
.df__thinking .dm-spin {
  border-color: rgba(var(--v-theme-on-surface), 0.2);
  border-top-color: rgb(var(--v-theme-primary));
}
.df__chips,
.df__filters {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.df__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
  animation: dmSettle 0.35s both;
}
.df__applied {
  margin: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-success));
  animation: dmSettle 0.35s 1.8s both;
}
.df__feed {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.8rem;
}
.df__card {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.65rem 0.75rem;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-on-surface), 0.02);
  animation: dmSettle 0.4s both;
}
.df__card > div {
  flex: 1;
  min-width: 0;
}
.df__card b {
  display: block;
  font-size: 13px;
}
.df__card small {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.df__logo {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #22d3ee);
}
.df__svc {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.3rem;
}
.df__svc span {
  padding: 0.1rem 0.45rem;
  border-radius: 6px;
  font-size: 10px;
  background: rgba(var(--v-theme-on-surface), 0.07);
}
.df__site {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.7rem;
  background: #f5f8fb;
  color: #12263a;
}
.df__hero {
  padding: 1rem;
  border-radius: 10px;
  background: linear-gradient(135deg, #1d4ed8, #22d3ee);
  color: #fff;
}
.df__hero small {
  display: block;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.85;
}
.df__hero b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 17px;
}
.df__contact {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.6rem;
  align-items: start;
}
.df__contact .dm-btn--ghost {
  background: #fff;
  color: #12263a;
}
.df__form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.6rem;
  border-radius: 10px;
  background: #fff;
}
.df__in {
  padding: 0.4rem 0.55rem;
  border-radius: 7px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  font-size: 11px;
  color: rgba(0, 0, 0, 0.45);
}
.df__in--tall {
  min-height: 40px;
}
.df__form .dm-btn {
  align-self: flex-start;
}
.df__sent {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  align-self: flex-start;
  margin: 0;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #15803d;
  background: #dcfce7;
  animation: dmSettle 0.4s 2.4s both;
}
@media (max-width: 600px) {
  .df__contact {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .df__q--typing,
  .df__thinking,
  .df__chip,
  .df__card,
  .df__applied,
  .df__sent {
    animation: none;
  }
}
</style>
