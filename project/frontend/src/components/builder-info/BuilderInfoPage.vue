<script setup lang="ts">
/**
 * One builder's information page: what it does, a step-by-step animated
 * demo of the real interface, what you give vs what the AI does, the
 * result, the options and the honest limits, with a CTA into the real,
 * unchanged builder. All copy lives in `binfo.<kind>.*` and was checked
 * against each builder's implementation; prices are read live.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RouteLocationRaw } from 'vue-router'

import DemoEasy from './DemoEasy.vue'
import DemoAdvanced from './DemoAdvanced.vue'
import DemoAds from './DemoAds.vue'
import StepPlayer from './StepPlayer.vue'
import { BUILDERS, type BuilderKind } from './builders'

const props = defineProps<{ kind: BuilderKind; price?: number | null }>()
const { t, tm } = useI18n()

const meta = computed(() => BUILDERS[props.kind])
const k = (s: string) => `binfo.${props.kind}.${s}`
const count = (s: string) => {
  const v = tm(k(s)) as unknown
  return Array.isArray(v) ? v.length : 0
}
const range = (n: number) => Array.from({ length: n }, (_, i) => i)

const steps = computed(() => range(count('steps')))
const demo = computed(() => ({ easy: DemoEasy, advanced: DemoAdvanced, ads: DemoAds })[props.kind])
const cta = computed<RouteLocationRaw>(() => ({ name: meta.value.route }))
const others = computed(() => (Object.keys(BUILDERS) as BuilderKind[]).filter((x) => x !== props.kind))

const reduced =
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const stepList = computed(() =>
  steps.value.map((i) => ({ t: t(k(`steps.${i}.t`)), d: t(k(`steps.${i}.d`)) })),
)

function scrollToHow(): void {
  document.getElementById('binfo-how')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
}
</script>

<template>
  <div class="bi" :class="`bi--${kind}`">
    <!-- HERO -->
    <header class="bi__hero">
      <div class="bi__heroText">
        <p class="bi__eyebrow">
          <span class="bi__icon"><v-icon :icon="meta.icon" size="16" /></span>
          {{ t(k('eyebrow')) }}
        </p>
        <h1>{{ t(k('title')) }}</h1>
        <p class="bi__lead">{{ t(k('lead')) }}</p>
        <ul class="bi__badges">
          <li v-for="i in range(count('badges'))" :key="i">
            <v-icon icon="mdi-check-circle" size="15" /> {{ t(k(`badges.${i}`)) }}
          </li>
        </ul>
        <div class="bi__actions">
          <v-btn :to="cta" color="primary" size="large" append-icon="mdi-arrow-right">{{ t(k('cta')) }}</v-btn>
          <v-btn variant="text" size="large" prepend-icon="mdi-play-circle-outline" @click="scrollToHow">
            {{ t('binfo.common.learnMore') }}
          </v-btn>
        </div>
        <p v-if="meta.priced && price" class="bi__price">
          <v-icon icon="mdi-wallet-outline" size="15" /> {{ t(k('price'), { credits: price }) }}
        </p>
      </div>
    </header>

    <!-- HOW IT WORKS: step rail + animated demo -->
    <section id="binfo-how" class="bi__how">
      <div class="bi__secHead">
        <h2>{{ t('binfo.common.howTitle') }}</h2>
        <p>{{ t('binfo.common.howLead') }}</p>
      </div>
      <StepPlayer :steps="stepList">
        <template #demo="{ step }">
          <component :is="demo" :step="step" :price="price" />
        </template>
      </StepPlayer>
    </section>

    <!-- YOU GIVE / AI DOES -->
    <section class="bi__split">
      <div class="bi__col">
        <h3><v-icon icon="mdi-account-edit-outline" size="20" /> {{ t('binfo.common.youGive') }}</h3>
        <ul>
          <li v-for="i in range(count('you'))" :key="i">{{ t(k(`you.${i}`)) }}</li>
        </ul>
      </div>
      <div class="bi__arrow" aria-hidden="true"><v-icon icon="mdi-arrow-right-thick" size="26" /></div>
      <div class="bi__col bi__col--ai">
        <h3><v-icon icon="mdi-creation" size="20" /> {{ t('binfo.common.aiDoes') }}</h3>
        <ul>
          <li v-for="i in range(count('ai'))" :key="i">{{ t(k(`ai.${i}`)) }}</li>
        </ul>
      </div>
    </section>

    <!-- WHAT YOU CAN ACHIEVE + RESULT -->
    <section class="bi__block">
      <div class="bi__secHead">
        <h2>{{ t('binfo.common.createTitle') }}</h2>
      </div>
      <div class="bi__cards">
        <article v-for="i in range(count('create'))" :key="i" class="fcard" :style="{ '--d': `${i * 80}ms` }">
          <span class="fcard__icon"><v-icon :icon="meta.createIcons[i] ?? 'mdi-star-outline'" size="22" /></span>
          <h4>{{ t(k(`create.${i}.t`)) }}</h4>
          <p>{{ t(k(`create.${i}.d`)) }}</p>
        </article>
      </div>
      <div class="bi__result">
        <v-icon icon="mdi-flag-checkered" size="22" />
        <div>
          <h3>{{ t('binfo.common.resultTitle') }}</h3>
          <p>{{ t(k('result')) }}</p>
        </div>
      </div>
    </section>

    <!-- OPTIONS -->
    <section class="bi__block">
      <div class="bi__secHead">
        <h2>{{ t('binfo.common.capsTitle') }}</h2>
      </div>
      <div class="bi__caps">
        <div v-for="i in range(count('caps'))" :key="i" class="cap">
          <v-icon :icon="meta.capIcons[i] ?? 'mdi-check'" size="20" />
          <div>
            <b>{{ t(k(`caps.${i}.t`)) }}</b>
            <p>{{ t(k(`caps.${i}.d`)) }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- GOOD TO KNOW -->
    <section class="bi__notes">
      <h3><v-icon icon="mdi-information-outline" size="20" /> {{ t('binfo.common.notesTitle') }}</h3>
      <ul>
        <li v-for="i in range(count('notes'))" :key="i">{{ t(k(`notes.${i}`)) }}</li>
      </ul>
    </section>

    <!-- FINAL CTA -->
    <section class="bi__final">
      <h2>{{ t(k('title')) }}</h2>
      <v-btn :to="cta" color="primary" size="x-large" append-icon="mdi-arrow-right">{{ t(k('cta')) }}</v-btn>
      <div class="bi__others">
        <span>{{ t('binfo.common.otherBuilders') }}:</span>
        <RouterLink v-for="o in others" :key="o" :to="{ name: BUILDERS[o].infoRoute }">
          <v-icon :icon="BUILDERS[o].icon" size="15" /> {{ t(`binfo.${o}.eyebrow`) }}
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.bi {
  max-width: 1120px;
  margin: 0 auto;
  padding: clamp(1.5rem, 5vw, 3.5rem) clamp(1rem, 3vw, 1.75rem) 4rem;
  display: flex;
  flex-direction: column;
  gap: clamp(3rem, 8vw, 5.5rem);
}
h1,
h2,
h3,
h4 {
  font-family: 'Space Grotesk Variable', sans-serif;
  letter-spacing: -0.02em;
  margin: 0;
}

/* hero */
.bi__hero {
  position: relative;
  text-align: center;
}
.bi__hero::before {
  content: '';
  position: absolute;
  inset: -20% 10% auto;
  height: 340px;
  z-index: -1;
  background: radial-gradient(closest-side, rgba(var(--v-theme-primary), 0.22), transparent);
  filter: blur(20px);
  animation: aura 9s ease-in-out infinite alternate;
}
@keyframes aura {
  to {
    transform: translateY(20px) scale(1.08);
  }
}
.bi__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  margin: 0 0 1.1rem;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--tvz-ai);
}
.bi__icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: var(--tvz-ai-soft);
}
.bi__hero h1 {
  font-size: clamp(2rem, 5.6vw, 3.4rem);
  line-height: 1.05;
  text-wrap: balance;
  max-width: 20ch;
  margin-inline: auto;
}
.bi__lead {
  margin: 1.1rem auto 0;
  max-width: 56ch;
  font-size: clamp(1rem, 2.2vw, 1.15rem);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.bi__badges {
  list-style: none;
  padding: 0;
  margin: 1.5rem 0 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}
.bi__badges li {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  background: var(--tvz-glass-bg);
  border: 1px solid var(--tvz-glass-border);
}
.bi__badges :deep(.v-icon) {
  color: rgb(var(--v-theme-success));
}
.bi__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.6rem;
  margin-top: 1.8rem;
}
.bi__price {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.9rem 0 0;
  font-size: 0.88rem;
  color: rgba(var(--v-theme-on-surface), 0.62);
}

