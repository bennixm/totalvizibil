<script setup lang="ts">
/**
 * Panel page — edit an existing business's service area (the județe it's
 * found in, plus an optional exact-address pin). Category tagging lives on
 * its own page now (see CategoryView.vue) — editing one never requires
 * touching the other. The pre-account draft flow (CreateLocationView) is a
 * separate, unrelated onboarding step that still sets both together, since
 * there's no existing company to split against yet.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import LocationMap from '@/components/LocationMap.vue'
import InfoHint from '@/components/InfoHint.vue'
import { fetchCounties, nearestCity, countyCenter } from '@/services/geo'
import { useCompaniesStore } from '@/stores/companies'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const toasts = useToastStore()

const DEFAULT = { lat: 44.4268, lng: 26.1025 } // București

const companyId = ref<string | null>(null)
const ready = ref(false)
const error = ref('')

/**
 * Backend error → localized copy, mirroring CampaignView's own `errText`:
 * a recognised code (or the backend's raw English sentence for the
 * role/not-found guards, which aren't code-shaped) gets its own line and
 * anything unrecognised falls back to one generic sentence. Without this the
 * toast showed the raw server string verbatim — a bare
 * `company_pending_deletion` for a frozen business, untranslated English for
 * a non-owner role.
 */
const ERROR_KEYS: Record<string, string> = {
  company_pending_deletion: 'company_pending_deletion',
  forbidden: 'forbidden',
  'Your role cannot edit this company': 'forbidden',
  not_found: 'not_found',
  'Company not found': 'not_found',
}
function errText(raw: string): string {
  const key = ERROR_KEYS[raw]
  return key ? t('location.err.' + key) : t('location.err.generic')
}
watch(error, (v) => { if (v) toasts.error(errText(v)) })

// A business pending deletion is fully frozen server-side (every profile
// mutation throws `company_pending_deletion`), so editing the service area
// here can only fail — say so up front and disable the form instead, exactly
// as the dashboard and the campaign/budget page already do.
const pendingDeletion = computed(
  () => !!companies.list.find((c) => c.id === companyId.value)?.deletionScheduledAt,
)

const NATIONWIDE = '__nationwide__'
const counties = ref<string[]>([])
const countyItems = computed(() => [
  { title: t('location.nationwideOption'), value: NATIONWIDE },
  ...counties.value.map((c) => ({ title: c, value: c })),
])
const countySelections = ref<string[]>([])
const nationwide = computed(() => countySelections.value.includes(NATIONWIDE))
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
// Bumped once per selection change and threaded through both this and the
// primary-pin re-centre below — each async result is discarded if a newer
// selection change has started by the time it resolves. Without this,
// ticking several counties in a row fires that many concurrent lookups that
// can resolve out of order, and whichever lands LAST (not the one for the
// current selection) wins — the map was observed getting stuck on an
// early/small selection forever.
let locSeq = 0
async function refreshOverview(seq: number): Promise<void> {
  if (nationwide.value || countiesChosen.value.length <= 1) {
    if (seq === locSeq) overviewMarkers.value = null
    return
  }
  try {
    const centers = await Promise.all(countiesChosen.value.map((c) => countyCenter(c)))
    if (seq !== locSeq) return
    overviewMarkers.value = centers.map((c) => ({ lat: c.lat, lng: c.lng, label: c.county }))
  } catch {
    if (seq === locSeq) overviewMarkers.value = null
  }
}

function onCountySelectionsChange(vals: string[]): void {
  const justPickedNationwide = vals.includes(NATIONWIDE) && !nationwide.value
  const realPicks = vals.filter((v) => v !== NATIONWIDE)
  const pickedEveryCounty = counties.value.length > 0 && realPicks.length === counties.value.length
  countySelections.value = justPickedNationwide || pickedEveryCounty ? [NATIONWIDE] : realPicks
  saved.value = false
  const seq = ++locSeq
  void refreshOverview(seq)
  // Re-centre the single-pin map on the (new) first county's main city —
  // only meaningful once we're back down to exactly one real county.
  const primary = countiesChosen.value[0]
  if (primary && countiesChosen.value.length === 1) {
    void countyCenter(primary)
      .then((center) => {
        if (seq !== locSeq) return
        lat.value = center.lat
        lng.value = center.lng
        city.value = center.name
      })
      .catch(() => {})
  }
}
function removeCounty(c: string): void {
  onCountySelectionsChange(countySelections.value.filter((v) => v !== c))
}

function onMapPick(p: { lat: number; lng: number }): void {
  lat.value = Number(p.lat.toFixed(5))
  lng.value = Number(p.lng.toFixed(5))
  saved.value = false
  void nearestCity(lat.value, lng.value)
    .then((near) => {
      city.value = near.name
      if (counties.value.includes(near.county) && !countiesChosen.value.includes(near.county)) {
        countySelections.value = [near.county, ...countiesChosen.value]
        void refreshOverview(++locSeq)
      }
    })
    .catch(() => {})
}

