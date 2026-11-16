<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import OnboardingSteps from '@/components/OnboardingSteps.vue'
import { useSeo } from '@/composables/useSeo'
import { fetchPricing } from '@/services/platform'

const { t, n } = useI18n()
const router = useRouter()

useSeo(() => ({
  title: t('create.seoTitle'),
  description: t('create.seoDesc'),
  canonicalPath: '/create',
}))

/** Simplu's own real benefits — shown only on its card. */
const EASY_OWN = ['free', 'aiServiceCopy', 'ownPhotos', 'onePage'] as const
/**
 * The same ordered rows on BOTH cards — Avansat checked throughout, Simplu
 * crossed out throughout — so the two are read side by side, not as two
 * independent lists. Every row is a verified, real Advanced capability
 * Simplu genuinely doesn't have (not invented for the comparison).
 */
const COMPARE_ROWS = [
  'realCode',
  'liveCodeChat',
  'fullControl',
  'unlimitedPages',
  'livePreview',
  'bookingForms',
  'sourceCode',
] as const

const priceCredits = ref<number | null>(null)
const eurRonRate = ref(5.05)
onMounted(async () => {
  try {
    const p = await fetchPricing()
    priceCredits.value = p.advancedBuilderPriceCredits
    eurRonRate.value = p.eurRonRate
  } catch {
    priceCredits.value = null
  }
})

const picked = ref<'easy' | 'advanced' | null>(null)

function pick(key: 'easy' | 'advanced'): void {
  picked.value = key
  void router.push({ name: key === 'easy' ? 'create-easy' : 'create-advanced' })
}
</script>

<template>
  <v-container class="cb">
    <OnboardingSteps
      v-if="picked"
      :mode="picked === 'advanced' ? 'advanced' : 'easy'"
      current="plan"
      class="cb__steps"
    />
    <div class="cb__head">
      <p class="cb__eyebrow"><span class="cb__dot" /> {{ t('create.assistant') }}</p>
      <h1>{{ t('create.headline') }}</h1>
      <p class="cb__lead">{{ t('create.lead') }}</p>
    </div>

    <div class="cb__cards">
      <!-- Simplu -->
      <div class="plan">
        <div class="plan__top">
          <span class="plan__icon plan__icon--easy"><v-icon icon="mdi-flash-outline" size="22" /></span>
          <div>
            <h2>{{ t('create.easyTitle') }}</h2>
            <span class="plan__tag">{{ t('create.easyTag') }}</span>
          </div>
        </div>
        <p class="plan__text">{{ t('create.easyText') }}</p>

        <div class="plan__price plan__price--free">
          <span>{{ t('create.priceLabel') }}</span>
          <strong>{{ t('create.easyTag') }}</strong>
        </div>

        <ul class="plan__own">
          <li v-for="f in EASY_OWN" :key="f">
            <v-icon icon="mdi-check" size="15" /> {{ t(`create.easyFeat.${f}`) }}
          </li>
        </ul>

        <div class="plan__divider"><span>{{ t('create.compareHeading') }}</span></div>
        <ul class="plan__cmp plan__cmp--no">
          <li v-for="row in COMPARE_ROWS" :key="row">
            <v-icon icon="mdi-close" size="15" /> {{ t(`create.compareRow.${row}`) }}
          </li>
        </ul>

        <v-btn
          class="plan__cta plan__cta--easy"
          variant="outlined"
          color="primary"
          rounded="pill"
          block
          size="large"
          append-icon="mdi-arrow-right"
          @click="pick('easy')"
        >
          {{ t('create.choose', { name: t('create.easyTitle') }) }}
        </v-btn>
      </div>

      <!-- Avansat -->
      <div class="plan plan--featured">
        <span class="plan__badge">
          <v-icon icon="mdi-star-four-points" size="13" /> {{ t('create.advancedBadge') }}
        </span>
        <div class="plan__top">
          <span class="plan__icon plan__icon--adv"><v-icon icon="mdi-tune-vertical" size="22" /></span>
          <div>
            <h2>{{ t('create.advancedTitle') }}</h2>
            <span class="plan__tag plan__tag--adv">{{ t('create.advancedTag') }}</span>
          </div>
        </div>
        <p class="plan__text">{{ t('create.advancedText') }}</p>

        <div class="plan__price">
          <span>{{ t('create.priceLabel') }}</span>
          <strong v-if="priceCredits != null">{{ t('create.priceValue', { credits: priceCredits }) }}</strong>
          <strong v-else>{{ t('create.priceLoading') }}</strong>
          <small v-if="priceCredits != null">
            {{
              t('create.priceEq', {
                eur: n(priceCredits, { maximumFractionDigits: 0 }),
                ron: n(Math.round(priceCredits * eurRonRate), { maximumFractionDigits: 0 }),
              })
            }}
          </small>
        </div>

        <div class="plan__divider"><span>{{ t('create.compareHeading') }}</span></div>
        <ul class="plan__cmp plan__cmp--yes">
          <li v-for="row in COMPARE_ROWS" :key="row">
            <v-icon icon="mdi-check-circle" size="15" /> {{ t(`create.compareRow.${row}`) }}
          </li>
        </ul>

        <v-btn
          class="plan__cta plan__cta--adv"
          variant="flat"
          color="primary"
          rounded="pill"
          block
          size="large"
          append-icon="mdi-arrow-right"
          @click="pick('advanced')"
        >
          {{ t('create.choose', { name: t('create.advancedTitle') }) }}
        </v-btn>
      </div>
    </div>

    <p class="cb__foot">{{ t('create.registerLaterNote') }}</p>
  </v-container>
