<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import { fetchPricing } from '@/services/platform'

/**
 * Homepage advertisement for the affiliate program. A designed, interactive
 * promo card — pointer parallax on the emblem, a count-up on the reward figure,
 * drifting aurora + shimmer. Copy only: the real link lives in Account → Afiliere
 * and on the create-business page.
 */
const { t } = useI18n()
const auth = useAuthStore()
const { isAuthenticated } = storeToRefs(auth)

const enabled = ref(false)
const reward = ref(0)
const displayN = ref(0)
const card = ref<HTMLElement | null>(null)

let interactive = false

function countUp(target: number): void {
  if (!interactive || target <= 0) {
    displayN.value = target
    return
  }
  const dur = 850
  const t0 = performance.now()
  const step = (now: number): void => {
    const p = Math.min(1, (now - t0) / dur)
    displayN.value = Math.round(target * (1 - Math.pow(1 - p, 3)))
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function onMove(e: PointerEvent): void {
  if (!interactive || !card.value) return
  const r = card.value.getBoundingClientRect()
  card.value.style.setProperty('--mx', String((e.clientX - r.left) / r.width - 0.5))
  card.value.style.setProperty('--my', String((e.clientY - r.top) / r.height - 0.5))
}
function onLeave(): void {
  card.value?.style.setProperty('--mx', '0')
  card.value?.style.setProperty('--my', '0')
}

onMounted(async () => {
  interactive =
    typeof window !== 'undefined' &&
    window.matchMedia('(pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  try {
    const pricing = await fetchPricing()
    enabled.value = pricing.affiliateEnabled
    reward.value = pricing.affiliateRewardCredits
    countUp(reward.value)
  } catch {
    /* leave hidden */
  }

  if (interactive) window.addEventListener('pointermove', onMove, { passive: true })
})

onBeforeUnmount(() => window.removeEventListener('pointermove', onMove))
</script>

<template>
  <section
    v-if="enabled"
    ref="card"
    class="aff"
    @pointerleave="onLeave"
  >
    <div class="aff__bg" aria-hidden="true" />
    <div class="aff__grid" aria-hidden="true" />
    <div class="aff__shine" aria-hidden="true" />

    <div class="aff__content">
      <span class="aff__eyebrow">
        <span class="aff__dot" />
        {{ t('affiliate.badge') }}
      </span>
      <h2 class="aff__title">
        {{ t('affiliate.adHeadline') }}
        <span class="aff__num">{{ displayN }}</span>
        {{ t('affiliate.adHeadlineTail') }}
      </h2>
      <p class="aff__sub">{{ t('affiliate.adSub') }}</p>
      <RouterLink
        class="aff__cta"
        :to="isAuthenticated ? { name: 'account', query: { tab: 'affiliate' } } : { name: 'create' }"
      >
        {{ t('affiliate.adCta') }}
        <v-icon icon="mdi-arrow-right" size="17" />
      </RouterLink>
    </div>

    <div class="aff__visual" aria-hidden="true">
      <span class="aff__coin aff__coin--1" />
      <span class="aff__coin aff__coin--2" />
      <span class="aff__coin aff__coin--3" />
      <span class="aff__emblem"><v-icon icon="mdi-gift-outline" size="44" /></span>
    </div>
  </section>
</template>

<style scoped>
.aff {
  --mx: 0;
  --my: 0;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  min-height: 190px;
  padding: clamp(1.4rem, 3.5vw, 2.1rem) clamp(1.4rem, 3.5vw, 2.4rem);
  border-radius: var(--tvz-radius-xl);
  border: 1px solid rgba(255, 255, 255, 0.14);
  background:
    radial-gradient(120% 140% at 100% 0%, #4f3ad6 0%, transparent 55%),
    linear-gradient(115deg, #2a2a80 0%, #5b4bd8 48%, #1c8fa6 120%);
  box-shadow: var(--tvz-shadow-lg);
  perspective: 900px;
  isolation: isolate;
}

/* drifting aurora */
.aff__bg {
  position: absolute;
  inset: -30%;
  z-index: 0;
  background:
    radial-gradient(28% 40% at 20% 30%, rgba(120, 220, 255, 0.5), transparent 60%),
    radial-gradient(26% 38% at 78% 68%, rgba(180, 130, 255, 0.55), transparent 62%);
  filter: blur(28px);
  animation: aff-drift 16s ease-in-out infinite alternate;
}
@keyframes aff-drift {
  0% {
    transform: translate3d(-4%, -3%, 0) rotate(0deg);
  }
  100% {
    transform: translate3d(5%, 4%, 0) rotate(12deg);
  }
}

/* dotted texture, faded out toward the right */
.aff__grid {
  position: absolute;
  inset: 0;
  z-index: 0;
  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.4) 1px, transparent 1px);
  background-size: 22px 22px;
  opacity: 0.14;
  -webkit-mask-image: linear-gradient(100deg, #000 0%, transparent 62%);
  mask-image: linear-gradient(100deg, #000 0%, transparent 62%);
}

/* periodic shimmer sweep */
.aff__shine {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 40%;
  z-index: 1;
  background: linear-gradient(
    100deg,
    transparent 0%,
    rgba(255, 255, 255, 0.14) 45%,
    rgba(255, 255, 255, 0.28) 50%,
    rgba(255, 255, 255, 0.14) 55%,
    transparent 100%
  );
  transform: skewX(-16deg) translateX(-160%);
  animation: aff-sweep 7s ease-in-out infinite;
}
@keyframes aff-sweep {
  0%,
  62% {
    transform: skewX(-16deg) translateX(-160%);
  }
  92%,
  100% {
    transform: skewX(-16deg) translateX(420%);
  }
}

.aff__content {
  position: relative;
  z-index: 2;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  color: #fff;
}
.aff__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.78);
}
.aff__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #6bffb0;
  box-shadow: 0 0 0 0 rgba(107, 255, 176, 0.6);
  animation: aff-pulse 2.4s ease-out infinite;
}
@keyframes aff-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(107, 255, 176, 0.55);
  }
  70%,
  100% {
    box-shadow: 0 0 0 10px rgba(107, 255, 176, 0);
  }
}
.aff__title {
  margin: 0.2rem 0 0;
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: clamp(1.45rem, 3.4vw, 2.15rem);
  line-height: 1.12;
  letter-spacing: -0.02em;
  text-wrap: balance;
}
.aff__num {
  display: inline-block;
  min-width: 1.4ch;
  font-variant-numeric: tabular-nums;
  background: linear-gradient(180deg, #ffffff, #bfe9ff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.aff__sub {
  margin: 0.15rem 0 0;
  max-width: 46ch;
  font-size: 0.94rem;
  color: rgba(255, 255, 255, 0.82);
}
.aff__cta {
  align-self: flex-start;
  margin-top: 0.7rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.5rem 1rem;
  border-radius: var(--tvz-radius-pill);
  background: #fff;
  color: #221a4d;
  font-size: 0.85rem;
  font-weight: 650;
  text-decoration: none;
  box-shadow: 0 6px 20px -6px rgba(0, 0, 0, 0.4);
  transition:
    transform var(--tvz-dur-fast) var(--tvz-ease-out),
    background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.aff__cta .v-icon {
  transition: transform var(--tvz-dur-fast) var(--tvz-ease-out);
}
.aff__cta:hover {
  background: rgba(255, 255, 255, 0.92);
}
.aff__cta:hover .v-icon {
  transform: translateX(3px);
}

/* --- interactive emblem --- */
.aff__visual {
  position: relative;
  z-index: 2;
  flex: none;
  width: 150px;
  height: 150px;
  transform-style: preserve-3d;
}
.aff__emblem {
  position: absolute;
  inset: 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(150deg, #ffffff 0%, #d7ccff 100%);
  box-shadow:
    0 10px 30px -6px rgba(0, 0, 0, 0.45),
    inset 0 0 0 6px rgba(255, 255, 255, 0.35);
  transform: rotateX(calc(var(--my) * -12deg)) rotateY(calc(var(--mx) * 16deg));
  transition: transform var(--tvz-dur-med) var(--tvz-ease-out);
}
.aff__emblem .v-icon {
  color: #5b47d8;
  filter: drop-shadow(0 3px 6px rgba(70, 40, 160, 0.35));
}
.aff__coin {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fff, #cfe6ff 70%);
  box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.35);
  animation: aff-bob 3.4s ease-in-out infinite;
}
.aff__coin--1 {
  top: 4px;
  left: 12px;
  animation-delay: 0s;
}
.aff__coin--2 {
  top: 30px;
  right: 0;
  width: 11px;
  height: 11px;
  animation-delay: 0.7s;
}
.aff__coin--3 {
  bottom: 6px;
  left: 30px;
  width: 13px;
  height: 13px;
  animation-delay: 1.4s;
}
@keyframes aff-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-9px);
  }
}

@media (max-width: 720px) {
  .aff {
    min-height: 0;
  }
  .aff__visual {
    width: 96px;
    height: 96px;
    align-self: flex-start;
  }
  .aff__emblem {
    inset: 8px;
  }
  .aff__emblem .v-icon {
    font-size: 30px !important;
  }
}
@media (max-width: 460px) {
  .aff__visual {
    display: none;
  }
}
</style>
