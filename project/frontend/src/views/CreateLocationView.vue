<script setup lang="ts">
/**
 * Pre-account onboarding step only — category + service area together, since
 * there's no existing company yet to split them against. Editing either one
 * later (after the business exists) happens on its own dedicated panel page
 * instead (see LocationView.vue / CategoryView.vue).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import LocationMap from '@/components/LocationMap.vue'
import InfoHint from '@/components/InfoHint.vue'
import OnboardingSteps from '@/components/OnboardingSteps.vue'
import { fetchCounties, nearestCity, countyCenter } from '@/services/geo'
import { fetchCategoryTree, type CategoryGroup } from '@/services/categories'
import { useWebsiteDraftStore } from '@/stores/websiteDraft'
import { useToastStore } from '@/stores/toast'

const { t, locale } = useI18n()
const router = useRouter()
const draftStore = useWebsiteDraftStore()

const DEFAULT = { lat: 44.4268, lng: 26.1025 } // București

const ready = ref(false)
const error = ref('')
const toasts = useToastStore()
watch(error, (v) => { if (v) toasts.error(v) })

// Service area is by județ (Romanian county) — one, several, or every one at
// once (collapsed to "Toată țara", a pickable shortcut either way: choosing
// it selects every county, and manually ticking every county is recognised
// as the same thing). Never a radius. The map pin (city/lat/lng) is
// optional, for the public page's exact-address display only; it plays no
// part in matching.
const NATIONWIDE = '__nationwide__'
const counties = ref<string[]>([])
const countyItems = computed(() => [
  { title: t('location.nationwideOption'), value: NATIONWIDE },
  ...counties.value.map((c) => ({ title: c, value: c })),
])
const countySelections = ref<string[]>([])
const nationwide = computed(() => countySelections.value.includes(NATIONWIDE))
/** The real județe chosen (excludes the sentinel) — empty while nationwide. */
const countiesChosen = computed(() => countySelections.value.filter((v) => v !== NATIONWIDE))

const city = ref<string>('')
const lat = ref(DEFAULT.lat)
const lng = ref(DEFAULT.lng)

const saving = ref(false)
const saved = ref(false)

/** Several counties selected → the map switches to a read-only overview (one
 *  labelled marker per county) instead of a single draggable address pin,
 *  which stops making sense once there's more than one service area. */
const overviewMarkers = ref<{ lat: number; lng: number; label: string }[] | null>(null)
async function refreshOverview(): Promise<void> {
  if (nationwide.value || countiesChosen.value.length <= 1) {
    overviewMarkers.value = null
    return
  }
  try {
    const centers = await Promise.all(countiesChosen.value.map((c) => countyCenter(c)))
    overviewMarkers.value = centers.map((c) => ({ lat: c.lat, lng: c.lng, label: c.county }))
  } catch {
    overviewMarkers.value = null
  }
}

// Category (2-level, required): a parent group + one or more real
// subcategories. Selecting every subcategory under the group is how a
// business ends up classified as "Servicii complete {group}" — that's a
// derived feed-search state, never a separate pickable option here.
const catTree = ref<CategoryGroup[]>([])
const groupSlug = ref<string | null>(null)
const leafSlugs = ref<string[]>([])
const suggesting = ref(false)

function catName(n: { ro: string; en: string; de: string }): string {
  return n[locale.value as 'ro' | 'en' | 'de'] ?? n.en
}
const groupItems = computed(() =>
  catTree.value.map((g) => ({ title: catName(g.name), value: g.slug })),
)
const currentGroup = computed(() => catTree.value.find((x) => x.slug === groupSlug.value))
const leafItems = computed(() =>
  (currentGroup.value?.children ?? []).map((c) => ({ title: catName(c.name), value: c.slug })),
)

function onLeafSlugsChange(vals: string[]): void {
  leafSlugs.value = vals
  saved.value = false
}
function onGroupChange(): void {
  leafSlugs.value = []
  saved.value = false
}
function preselectCategory(slugs: string[] | null | undefined): void {
  if (!slugs?.length) return
  const first = slugs[0]
  const parent = catTree.value.find((x) => x.children.some((c) => c.slug === first))
  if (parent) {
    groupSlug.value = parent.slug
    leafSlugs.value = slugs.filter((s) => parent.children.some((c) => c.slug === s))
  }
}

/** AI-assisted suggestion from the services already collected in the studio
 *  flow — pre-fills the picker, fully editable before saving. */
async function suggestLeaves(): Promise<void> {
  if (!groupSlug.value || suggesting.value) return
  suggesting.value = true
  try {
    const slugs = await draftStore.suggestCategories(groupSlug.value)
    if (slugs.length) {
      leafSlugs.value = slugs
      saved.value = false
      toasts.success(t('location.suggestApplied'))
    } else {
      toasts.info(t('location.suggestNone'))
    }
  } finally {
    suggesting.value = false
  }
}

const canContinue = computed(
  () => leafSlugs.value.length > 0 && countySelections.value.length > 0,
)
// Where "back" goes — the advanced plan started at the advanced info screen,
// not the easy studio.
const draftEntry = computed(() =>
  draftStore.draft?.mode === 'advanced' ? 'create-advanced' : 'create-easy',
)
const backTarget = computed(() => ({ name: draftEntry.value }))

