<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import WebsiteRenderer from '@/components/WebsiteRenderer.vue'
import PagePanel from '@/components/builder/PagePanel.vue'
import SectionEditor from '@/components/builder/SectionEditor.vue'
import ChromeEditor from '@/components/builder/ChromeEditor.vue'
import SectionCatalog from '@/components/builder/SectionCatalog.vue'
import ThemeBar from '@/components/builder/ThemeBar.vue'
import AiBrief from '@/components/builder/AiBrief.vue'
import AiLoader from '@/components/builder/AiLoader.vue'
import { useCompaniesStore } from '@/stores/companies'
import { useBuilderStore } from '@/stores/builder'
import { useToastStore } from '@/stores/toast'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const builder = useBuilderStore()
const { overview } = storeToRefs(companies)
const { view, activePage, selectedId, loading, working, dirty, saving, aiPlanning, error } =
  storeToRefs(builder)
const toasts = useToastStore()

async function doSave(): Promise<void> {
  if (companyId.value && dirty.value && !saving.value) await builder.save(companyId.value)
}
function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void doSave()
  }
}
function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (dirty.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}

// Leaving the studio with unsaved edits → confirm first.
onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return window.confirm(t('builder.leaveWarn'))
})

const companyId = ref<string | null>(null)
/** A platform admin editing a business's site — entered from the admin panel with
 *  `?companyId=`. Skips the owner-onboarding nudges and returns to the admin page. */
const adminMode = computed(() => typeof route.query.companyId === 'string')
const backTarget = computed(() =>
  adminMode.value && companyId.value
    ? { name: 'admin-company', params: { id: companyId.value } }
    : { name: 'dashboard' },
)
const pane = ref<'pages' | 'preview' | 'editor'>('pages')
const catalogPayload = ref<{ pageId: string; index?: number } | null>(null)
const aiOpen = ref(false)
const aiNotesDismissed = ref(false)
const aiNotes = computed(() => view.value?.doc?.ai?.notes ?? [])
watch(aiNotes, () => (aiNotesDismissed.value = false))

// NB: the AI verifies + auto-fixes the site DURING generation (see the backend
// `repairGeneratedSite`), so there is deliberately no "issues to resolve" panel
// here — the studio only ever receives the finished, corrected result.

const balance = computed(() => view.value?.wallet.balance.credits ?? 0)
const price = computed(() => view.value?.priceCredits ?? 0)
const funded = computed(() => balance.value >= price.value)
const isUpgrade = computed(() => view.value?.mode === 'easy')
// No campaign row yet, or one that's sitting in 'draft' (configured but never
// actually gone live — `paused`/`depleted` are only ever reached *from*
// `active`, per `campaign.service.ts`) → this business has never gone live,
// so this is still the first pass through the builder → budget flow, whether
// it's a brand-new advanced signup or an easy-plan upgrade that never
// finished setting up a campaign. Once it's been live at least once, later
// builder visits are edits and get the quiet "autosaved" note instead.
const isFirstTimeSetup = computed(() => {
  if (adminMode.value) return false
  const status = overview.value.find((c) => c.id === companyId.value)?.campaignStatus
  return status == null || status === 'draft'
})
// A business scheduled for deletion can't unlock/edit the builder during its
// grace window (see `website-builder.service.ts` `load()`'s `needEdit` gate).
const pendingDeletion = computed(
  () => !!overview.value.find((c) => c.id === companyId.value)?.deletionScheduledAt,
)
const aiPlanLimit = computed(() => view.value?.aiLimits?.plan ?? 6)
const aiSectionLimit = computed(() => view.value?.aiLimits?.section ?? 40)
const aiPlanLeft = computed(() => view.value?.aiLimits?.planLeft ?? aiPlanLimit.value)

