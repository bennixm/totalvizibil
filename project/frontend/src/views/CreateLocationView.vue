<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import LocationMap from '@/components/LocationMap.vue'
import InfoHint from '@/components/InfoHint.vue'
import OnboardingSteps from '@/components/OnboardingSteps.vue'
import { fetchCounties, nearestCity, countyCenter } from '@/services/geo'
import { fetchCategoryTree, type CategoryGroup } from '@/services/categories'
import { useAuthStore } from '@/stores/auth'
import { useCompaniesStore, type LocalizedName } from '@/stores/companies'
import { useWebsiteDraftStore } from '@/stores/websiteDraft'
import { useToastStore } from '@/stores/toast'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const companies = useCompaniesStore()
const draftStore = useWebsiteDraftStore()

const DEFAULT = { lat: 44.4268, lng: 26.1025 } // București

// 'draft' = pre-account (free flow), 'company' = post-account (advanced flow / edit).
const mode = ref<'draft' | 'company' | null>(null)
const companyId = ref<string | null>(null)
const ready = ref(false)
const error = ref('')
const toasts = useToastStore()
watch(error, (v) => { if (v) toasts.error(v) })
// True when we're editing the location of a business that already has a campaign
// (i.e. not a step in onboarding — just a settings change).
const editing = ref(false)

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

// Category (2-level, required): a parent group + one or more real
// subcategories. Selecting every subcategory under the group is how a
// business ends up classified as "Servicii complete {group}" — that's a
// derived feed-search state, never a separate pickable option here.
const catTree = ref<CategoryGroup[]>([])
const groupSlug = ref<string | null>(null)
const leafSlugs = ref<string[]>([])
const suggesting = ref(false)

