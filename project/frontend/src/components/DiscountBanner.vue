<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import PromoBanner from '@/components/PromoBanner.vue'
import { useAuthStore } from '@/stores/auth'
import { fetchPricing } from '@/services/platform'

/** Homepage promo for an active credits discount. Copy only — the real
 *  purchase flow is the Wallet page. */
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
  <PromoBanner
    v-if="enabled"
    tone="warning"
    :badge="t('discountBanner.badge')"
    :sub="t('discountBanner.sub')"
    :cta-text="t('discountBanner.cta')"
    :cta-to="isAuthenticated ? { name: 'wallet' } : { name: 'login' }"
  >
    <span class="disc__num">-{{ pct }}%</span>
    {{ t('discountBanner.headline') }}
  </PromoBanner>
</template>

<style scoped>
.disc__num {
  color: rgb(var(--v-theme-warning));
  font-variant-numeric: tabular-nums;
}
</style>
