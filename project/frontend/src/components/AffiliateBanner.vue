<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import PromoBanner from '@/components/PromoBanner.vue'
import { useAuthStore } from '@/stores/auth'
import { fetchPricing } from '@/services/platform'

/** Homepage promo for the affiliate program. Copy only — the real link
 *  lives in Account → Afiliere and on the create-business page. */
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
  <PromoBanner
    v-if="enabled"
    tone="primary"
    :badge="t('affiliate.badge')"
    :sub="t('affiliate.adSub')"
    :cta-text="t('affiliate.adCta')"
    :cta-to="isAuthenticated ? { name: 'account', query: { tab: 'affiliate' } } : { name: 'create' }"
  >
    {{ t('affiliate.adHeadline') }}
    <span class="aff__num">{{ displayN }}</span>
    {{ t('affiliate.adHeadlineTail') }}
  </PromoBanner>
</template>

<style scoped>
.aff__num {
  color: rgb(var(--v-theme-primary));
  font-variant-numeric: tabular-nums;
}
</style>
