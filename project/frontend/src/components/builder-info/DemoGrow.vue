<script setup lang="ts">
/**
 * Animated replica of a business getting visible: the site being built,
 * area + category, the campaign form (real `campaign.*` labels: daily
 * budget, max CPC, AUTO, activate) and the business appearing in the feed
 * with a customer request coming in. Amounts and names are examples.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import './demo.css'

defineProps<{ step: number }>()
const { t } = useI18n()
const d = (k: string) => t(`hsec.grow.demo.${k}`)
const f = (k: string) => t(`hsec.find.demo.${k}`)
const cardTitle = computed(() => `${f('category')} ${f('city')}`)
</script>

<template>
  <div class="dm-win dg">
    <div class="dm-chrome"><i /><i /><i /><span>totalvizibil.ro/{{ ['create', 'create/location', 'campaign/budget', ''][step] }}</span></div>

    <!-- 1. Site -->
    <div v-if="step === 0" key="s0" class="dg__site">
      <div class="dg__pick">
        <span class="on"><v-icon icon="mdi-flash-outline" size="14" /> {{ d('simple') }}</span>
        <span><v-icon icon="mdi-code-tags" size="14" /> {{ d('advanced') }}</span>
      </div>
      <div class="dg__mini">
        <div class="dg__bar dm-build" />
        <div class="dg__hero dm-build" style="animation-delay: 0.8s"><b class="dm-type">{{ f('firms.0') }}</b></div>
        <div class="dg__row dm-build" style="animation-delay: 1.4s"><span /><span /><span /></div>
      </div>
    </div>

    <!-- 2. Area + category -->
    <div v-else-if="step === 1" key="s1" class="dg__zone">
      <div class="dg__map" aria-hidden="true">
        <span class="dg__pin"><v-icon icon="mdi-map-marker" size="30" /></span>
        <span class="dg__ring" />
      </div>
      <div class="dg__fields">
        <label>{{ d('zone') }}</label>
        <span class="dg__val" style="animation-delay: 0.4s">{{ f('city') }}, {{ f('county') }}</span>
        <label>{{ d('cat') }}</label>
        <span class="dg__val" style="animation-delay: 1s">{{ f('category') }}</span>
      </div>
    </div>

    <!-- 3. Campaign -->
    <div v-else-if="step === 2" key="s2" class="dg__camp">
      <b class="dg__h">{{ t('campaign.title') }}</b>
      <div class="dg__line">
        <span>{{ t('campaign.dailyBudget') }}</span>
        <div class="dg__slider"><i style="--to: 55%" /></div>
        <b>20 cr</b>
      </div>
      <div class="dg__line">
        <span>{{ t('campaign.cpc') }}</span>
        <div class="dg__slider"><i style="--to: 35%" /></div>
        <b>1,5 cr</b>
      </div>
      <div class="dg__auto"><span class="dg__sw" /> {{ d('auto') }}</div>
      <span class="dm-btn dm-press">{{ t('campaign.activate') }}</span>
    </div>

    <!-- 4. In the feed, requests coming in -->
    <div v-else key="s3" class="dg__feed">
      <p class="dm-pill dm-pill--ok dg__live"><v-icon icon="mdi-circle" size="8" /> {{ t('campaign.liveNote') }}</p>
      <article class="dg__card dg__card--you">
        <span class="dg__logo">{{ f('firms.0').charAt(0) }}</span>
        <div>
          <b>{{ cardTitle }}</b>
          <small>{{ f('firms.0') }} · {{ d('yours') }}</small>
        </div>
      </article>
      <article v-for="i in [1, 2]" :key="i" class="dg__card">
        <span class="dg__logo dg__logo--muted">{{ f(`firms.${i}`).charAt(0) }}</span>
        <div>
          <b>{{ cardTitle }}</b>
          <small>{{ f(`firms.${i}`) }}</small>
        </div>
      </article>
      <div class="dg__toast"><v-icon icon="mdi-email-fast-outline" size="16" /> {{ d('lead') }}</div>
    </div>
  </div>
</template>

<style scoped>
.dg__site,
.dg__camp {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem;
}
.dg__pick {
  display: flex;
  gap: 0.4rem;
}
.dg__pick span {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.dg__pick .on {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
.dg__mini {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.6rem;
  border-radius: 12px;
  background: #f6f6fb;
}
.dg__bar {
  height: 16px;
  border-radius: 999px;
  background: #fff;
}
.dg__hero {
  display: grid;
  place-items: center;
  height: 96px;
  border-radius: 10px;
  background: linear-gradient(160deg, #e0e7ff, #fff);
  color: #1c1b2e;
}
.dg__hero b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 17px;
}
.dg__row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
}
.dg__row span {
  height: 50px;
  border-radius: 8px;
  background: #fff;
}
.dg__zone {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: center;
  padding: 1rem;
}
.dg__map {
  position: relative;
  display: grid;
  place-items: center;
  height: 190px;
  border-radius: 14px;
  background:
    repeating-linear-gradient(0deg, rgba(var(--v-theme-on-surface), 0.05) 0 1px, transparent 1px 22px),
    repeating-linear-gradient(90deg, rgba(var(--v-theme-on-surface), 0.05) 0 1px, transparent 1px 22px),
    rgba(var(--v-theme-primary), 0.05);
}
.dg__pin {
  position: relative;
  z-index: 1;
  color: rgb(var(--v-theme-primary));
  animation: pinDrop 0.6s cubic-bezier(0.3, 1.6, 0.5, 1) both;
}
@keyframes pinDrop {
  from {
    transform: translateY(-40px);
    opacity: 0;
  }
}
.dg__ring {
  position: absolute;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid rgba(var(--v-theme-primary), 0.5);
  animation: ring 1.8s 0.6s ease-out infinite;
}
@keyframes ring {
  to {
    transform: scale(3);
    opacity: 0;
  }
}
.dg__fields {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.dg__fields label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.dg__val {
  margin-bottom: 0.6rem;
  padding: 0.5rem 0.7rem;
  border-radius: 10px;
  border: 1.5px solid rgb(var(--v-theme-primary));
  font-weight: 600;
  animation: dmSettle 0.4s both;
}
.dg__h {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 15px;
}
.dg__line {
  display: grid;
  grid-template-columns: minmax(90px, auto) minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.7rem;
  font-size: 12px;
}
.dg__slider {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.1);
}
.dg__slider i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 3px;
  background: rgb(var(--v-theme-primary));
  animation: slide 1.2s 0.3s ease both;
}
@keyframes slide {
  from {
    width: 0;
  }
  to {
    width: var(--to);
  }
}
.dg__auto {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  font-size: 12px;
}
.dg__sw {
  position: relative;
  width: 30px;
  height: 17px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.2);
  animation: swOn 0.3s 1.6s both;
}
.dg__sw::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  animation: knob 0.3s 1.6s both;
}
@keyframes swOn {
  to {
    background: rgb(var(--v-theme-primary));
  }
}
@keyframes knob {
  to {
    transform: translateX(13px);
  }
}
.dg__camp > .dm-btn {
  align-self: flex-start;
}
.dg__feed {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.8rem;
}
.dg__live {
  align-self: flex-start;
  margin: 0;
}
.dg__card {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.65rem 0.75rem;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.dg__card b {
  display: block;
  font-size: 13px;
}
.dg__card small {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.dg__card--you {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.07);
  animation: dmSettle 0.5s 0.2s both;
}
.dg__logo {
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
.dg__logo--muted {
  background: rgba(var(--v-theme-on-surface), 0.2);
}
.dg__toast {
  position: absolute;
  right: 0.8rem;
  bottom: 0.8rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 0.8rem;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: rgba(15, 18, 32, 0.9);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  animation: dmSettle 0.45s 1.8s both;
}
.dg__toast .v-icon {
  color: #4ade80;
}
@media (max-width: 600px) {
  .dg__zone {
    grid-template-columns: 1fr;
  }
  .dg__map {
    height: 120px;
  }
  .dg__toast {
    position: static;
    align-self: flex-start;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dg__pin,
  .dg__ring,
  .dg__val,
  .dg__slider i,
  .dg__sw,
  .dg__sw::after,
  .dg__card--you,
  .dg__toast {
    animation: none;
  }
}
</style>
