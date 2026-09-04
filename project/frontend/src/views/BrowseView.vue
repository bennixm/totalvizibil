<script setup lang="ts">
/**
 * Resolves the flat, prefix-free `/seg1[/seg2][/seg3]` path into either the
 * category feed or a company's public page. The two used to live behind
 * distinct prefixes (`/feed/…`, `/c/…`) precisely so their URLs could never
 * collide; dropping both prefixes for a cleaner SEO path means the segment
 * count alone no longer says which page a URL means — `/instalatii/electrica`
 * could be a niche under a group, or a company slug sitting directly under a
 * top-level group. The category tree is the only thing that can tell them
 * apart, so this view loads it once (`useFeedStore().loadFacets()`, already
 * cached) and decides:
 *   - 3 segments → always a company (`/group/niche/slug`); the feed never
 *     nests three deep.
 *   - 2 segments → a feed niche page if `seg1` is a known top-level group AND
 *     `seg2` matches one of its children; otherwise a company filed directly
 *     under that group (`/group/slug`).
 *   - 1 segment → a feed group page if `seg1` matches a top-level group;
 *     otherwise a company with no category at all (`/slug`).
 * Whichever it is, the matched view renders here as a plain child with the
 * resolved params passed as props — no further navigation, so the address
 * bar keeps showing exactly what the visitor typed or clicked.
 */
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'

import FeedView from '@/views/FeedView.vue'
import CompanyPublicView from '@/views/CompanyPublicView.vue'
import { useFeedStore } from '@/stores/feed'

const route = useRoute()
const feed = useFeedStore()
const { facets, facetsLoaded } = storeToRefs(feed)

onMounted(() => feed.loadFacets())

const seg1 = computed(() => route.params.seg1 as string)
const seg2 = computed(() => (route.params.seg2 as string | undefined) ?? null)
const seg3 = computed(() => (route.params.seg3 as string | undefined) ?? null)

type Resolved =
  | { kind: 'feed'; group: string; niche: string | null }
  | { kind: 'company'; crumbs: string[] }

const resolved = computed<Resolved>(() => {
  if (seg3.value) return { kind: 'company', crumbs: [seg1.value, seg2.value!, seg3.value] }

  const group = facets.value.categories.find((c) => c.slug === seg1.value)

  if (seg2.value) {
    if (group?.children.some((ch) => ch.slug === seg2.value)) {
      return { kind: 'feed', group: seg1.value, niche: seg2.value }
    }
    return { kind: 'company', crumbs: [seg1.value, seg2.value] }
  }

  if (group) return { kind: 'feed', group: seg1.value, niche: null }
  return { kind: 'company', crumbs: [seg1.value] }
})
</script>

<template>
  <div v-if="!facetsLoaded" class="browse__center">
    <v-progress-circular indeterminate color="primary" />
  </div>
  <FeedView v-else-if="resolved.kind === 'feed'" :group="resolved.group" :niche="resolved.niche" />
  <CompanyPublicView v-else :crumbs="resolved.crumbs" />
</template>

<style scoped>
.browse__center {
  display: grid;
  place-items: center;
  min-height: 60vh;
}
</style>