function catName(n: LocalizedName): string {
  return n[locale.value as keyof LocalizedName] ?? n.en
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
 *  flow — pre-fills the picker, fully editable before saving. Draft-only: an
 *  existing company (editing its area later) already has its tagging set. */
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
// Where "back" goes in the pre-account flow — the advanced plan started at the
// advanced info screen, not the easy studio.
const draftEntry = computed(() =>
  draftStore.draft?.mode === 'advanced' ? 'create-advanced' : 'create-easy',
)
const backTarget = computed(() =>
  mode.value === 'company'
    ? { name: 'dashboard', query: { c: companyId.value } }
    : { name: draftEntry.value },
)
// Header + CTA copy: a step in onboarding vs. a plain settings edit.
const eyebrowText = computed(() =>
  editing.value ? t('location.eyebrowEdit') : t('location.eyebrow'),
)
const titleText = computed(() => (editing.value ? t('location.titleEdit') : t('location.title')))
const backText = computed(() => (mode.value === 'company' ? t('location.backDash') : t('location.back')))
const ctaText = computed(() => {
  if (saved.value) return t('location.savedContinue')
  return editing.value ? t('location.save') : t('location.continue')
})

/** Picking "Toată țara" selects every județ (collapsed to just the sentinel
 *  in the chips); manually ticking every real județ is recognised as the
 *  same thing and collapses the same way — both directions of the rule. */
function onCountySelectionsChange(vals: string[]): void {
  const justPickedNationwide = vals.includes(NATIONWIDE) && !nationwide.value
  const realPicks = vals.filter((v) => v !== NATIONWIDE)
  const pickedEveryCounty = counties.value.length > 0 && realPicks.length === counties.value.length
  countySelections.value = justPickedNationwide || pickedEveryCounty ? [NATIONWIDE] : realPicks
  saved.value = false
  // Re-centre on the (new) first county's main city — a sensible default pin
  // the owner can fine-tune by clicking elsewhere on the map.
  const primary = countiesChosen.value[0]
  if (primary) {
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
    if (mode.value === 'company' && companyId.value) {
      await companies.updateLocation(companyId.value, payload)
      saved.value = true
      // Always return to the dashboard. If the campaign still needs setting up,
      // the dashboard surfaces that as a task — we never force the campaign /
      // "publish" screen after a plain settings change (that re-prompted an
      // already-published business to pay again).
      void router.push({ name: 'dashboard', query: { c: companyId.value } })
    } else {
      const ok = await draftStore.setLocation(payload)
      if (!ok) throw new Error(draftStore.error || 'error')
      saved.value = true
      void router.push({ name: 'create-account' })
    }
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

  // Arriving with ?c=… while signed in means "edit this business's coverage
  // area" — a plain settings change reached from the dashboard. It must operate
  // on the real company and must never be hijacked by a leftover pre-account
  // draft in localStorage (that dragged an already-published business back into
  // the "continue → pay" onboarding flow).
  const editingCompany =
    auth.isAuthenticated && typeof route.query.c === 'string' && route.query.c.length > 0

  // Otherwise an in-progress draft wins — it's the pre-account (free) flow, even
  // for a logged-in user building a second site.
  const hasDraft = editingCompany ? false : await draftStore.resumeIfAny()
  if (hasDraft && draftStore.draft?.ready) {
    mode.value = 'draft'
    preselectCategory(draftStore.draft.categorySlugs)
    const loc = draftStore.draft.location
    if (loc) prefill(loc)
    ready.value = true
    return
  }

  // Post-account (advanced flow, or editing later): operate on the real company.
  if (auth.isAuthenticated) {
    mode.value = 'company'
    // `ensureLoaded()` (→ `fetchList()`) has no internal error handling — an
    // unguarded rejection here used to kill this whole `Promise.all` and, with
    // it, this entire `onMounted`, leaving `ready` stuck at `false` forever
    // (a permanent spinner, only cleared by a full page refresh).
    await Promise.all([
      companies.ensureLoaded().catch(() => {}),
      companies.fetchOverview().catch(() => {}),
    ])
    const id = companies.resolveId(route.query.c)
    const company = id ? companies.list.find((c) => c.id === id) : null
    if (!company) {
      void router.replace({ name: 'dashboard' })
      return
    }
    companyId.value = company.id
    preselectCategory(company.categories.map((c) => c.slug))
    // The full served-area set — every row, not just the primary pin.
    const primaryLoc = company.locations.find((l) => l.isPrimary) ?? company.locations[0]
    const isNationwide = company.locations.some((l) => l.nationwide)
    const countyList = company.locations.map((l) => l.county).filter((c): c is string => !!c)
    // A coverage area is already on file (a județ, or whole-country) → this
    // is a settings edit, not the onboarding step.
    const hasCoverage = isNationwide || countyList.length > 0
    editing.value = hasCoverage
    if (hasCoverage) {
      prefill({
        city: primaryLoc?.city ?? null,
        counties: countyList,
        lat: primaryLoc?.lat ?? null,
        lng: primaryLoc?.lng ?? null,
        nationwide: isNationwide,
      })
    }
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
      v-if="mode === 'draft'"
      :mode="draftStore.draft?.mode === 'advanced' ? 'advanced' : 'easy'"
      current="location"
      class="loc__steps"
    />
    <header class="loc__head">
      <p class="loc__eyebrow"><span class="loc__dot" /> {{ eyebrowText }}</p>
      <h1>{{ titleText }}</h1>
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
      <div v-if="mode === 'draft' && groupSlug" class="loc__suggest">
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
        chips
        closable-chips
        hide-details
        @update:model-value="onCountySelectionsChange"
      />

      <div v-if="nationwide" class="loc__note">
        <span>{{ t('location.nationwideHint') }}</span>
      </div>

      <template v-else>
        <div class="loc__fieldhead">
          <span>{{ t('location.mapLabel') }}</span>
          <InfoHint :text="t('location.mapHint')" />
        </div>
        <div class="loc__map">
          <LocationMap :lat="lat" :lng="lng" @pick="onMapPick" />
        </div>
      </template>

      <div class="loc__actions" :class="{ 'loc__actions--solo': editing }">
        <!-- No "back" when this is a settings edit — there is no previous
             onboarding step to return to, only the dashboard. -->
        <v-btn v-if="!editing" variant="text" prepend-icon="mdi-arrow-left" :to="backTarget">
          {{ backText }}
        </v-btn>
        <v-btn
          color="primary"
          :append-icon="editing ? undefined : 'mdi-arrow-right'"
          :disabled="!canContinue"
          :loading="saving"
          @click="save"
        >
          {{ ctaText }}
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
.loc__note strong {
  font-size: 0.9rem;
}
.loc__note span {
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.loc__note--error {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}

.loc__actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1.75rem;
}
.loc__actions--solo {
  justify-content: flex-end;
}
</style>