const KNOWN_ERR = [
  'insufficient_credits',
  'advanced_builder_locked',
  'not_an_advanced_website',
  'company_pending_deletion',
  'ai_plan_limit',
  'ai_section_limit',
  'ai_unavailable',
  'nothing_to_undo',
  'banned_content',
  'section_limit',
  'system_page_locked',
  'last_section',
]
function errText(code: string): string {
  return KNOWN_ERR.includes(code) ? t('builder.err.' + code) : code
}
// Every builder error surfaces as the shared pop-up toast (the locked-screen
// fallback text stays inline — it's page content, not an action alert).
watch(error, (v) => {
  if (v) toasts.error(errText(v))
})

/** The renderer wants a single page's content; feed it the active page only,
 *  but keep the nav/footer config so the chrome previews correctly. */
const previewContent = computed(() => {
  const c = view.value?.content
  if (!c) return null
  const p = c.pages.find((x) => x.slug === activePage.value?.slug) ?? c.pages[0]
  return { pages: p ? [p] : c.pages, seo: c.seo, nav: c.nav, footer: c.footer }
})
/** Real page list for the previewed navbar (the preview renders one page). */
const navPreview = computed(() =>
  (view.value?.content?.pages ?? [])
    .filter((p) => (p as { nav?: boolean }).nav !== false && !(p as { system?: string }).system)
    .map((p) => ({ slug: p.slug, title: p.title })),
)
const chromeSelected = computed(
  () => selectedId.value === '__nav__' || selectedId.value === '__footer__',
)

