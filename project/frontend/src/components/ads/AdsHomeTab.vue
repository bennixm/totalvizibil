<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminHint from '@/components/admin/AdminHint.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import GoogleAdsIssueList from '@/components/admin/google-ads/GoogleAdsIssueList.vue'
import GoogleAdsScoreRing from '@/components/admin/google-ads/GoogleAdsScoreRing.vue'
import AdsRunPanel from './AdsRunPanel.vue'
import type { UserCampaignDetail } from '@/services/googleAdsUser'
import { adsMoney, creditsOf, dateTime, healthOf, isUrgent, nextStep, strengthTone } from './format'

/**
 * Start page of one campaign, for people who have never managed ads: ONE
 * next step with ONE button, then the results in plain words. Everything
 * technical lives in the "details" tab.
 */
const props = defineProps<{ detail: UserCampaignDetail }>()
const emit = defineEmits<{
  (e: 'changed'): void
  (e: 'goto', tab: string): void
  (e: 'reconnect'): void
  (e: 'sync'): void
}>()
const { t, n, locale } = useI18n()

const c = computed(() => props.detail.campaign)
const ev = computed(() => props.detail.snapshot?.evaluation)
const cur = computed(() => ev.value?.performance.current)
const currency = computed(() => props.detail.snapshot?.campaign.currencyCode ?? c.value.currencyCode)
const step = computed(() => nextStep(props.detail))
const health = computed(() => healthOf(c.value.score))
const ownIssues = computed(() => (ev.value?.issues ?? []).filter((i) => !i.autoFixable))
const lastCycle = computed(() => props.detail.cycles.find((x) => x.status !== 'running') ?? null)

const yours = ref<HTMLElement | null>(null)
const ICONS = {
  reconnect: 'mdi-link-variant-off',
  running: 'mdi-robot-outline',
  approve: 'mdi-account-check-outline',
  paused: 'mdi-pause-circle-outline',
  answer: 'mdi-chat-question-outline',
  sync: 'mdi-cloud-sync-outline',
  optimize: 'mdi-auto-fix',
  yours: 'mdi-alert-outline',
  done: 'mdi-check-decagram',
} as const

const results = computed(() => [
  { key: 'seen', icon: 'mdi-eye-outline', value: n(cur.value?.impressions ?? 0) },
  { key: 'clicked', icon: 'mdi-cursor-default-click-outline', value: n(cur.value?.clicks ?? 0) },
  { key: 'spent', icon: 'mdi-cash', value: adsMoney(cur.value?.costMicros, currency.value, locale.value) },
  { key: 'actions', icon: 'mdi-phone-check-outline', value: n(Math.round(cur.value?.conversions ?? 0)) },
])

const lastText = computed(() => {
  const x = lastCycle.value
  if (!x) return ''
  if (!x.tasksApplied && !x.tasksProposed) {
    return x.chargedMinor
      ? t('ads.home.lastNothing')
      : t('ads.home.lastReturned')
  }
  return t('ads.home.lastDone', { applied: x.tasksApplied, proposed: x.tasksProposed })
})
</script>

