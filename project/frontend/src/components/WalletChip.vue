<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import CreditsValue from '@/components/CreditsValue.vue'
import { useWalletStore } from '@/stores/wallet'

/**
 * The navbar balance, live: when it changes (pushed by the server, or
 * refreshed by any page) the number counts to the new value, the chip glows
 * and the difference floats away. Nothing moves on the first load, and with
 * reduced motion the number simply changes.
 */
const { t, n } = useI18n()
const wallet = useWalletStore()

const credits = computed(() => wallet.summary?.balance.credits ?? null)
const shown = ref(credits.value ?? 0)
const delta = ref<{ id: number; value: number } | null>(null)
let frame = 0
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

watch(credits, (to, from) => {
  cancelAnimationFrame(frame)
  if (to === null || from === null || from === undefined || document.hidden) {
    shown.value = to ?? 0
    return
  }
  const diff = Math.round((to - from) * 100) / 100
  if (!diff) return
  clearTimeout(timer)
  // Changes that land together add up into one floating number.
  delta.value = { id: ++seq, value: Math.round(((delta.value?.value ?? 0) + diff) * 100) / 100 }
  timer = setTimeout(() => (delta.value = null), 1800)
  if (still()) {
    shown.value = to
    return
  }
  const start = shown.value
  const t0 = performance.now()
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / 900)
    const eased = 1 - (1 - p) ** 3
    shown.value = p === 1 ? to : Math.round((start + (to - start) * eased) * 100) / 100
    if (p < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  clearTimeout(timer)
})
</script>

<template>
  <router-link
    :to="{ name: 'wallet' }"
    class="wallet-chip"
    :class="delta && delta.value ? (delta.value < 0 ? 'is-down' : 'is-up') : null"
    :aria-label="t('wallet.title')"
  >
    <v-icon icon="mdi-wallet-outline" size="18" class="wallet-chip__ic" />
    <CreditsValue :credits="shown" :approx="false" />
    <span v-if="delta && delta.value" :key="delta.id" class="wallet-chip__delta" aria-hidden="true">
      {{ n(delta.value, { maximumFractionDigits: 2, signDisplay: 'always' }) }}
    </span>
  </router-link>
</template>

<style scoped>
.wallet-chip {
  position: relative;
}
.wallet-chip__ic {
  transition: transform 0.3s ease;
}
.is-down .wallet-chip__ic,
.is-up .wallet-chip__ic {
  animation: wc-bump 0.5s ease;
}
.is-down {
  animation: wc-down 1.4s ease;
}
.is-up {
  animation: wc-up 1.4s ease;
}
.wallet-chip__delta {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 2;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  font-size: var(--tvz-fs-caption, 0.75rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  color: #fff;
  background: rgb(var(--v-theme-success));
  animation: wc-float 1.8s ease forwards;
}
.is-down .wallet-chip__delta {
  background: rgb(var(--v-theme-error));
}
@keyframes wc-bump {
  40% {
    transform: scale(1.3) rotate(-8deg);
  }
}
@keyframes wc-down {
  20% {
    box-shadow: 0 0 0 4px rgba(var(--v-theme-error), 0.25);
  }
}
@keyframes wc-up {
  20% {
    box-shadow: 0 0 0 4px rgba(var(--v-theme-success), 0.25);
  }
}
@keyframes wc-float {
  0% {
    opacity: 0;
    transform: translateY(-6px);
  }
  15%,
  65% {
    opacity: 1;
    transform: translateY(2px);
  }
  100% {
    opacity: 0;
    transform: translateY(12px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .wallet-chip,
  .wallet-chip__ic,
  .wallet-chip__delta {
    animation: none !important;
  }
}
</style>
