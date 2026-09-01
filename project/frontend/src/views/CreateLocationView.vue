<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import LocationMap from '@/components/LocationMap.vue'
import InfoHint from '@/components/InfoHint.vue'
import { searchCities, type GeoCity } from '@/services/geo'
import { fetchCategoryTree, type CategoryGroup } from '@/services/categories'
import { useAuthStore } from '@/stores/auth'
import { useCompaniesStore, type LocalizedName } from '@/stores/companies'
import { useWebsiteDraftStore } from '@/stores/websiteDraft'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const companies = useCompaniesStore()
const draftStore = useWebsiteDraftStore()

const DEFAULT = { lat: 44.4268, lng: 26.1025, radiusKm: 15 } // București

// 'draft' = pre-account (free flow), 'company' = post-account (advanced flow / edit).
const mode = ref<'draft' | 'company' | null>(null)
const companyId = ref<string | null>(null)
const ready = ref(false)
const error = ref('')
// True when we're editing the location of a business that already has a campaign
// (i.e. not a step in onboarding — just a settings change).
const editing = ref(false)

const city = ref<GeoCity | null>(null)
const region = ref<string>('')
const lat = ref(DEFAULT.lat)
const lng = ref(DEFAULT.lng)
const radiusKm = ref(DEFAULT.radiusKm)
// Serves the whole country — hides the km radius entirely.
const nationwide = ref(false)

const cityItems = ref<GeoCity[]>([])
const searching = ref(false)
const saving = ref(false)
const saved = ref(false)

// Category (2-level, required): a parent group + an exact-niche subcategory.
const catTree = ref<CategoryGroup[]>([])
const groupSlug = ref<string | null>(null)
const leafSlug = ref<string | null>(null)