/** Picking "Toată țara" selects every județ (collapsed to just the sentinel
 *  in the chips); manually ticking every real județ is recognised as the
 *  same thing and collapses the same way — both directions of the rule. */
function onCountySelectionsChange(vals: string[]): void {
  const justPickedNationwide = vals.includes(NATIONWIDE) && !nationwide.value
  const realPicks = vals.filter((v) => v !== NATIONWIDE)
  const pickedEveryCounty = counties.value.length > 0 && realPicks.length === counties.value.length
  countySelections.value = justPickedNationwide || pickedEveryCounty ? [NATIONWIDE] : realPicks
  saved.value = false
  void refreshOverview()
  // Re-centre on the (new) first county's main city — only meaningful once
  // we're back down to exactly one real county (the pin becomes an overview
  // otherwise — see refreshOverview).
  const primary = countiesChosen.value[0]
  if (primary && countiesChosen.value.length === 1) {
    void countyCenter(primary)
      .then((center) => {
        lat.value = center.lat
        lng.value = center.lng
        city.value = center.name
      })
      .catch(() => {
        /* keep whatever point was already set */
      })
  }
}
function removeCounty(c: string): void {
  onCountySelectionsChange(countySelections.value.filter((v) => v !== c))
}

// Moving the pin on the map updates the coordinates, fills the city name for
// display, AND adds that county to the selection (as the primary/first one)
// if it isn't already there — the map is a precise way to add a județ, not
// just to fine-tune one already picked.
function onMapPick(p: { lat: number; lng: number }): void {
  lat.value = Number(p.lat.toFixed(5))
  lng.value = Number(p.lng.toFixed(5))
  saved.value = false
  void nearestCity(lat.value, lng.value)
    .then((near) => {
      city.value = near.name
      if (counties.value.includes(near.county) && !countiesChosen.value.includes(near.county)) {
        countySelections.value = [near.county, ...countiesChosen.value]
        void refreshOverview()
      }
    })
    .catch(() => {
      /* keep the raw point — the input just won't get a city name */
    })
}

function prefill(loc: {
  city: string | null
  counties: string[]
  lat: number | null
  lng: number | null
  nationwide?: boolean
}): void {
  countySelections.value = loc.nationwide ? [NATIONWIDE] : loc.counties
  city.value = loc.city ?? ''
  if (loc.lat != null && loc.lng != null) {
    lat.value = loc.lat
    lng.value = loc.lng
  }
}

async function save(): Promise<void> {
  if (!canContinue.value || saving.value) return
  saving.value = true
  error.value = ''
  const payload = nationwide.value
    ? { categorySlugs: leafSlugs.value, nationwide: true }
    : {
        categorySlugs: leafSlugs.value,
        counties: countiesChosen.value,
        city: city.value || undefined,
        lat: lat.value,
        lng: lng.value,
        nationwide: false,
      }
  try {
    const ok = await draftStore.setLocation(payload)
    if (!ok) throw new Error(draftStore.error || 'error')
    saved.value = true
    void router.push({ name: 'create-account' })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'error'
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  ;[catTree.value, counties.value] = await Promise.all([
    fetchCategoryTree().catch(() => []),
    fetchCounties().catch(() => []),
  ])

  const hasDraft = await draftStore.resumeIfAny()
  if (hasDraft && draftStore.draft?.ready) {
    preselectCategory(draftStore.draft.categorySlugs)
    const loc = draftStore.draft.location
    if (loc) prefill(loc)
    await refreshOverview()
    ready.value = true
    return
  }

  if (hasDraft) void router.replace({ name: draftEntry.value })
  else void router.replace({ name: 'create' })
})
</script>