async function unlock(): Promise<void> {
  if (companyId.value) await builder.unlock(companyId.value)
}
function onSelect(id: string): void {
  builder.select(id)
  pane.value = 'editor'
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
  await companies.fetchOverview().catch(() => {})
  const id = adminMode.value
    ? String(route.query.companyId)
    : companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  companyId.value = id
  await builder.load(id)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <div class="wb">
    <header class="wb__bar">
      <div class="wb__title">
        <p class="wb__eyebrow"><span class="wb__dot" /> {{ t('builder.eyebrow') }}</p>
        <h1>{{ t('builder.title') }}</h1>
      </div>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="backTarget">
        {{ adminMode ? t('builder.backAdmin') : t('builder.back') }}
      </v-btn>
    </header>

    <div v-if="loading && !view" class="wb__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="!view" class="wb__lock">
      <v-icon icon="mdi-alert-circle-outline" size="34" />
      <h2>{{ t('builder.loadErrorTitle') }}</h2>
      <p class="wb__lockText">{{ error ? errText(error) : t('builder.loadErrorText') }}</p>
      <v-btn color="primary" variant="tonal" :to="backTarget">
        {{ adminMode ? t('builder.backAdmin') : t('builder.back') }}
      </v-btn>
    </div>

    <!-- ADMIN, site still on the easy plan — the pay screen is the owner's, not
         the admin's. Send them back to grant/charge the upgrade from the panel. -->
    <div v-else-if="!view.unlocked && adminMode" class="wb__lock">
      <v-icon icon="mdi-lock-open-variant-outline" size="34" />
      <h2>{{ t('builder.adminLockedTitle') }}</h2>
      <p class="wb__lockText">{{ t('builder.adminLockedText') }}</p>
      <v-btn color="primary" variant="flat" append-icon="mdi-arrow-right" :to="backTarget">
        {{ t('builder.backAdmin') }}
      </v-btn>
    </div>

    <!-- LOCKED: pay to unlock / upgrade -->
    <div v-else-if="!view.unlocked" class="wb__lock">
      <v-icon :icon="isUpgrade ? 'mdi-creation' : 'mdi-lock-open-variant-outline'" size="34" />
      <h2>{{ isUpgrade ? t('builder.upgradeTitle') : t('builder.lockTitle') }}</h2>
      <p class="wb__lockText">{{ isUpgrade ? t('builder.upgradeText') : t('builder.lockText') }}</p>

      <ul class="wb__feats">
        <li><v-icon icon="mdi-file-tree" size="16" /> {{ t('builder.feat.pages') }}</li>
        <li><v-icon icon="mdi-view-grid-plus-outline" size="16" /> {{ t('builder.feat.sections') }}</li>
        <li><v-icon icon="mdi-palette-outline" size="16" /> {{ t('builder.feat.design') }}</li>
        <li class="wb__feats-hi">
          <v-icon icon="mdi-infinity" size="16" /> {{ t('builder.feat.unlimited') }}
        </li>
        <li>
          <v-icon icon="mdi-creation" size="16" />
          {{ t('builder.feat.ai', { plan: aiPlanLimit, section: aiSectionLimit }) }}
        </li>
      </ul>

      <div class="wb__lockPrice">
        <strong>{{ t('builder.priceValue', { credits: price }) }}</strong>
        <span>{{ t('builder.balance', { n: n(balance, { maximumFractionDigits: 2 }) }) }}</span>
      </div>
      <div class="wb__lockActions">
        <v-btn
          v-if="!funded"
          color="primary"
          variant="tonal"
          :to="{ name: 'wallet', query: { c: companyId } }"
        >
          {{ t('builder.addCredits') }}
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!funded || pendingDeletion"
          :loading="working"
          append-icon="mdi-arrow-right"
          @click="unlock"
        >
          {{ isUpgrade ? t('builder.upgradeCta', { credits: price }) : t('builder.payCta', { credits: price }) }}
        </v-btn>
      </div>
    </div>

    <!-- FROZEN: pending deletion — cancel it from the dashboard before editing again -->
    <div v-else-if="pendingDeletion" class="wb__lock">
      <v-icon icon="mdi-trash-clock-outline" size="34" />
      <h2>{{ t('builder.deletionPendingTitle') }}</h2>
      <p class="wb__lockText">{{ t('builder.deletionPendingText') }}</p>
      <v-btn
        color="primary"
        variant="flat"
        append-icon="mdi-arrow-right"
        :to="{ name: 'dashboard', query: { c: companyId } }"
      >
        {{ t('builder.deletionPendingCta') }}
      </v-btn>
    </div>

    <!-- UNLOCKED: the component builder -->
    <template v-else>
      <ThemeBar v-if="companyId" :company-id="companyId" @open-ai="aiOpen = true" />

      <div class="wb__save" :class="{ 'is-dirty': dirty }">
        <span class="wb__saveState">
          <v-icon :icon="dirty ? 'mdi-circle-medium' : 'mdi-check-circle-outline'" size="17" />
          {{ dirty ? t('builder.unsaved') : t('builder.allSaved') }}
        </span>
        <button
          type="button"
          class="wb__saveBtn"
          :disabled="!dirty || saving"
          @click="doSave"
        >
          <v-progress-circular v-if="saving" indeterminate size="14" width="2" />
          <template v-else><v-icon icon="mdi-content-save-outline" size="15" /> {{ t('builder.saveNow') }}</template>
        </button>
      </div>

      <div class="wb__tabs">
        <button :class="{ 'is-on': pane === 'pages' }" type="button" @click="pane = 'pages'">
          <v-icon icon="mdi-file-tree-outline" size="18" /> {{ t('builder.panePages') }}
        </button>
        <button :class="{ 'is-on': pane === 'preview' }" type="button" @click="pane = 'preview'">
          <v-icon icon="mdi-monitor" size="18" /> {{ t('builder.panePreview') }}
        </button>
        <button :class="{ 'is-on': pane === 'editor' }" type="button" @click="pane = 'editor'">
          <v-icon icon="mdi-tune-variant" size="18" /> {{ t('builder.paneEditor') }}
        </button>
      </div>

      <div class="wb__grid">
        <aside class="wb__rail" :class="{ 'is-hidden-mobile': pane !== 'pages' }">
          <PagePanel
            v-if="companyId"
            :company-id="companyId"
            @open-catalog="catalogPayload = $event"
          />
        </aside>

        <section class="wb__preview" :class="{ 'is-hidden-mobile': pane !== 'preview' }">
          <WebsiteRenderer
            v-if="previewContent && view.theme"
            :content="previewContent"
            :theme="view.theme"
            :selected-id="selectedId"
            :nav-preview="navPreview"
            editable
            framed
            @select="onSelect"
          />
          <div v-else class="wb__empty">
            <v-icon icon="mdi-image-frame" size="34" />
            <p>{{ t('builder.previewEmpty') }}</p>
          </div>
        </section>

        <aside class="wb__editor" :class="{ 'is-hidden-mobile': pane !== 'editor' }">
          <ChromeEditor v-if="companyId && chromeSelected" :company-id="companyId" />
          <SectionEditor v-else-if="companyId" :company-id="companyId" />
        </aside>
      </div>

      <!-- Status region: capped + scrollable so stacked notes never starve the
           preview grid above (this is what made the preview collapse). -->
      <div class="wb__foot">
        <div v-if="aiNotes.length && !aiNotesDismissed" class="wb__ainote">
          <v-icon icon="mdi-pencil-outline" size="16" />
          <div>
            <strong>{{ t('builder.aiNoteTitle') }}</strong>
            <ul>
              <li v-for="n in aiNotes" :key="n">{{ t(`builder.aiNote.${n}`) }}</li>
            </ul>
          </div>
          <button type="button" class="wb__ainote-x" @click="aiNotesDismissed = true">
            <v-icon icon="mdi-close" size="16" />
          </button>
        </div>

        <div v-if="!view.locationSet && !adminMode" class="wb__note">
          <div class="wb__note-txt">
            <strong>{{ t('builder.doneTitle') }}</strong>
            <span>{{ t('builder.doneText') }}</span>
          </div>
          <v-btn
            color="primary"
            size="small"
            append-icon="mdi-arrow-right"
            :to="{ name: 'create-location', query: { c: companyId } }"
          >
            {{ t('builder.continueLocation') }}
          </v-btn>
        </div>
        <div v-else-if="isFirstTimeSetup" class="wb__note">
          <div class="wb__note-txt">
            <strong>{{ t('builder.doneTitle') }}</strong>
            <span>{{ t('builder.doneText') }}</span>
          </div>
          <v-btn
            color="primary"
            size="small"
            append-icon="mdi-arrow-right"
            :to="{ name: 'campaign-budget', query: { c: companyId, flow: 'onboarding' } }"
          >
            {{ t('builder.continueBudget') }}
          </v-btn>
        </div>
        <p v-if="view.aiConfigured" class="wb__aiquota">
          <v-icon icon="mdi-creation" size="13" />
          {{ t('builder.aiQuota', { left: aiPlanLeft, limit: aiPlanLimit }) }}
        </p>
      </div>

      <SectionCatalog
        v-if="catalogPayload && companyId"
        :company-id="companyId"
        :page-id="catalogPayload.pageId"
        :index="catalogPayload.index"
        @close="catalogPayload = null"
      />

      <AiBrief v-if="aiOpen && companyId" :company-id="companyId" @close="aiOpen = false" />
    </template>

    <AiLoader v-if="aiPlanning" />
  </div>
</template>

<style scoped>
.wb {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - var(--tvz-topbar-h) - 2px);
  padding: clamp(1rem, 3vw, 1.75rem);
  gap: 0.9rem;
}
.wb__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.wb__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: var(--tvz-ai);
  margin: 0 0 0.35rem;
}
.wb__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.wb__title h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.35rem, 3.5vw, 1.9rem);
  letter-spacing: -0.02em;
  margin: 0;
}