function catName(n: LocalizedName): string {
  return n[locale.value as keyof LocalizedName] ?? n.en
}
const groupItems = computed(() =>
  catTree.value.map((g) => ({ title: catName(g.name), value: g.slug })),
)
const leafItems = computed(() => {
  const g = catTree.value.find((x) => x.slug === groupSlug.value)
  if (!g) return []
  // First option = the whole group ("all services in this category").
  return [
    { title: t('location.categoryAll', { group: catName(g.name) }), value: g.slug },
    ...g.children.map((c) => ({ title: catName(c.name), value: c.slug })),
  ]
})
function isValidLeaf(g: CategoryGroup | undefined, slug: string | null): boolean {
  return !!g && (slug === g.slug || g.children.some((c) => c.slug === slug))
}
function onGroupChange(): void {
  const g = catTree.value.find((x) => x.slug === groupSlug.value)
  if (!isValidLeaf(g, leafSlug.value)) leafSlug.value = null
  saved.value = false
}
function preselectCategory(slug: string | null | undefined): void {
  if (!slug) return
  const parent = catTree.value.find((x) => x.children.some((c) => c.slug === slug))
  if (parent) {
    groupSlug.value = parent.slug
    leafSlug.value = slug
    return
  }
  // A parent-group slug on its own → "all of {group}".
  const group = catTree.value.find((x) => x.slug === slug)
  if (group) {
    groupSlug.value = group.slug
    leafSlug.value = group.slug
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined

const canContinue = computed(
  () =>
    !!leafSlug.value &&
    // Whole-country coverage needs no city or map pin.
    (nationwide.value ||
      (!!city.value && Number.isFinite(lat.value) && Number.isFinite(lng.value))),
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

async function runSearch(q: string): Promise<void> {
  searching.value = true
  try {
    cityItems.value = await searchCities(q)
  } catch {
    cityItems.value = []
  } finally {
    searching.value = false
  }
}

function onSearch(q: string): void {
  clearTimeout(debounce)
  debounce = setTimeout(() => void runSearch(q), 220)
}

function onCityPick(picked: GeoCity | null): void {
  if (!picked) return
  region.value = picked.county
  lat.value = picked.lat
  lng.value = picked.lng
  saved.value = false
}

function onMapPick(p: { lat: number; lng: number }): void {
  lat.value = Number(p.lat.toFixed(5))
  lng.value = Number(p.lng.toFixed(5))
  saved.value = false
}

function prefill(loc: {
  city: string | null
  region: string | null
  lat: number | null
  lng: number | null
  radiusKm: number | null
  nationwide?: boolean
}): void {
  nationwide.value = !!loc.nationwide
  radiusKm.value = loc.radiusKm ?? DEFAULT.radiusKm
  // A whole-country location has no city / coordinates to restore.
  if (loc.city && loc.lat != null && loc.lng != null) {
    const p: GeoCity = { name: loc.city, county: loc.region ?? '', lat: loc.lat, lng: loc.lng }
    cityItems.value = [p]
    city.value = p
    region.value = loc.region ?? ''
    lat.value = loc.lat
    lng.value = loc.lng
  }
}

async function save(): Promise<void> {
  if (!canContinue.value || saving.value) return
  saving.value = true
  error.value = ''
  const payload = nationwide.value
    ? { categorySlug: leafSlug.value!, nationwide: true }
    : {
        categorySlug: leafSlug.value!,
        city: city.value!.name,
        region: region.value || undefined,
        lat: lat.value,
        lng: lng.value,
        radiusKm: radiusKm.value,
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
  catTree.value = await fetchCategoryTree().catch(() => [])

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
    preselectCategory(draftStore.draft.categorySlug)
    const loc = draftStore.draft.location
    if (loc) prefill(loc)
    await runSearch(loc?.city ?? '')
    ready.value = true
    return
  }

  // Post-account (advanced flow, or editing later): operate on the real company.
  if (auth.isAuthenticated) {
    mode.value = 'company'
    await Promise.all([
      companies.ensureLoaded(),
      companies.fetchOverview().catch(() => {}),
    ])
    const id = companies.resolveId(route.query.c)
    const company = id ? companies.list.find((c) => c.id === id) : null
    if (!company) {
      void router.replace({ name: 'dashboard' })
      return
    }
    companyId.value = company.id
    preselectCategory(company.category?.slug)
    const loc = company.locations.find((l) => l.isPrimary) ?? company.locations[0]
    // A coverage area is already on file (a city pin, or whole-country) → this
    // is a settings edit, not the onboarding step.
    const hasCoverage = !!loc && (loc.nationwide || (loc.lat != null && loc.lng != null))
    editing.value = hasCoverage
    if (loc && hasCoverage) {
      prefill({
        city: loc.city,
        region: loc.region,
        lat: loc.lat,
        lng: loc.lng,
        radiusKm: loc.serviceRadiusKm,
        nationwide: loc.nationwide,
      })
    }
    await runSearch(loc?.city ?? '')
    ready.value = true
    return
  }

  if (hasDraft) void router.replace({ name: draftEntry.value })
  else void router.replace({ name: 'create' })
})

onBeforeUnmount(() => clearTimeout(debounce))
</script>

<template>
  <v-container class="loc">
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
          v-model="leafSlug"
          :items="leafItems"
          :label="t('location.categoryLeafLabel')"
          :disabled="!groupSlug"
          :placeholder="groupSlug ? '' : t('location.categoryLeafEmpty')"
          variant="outlined"
          density="comfortable"
          hide-details
          @update:model-value="saved = false"
        />
      </div>

      <v-switch
        v-model="nationwide"
        :label="t('location.nationwideLabel')"
        color="primary"
        density="comfortable"
        hide-details
        class="loc__nationwide"
        @update:model-value="saved = false"
      />

      <div v-if="nationwide" class="loc__note">
        <span>{{ t('location.nationwideHint') }}</span>
      </div>

      <template v-else>
        <div class="loc__fieldhead">
          <span>{{ t('location.areaSection') }}</span>
          <InfoHint :text="`${t('location.feedNote')} ${t('location.mapHint')}`" />
        </div>
        <v-autocomplete
          v-model="city"
          :items="cityItems"
          item-title="name"
          return-object
          no-filter
          hide-no-data
          auto-select-first
          :loading="searching"
          :label="t('location.cityLabel')"
          :placeholder="t('location.cityPlaceholder')"
          prepend-inner-icon="mdi-map-marker-outline"
          variant="outlined"
          density="comfortable"
          @update:search="onSearch"
          @update:model-value="onCityPick"
        >
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps" :title="item.raw.name" :subtitle="item.raw.county" />
          </template>
        </v-autocomplete>

        <div class="loc__map">
          <LocationMap :lat="lat" :lng="lng" :radius-km="radiusKm" @pick="onMapPick" />
        </div>

        <div class="loc__radius">
          <div class="loc__radiusTop">
            <label for="loc-radius">{{ t('location.radiusLabel') }}</label>
            <strong>{{ t('location.radiusValue', { n: radiusKm }) }}</strong>
          </div>
          <v-slider
            id="loc-radius"
            v-model="radiusKm"
            :min="1"
            :max="100"
            :step="1"
            color="primary"
            thumb-label
            hide-details
            @update:model-value="saved = false"
          />
        </div>
      </template>

      <div v-if="error" class="loc__note loc__note--error">
        <v-icon icon="mdi-alert-circle-outline" size="18" /> {{ error }}
      </div>

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
  color: rgb(var(--v-theme-on-surface) / 0.66);
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
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.loc__fieldhead:first-of-type {
  margin-top: 0;
}
.loc__cat {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}
@media (max-width: 560px) {
  .loc__cat {
    grid-template-columns: 1fr;
  }
}

.loc__map {
  height: 340px;
  margin-top: 0.75rem;
}

.loc__nationwide {
  margin-top: 1.5rem;
}
.loc__radius {
  margin-top: 1.5rem;
}
.loc__radiusTop {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.25rem;
}
.loc__radiusTop label {
  font-size: 0.9rem;
  font-weight: 600;
}
.loc__radiusTop strong {
  color: rgb(var(--v-theme-primary));
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
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.loc__note--error {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  background: rgb(var(--v-theme-error) / 0.1);
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