<template>
  <v-container class="loc">
    <OnboardingSteps
      :mode="draftStore.draft?.mode === 'advanced' ? 'advanced' : 'easy'"
      current="location"
      class="loc__steps"
    />
    <header class="loc__head">
      <p class="loc__eyebrow"><span class="loc__dot" /> {{ t('location.eyebrow') }}</p>
      <h1>{{ t('location.title') }}</h1>
      <p class="loc__lead">{{ t('location.lead') }}</p>
    </header>

    <div v-if="!ready" class="loc__loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <div class="loc__fieldhead">
        <span>{{ t('location.categorySection') }}</span>
        <InfoHint :text="t('location.categoryHint')" />
      </div>
      <div class="loc__cat">
        <v-select
          v-model="groupSlug"
          :items="groupItems"
          :label="t('location.categoryGroupLabel')"
          prepend-inner-icon="mdi-shape-outline"
          variant="outlined"
          density="comfortable"
          hide-details
          @update:model-value="onGroupChange"
        />
        <v-select
          :model-value="leafSlugs"
          :items="leafItems"
          :label="t('location.categoryLeafLabel')"
          :disabled="!groupSlug"
          :placeholder="groupSlug ? '' : t('location.categoryLeafEmpty')"
          variant="outlined"
          density="comfortable"
          multiple
          chips
          closable-chips
          hide-details
          @update:model-value="onLeafSlugsChange"
        />
      </div>
      <div v-if="groupSlug" class="loc__suggest">
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-auto-fix"
          :loading="suggesting"
          @click="suggestLeaves"
        >
          {{ t('location.suggestButton') }}
        </v-btn>
      </div>

      <div class="loc__fieldhead">
        <span>{{ t('location.areaSection') }}</span>
        <InfoHint :text="t('location.feedNote')" />
      </div>
      <v-select
        :model-value="countySelections"
        :items="countyItems"
        :label="t('location.countyLabel')"
        prepend-inner-icon="mdi-map-marker-outline"
        variant="outlined"
        density="comfortable"
        multiple
        hide-details
        @update:model-value="onCountySelectionsChange"
      >
        <template #selection="{ index }">
          <span v-if="index === 0" class="loc__selectPlaceholder">
            {{
              nationwide
                ? t('location.nationwideOption')
                : t('location.selectedCount', { n: countiesChosen.length })
            }}
          </span>
        </template>
      </v-select>

      <!-- Large, legible pills instead of the input's own cramped chip row —
           makes exactly what's selected unambiguous. -->
      <div class="loc__summary">
        <span v-if="nationwide" class="locchip locchip--all">
          <v-icon icon="mdi-earth" size="15" /> {{ t('location.nationwideOption') }}
        </span>
        <template v-else-if="countiesChosen.length">
          <span v-for="c in countiesChosen" :key="c" class="locchip">
            <v-icon icon="mdi-map-marker" size="14" />
            {{ c }}
            <button
              type="button"
              class="locchip__x"
              :aria-label="t('location.removeCounty', { county: c })"
              @click="removeCounty(c)"
            >
              <v-icon icon="mdi-close" size="13" />
            </button>
          </span>
        </template>
        <span v-else class="loc__summaryEmpty">{{ t('location.noneSelected') }}</span>
      </div>

      <div v-if="nationwide" class="loc__note">
        <span>{{ t('location.nationwideHint') }}</span>
      </div>

      <template v-else-if="countiesChosen.length">
        <div class="loc__fieldhead">
          <span>{{ t('location.mapLabel') }}</span>
          <InfoHint
            :text="countiesChosen.length > 1 ? t('location.mapOverviewHint') : t('location.mapHint')"
          />
        </div>
        <div class="loc__map">
          <LocationMap :lat="lat" :lng="lng" :markers="overviewMarkers" @pick="onMapPick" />
        </div>
      </template>

      <div class="loc__actions">
        <v-btn variant="text" prepend-icon="mdi-arrow-left" :to="backTarget">
          {{ t('location.back') }}
        </v-btn>
        <v-btn
          color="primary"
          append-icon="mdi-arrow-right"
          :disabled="!canContinue"
          :loading="saving"
          @click="save"
        >
          {{ saved ? t('location.savedContinue') : t('location.continue') }}
        </v-btn>
      </div>
    </template>
  </v-container>
</template>

<style scoped>
.loc {
  max-width: 720px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.loc__steps {
  margin-bottom: 1.5rem;
}
.loc__head {
  margin-bottom: 1.75rem;
}
.loc__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: var(--tvz-ai);
  margin: 0 0 0.6rem;
}
.loc__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.loc__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.loc__lead {
  margin: 0.6rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.66);
}

.loc__loading {
  display: grid;
  place-items: center;
  min-height: 200px;
}

.loc__fieldhead {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 1.25rem 0 0.5rem;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.loc__fieldhead:first-of-type {
  margin-top: 0;
}
.loc__cat {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: start;
  gap: 0.75rem;
}
@media (max-width: 560px) {
  .loc__cat {
    grid-template-columns: 1fr;
  }
}
.loc__suggest {
  margin-top: 0.6rem;
}

.loc__selectPlaceholder {
  color: rgba(var(--v-theme-on-surface), 0.75);
}

/* Selected-counties summary ------------------------------------------ */
.loc__summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.9rem;
}
.loc__summaryEmpty {
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.locchip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.4rem 0.4rem 0.7rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.1);
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  color: rgb(var(--v-theme-primary));
  font-size: 0.82rem;
  font-weight: 600;
}
.locchip--all {
  padding: 0.4rem 0.9rem;
  background: var(--tvz-ai-soft);
  border-color: rgba(var(--v-theme-primary), 0.35);
}
.locchip__x {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: rgb(var(--v-theme-primary));
  opacity: 0.7;
}
.locchip__x:hover {
  opacity: 1;
  background: rgba(var(--v-theme-primary), 0.16);
}

.loc__map {
  height: 340px;
  margin-top: 0.75rem;
}

.loc__note {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-top: 1.25rem;
  padding: 0.8rem 1rem;
  border-radius: var(--tvz-radius-md);
  background: var(--tvz-ai-soft);
  border: 1px solid var(--tvz-glass-border);
  font-size: 0.82rem;
}
.loc__note span {
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.loc__actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1.75rem;
}
</style>
