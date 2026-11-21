<script setup lang="ts">
/**
 * Animated replica of the Advanced flow: the name step, the one-time
 * unlock, then the real builder screen (Chat/Files, sandbox status pill
 * with its real states, the "what I did" log, an attached image, the
 * automatic repair, Publish → Continue to budget). Labels come from the
 * builder's own i18n (`proV2.*`, `pro.*`, `advanced.*`, `unlock.*`).
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import './demo.css'

const props = defineProps<{ step: number; price?: number | null }>()
const { t } = useI18n()
const d = (k: string) => t(`binfo.advanced.demo.${k}`)

// Sandbox status pill: walks through the real states within a step.
const status = ref('')
let timers: ReturnType<typeof setTimeout>[] = []
function run(seq: [number, string][]): void {
  timers.forEach(clearTimeout)
  timers = seq.map(([ms, s]) => setTimeout(() => (status.value = s), ms))
}
watch(
  () => props.step,
  (s) => {
    if (s === 2)
      run([
        [0, 'booting'],
        [1300, 'installing'],
        [2600, 'ready'],
      ])
    else if (s === 3)
      run([
        [0, 'ready'],
        [1200, 'error'],
        [2100, 'fixing'],
        [3300, 'ready'],
      ])
    else run([[0, 'ready']])
  },
  { immediate: true },
)
onBeforeUnmount(() => timers.forEach(clearTimeout))
const statusLabel = computed(
  () =>
    ({
      booting: t('proV2.statusBooting'),
      installing: t('proV2.statusInstalling'),
      ready: t('proV2.statusReady'),
      error: t('proV2.statusErrorDetected'),
      fixing: t('proV2.statusFixing'),
    })[status.value] ?? '',
)
const live = computed(() => status.value === 'ready')
const pages = computed(() => [0, 1, 2].map((i) => d(`pages.${i}`)))
const actions = computed(() => [0, 1, 2, 3].map((i) => d(`actions.${i}`)))
</script>

<template>
  <div class="dm-win da">
    <div class="dm-chrome"><i /><i /><i /><span>totalvizibil.ro/{{ step < 2 ? 'create/advanced' : 'website/builder' }}</span></div>

    <!-- 1. Name -->
    <div v-if="step === 0" key="s0" class="da__form">
      <h4 class="dm-type">{{ t('advanced.pitchTitle') }}</h4>
      <div class="da__field">
        <small>{{ t('advanced.fieldName') }}</small>
        <span class="da__typed">Clinica Dentară Zâmbet</span>
      </div>
      <span class="dm-btn dm-press">{{ t('advanced.cta') }} <v-icon icon="mdi-arrow-right" size="14" /></span>
      <p class="da__flow">{{ t('advanced.flowNote') }}</p>
    </div>

    <!-- 2. Account + unlock -->
    <div v-else-if="step === 1" key="s1" class="da__form">
      <span class="da__lock"><v-icon icon="mdi-lock-open-variant-outline" size="26" /></span>
      <h4>{{ t('unlock.title') }}</h4>
      <p class="da__lead">{{ t('unlock.lead') }}</p>
      <span class="dm-btn dm-press">
        {{ price ? t('unlock.pay', { credits: price }) : t('unlock.title') }}
      </span>
      <p class="da__bonus"><v-icon icon="mdi-gift-outline" size="15" /> {{ d('bonus') }}</p>
    </div>

    <!-- 3-5. The builder -->
    <div v-else key="sb" class="da__builder">
      <div class="da__top">
        <div class="da__tabs">
          <span class="on">{{ t('proV2.tabChat') }}</span>
          <span>{{ t('proV2.files') }}</span>
        </div>
        <span class="dm-pill" :class="{ 'dm-pill--ok': live, 'dm-pill--warn': status === 'error' || status === 'fixing' }">
          <span v-if="!live" class="dm-spin" /><v-icon v-else icon="mdi-circle" size="8" /> {{ statusLabel }}
        </span>
        <span v-if="step === 4" class="dm-pill dm-pill--ok da__pub"><v-icon icon="mdi-check" size="12" /> {{ t('proV2.published') }}</span>
        <span v-else class="dm-btn">{{ t('proV2.publish') }}</span>
      </div>
      <div class="da__grid">
        <div class="da__chat">
          <TransitionGroup name="dm-in" tag="div" class="da__log">
            <div key="p" class="dm-msg dm-msg--u"><p>{{ d('prompt') }}</p></div>
            <div key="w" class="dm-msg">
              <span class="dm-av">AI</span>
              <div class="da__did">
                <b><v-icon icon="mdi-format-list-checks" size="13" /> {{ d('did') }}</b>
                <ul>
                  <li v-for="(a, i) in actions" :key="a" :style="{ animationDelay: `${step === 2 ? 0.5 + i * 0.6 : 0}s` }">
                    <v-icon icon="mdi-check" size="12" /> {{ a }}
                  </li>
                </ul>
                <p>{{ d('reply') }}</p>
              </div>
            </div>
            <div v-if="step >= 3" key="c" class="dm-msg dm-msg--u">
              <p>
                <span class="da__att"><v-icon icon="mdi-image-outline" size="12" /> {{ d('image') }}</span>
                {{ d('change') }}
              </p>
            </div>
          </TransitionGroup>
          <div class="da__input">
            <v-icon icon="mdi-paperclip" size="15" :title="t('proV2.attachImage')" />
            <span>{{ t('proV2.placeholder') }}</span>
          </div>
        </div>
        <div class="da__prev" :class="{ 'is-dim': !live }">
          <nav><b>Zâmbet</b><span v-for="p in pages" :key="p">{{ p }}</span></nav>
          <div class="da__hero" :class="{ 'has-photo': step >= 3 && live, 'dm-build': step === 3 && live }">
            <b>{{ d('heroTitle') }}</b>
            <span class="da__cta">{{ pages[2] }}</span>
          </div>
          <div class="da__rows"><span /><span /><span /></div>
          <div v-if="step === 4" class="da__done">
            <span class="dm-btn dm-press">{{ t('proV2.continueToBudget') }} <v-icon icon="mdi-arrow-right" size="14" /></span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.da__form {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.9rem;
  padding: 1.5rem;
  text-align: center;
  animation: dmSettle 0.4s both;
}
.da__form h4 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 18px;
  margin: 0;
}
.da__field {
  width: min(320px, 100%);
  padding: 0.5rem 0.75rem;
  border-radius: 10px;
  border: 1.5px solid rgb(var(--v-theme-primary));
  text-align: left;
}
.da__field small {
  display: block;
  font-size: 10px;
  color: rgb(var(--v-theme-primary));
}
.da__typed {
  display: inline-block;
  overflow: hidden;
  white-space: nowrap;
  border-right: 2px solid currentColor;
  animation:
    typing 1.6s 0.4s steps(22, end) both,
    caret 0.8s step-end infinite;
}
@keyframes typing {
  from {
    width: 0;
  }
  to {
    width: 22ch;
  }
}
@keyframes caret {
  50% {
    border-color: transparent;
  }
}
.da__flow,
.da__lead {
  margin: 0;
  max-width: 44ch;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.da__lock {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 16px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
.da__bonus {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-success));
}
.da__builder {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.da__top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.7rem;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.da__tabs {
  display: flex;
  gap: 0.2rem;
  padding: 0.15rem;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  margin-right: auto;
}
.da__tabs span {
  padding: 0.2rem 0.55rem;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}
.da__tabs .on {
  background: rgb(var(--v-theme-surface));
}
.da__grid {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  min-height: 0;
}
.da__chat {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  min-width: 0;
}
.da__log {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.5rem;
  font-size: 11.5px;
}
.da__did {
  padding: 0.5rem 0.65rem;
  border-radius: 13px 13px 13px 4px;
  background: rgba(var(--v-theme-on-surface), 0.07);
}
.da__did b {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 11px;
}
.da__did ul {
  margin: 0.3rem 0;
  padding: 0;
  list-style: none;
}
.da__did li {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  animation: dmSettle 0.3s both;
}
.da__did li .v-icon {
  color: rgb(var(--v-theme-success));
}
.da__did p {
  margin: 0;
}
.da__att {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.1rem 0.35rem;
  margin-right: 0.2rem;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.2);
  font-size: 10px;
}
.da__input {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.6rem;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.da__input span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.da__prev {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem;
  background: #f5f8fb;
  color: #12263a;
  transition: filter 0.4s;
}
.da__prev.is-dim {
  filter: grayscale(0.7) opacity(0.55);
}
.da__prev nav {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 10px;
}
.da__prev nav b {
  margin-right: auto;
  font-size: 12px;
}
.da__hero {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 0.4rem;
  min-height: 120px;
  padding: 0.8rem;
  border-radius: 10px;
  background: linear-gradient(135deg, #0e7490, #22d3ee);
  color: #fff;
}
.da__hero.has-photo {
  background:
    linear-gradient(0deg, rgba(0, 0, 0, 0.45), transparent 70%),
    radial-gradient(circle at 70% 35%, #fde8d4 0 18%, transparent 19%),
    linear-gradient(135deg, #7dd3fc, #0369a1);
}
.da__hero b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 18px;
}
.da__cta {
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  background: #fff;
  color: #0e7490;
}
.da__rows {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
}
.da__rows span {
  height: 46px;
  border-radius: 8px;
  background: #fff;
}
.da__done {
  position: absolute;
  inset: auto 0.6rem 0.6rem auto;
  animation: dmSettle 0.4s 0.4s both;
}
@media (max-width: 600px) {
  .da__grid {
    grid-template-columns: 1fr;
  }
  .da__chat {
    border-right: 0;
    order: 2;
  }
  .da__log > :first-child {
    display: none;
  }
}
</style>
