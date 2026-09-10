<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import { fetchPricing } from '@/services/platform'

/**
 * Homepage promo for the affiliate program — the "Firma" night panel:
 * dark, calm, with one warm amber glow (a sign switching on). One earned
 * motion moment: a single count-up on the reward figure. Copy only — the
 * real link lives in Account → Afiliere and on the create-business page.
 */
const { t } = useI18n()
const auth = useAuthStore()
const { isAuthenticated } = storeToRefs(auth)

const enabled = ref(false)
const reward = ref(0)
const displayN = ref(0)

let interactive = false

function countUp(target: number): void {
  if (!interactive || target <= 0) {
    displayN.value = target
    return
  }
  const dur = 700
  const t0 = performance.now()
  const step = (now: number): void => {
    const p = Math.min(1, (now - t0) / dur)
    displayN.value = Math.round(target * (1 - Math.pow(1 - p, 3)))
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

onMounted(async () => {
  interactive =
    typeof window !== 'undefined' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  try {
    const pricing = await fetchPricing()
    enabled.value = pricing.affiliateEnabled
    reward.value = pricing.affiliateRewardCredits
    countUp(reward.value)
  } catch {
    /* leave hidden */
  }
})
</script>

<template>
  <section v-if="enabled" class="aff">
    <span class="aff__glow" aria-hidden="true" />

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

    <span class="aff__emblem" aria-hidden="true">
      <v-icon icon="mdi-gift-outline" size="40" />
    </span>
  </section>
</template>

<style scoped>
.aff {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  min-height: 172px;
  padding: clamp(1.4rem, 3.5vw, 2rem) clamp(1.4rem, 3.5vw, 2.2rem);
  border-radius: var(--tvz-radius-lg);
  border: 1px solid rgba(226, 232, 246, 0.12);
  background: var(--tvz-night, #0c1424);
  box-shadow: var(--tvz-shadow-md);
  isolation: isolate;
}

/* one cool glow, top-right */
.aff__glow {
  position: absolute;
  z-index: 0;
  top: -55%;
  right: -12%;
  width: 340px;
  height: 340px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(91, 141, 239, 0.28), transparent 68%);
  pointer-events: none;
}

.aff__content {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  color: #eef1f7;
}
.aff__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: #8794ad;
}
.aff__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5b8def;
  box-shadow: 0 0 10px rgba(91, 141, 239, 0.6);
}
.aff__title {
  margin: 0.2rem 0 0;
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: clamp(1.4rem, 3.2vw, 2rem);
  line-height: 1.14;
  letter-spacing: -0.01em;
  text-wrap: balance;
}
.aff__num {
  display: inline-block;
  min-width: 1.4ch;
  font-variant-numeric: tabular-nums;
  color: #5b8def;
}
.aff__sub {
  margin: 0.1rem 0 0;
  max-width: 46ch;
  font-size: 0.94rem;
  color: rgba(238, 241, 247, 0.78);
}
.aff__cta {
  align-self: flex-start;
  margin-top: 0.7rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1.1rem;
  border-radius: var(--tvz-radius-pill);
  background: #5b8def;
  color: #0c1220;
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
  transition:
    transform var(--tvz-dur-fast) var(--tvz-ease-out),
    box-shadow var(--tvz-dur-fast) var(--tvz-ease-out);
}
.aff__cta .v-icon {
  transition: transform var(--tvz-dur-fast) var(--tvz-ease-out);
}
.aff__cta:hover {
  box-shadow: 0 0 0 3px rgba(91, 141, 239, 0.28);
}
.aff__cta:hover .v-icon {
  transform: translateX(3px);
}

.aff__emblem {
  position: relative;
  z-index: 1;
  flex: none;
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: rgba(238, 241, 247, 0.06);
  box-shadow: inset 0 0 0 1.5px rgba(91, 141, 239, 0.45);
}
.aff__emblem .v-icon {
  color: #5b8def;
}

@media (max-width: 720px) {
  .aff {
    min-height: 0;
  }
  .aff__emblem {
    width: 72px;
    height: 72px;
    align-self: flex-start;
  }
  .aff__emblem .v-icon {
    font-size: 30px !important;
  }
}
@media (max-width: 460px) {
  .aff__emblem {
    display: none;
  }
}
</style>
