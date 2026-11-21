<script setup lang="ts">
/**
 * Animated replica of the Site Simplu studio: chat on the right (the real
 * assistant lines from `studio.msg.*`), the page building itself on the
 * left exactly like `BuildStage` does (empty canvas → sections appear one
 * by one, outlined and scanned), the build console, then style + color.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import './demo.css'

const props = defineProps<{ step: number; price?: number | null }>()
const { t } = useI18n()
const d = (k: string) => t(`binfo.easy.demo.${k}`)

type Msg = { u?: boolean; text: string }
const msgs = computed<Msg[]>(() => {
  const s = props.step
  const out: Msg[] = [{ text: t('studio.msg.opening') }, { u: true, text: d('bizMsg') }]
  if (s >= 1) out.push({ text: t('studio.msg.askServices') }, { u: true, text: d('servicesMsg') })
  if (s >= 2) out.push({ text: t('studio.msg.askPhotos') }, { u: true, text: d('photosMsg') })
  if (s >= 3) out.push({ text: t('studio.msg.askContact') }, { u: true, text: d('contactMsg') }, { text: d('done') })
  return out.slice(-4)
})
const consoleLines = computed(() => {
  const all = [0, 1, 2, 3, 4].map((i) => d(`build.${i}`))
  return [[all[0], all[1]], [all[2]], [all[3]], [all[4]], []][props.step] ?? []
})
const services = computed(() => d('servicesMsg').split(',').map((s) => s.trim()))
const ACCENTS = ['#4f46e5', '#059669', '#d97706', '#e11d48']
const chip = computed(() => t(`studio.step.${['intro', 'services', 'photos', 'contact', 'done'][props.step]}`))
</script>

<template>
  <div class="dm-win de" :class="`de--s${step}`">
    <div class="dm-chrome"><i /><i /><i /><span>totalvizibil.ro/create/easy</span></div>
    <div class="de__grid">
      <!-- live preview -->
      <div class="de__prev">
        <div v-if="step === 0" class="de__canvas">
          <div class="de__ghost"><b /><b /><b class="sh" /></div>
        </div>
        <div class="de__site" :style="step === 4 ? undefined : { '--acc': ACCENTS[0] }">
          <div :key="`h${step === 0}`" class="de__hero" :class="{ 'dm-build': step === 0 }">
            <small>{{ d('bizMsg').split(',')[0] }}</small>
            <b class="dm-type">{{ d('heroTitle') }}</b>
            <span class="de__btn" />
          </div>
          <div v-if="step >= 1" class="de__sec" :class="{ 'dm-build': step === 1 }">
            <i>01</i><b>{{ d('services') }}</b>
            <div class="de__cards">
              <span v-for="s in services" :key="s"><em />{{ s }}</span>
            </div>
          </div>
          <div v-if="step >= 2" class="de__sec" :class="{ 'dm-build': step === 2 }">
            <i>02</i><b>{{ d('gallery') }}</b>
            <div class="de__gal"><span /><span /><span /></div>
          </div>
          <template v-if="step >= 3">
            <div class="de__sec de__sec--sm" :class="{ 'dm-build': step === 3 }"><b>{{ d('about') }}</b><p /></div>
            <div class="de__sec de__sec--sm" :class="{ 'dm-build': step === 3 }" style="animation-delay: 0.6s"><b>{{ d('faq') }}</b><p /></div>
            <div class="de__sec de__sec--sm" :class="{ 'dm-build': step === 3 }" style="animation-delay: 0.9s"><b>{{ d('contact') }}</b><p /></div>
          </template>
          <div v-else-if="step >= 1" class="de__next">{{ step === 1 ? t('studio.build.next', { section: t('studio.build.sec.gallery') }) : t('studio.build.next', { section: t('studio.build.nextRest') }) }}</div>
        </div>
        <div v-if="consoleLines.length" :key="`c${step}`" class="dm-console">
          <b>{{ d('console') }}</b>
          <ul>
            <li v-for="(l, i) in consoleLines" :key="l" :style="{ animationDelay: `${i * 0.6}s` }">
              <v-icon icon="mdi-check" size="11" /> {{ l }}
            </li>
          </ul>
        </div>
        <div v-if="step === 0" class="de__empty">{{ d('empty') }}</div>
      </div>

      <!-- chat -->
      <div class="de__chat">
        <div class="de__chip">{{ step < 4 ? `${t('studio.stepOf', { n: step + 1, total: 4 })} · ${chip}` : d('styles') }}</div>
        <TransitionGroup v-if="step < 4" name="dm-in" tag="div" class="de__log">
          <div v-for="m in msgs" :key="m.text" class="dm-msg" :class="{ 'dm-msg--u': m.u }">
            <span v-if="!m.u" class="dm-av">A</span>
            <p>{{ m.text }}</p>
          </div>
        </TransitionGroup>
        <div v-else class="de__style">
          <div class="de__tpls">
            <span v-for="(tp, i) in ['classic', 'bold', 'minimal', 'warm', 'sharp', 'editorial']" :key="tp" :class="{ on: i === 1 }">
              {{ t(`studio.template.${tp}`) }}
            </span>
          </div>
          <div class="de__dots"><i v-for="c in ACCENTS" :key="c" :style="{ background: c }" /></div>
        </div>
        <div class="de__input"><span>{{ t('studio.inputPlaceholder') }}</span><i><v-icon icon="mdi-send" size="13" /></i></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.de__grid {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  min-height: 0;
}
.de__prev {
  position: relative;
  overflow: hidden;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: #f7f7fb;
  color: #1c1b2e;
}
.de__canvas {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(0, 0, 0, 0.09) 1px, transparent 1px);
  background-size: 16px 16px;
}
.de__ghost {
  position: absolute;
  inset: auto 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  opacity: 0.4;
}
.de__ghost b {
  height: 40px;
  border-radius: 8px;
  border: 1.5px dashed rgba(0, 0, 0, 0.25);
}
.de__ghost .sh {
  width: 60%;
}
.de__empty {
  position: absolute;
  top: 45%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 0.5rem 0.9rem;
  border-radius: 10px;
  background: #fff;
  font-weight: 700;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
  white-space: nowrap;
  animation: fadeOut 0.4s 1.2s ease forwards;
}
@keyframes fadeOut {
  to {
    opacity: 0;
  }
}
.de__site {
  --acc: #4f46e5;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem;
}
.de--s4 .de__site {
  animation: accent 5s linear both;
}
@keyframes accent {
  0%,
  24% {
    --acc: #4f46e5;
  }
  25%,
  49% {
    --acc: #059669;
  }
  50%,
  74% {
    --acc: #d97706;
  }
  75%,
  100% {
    --acc: #e11d48;
  }
}
.de--s0 .de__hero {
  animation-delay: 1.3s;
}
.de__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 1.2rem 0.6rem 1rem;
  border-radius: 10px;
  background: linear-gradient(160deg, color-mix(in srgb, var(--acc) 14%, #fff), #fff);
  text-align: center;
}
.de__hero small {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--acc);
}
.de__hero b {
  font-size: 17px;
  font-family: 'Space Grotesk Variable', sans-serif;
}
.de__btn {
  width: 70px;
  height: 16px;
  margin-top: 0.3rem;
  border-radius: 6px;
  background: var(--acc);
}
.de__sec {
  padding: 0.6rem;
  border-radius: 10px;
  background: #fff;
}
.de__sec > i {
  font-style: normal;
  font-size: 9px;
  color: var(--acc);
  margin-right: 0.35rem;
}
.de__sec > b {
  font-family: 'Space Grotesk Variable', sans-serif;
}
.de__sec--sm p {
  height: 7px;
  width: 70%;
  margin: 0.4rem 0 0;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.08);
}
.de__cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
  margin-top: 0.45rem;
}
.de__cards span {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.4rem;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 600;
  background: #f4f4fa;
}
.de__cards em {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: var(--acc);
}
.de__gal {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
  margin-top: 0.45rem;
}
.de__gal span {
  height: 44px;
  border-radius: 7px;
  background: linear-gradient(135deg, #f6c77a, #c97b3e);
}
.de__gal span:nth-child(2) {
  background: linear-gradient(135deg, #e9b98a, #8d5a32);
}
.de__gal span:nth-child(3) {
  background: linear-gradient(135deg, #f3dfb6, #b68645);
}
.de__next {
  padding: 1rem;
  border-radius: 10px;
  border: 2px dashed rgba(124, 92, 255, 0.4);
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  color: rgba(90, 80, 150, 0.9);
}
.de__chat {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem;
  min-width: 0;
}
.de__chip {
  align-self: flex-start;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  background: var(--tvz-ai-soft);
  color: var(--tvz-ai);
}
.de__log {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.45rem;
  font-size: 11.5px;
}
.de__style {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.de__tpls {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.35rem;
}
.de__tpls span {
  padding: 0.45rem;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.de__tpls .on {
  outline: 2px solid rgb(var(--v-theme-primary));
}
.de__dots {
  display: flex;
  gap: 0.45rem;
}
.de__dots i {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  animation: dot 5s linear infinite;
}
.de__dots i:nth-child(2) {
  animation-delay: 1.25s;
}
.de__dots i:nth-child(3) {
  animation-delay: 2.5s;
}
.de__dots i:nth-child(4) {
  animation-delay: 3.75s;
}
@keyframes dot {
  0%,
  20% {
    box-shadow: 0 0 0 3px rgb(var(--v-theme-surface)), 0 0 0 5px currentColor;
  }
  25%,
  100% {
    box-shadow: none;
  }
}
.de__input {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.4rem 0.4rem 0.7rem;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.de__input span {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.de__input i {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: rgb(var(--v-theme-primary));
  color: #fff;
}
@media (max-width: 600px) {
  .de__grid {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(250px, auto) auto;
  }
  .de__prev {
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  }
  .de__log .dm-msg:nth-last-child(n + 3) {
    display: none;
  }
}
</style>