.wb__center {
  flex: 1;
  display: grid;
  place-items: center;
}

.wb__lock {
  max-width: 460px;
  margin: 2rem auto;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 2rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
}
.wb__lock h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.3rem;
  margin: 0;
}
.wb__lockText {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.9rem;
}
.wb__feats {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0.9rem 1rem;
  width: 100%;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid var(--tvz-hairline);
  font-size: 0.84rem;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.wb__feats li {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}
.wb__feats li .v-icon {
  margin-top: 0.1rem;
  color: rgb(var(--v-theme-primary));
  flex: none;
}
.wb__feats-hi {
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.95);
}
.wb__lockPrice {
  margin: 0.6rem 0;
}
.wb__lockPrice strong {
  display: block;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.7rem;
}
.wb__lockPrice span {
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.wb__lockActions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  justify-content: center;
}

.wb__tabs {
  display: none;
  gap: 0.35rem;
  padding: 0.25rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  align-self: flex-start;
}
.wb__tabs button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.wb__tabs button.is-on {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  box-shadow: var(--tvz-shadow-sm);
}

.wb__save {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-glass-border);
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.wb__save.is-dirty {
  border-color: rgba(var(--v-theme-warning), 0.45);
  background: rgba(var(--v-theme-warning), 0.08);
}
.wb__saveState {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.wb__save.is-dirty .wb__saveState {
  color: rgb(var(--v-theme-warning, 217 119 6));
}
.wb__saveBtn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 1rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 700;
  color: #fff;
  background: rgb(var(--v-theme-primary));
}
.wb__saveBtn:disabled {
  opacity: 0.45;
}