</template>

<style scoped>
.cb {
  max-width: 980px;
  padding-block: clamp(2.5rem, 7vw, 5rem);
}
.cb__steps {
  margin-bottom: 2rem;
}
.cb__head {
  text-align: center;
  margin-bottom: 3rem;
}
.cb__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 11px;
  font-weight: 600;
  color: var(--tvz-ai);
  margin: 0 0 1rem;
}
.cb__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.cb__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(2rem, 5.5vw, 3.2rem);
  letter-spacing: -0.03em;
  line-height: 1.05;
  margin: 0;
  text-wrap: balance;
}
.cb__lead {
  margin: 1rem auto 0;
  max-width: 46ch;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 1.05rem;
}

.cb__cards {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  align-items: start;
}

.plan {
  position: relative;
  text-align: left;
  display: flex;
  flex-direction: column;
  padding: 2rem 1.9rem 1.9rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  /* Discreet grey glass: a soft top-to-bottom sheen (tinted at the top,
     settling into the theme's own translucent glass tone by mid-card) —
     blurred so the animated page background still reads through softly. */
  background: linear-gradient(
    180deg,
    rgba(var(--v-theme-on-surface), 0.09),
    var(--tvz-glass-bg) 65%
  );
  backdrop-filter: blur(var(--tvz-glass-blur));
  -webkit-backdrop-filter: blur(var(--tvz-glass-blur));
  box-shadow: var(--tvz-shadow-sm);
  transition:
    transform var(--tvz-dur-med, 0.25s) var(--tvz-ease-out, ease),
    box-shadow var(--tvz-dur-med, 0.25s) var(--tvz-ease-out, ease);
}
.plan--featured {
  /* Same discreet top-to-bottom sheen as the grey card, just a faint brand
     tint instead — deliberately low-intensity (a thin soft border carries
     the accent, not a bold gradient ring; the badge/checkmarks/button carry
     "premium", not the fill). */
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.055), var(--tvz-glass-bg) 55%);
  backdrop-filter: blur(var(--tvz-glass-blur));
  -webkit-backdrop-filter: blur(var(--tvz-glass-blur));
  box-shadow: var(--tvz-shadow-lg);
  transform: translateY(-6px);
}
@media (min-width: 701px) {
  .plan--featured {
    transform: translateY(-10px);
  }
}
.plan__badge {
  position: absolute;
  top: -13px;
  left: 50%;
  translate: -50% 0;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.85rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #fff;
  background: var(--tvz-gradient-brand);
  box-shadow: var(--tvz-glow-primary);
}

.plan__top {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}
.plan__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.plan__icon--adv {
  background: var(--tvz-gradient-brand);
  color: #fff;
}
.plan__top h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0;
}
.plan__tag {
  display: inline-block;
  margin-top: 0.15rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.plan__tag--adv {
  background: var(--tvz-ai-soft);
  color: var(--tvz-ai);
}
.plan__text {
  margin: 0.9rem 0 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.66);
  min-height: 3.4em;
}