const canSave = computed(() => countySelections.value.length > 0 && !pendingDeletion.value)

async function save(): Promise<void> {
  if (!canSave.value || saving.value || !companyId.value) return
  saving.value = true
  error.value = ''
  const payload = nationwide.value
    ? { nationwide: true }
    : {
        counties: countiesChosen.value,
        city: countiesChosen.value.length === 1 ? city.value || undefined : undefined,
        lat: countiesChosen.value.length === 1 ? lat.value : undefined,
        lng: countiesChosen.value.length === 1 ? lng.value : undefined,
        nationwide: false,
      }
  try {
    await companies.updateLocation(companyId.value, payload)
    saved.value = true
    toasts.success(t('location.saved'))
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'error'
  } finally {
    saving.value = false
  }
}

async function loadFor(id: string): Promise<void> {
  companyId.value = id
  companies.select(id)
  ready.value = false
  await Promise.all([
    companies.ensureLoaded().catch(() => {}),
    companies.fetchOverview().catch(() => {}),
  ])
  const company = companies.list.find((c) => c.id === id)
  if (!company) {
    void router.replace({ name: 'dashboard' })
    return
  }
  const isNationwide = company.locations.some((l) => l.nationwide)
  const primaryLoc = company.locations.find((l) => l.isPrimary) ?? company.locations[0]
  const countyList = company.locations.map((l) => l.county).filter((c): c is string => !!c)
  countySelections.value = isNationwide ? [NATIONWIDE] : countyList
  city.value = primaryLoc?.city ?? ''
  if (primaryLoc?.lat != null && primaryLoc?.lng != null) {
    lat.value = primaryLoc.lat
    lng.value = primaryLoc.lng
  }
  await refreshOverview(++locSeq)
  ready.value = true
}

onMounted(async () => {
  counties.value = await fetchCounties().catch(() => [])
  const id = companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  await loadFor(id)
})

watch(
  () => route.query.c,
  (raw) => {
    const next = typeof raw === 'string' ? raw : null
    if (next && next !== companyId.value) void loadFor(next)
  },
)
</script>

<template>
  <v-container class="loc">
    <header class="loc__head">
      <p class="loc__eyebrow">{{ t('location.eyebrowEdit') }}</p>
      <h1>{{ t('location.titleEdit') }}</h1>
      <p class="loc__lead">{{ t('location.feedNote') }}</p>
    </header>

    <div v-if="!ready" class="loc__loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <div v-if="pendingDeletion" class="loc__frozen">
        <v-icon icon="mdi-delete-clock-outline" size="18" />
        <div>
          <strong>{{ t('location.deletionPendingTitle') }}</strong>
          <p>{{ t('location.deletionPendingNote') }}</p>
        </div>
        <v-btn
          size="small"
          variant="flat"
          color="primary"
          append-icon="mdi-arrow-right"
          :to="{ name: 'dashboard', query: { c: companyId } }"
        >
          {{ t('location.deletionPendingCta') }}
        </v-btn>
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
        :disabled="pendingDeletion"
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

      <!-- Redesigned summary: large, legible pills instead of the input's
           own cramped chip row — makes exactly what's selected unambiguous. -->
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
              :disabled="pendingDeletion"
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
        <v-btn
          color="primary"
          :disabled="!canSave"
          :loading="saving"
          @click="save"
        >
          {{ saved ? t('location.savedContinue') : t('location.save') }}
        </v-btn>
      </div>
    </template>
  </v-container>
</template>

<style scoped>
.loc {
  max-width: 680px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.loc__head {
  margin-bottom: 1.75rem;
}
.loc__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin: 0 0 0.6rem;
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

.loc__selectPlaceholder {
  color: rgba(var(--v-theme-on-surface), 0.75);
}

/* Same shape as CampaignView's own frozen/pending-deletion notice. */
.loc__frozen {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.85rem 1rem;
  border-radius: var(--tvz-radius-md);
  margin-bottom: 1.25rem;
  background: rgba(var(--v-theme-error), 0.08);
  border: 1px solid rgba(var(--v-theme-error), 0.4);
}
.loc__frozen > .v-icon {
  color: rgb(var(--v-theme-error));
  flex: none;
}
.loc__frozen > div {
  flex: 1;
  min-width: 0;
}
.loc__frozen strong {
  font-size: 0.9rem;
}
.loc__frozen p {
  margin: 0.1rem 0 0;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
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
  justify-content: flex-end;
  margin-top: 1.75rem;
}
</style>
