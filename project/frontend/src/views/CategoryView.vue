<script setup lang="ts">
/**
 * Panel page — edit an existing business's category tagging (which
 * subcategories it's found under in the feed). Split out from location
 * editing (see LocationView.vue) so each is a focused, independent edit.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import InfoHint from '@/components/InfoHint.vue'
import { fetchCategoryTree, type CategoryGroup } from '@/services/categories'
import { useCompaniesStore, type LocalizedName } from '@/stores/companies'
import { useToastStore } from '@/stores/toast'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const toasts = useToastStore()

const companyId = ref<string | null>(null)
const ready = ref(false)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

/**
 * Backend error → localized copy, mirroring CampaignView's own `errText`.
 * Recognised codes (plus the backend's raw English sentences for the
 * role/not-found guards, which aren't code-shaped) get their own line;
 * anything unrecognised falls back to one generic sentence instead of
 * toasting the raw server string verbatim. Shares the `location.err.*` keys
 * with LocationView — this page already reuses that namespace for the rest
 * of its copy.
 */
const ERROR_KEYS: Record<string, string> = {
  company_pending_deletion: 'company_pending_deletion',
  forbidden: 'forbidden',
  'Your role cannot edit this company': 'forbidden',
  not_found: 'not_found',
  'Company not found': 'not_found',
  unknown_category: 'unknown_category',
  'Unknown category': 'unknown_category',
}
function errText(raw: string): string {
  const key = ERROR_KEYS[raw]
  return key ? t('location.err.' + key) : t('location.err.generic')
}
watch(error, (v) => { if (v) toasts.error(errText(v)) })

// A business pending deletion is fully frozen server-side — saving here can
// only throw `company_pending_deletion`, so say so and disable the form, the
// way the dashboard and the campaign/budget page already do.
const pendingDeletion = computed(
  () => !!companies.list.find((c) => c.id === companyId.value)?.deletionScheduledAt,
)

const catTree = ref<CategoryGroup[]>([])
const groupSlug = ref<string | null>(null)
const leafSlugs = ref<string[]>([])

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
function preselect(slugs: string[]): void {
  if (!slugs.length) return
  const first = slugs[0]
  const parent = catTree.value.find((x) => x.children.some((c) => c.slug === first))
  if (parent) {
    groupSlug.value = parent.slug
    leafSlugs.value = slugs.filter((s) => parent.children.some((c) => c.slug === s))
  }
}

const canSave = computed(() => leafSlugs.value.length > 0 && !pendingDeletion.value)

async function save(): Promise<void> {
  if (!canSave.value || saving.value || !companyId.value) return
  saving.value = true
  error.value = ''
  try {
    await companies.updateCategories(companyId.value, leafSlugs.value)
    saved.value = true
    toasts.success(t('category.saved'))
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
  preselect(company.categories.map((c) => c.slug))
  ready.value = true
}

onMounted(async () => {
  catTree.value = await fetchCategoryTree().catch(() => [])
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
  <v-container class="cat">
    <header class="cat__head">
      <p class="cat__eyebrow">{{ t('category.eyebrow') }}</p>
      <h1>{{ t('category.title') }}</h1>
      <p class="cat__lead">{{ t('location.categoryHint') }}</p>
    </header>

    <div v-if="!ready" class="cat__loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <div v-if="pendingDeletion" class="cat__frozen">
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

      <div class="cat__fields">
        <v-select
          v-model="groupSlug"
          :items="groupItems"
          :label="t('location.categoryGroupLabel')"
          prepend-inner-icon="mdi-shape-outline"
          variant="outlined"
          density="comfortable"
          hide-details
          :disabled="pendingDeletion"
          @update:model-value="onGroupChange"
        />
        <v-select
          :model-value="leafSlugs"
          :items="leafItems"
          :label="t('location.categoryLeafLabel')"
          :disabled="!groupSlug || pendingDeletion"
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
      <p class="cat__hint">
        <InfoHint :text="t('location.categoryHint')" /> {{ t('category.feedNote') }}
      </p>

      <div class="cat__actions">
        <v-btn color="primary" :disabled="!canSave" :loading="saving" @click="save">
          {{ saved ? t('location.savedContinue') : t('location.save') }}
        </v-btn>
      </div>
    </template>
  </v-container>
</template>

<style scoped>
.cat {
  max-width: 680px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.cat__head {
  margin-bottom: 1.75rem;
}
.cat__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin: 0 0 0.6rem;
}
.cat__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.cat__lead {
  margin: 0.6rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.66);
}
.cat__loading {
  display: grid;
  place-items: center;
  min-height: 200px;
}
/* Same shape as CampaignView's own frozen/pending-deletion notice. */
.cat__frozen {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.85rem 1rem;
  border-radius: var(--tvz-radius-md);
  margin-bottom: 1.25rem;
  background: rgba(var(--v-theme-error), 0.08);
  border: 1px solid rgba(var(--v-theme-error), 0.4);
}
.cat__frozen > .v-icon {
  color: rgb(var(--v-theme-error));
  flex: none;
}
.cat__frozen > div {
  flex: 1;
  min-width: 0;
}
.cat__frozen strong {
  font-size: 0.9rem;
}
.cat__frozen p {
  margin: 0.1rem 0 0;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.cat__fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: start;
  gap: 0.75rem;
}
@media (max-width: 560px) {
  .cat__fields {
    grid-template-columns: 1fr;
  }
}
.cat__hint {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.9rem 0 0;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.cat__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1.75rem;
}
</style>