<template>
  <div class="ho">
    <!-- The one thing to do now -->
    <section class="nx" :class="`nx--${step}`" data-guide="ads-next">
      <span class="nx__icon"><v-icon :icon="ICONS[step]" size="26" /></span>
      <div class="nx__body">
        <p class="nx__eyebrow">{{ t('ads.home.now') }}</p>
        <h2>{{ t(`ads.home.step.${step}.title`, { n: detail.pending.length }) }}</h2>
        <p class="nx__text">{{ t(`ads.home.step.${step}.text`) }}</p>
        <div class="nx__actions">
          <v-btn v-if="step === 'reconnect'" color="primary" size="large" @click="emit('reconnect')">
            {{ t('ads.home.step.reconnect.cta') }}
          </v-btn>
          <v-btn v-else-if="step === 'approve'" color="primary" size="large" append-icon="mdi-arrow-right" @click="emit('goto', 'proposals')">
            {{ t('ads.home.step.approve.cta') }}
          </v-btn>
          <v-btn v-else-if="step === 'answer'" color="primary" size="large" append-icon="mdi-arrow-right" @click="emit('goto', 'chat')">
            {{ t('ads.home.step.answer.cta') }}
          </v-btn>
          <v-btn v-else-if="step === 'paused'" color="primary" size="large" append-icon="mdi-arrow-right" @click="emit('goto', 'settings')">
            {{ t('ads.home.step.paused.cta') }}
          </v-btn>
          <v-btn v-else-if="step === 'sync'" color="primary" size="large" @click="emit('sync')">
            {{ t('ads.home.step.sync.cta') }}
          </v-btn>
          <v-btn v-else-if="step === 'yours'" color="primary" size="large" append-icon="mdi-arrow-down" @click="yours?.scrollIntoView({ behavior: 'smooth', block: 'center' })">
            {{ t('ads.home.step.yours.cta') }}
          </v-btn>
          <v-btn v-else-if="step === 'done'" variant="tonal" color="primary" size="large" prepend-icon="mdi-chat-outline" @click="emit('goto', 'chat')">
            {{ t('ads.home.step.done.cta') }}
          </v-btn>
          <v-btn v-else-if="step === 'running'" variant="tonal" color="primary" @click="emit('goto', 'history')">
            {{ t('ads.home.step.running.cta') }}
          </v-btn>
        </div>
        <AdsRunPanel v-if="step === 'optimize'" class="nx__run" :detail="detail" @changed="emit('changed')" @goto="(v) => emit('goto', v)" />
      </div>
    </section>

    <!-- First time: what happens, in three steps -->
    <section v-if="!detail.firstCycleDone" class="how">
      <h3>{{ t('ads.home.howTitle') }}</h3>
      <ol>
        <li v-for="i in 3" :key="i"><span class="how__n">{{ i }}</span><span>{{ t(`ads.home.how${i}`) }}</span></li>
      </ol>
    </section>

    <!-- Optimization score + results in plain words -->
    <section class="bx">
      <header class="bx__head">
        <h3>{{ t('ads.home.resultsTitle') }}</h3>
        <span class="bx__sub">{{ t('ads.home.period') }}</span>
      </header>
      <div class="sc">
        <GoogleAdsScoreRing :score="c.score" :size="104" :stroke="9" />
        <div class="sc__text">
          <p class="sc__label">{{ t('ads.home.scoreTitle') }} <AdminHint :text="t('ads.home.scoreHint')" /></p>
          <p class="sc__health">{{ health ? t(`ads.home.health.${health}`) : t('ads.home.scoreNone') }}</p>
          <p class="sc__strength">
            {{ t('ads.home.adQuality') }}
            <GaChip :tone="strengthTone(c.adStrength)">{{ t(`ads.strength.${c.adStrength ?? 'UNKNOWN'}`, c.adStrength ?? '–') }}</GaChip>
            <AdminHint :text="t('ads.home.adQualityHint')" size="sm" />
          </p>
        </div>
      </div>
      <dl class="rs">
        <div v-for="r in results" :key="r.key">
          <dt><v-icon :icon="r.icon" size="16" /> {{ t(`ads.home.result.${r.key}`) }}<AdminHint v-if="r.key === 'seen' && !cur?.impressions" :text="t('ads.home.noViews')" size="sm" /></dt>
          <dd>{{ r.value }}</dd>
        </div>
      </dl>
      <p v-if="lastCycle" class="bx__note">
        <b>{{ t('ads.home.lastTitle', { when: dateTime(lastCycle.startedAt, locale) }) }}</b>
        {{ lastText }}
        <template v-if="lastCycle.chargedMinor">{{ t('ads.home.paid', { credits: creditsOf(lastCycle.chargedMinor, locale) }) }}</template>
      </p>
      <v-btn variant="text" size="small" append-icon="mdi-arrow-right" class="bx__more" @click="emit('goto', 'overview')">
        {{ t('ads.home.details') }}
      </v-btn>
    </section>

    <!-- Only the owner can do these -->
    <section v-if="ownIssues.length" ref="yours" class="bx">
      <header class="bx__head">
        <h3>{{ t('ads.home.yoursTitle') }} <AdminHint :text="t(ownIssues.some(isUrgent) ? 'ads.home.yoursUrgent' : 'ads.home.yoursText')" /></h3>
      </header>
      <GoogleAdsIssueList :issues="ownIssues" expanded />
    </section>
  </div>
</template>

<style scoped>
.ho {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.nx {
  display: flex;
  gap: 1rem;
  padding: 1.35rem 1.4rem;
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: var(--tvz-radius-lg);
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.1), rgb(var(--v-theme-surface)) 85%);
}
.nx--reconnect,
.nx--yours,
.nx--paused {
  border-color: rgba(var(--v-theme-warning), 0.45);
  background: linear-gradient(180deg, rgba(var(--v-theme-warning), 0.1), rgb(var(--v-theme-surface)) 85%);
}
.nx--done {
  border-color: rgba(var(--v-theme-success), 0.4);
  background: linear-gradient(180deg, rgba(var(--v-theme-success), 0.09), rgb(var(--v-theme-surface)) 85%);
}
.nx__icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.14);
}
.nx--reconnect .nx__icon,
.nx--yours .nx__icon,
.nx--paused .nx__icon {
  color: rgb(var(--v-theme-warning));
  background: rgba(var(--v-theme-warning), 0.14);
}
.nx--done .nx__icon {
  color: rgb(var(--v-theme-success));
  background: rgba(var(--v-theme-success), 0.14);
}
.nx__body {
  flex: 1;
  min-width: 0;
}
.nx__eyebrow {
  margin: 0 0 0.2rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.nx h2 {
  margin: 0;
  font-size: 1.3rem;
  line-height: 1.3;
  font-weight: 700;
}
.nx__text {
  margin: 0.4rem 0 0;
  max-width: 60ch;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.nx__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1rem;
}
.nx__actions:empty {
  display: none;
}
.nx__run {
  margin-top: 1rem;
}
.how,
.bx {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1.15rem 1.25rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
}
.how h3,
.bx h3 {
  margin: 0;
  font-size: var(--tvz-fs-section, 1.05rem);
  font-weight: 600;
}
.how ol {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
  gap: 0.9rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.how li {
  display: flex;
  gap: 0.6rem;
  line-height: 1.45;
  font-size: var(--tvz-fs-small);
}
.how__n {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
.bx__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 1rem;
}
.bx__sub,
.bx__note {
  margin: 0;
  font-size: var(--tvz-fs-small);
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.bx__more {
  align-self: flex-start;
  margin-left: -0.75rem;
}
.sc {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem 1.25rem;
}
.sc__text {
  flex: 1 1 12rem;
  min-width: 0;
}
.sc__text p {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
}
.sc__label {
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.sc .sc__health {
  margin: 0.15rem 0 0.4rem;
  font-size: 1.15rem;
  font-weight: 700;
}
.sc__strength {
  font-size: var(--tvz-fs-small);
}
.rs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
  margin: 0;
}
.rs > div {
  min-width: 0;
  padding: 0.8rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.rs dt {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  font-size: var(--tvz-fs-caption);
  line-height: 1.35;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.rs dd {
  margin: 0.3rem 0 0;
  font-size: 1.25rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .nx {
    flex-direction: column;
    padding: 1.1rem;
  }
  .nx__actions .v-btn {
    width: 100%;
  }
  .rs {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