/* section heads */
.bi__secHead {
  text-align: center;
  margin-bottom: 1.8rem;
}
.bi__secHead h2 {
  font-size: clamp(1.5rem, 3.8vw, 2.2rem);
}
.bi__secHead p {
  margin: 0.6rem auto 0;
  max-width: 52ch;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

/* you give / ai does */
.bi__split {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 1rem;
  align-items: stretch;
}
.bi__col {
  padding: 1.4rem 1.5rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: var(--tvz-glass-bg);
}
.bi__col--ai {
  border-color: rgba(var(--v-theme-primary), 0.35);
  background: linear-gradient(160deg, rgba(var(--v-theme-primary), 0.1), var(--tvz-glass-bg) 60%);
}
.bi__col h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.15rem;
  margin-bottom: 0.9rem;
}
.bi__col ul,
.bi__notes ul {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.bi__arrow {
  display: grid;
  place-items: center;
  color: rgb(var(--v-theme-primary));
  animation: nudge 1.8s ease-in-out infinite;
}
@keyframes nudge {
  50% {
    transform: translateX(5px);
  }
}

/* cards */
.bi__cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
.fcard {
  padding: 1.4rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: var(--tvz-glass-bg);
  transition:
    transform 0.25s,
    box-shadow 0.25s;
  animation: fadeUp 0.5s var(--d) ease both;
}
.fcard:hover {
  transform: translateY(-4px);
  box-shadow: var(--tvz-shadow-lg);
}
.fcard__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 13px;
  margin-bottom: 0.9rem;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
.fcard h4 {
  font-size: 1.05rem;
  margin-bottom: 0.4rem;
}
.fcard p,
.cap p {
  margin: 0;
  font-size: 0.9rem;
  color: rgba(var(--v-theme-on-surface), 0.68);
}
.bi__result {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  margin-top: 1rem;
  padding: 1.3rem 1.5rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid rgba(var(--v-theme-success), 0.35);
  background: rgba(var(--v-theme-success), 0.07);
}
.bi__result :deep(.v-icon) {
  color: rgb(var(--v-theme-success));
  margin-top: 0.15rem;
}
.bi__result h3 {
  font-size: 1.1rem;
  margin-bottom: 0.35rem;
}
.bi__result p {
  margin: 0;
}
.bi__caps {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.8rem 1.5rem;
}
.cap {
  display: flex;
  gap: 0.8rem;
  padding: 1rem 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.cap > :deep(.v-icon) {
  color: rgb(var(--v-theme-primary));
  margin-top: 0.1rem;
}
.cap b {
  display: block;
  margin-bottom: 0.2rem;
}
.bi__notes {
  padding: 1.4rem 1.5rem;
  border-radius: var(--tvz-radius-lg);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.bi__notes h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.1rem;
  margin-bottom: 0.8rem;
}
.bi__final {
  text-align: center;
  padding: clamp(2rem, 6vw, 3.5rem) 1.5rem;
  border-radius: 24px;
  background:
    radial-gradient(120% 140% at 50% 0%, rgba(var(--v-theme-primary), 0.22), transparent 60%),
    var(--tvz-glass-bg);
  border: 1px solid var(--tvz-glass-border);
}
.bi__final h2 {
  font-size: clamp(1.4rem, 3.6vw, 2.1rem);
  max-width: 24ch;
  margin: 0 auto 1.5rem;
  text-wrap: balance;
}
.bi__others {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem 1rem;
  margin-top: 1.5rem;
  font-size: 0.9rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.bi__others a {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
  font-weight: 600;
}
@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}

@media (max-width: 860px) {
  .bi__split {
    grid-template-columns: 1fr;
  }
  .bi__arrow {
    transform: rotate(90deg);
    animation: none;
  }
  .bi__cards,
  .bi__caps {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bi__hero::before,
  .bi__arrow,
  .fcard {
    animation: none;
  }
}
</style>