.wb__grid {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr) minmax(280px, 340px);
  gap: 0.8rem;
}

/* Below the grid: AI notes + the "continue" nudge + AI quota. Sized to its
   content and always fully visible (no inner scrollbar). It stays small on its
   own now that the old post-generation "review" panel is gone, so the preview
   grid above keeps almost the full height. */
.wb__foot {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.wb__foot:empty {
  display: none;
}

/* Desktop: lock the studio to the viewport so the 3 panes — the page rail, the
   preview and the editor on the right — are always visible. Nothing here drives
   page scroll; every pane scrolls its own overflow internally. */
@media (min-width: 1101px) {
  .wb {
    height: calc(100dvh - var(--tvz-topbar-h) - 2px);
    overflow: hidden;
    gap: 0.55rem;
  }
  .wb__grid {
    min-height: 0;
  }
  .wb__grid > * {
    min-height: 0;
    height: 100%;
  }
}

/* Tablet / phone: the panes stack under tabs — give the preview real height
   so it isn't a tiny sliver. */
@media (max-width: 1100px) {
  .wb__preview {
    min-height: 62vh;
  }
}
.wb__rail,
.wb__editor {
  min-height: 0;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}

.wb__preview {
  min-height: 0;
  overflow: hidden;
  border-radius: var(--tvz-radius-lg);
}
.wb__preview :deep(.site) {
  height: 100%;
}
.wb__preview :deep(.site--framed .site__scroll) {
  max-height: none;
  height: calc(100% - 34px);
}
.wb__empty {
  height: 100%;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  border: 1px dashed var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
}
.wb__note {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.9rem;
  padding: 0.55rem 0.85rem;
  border-radius: var(--tvz-radius-md);
  background: var(--tvz-ai-soft);
  border: 1px solid var(--tvz-glass-border);
  font-size: 0.82rem;
}
.wb__note-txt {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1 1 260px;
  min-width: 0;
}
.wb__ainote {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.7rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-warning), 0.12);
  border: 1px solid rgba(var(--v-theme-warning), 0.35);
  font-size: 0.82rem;
}
.wb__ainote strong {
  font-size: 0.86rem;
}
.wb__ainote ul {
  margin: 0.25rem 0 0;
  padding-left: 1.1rem;
}
.wb__ainote-x {
  margin-left: auto;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.wb__aiquota {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.wb__aiquota .v-icon {
  color: rgb(var(--v-theme-primary));
}
.wb__note--ok {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.wb__note strong {
  font-size: 0.9rem;
}
.wb__err {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
  font-size: 0.8rem;
}

@media (max-width: 1100px) {
  .wb__tabs {
    display: flex;
  }
  .wb__grid {
    grid-template-columns: 1fr;
  }
  .is-hidden-mobile {
    display: none !important;
  }
}
</style>
