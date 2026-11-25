<script setup lang="ts">
/**
 * Animated replica of the Google Ads optimization flow: the connect screen
 * (real `ads.connect.*` copy), the account/campaign multi-picker, the
 * campaign dashboard with its score, an optimization cycle, and a budget
 * proposal waiting for approval. The example score and amounts are
 * illustrative; every label is the builder's own.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import './demo.css'

const props = defineProps<{ step: number; price?: number | null }>()
const { t } = useI18n()
const d = (k: string) => t(`binfo.ads.demo.${k}`)

const ACCESS = ['read', 'apply', 'budget', 'revoke'] as const
const camps = computed(() => [0, 1, 2].map((i) => d(`camp.${i}`)))
const cycleSteps = computed(() => [0, 1, 2, 3].map((i) => d(`cycleSteps.${i}`)))

// Score gauge: counts up on the dashboard and again after the cycle.
const score = ref(32)
let raf = 0
function animateTo(from: number, to: number, ms: number): void {
  cancelAnimationFrame(raf)
  const start = performance.now()
  const tick = (now: number) => {
    const p = Math.min(1, (now - start) / ms)
    score.value = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)))
    if (p < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}
watch(
  () => props.step,
  (s) => {
    if (s === 2) animateTo(0, 32, 1200)
    else if (s === 3) {
      score.value = 32
      setTimeout(() => props.step === 3 && animateTo(32, 61, 1500), 2600)
    } else score.value = s > 3 ? 61 : 32
  },
  { immediate: true },
)
onBeforeUnmount(() => cancelAnimationFrame(raf))
const dash = computed(() => `${(score.value / 100) * 163} 163`)
</script>

<template>
  <div class="dm-win dd">
    <div class="dm-chrome"><i /><i /><i /><span>totalvizibil.ro/google-ads{{ step >= 2 ? '/c/…' : step === 1 ? '/campaigns' : '' }}</span></div>

    <!-- 1. Connect -->
    <div v-if="step === 0" key="s0" class="dd__connect">
      <h4>{{ t('ads.connect.title') }}</h4>
      <ul>
        <li v-for="(a, i) in ACCESS" :key="a" :style="{ animationDelay: `${i * 0.25}s` }">
          <v-icon icon="mdi-check-circle-outline" size="15" /> {{ t(`ads.connect.access.${a}`) }}
        </li>
      </ul>
      <span class="dm-btn dm-press dd__g"><v-icon icon="mdi-google" size="15" /> {{ t('ads.connect.cta') }}</span>
      <p><v-icon icon="mdi-shield-lock-outline" size="13" /> {{ d('secure') }}</p>
    </div>

    <!-- 2. Pick campaigns -->
    <div v-else-if="step === 1" key="s1" class="dd__pick">
      <div class="dd__accts">
        <small>{{ d('accounts') }}</small>
        <span class="on">Instalații Exemplu SRL <em>2</em></span>
        <span>Client agenție</span>
      </div>
      <div class="dd__camps">
        <small>{{ d('campaigns') }}</small>
        <div v-for="(c, i) in camps" :key="c" class="dd__camp" :class="{ off: i === 2 }">
          <span class="dd__box" :class="{ tick: i < 2 }" :style="{ animationDelay: `${0.6 + i * 0.7}s` }"><v-icon icon="mdi-check" size="11" /></span>
          <b>{{ c }}</b>
          <span class="dm-pill">{{ i === 2 ? 'Performance Max' : 'Search' }}</span>
        </div>
        <span class="dm-btn dd__go" style="animation-delay: 2.2s">{{ d('continue') }} <v-icon icon="mdi-arrow-right" size="14" /></span>
      </div>
    </div>

    <!-- 3-5. Dashboard -->
    <div v-else key="sd" class="dd__dash">
      <div class="dd__tabs">
        <span v-for="(tb, i) in ['home', 'history', 'proposals']" :key="tb" :class="{ on: (step === 2 && i === 0) || (step === 3 && i === 1) || (step === 4 && i === 2) }">
          {{ t(`ads.tab.${tb}`) }}
        </span>
      </div>
      <div class="dd__body">
        <div class="dd__gauge">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="26" class="bg" />
            <circle cx="32" cy="32" r="26" class="fg" :stroke-dasharray="dash" />
          </svg>
          <b>{{ score }}</b>
          <small>{{ t('ads.dash.score') }}</small>
        </div>
        <div class="dd__panel">
          <template v-if="step === 2">
            <b class="dd__h">{{ t('ads.dash.toImprove') }}</b>
            <div v-for="(x, i) in ['sitelinks', 'headlines', 'images']" :key="x" class="dd__issue" :style="{ animationDelay: `${0.4 + i * 0.3}s` }">
              <v-icon icon="mdi-alert-circle-outline" size="14" /> <span class="dd__bar" :style="{ width: `${70 - i * 15}%` }" />
            </div>
            <span class="dm-btn dm-press">{{ t('ads.dash.letAgent') }}</span>
          </template>
          <template v-else-if="step === 3">
            <b class="dd__h">{{ d('cycle') }}</b>
            <div v-for="(c, i) in cycleSteps" :key="c" class="dd__cstep" :style="{ animationDelay: `${0.3 + i * 0.6}s` }">
              <v-icon icon="mdi-check-circle" size="14" /> {{ c }}
            </div>
          </template>
          <template v-else>
            <div class="dd__prop">
              <b><v-icon icon="mdi-cash-plus" size="15" /> {{ d('proposal') }}</b>
              <p>{{ d('proposalText') }}</p>
              <div class="dd__acts">
                <span class="dm-btn dm-press">{{ d('approve') }}</span>
                <span class="dm-btn dm-btn--ghost">{{ d('reject') }}</span>
              </div>
              <p class="dd__rule"><v-icon icon="mdi-shield-check-outline" size="13" /> {{ t('ads.set.budgetRule') }}</p>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dd__connect {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  padding: 1.4rem;
  text-align: center;
}
.dd__connect h4 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 18px;
}
.dd__connect ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  text-align: left;
  max-width: 380px;
}
.dd__connect li {
  display: flex;
  gap: 0.4rem;
  font-size: 12px;
  animation: dmSettle 0.4s both;
}
.dd__connect li .v-icon {
  color: rgb(var(--v-theme-success));
  flex: none;
  margin-top: 1px;
}
.dd__connect p {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.dd__g {
  padding: 0.55rem 1rem;
}
.dd__pick {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.4fr);
  gap: 0.8rem;
  padding: 0.9rem;
}
.dd__pick small {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.dd__accts span {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.55rem 0.65rem;
  margin-bottom: 0.4rem;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  font-weight: 600;
  font-size: 12px;
}
.dd__accts .on {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
.dd__accts em {
  font-style: normal;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 10px;
  color: #fff;
  background: rgb(var(--v-theme-primary));
  animation: dmSettle 0.3s 2s both;
}
.dd__camps {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.dd__camp {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.65rem;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  font-size: 12px;
}
.dd__camp b {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dd__camp.off {
  opacity: 0.5;
}
.dd__box {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 4px;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.3);
  color: transparent;
}
.dd__box.tick {
  animation: tick 0.3s both;
}
@keyframes tick {
  to {
    background: rgb(var(--v-theme-primary));
    border-color: rgb(var(--v-theme-primary));
    color: #fff;
  }
}
.dd__go {
  align-self: flex-end;
  animation: dmSettle 0.4s both;
}
.dd__dash {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.dd__tabs {
  display: flex;
  gap: 0.2rem;
  padding: 0.5rem 0.7rem;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.dd__tabs span {
  padding: 0.25rem 0.65rem;
  border-radius: 7px;
  font-size: 11.5px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  transition: all 0.3s;
}
.dd__tabs .on {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}
.dd__body {
  flex: 1;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  align-items: center;
  padding: 1rem;
}
.dd__gauge {
  position: relative;
  width: 130px;
  text-align: center;
}
.dd__gauge svg {
  width: 130px;
  height: 130px;
  transform: rotate(-90deg);
}
.dd__gauge circle {
  fill: none;
  stroke-width: 6;
}
.dd__gauge .bg {
  stroke: rgba(var(--v-theme-on-surface), 0.1);
}
.dd__gauge .fg {
  stroke: rgb(var(--v-theme-primary));
  stroke-linecap: round;
}
.dd__gauge b {
  position: absolute;
  top: 44px;
  left: 0;
  right: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 30px;
}
.dd__gauge small {
  display: block;
  font-size: 10.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.dd__panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}
.dd__h {
  font-size: 13px;
}
.dd__issue {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  animation: dmSettle 0.35s both;
}
.dd__issue .v-icon {
  color: rgb(var(--v-theme-warning));
}
.dd__bar {
  height: 8px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.1);
}
.dd__panel > .dm-btn {
  align-self: flex-start;
}
.dd__cstep {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 12px;
  animation: dmSettle 0.35s both;
}
.dd__cstep .v-icon {
  color: rgb(var(--v-theme-success));
}
.dd__prop {
  padding: 0.8rem;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  background: rgba(var(--v-theme-primary), 0.05);
  animation: dmSettle 0.4s both;
}
.dd__prop b {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.dd__prop p {
  margin: 0.4rem 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 18px;
}
.dd__acts {
  display: flex;
  gap: 0.4rem;
}
.dd__prop .dd__rule {
  display: flex;
  gap: 0.3rem;
  margin: 0.6rem 0 0;
  font-family: inherit;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
@media (max-width: 600px) {
  .dd__pick,
  .dd__body {
    grid-template-columns: 1fr;
  }
  .dd__gauge {
    margin: 0 auto;
  }
}
</style>
