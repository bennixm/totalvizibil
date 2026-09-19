<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import { fetchPricing } from '@/services/platform'

/** Homepage promo for an active credits discount — same night-panel language
 *  as AffiliateBanner, in a warm amber tone to read as "offer" rather than
 *  "referral". Copy only — the real purchase flow is the Wallet page. */
const { t } = useI18n()
const auth = useAuthStore()
const { isAuthenticated } = storeToRefs(auth)

const enabled = ref(false)
const pct = ref(0)

onMounted(async () => {
  try {
    const pricing = await fetchPricing()
    enabled.value = pricing.creditsDiscountEnabled
    pct.value = pricing.creditsDiscountPct
  } catch {
    /* leave hidden */
  }
})
</script>

<template>
  <section v-if="enabled" class="disc">
    <span class="disc__glow" aria-hidden="true" />

    <div class="disc__content">
      <span class="disc__eyebrow">
        <span class="disc__dot" />
        {{ t('discountBanner.badge') }}
      </span>
      <h2 class="disc__title">
        <span class="disc__num">-{{ pct }}%</span>
        {{ t('discountBanner.headline') }}
      </h2>
      <p class="disc__sub">{{ t('discountBanner.sub') }}</p>
      <RouterLink
        class="disc__cta"
        :to="isAuthenticated ? { name: 'wallet' } : { name: 'login' }"
      >
        {{ t('discountBanner.cta') }}
        <v-icon icon="mdi-arrow-right" size="17" />
      </RouterLink>
    </div>

    <span class="disc__emblem" aria-hidden="true">
      <v-icon icon="mdi-sale-outline" size="40" />
    </span>
  </section>
</template>

<style scoped>
.disc {
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

.disc__glow {
  position: absolute;
  z-index: 0;
  top: -55%;
  right: -12%;
  width: 340px;
  height: 340px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(239, 168, 91, 0.28), transparent 68%);
  pointer-events: none;
}

.disc__content {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  color: #eef1f7;
}
.disc__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: #8794ad;
}
.disc__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #efa85b;
  box-shadow: 0 0 10px rgba(239, 168, 91, 0.6);
}
.disc__title {
  margin: 0.2rem 0 0;
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: clamp(1.4rem, 3.2vw, 2rem);
  line-height: 1.14;
  letter-spacing: -0.01em;
  text-wrap: balance;
}
.disc__num {
  display: inline-block;
  font-variant-numeric: tabular-nums;
  color: #efa85b;
}
.disc__sub {
  margin: 0.1rem 0 0;
  max-width: 46ch;
  font-size: 0.94rem;
  color: rgba(238, 241, 247, 0.78);
}
.disc__cta {
  align-self: flex-start;
  margin-top: 0.7rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1.1rem;
  border-radius: var(--tvz-radius-pill);
  background: #efa85b;
  color: #0c1220;
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
  transition:
    transform var(--tvz-dur-fast) var(--tvz-ease-out),
    box-shadow var(--tvz-dur-fast) var(--tvz-ease-out);
}
.disc__cta .v-icon {
  transition: transform var(--tvz-dur-fast) var(--tvz-ease-out);
}
.disc__cta:hover {
  box-shadow: 0 0 0 3px rgba(239, 168, 91, 0.28);
}
.disc__cta:hover .v-icon {
  transform: translateX(3px);
}

.disc__emblem {
  position: relative;
  z-index: 1;
  flex: none;
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: rgba(238, 241, 247, 0.06);
  box-shadow: inset 0 0 0 1.5px rgba(239, 168, 91, 0.45);
}
.disc__emblem .v-icon {
  color: #efa85b;
}

@media (max-width: 720px) {
  .disc {
    min-height: 0;
  }
  .disc__emblem {
    width: 72px;
    height: 72px;
    align-self: flex-start;
  }
  .disc__emblem .v-icon {
    font-size: 30px !important;
  }
}
@media (max-width: 460px) {
  .disc__emblem {
    display: none;
  }
}
</style>
