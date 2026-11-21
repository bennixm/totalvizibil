<script setup lang="ts">
/**
 * `/ghid/<builder>`: the information page of one builder. The builder is
 * picked by the route's `meta.builder`; prices are read live from the
 * platform (never hard-coded), and a failed read just hides the price line.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import BuilderInfoPage from '@/components/builder-info/BuilderInfoPage.vue'
import { BUILDERS, type BuilderKind } from '@/components/builder-info/builders'
import { useSeo } from '@/composables/useSeo'
import { fetchPricing } from '@/services/platform'
import { googleAdsUserApi } from '@/services/googleAdsUser'

const { t } = useI18n()
const route = useRoute()
const kind = computed(() => (route.meta.builder as BuilderKind) ?? 'easy')

useSeo(() => ({
  title: t(`binfo.${kind.value}.seoTitle`),
  description: t(`binfo.${kind.value}.seoDesc`),
  canonicalPath: `/ghid/${BUILDERS[kind.value].slug}`,
}))

const price = ref<number | null>(null)
async function loadPrice(): Promise<void> {
  price.value = null
  try {
    if (kind.value === 'advanced') price.value = (await fetchPricing()).advancedBuilderPriceCredits
    else if (kind.value === 'ads') {
      const s = await googleAdsUserApi.status()
      price.value = s.available ? s.minCredits : null
    }
  } catch {
    price.value = null
  }
}
onMounted(loadPrice)
watch(kind, loadPrice)
</script>

<template>
  <BuilderInfoPage :key="kind" :kind="kind" :price="price" />
</template>