.plan__own {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.plan__own li {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.86rem;
  line-height: 1.35;
}
.plan__own .v-icon {
  color: rgb(var(--v-theme-primary));
  margin-top: 0.15rem;
  flex: none;
}

.plan__price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 1rem 0 0;
  padding: 0.75rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  background: var(--tvz-ai-soft);
}
.plan__price--free {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.plan__price--free strong {
  color: rgb(var(--v-theme-primary));
}
.plan__price span {
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  width: 100%;
}
.plan__price strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
}
.plan__price small {
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.plan__divider {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 1.4rem 0 0.8rem;
}
.plan__divider::before,
.plan__divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--tvz-hairline);
}
.plan__divider span {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  white-space: nowrap;
}

.plan__cmp {
  list-style: none;
  margin: 0 0 1.4rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  flex: 1;
}
.plan__cmp li {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.85rem;
  line-height: 1.35;
}
.plan__cmp--no li {
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.plan__cmp--no .v-icon {
  color: rgba(var(--v-theme-on-surface), 0.32);
  margin-top: 0.1rem;
  flex: none;
}
.plan__cmp--yes li {
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-weight: 500;
}
.plan__cmp--yes .v-icon {
  color: rgb(var(--v-theme-primary));
  margin-top: 0.1rem;
  flex: none;
}

.plan__cta {
  margin-top: auto;
  box-sizing: border-box;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: none;
  transition:
    transform var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease),
    box-shadow var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.plan__cta:hover {
  transform: translateY(-2px);
}
.plan__cta :deep(.v-icon) {
  transition: transform var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.plan__cta:hover :deep(.v-icon) {
  transform: translateX(3px);
}
.plan__cta--easy {
  /* The site-wide `.rounded-pill` rule (main.scss) clips every pill button
     to a chamfered-corner polygon via `clip-path`. A plain `border` is
     drawn on the element's rectangular box, so at each chamfer the clip
     cuts straight through the border line, leaving a gap at the corner.
     Fix: draw the border as its own clipped "ring" shape (an evenodd
     polygon: outer hex minus an inset inner hex) on ::before, instead of
     relying on the `border` property at all. */
  position: relative;
  border: none !important;
}
.plan__cta--easy::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: rgb(var(--v-theme-primary));
  clip-path: polygon(
    evenodd,
    var(--tvz-cut-md) 0,
    calc(100% - var(--tvz-cut-md)) 0,
    100% var(--tvz-cut-md),
    100% calc(100% - var(--tvz-cut-md)),
    calc(100% - var(--tvz-cut-md)) 100%,
    var(--tvz-cut-md) 100%,
    0 calc(100% - var(--tvz-cut-md)),
    0 var(--tvz-cut-md),
    calc(var(--tvz-cut-md) + 1.5px) 1.5px,
    calc(100% - var(--tvz-cut-md) - 1.5px) 1.5px,
    calc(100% - 1.5px) calc(var(--tvz-cut-md) + 1.5px),
    calc(100% - 1.5px) calc(100% - var(--tvz-cut-md) - 1.5px),
    calc(100% - var(--tvz-cut-md) - 1.5px) calc(100% - 1.5px),
    calc(var(--tvz-cut-md) + 1.5px) calc(100% - 1.5px),
    1.5px calc(100% - var(--tvz-cut-md) - 1.5px),
    1.5px calc(var(--tvz-cut-md) + 1.5px)
  );
}
.plan__cta--easy:hover {
  background: rgba(var(--v-theme-primary), 0.06);
  box-shadow: 0 10px 22px rgba(var(--v-theme-primary), 0.14);
}
.plan__cta--adv {
  background: var(--tvz-gradient-brand) !important;
  box-shadow: var(--tvz-glow-primary);
  border: none;
}
.plan__cta--adv:hover {
  box-shadow: 0 14px 30px rgba(var(--v-theme-primary), 0.32);
}

.cb__foot {
  text-align: center;
  margin-top: 2.5rem;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.66);
}

@media (max-width: 700px) {
  .plan--featured {
    transform: none;
  }
}
</style>
