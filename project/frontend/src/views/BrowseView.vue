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
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'

import FeedView from '@/views/FeedView.vue'
import CompanyPublicView from '@/views/CompanyPublicView.vue'
import { useFeedStore, isCompleteServicesSlug } from '@/stores/feed'

const { t } = useI18n()
const route = useRoute()
const feed = useFeedStore()
const { facets, facetsLoaded } = storeToRefs(feed)

// `loadFacets()` has no internal error handling, and the whole page used to
// be gated on `facetsLoaded` — only ever set on success. One transient
// failure therefore left a permanent spinner on EVERY SEO category page and
// EVERY public company page, with no error and no retry; and because this
// only ran once per route-record mount, an SPA navigation between flat URLs
// never retried it either. Same failure mode (and same fix) as FeedView's
// own `onMounted` guard: never block the render on this one fetch. Here the
// facet tree is additionally load-bearing — it's the only thing that can say
// whether `/a/b` is a category page or a company page — so instead of
// rendering a guessed child we track the attempt explicitly: a resolved
// attempt either renders the real page or an explicit retryable error, never
// an endless spinner.
const attempted = ref(false)
const failed = ref(false)
const retrying = ref(false)

async function ensureFacets(): Promise<void> {
  if (facetsLoaded.value) {
    attempted.value = true
    failed.value = false
    return
  }
  retrying.value = true
  try {
    await feed.loadFacets()
    failed.value = false
  } catch {
    failed.value = true
  } finally {
    attempted.value = true
    retrying.value = false
  }
}

onMounted(() => void ensureFacets())

// A client-side navigation to another flat URL keeps this view mounted, so a
// previously-failed fetch gets another chance instead of staying broken for
// the rest of the session.
watch(
  () => [route.params.seg1, route.params.seg2, route.params.seg3],
  () => {
    if (!facetsLoaded.value) void ensureFacets()
  },
)

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
    // "Servicii complete {group}" is a feed search construct, not a real
    // category — never in the tree, so it needs its own recognised shape.
    const isComplete = isCompleteServicesSlug(seg2.value) && seg2.value.endsWith(seg1.value)
    // The feed's multi-select comma-joins several niches into this one
    // segment — a real company slug never contains a comma.
    const tokens = seg2.value.split(',')
    const isNicheSet =
      !!group && tokens.every((t) => group.children.some((ch) => ch.slug === t))
    if (group && (isNicheSet || isComplete)) {
      return { kind: 'feed', group: seg1.value, niche: seg2.value }
    }
    return { kind: 'company', crumbs: [seg1.value, seg2.value] }
  }

  if (group) return { kind: 'feed', group: seg1.value, niche: null }
  return { kind: 'company', crumbs: [seg1.value] }
})

// A three-segment path is unambiguously a company page — the feed never nests
// that deep — so it doesn't need the facet tree at all and renders even when
// the facets fetch is down.
const needsFacets = computed(() => !seg3.value)
const showSpinner = computed(() => needsFacets.value && !facetsLoaded.value && !attempted.value)
const showError = computed(() => needsFacets.value && !facetsLoaded.value && failed.value)
</script>

<template>
  <div v-if="showSpinner" class="browse__center">
    <v-progress-circular indeterminate color="primary" />
  </div>
  <div v-else-if="showError" class="browse__center browse__error">
    <v-icon icon="mdi-cloud-off-outline" size="34" />
    <h2>{{ t('feed.browseErrorTitle') }}</h2>
    <p>{{ t('feed.browseErrorText') }}</p>
    <v-btn
      color="primary"
      variant="flat"
      prepend-icon="mdi-refresh"
      :loading="retrying"
      @click="ensureFacets"
    >
      {{ t('feed.retry') }}
    </v-btn>
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
.browse__error {
  gap: 0.6rem;
  text-align: center;
  padding: 2rem 1rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.browse__error h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.25rem;
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
}
.browse__error p {
  margin: 0;
  max-width: 42ch;
  font-size: 0.9rem;
}
</style>
