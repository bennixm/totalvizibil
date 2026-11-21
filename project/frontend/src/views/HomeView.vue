<script setup lang="ts">
/**
 * `/` — the existing Feed, fronted once per session by the "ask" gate.
 *
 * `FeedView` is not modified in any way: it stays mounted (just hidden) under
 * the gate so the homepage keeps its SEO head and crawlable category links,
 * and the result is applied purely through the Feed's own inputs — the
 * category via its URL, the county via the store.
 */
import { defineAsyncComponent, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import FeedAskGate from '@/components/feed/FeedAskGate.vue'
import FeedView from '@/views/FeedView.vue'
// How the platform works (visitors + businesses), under the feed. Loaded
// on its own so it never delays the feed itself.
const HomeSections = defineAsyncComponent(() => import('@/components/builder-info/HomeSections.vue'))
import {
  askResultCounty,
  askResultLabel,
  askResultRoute,
  markAskGateSeen,
  shouldShowAskGate,
  type AskResult,
} from '@/services/feedAsk'
import { useFeedStore } from '@/stores/feed'
import { useToastStore } from '@/stores/toast'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const feed = useFeedStore()
const toasts = useToastStore()

const gateOpen = ref(shouldShowAskGate(route.query))
if (gateOpen.value) markAskGateSeen()
const feedMounted = ref(true)

async function apply(result: AskResult): Promise<void> {
  await feed.loadFacets().catch(() => {})
  const target = askResultRoute(result)
  const label = askResultLabel(result, feed.facets.categories, locale.value)

  if (target) {
    // Unmount the hidden Feed BEFORE touching the county: its own county
    // watcher would otherwise schedule a second, delayed reload that lands
    // after the new category page has rendered and flashes its skeleton.
    feedMounted.value = false
    await nextTick()
    feed.setCounty(askResultCounty(result))
    const failure = await router.push(target)
    if (failure) {
      // Navigation was aborted: fall back to revealing the Feed in place.
      feedMounted.value = true
      gateOpen.value = false
      return
    }
    toasts.info(t('ask.applied', { what: label }))
    return
  }

  feed.setCounty(askResultCounty(result))
  gateOpen.value = false
  toasts.info(
    result.counties.length
      ? t('ask.countyOnly', { county: result.counties.join(', ') })
      : t('ask.noMatch'),
  )
}
</script>

<template>
  <FeedAskGate v-if="gateOpen" @resolved="apply" @close="gateOpen = false" />
  <FeedView v-if="feedMounted" v-show="!gateOpen" />
  <HomeSections v-if="feedMounted" v-show="!gateOpen" />
</template>
