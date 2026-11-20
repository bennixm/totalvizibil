<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import type { RouteLocationRaw } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { fetchPricing } from '@/services/platform'

/**
 * The homepage's platform offers (credits discount, affiliate program) as
 * ONE slim row of pills instead of full-width promo cards, so browsing
 * starts right away. Each pill keeps the key fact + its link; the longer
 * explanation is in the tooltip and for screen readers. The X folds the row
 * into a small "Offers (n)" chip that reopens it; the folded state is
 * remembered per offer set, so a new or changed offer shows up again.
 * Copy only: the real flows are the Wallet and Account → Affiliate pages.
 */
const { t } = useI18n()
const auth = useAuthStore()
const { isAuthenticated } = storeToRefs(auth)

interface Offer {
  key: 'discount' | 'affiliate'
  icon: string
  tone: 'warning' | 'primary'
  value: string
  text: string
  sub: string
  cta: string
  to: RouteLocationRaw
}

const discountPct = ref(0)
const affiliateReward = ref(0)
const loaded = ref(false)

const offers = computed<Offer[]>(() => {
  const list: Offer[] = []
  if (discountPct.value > 0)
    list.push({
      key: 'discount',
      icon: 'mdi-tag-outline',
      tone: 'warning',
      value: `-${discountPct.value}%`,
      text: t('discountBanner.headline'),
      sub: t('discountBanner.sub'),
      cta: t('discountBanner.cta'),
      to: isAuthenticated.value ? { name: 'wallet' } : { name: 'login' },
    })
  if (affiliateReward.value > 0)
    list.push({
      key: 'affiliate',
      icon: 'mdi-gift-outline',
      tone: 'primary',
      value: String(affiliateReward.value),
      text: `${t('affiliate.adHeadline')} ${affiliateReward.value} ${t('affiliate.adHeadlineTail')}`,
      sub: t('affiliate.adSub'),
      cta: t('affiliate.adCta'),
      to: isAuthenticated.value
        ? { name: 'account', query: { tab: 'affiliate' } }
        : { name: 'create' },
    })
  return list
})

// --- folded state, remembered per offer set ------------------------------
const STORE_KEY = 'tvz.feedOffers.folded'
const signature = computed(() => `d${discountPct.value}|a${affiliateReward.value}`)
const folded = ref(false)
function readFolded(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === signature.value
  } catch {
    return false
  }
}
function setFolded(v: boolean): void {
  folded.value = v
  try {
    if (v) localStorage.setItem(STORE_KEY, signature.value)
    else localStorage.removeItem(STORE_KEY)
  } catch {
    /* per-browser convenience only */
  }
}

onMounted(async () => {
  try {
    const pricing = await fetchPricing()
    if (pricing.creditsDiscountEnabled) discountPct.value = pricing.creditsDiscountPct
    if (pricing.affiliateEnabled) affiliateReward.value = pricing.affiliateRewardCredits
  } catch {
    /* leave hidden */
  }
  folded.value = readFolded()
  loaded.value = true
})
</script>

<template>
  <section v-if="loaded && offers.length" class="fo" :aria-label="t('feedOffers.aria')">
    <button
      v-if="folded"
      type="button"
      class="fo__fold"
      :aria-label="t('feedOffers.show')"
      @click="setFolded(false)"
    >
      <v-icon icon="mdi-tag-multiple-outline" size="16" />
      {{ t('feedOffers.folded', { n: offers.length }) }}
      <v-icon icon="mdi-chevron-down" size="16" />
    </button>

    <div v-else class="fo__row">
      <router-link
        v-for="o in offers"
        :key="o.key"
        :to="o.to"
        class="fo__pill"
        :class="`fo__pill--${o.tone}`"
        :title="o.sub"
        :aria-describedby="`fo-sub-${o.key}`"
      >
        <v-icon :icon="o.icon" size="17" class="fo__icon" />
        <span class="fo__text">
          <b v-if="o.key === 'discount'" class="fo__value">{{ o.value }}</b>
          {{ o.text }}
        </span>
        <span class="fo__cta">
          {{ o.cta }}
          <v-icon icon="mdi-arrow-right" size="14" />
        </span>
        <span :id="`fo-sub-${o.key}`" class="fo__sr">{{ o.sub }}</span>
      </router-link>

      <button
        type="button"
        class="fo__close"
        :aria-label="t('feedOffers.hide')"
        :title="t('feedOffers.hide')"
        @click="setFolded(true)"
      >
        <v-icon icon="mdi-close" size="16" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.fo {
  display: flex;
}
.fo__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
  width: 100%;
}
.fo__pill {
  --acc: var(--v-theme-primary);
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  max-width: 100%;
  padding: 0.4rem 0.5rem 0.4rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--tvz-hairline);
  background: rgba(var(--v-theme-surface), 0.7);
  color: inherit;
  text-decoration: none;
  font-size: 0.86rem;
  line-height: 1.3;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.fo__pill--warning {
  --acc: var(--v-theme-warning);
}
.fo__pill:hover,
.fo__pill:focus-visible {
  border-color: rgba(var(--acc), 0.55);
  background: rgba(var(--acc), 0.08);
}
.fo__icon {
  flex: none;
  color: rgb(var(--acc));
}
.fo__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.fo__value {
  color: rgb(var(--acc));
  font-variant-numeric: tabular-nums;
}
.fo__cta {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: rgba(var(--acc), 0.14);
  color: rgb(var(--acc));
  font-size: 0.78rem;
  font-weight: 600;
}
.fo__close,
.fo__fold {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid transparent;
  background: none;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font: inherit;
  cursor: pointer;
  border-radius: 999px;
}
.fo__close {
  flex: none;
  justify-content: center;
  width: 30px;
  height: 30px;
}
.fo__close:hover,
.fo__fold:hover {
  color: rgb(var(--v-theme-on-surface));
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.fo__fold {
  padding: 0.3rem 0.65rem;
  border-color: var(--tvz-hairline);
  font-size: 0.8rem;
  font-weight: 500;
}
.fo__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* Phones: pills stack as a tight list; the CTA keeps a 32px+ tap height. */
@media (max-width: 600px) {
  .fo__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.4rem;
  }
  .fo__pill {
    grid-column: 1;
    width: 100%;
    border-radius: var(--tvz-radius-md);
    min-height: 44px;
  }
  /* Never cut the key fact (%, credits) on small screens: wrap to 2 lines. */
  .fo__text {
    flex: 1;
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .fo__close {
    grid-column: 2;
    grid-row: 1;
    align-self: center;
  }
}
</style>
