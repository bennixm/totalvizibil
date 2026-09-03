<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import WebsiteRenderer from '@/components/WebsiteRenderer.vue'
import PagePanel from '@/components/builder/PagePanel.vue'
import SectionEditor from '@/components/builder/SectionEditor.vue'
import SectionCatalog from '@/components/builder/SectionCatalog.vue'
import ThemeBar from '@/components/builder/ThemeBar.vue'
import AiBrief from '@/components/builder/AiBrief.vue'
import { useCompaniesStore } from '@/stores/companies'
import { useBuilderStore } from '@/stores/builder'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const builder = useBuilderStore()
const { view, activePage, selectedId, loading, working, error } = storeToRefs(builder)

const companyId = ref<string | null>(null)
const pane = ref<'pages' | 'preview' | 'editor'>('pages')
const catalogPayload = ref<{ pageId: string; index?: number } | null>(null)
const aiOpen = ref(false)

const balance = computed(() => view.value?.wallet.balance.credits ?? 0)
const price = computed(() => view.value?.priceCredits ?? 0)
const funded = computed(() => balance.value >= price.value)
const isUpgrade = computed(() => view.value?.mode === 'easy')

const KNOWN_ERR = [
  'insufficient_credits',
  'advanced_builder_locked',
  'not_an_advanced_website',
  'ai_plan_limit',
  'ai_section_limit',
  'ai_unavailable',
  'nothing_to_undo',
  'banned_content',
]
function errText(code: string): string {
  return KNOWN_ERR.includes(code) ? t('builder.err.' + code) : code
}

/** The renderer wants a single page's content; feed it the active page only. */
const previewContent = computed(() => {
  const c = view.value?.content
  if (!c) return null
  const p = c.pages.find((x) => x.slug === activePage.value?.slug) ?? c.pages[0]
  return { pages: p ? [p] : c.pages, seo: c.seo }
})

async function unlock(): Promise<void> {
  if (companyId.value) await builder.unlock(companyId.value)
}
function onSelect(id: string): void {
  builder.select(id)
  pane.value = 'editor'
}

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  companyId.value = id
  await builder.load(id)
})
</script>

<template>
  <div class="wb">
    <header class="wb__bar">
      <div class="wb__title">
        <p class="wb__eyebrow"><span class="wb__dot" /> {{ t('builder.eyebrow') }}</p>
        <h1>{{ t('builder.title') }}</h1>
      </div>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'dashboard' }">
        {{ t('builder.back') }}
      </v-btn>
    </header>

    <div v-if="loading && !view" class="wb__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="!view" class="wb__lock">
      <v-icon icon="mdi-alert-circle-outline" size="34" />
      <h2>{{ t('builder.loadErrorTitle') }}</h2>
      <p class="wb__lockText">{{ error ? errText(error) : t('builder.loadErrorText') }}</p>
      <v-btn color="primary" variant="tonal" :to="{ name: 'dashboard' }">{{ t('builder.back') }}</v-btn>
    </div>

    <!-- LOCKED: pay to unlock / upgrade -->
    <div v-else-if="!view.unlocked" class="wb__lock">
      <v-icon :icon="isUpgrade ? 'mdi-creation' : 'mdi-lock-open-variant-outline'" size="34" />
      <h2>{{ isUpgrade ? t('builder.upgradeTitle') : t('builder.lockTitle') }}</h2>
      <p class="wb__lockText">{{ isUpgrade ? t('builder.upgradeText') : t('builder.lockText') }}</p>
      <div class="wb__lockPrice">
        <strong>{{ t('builder.priceValue', { credits: price }) }}</strong>
        <span>{{ t('builder.balance', { n: n(balance, { maximumFractionDigits: 2 }) }) }}</span>
      </div>
      <div v-if="error" class="wb__err">
        <v-icon icon="mdi-alert-circle-outline" size="16" /> {{ errText(error) }}
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
          :disabled="!funded"
          :loading="working"
          append-icon="mdi-arrow-right"
          @click="unlock"
        >
          {{ isUpgrade ? t('builder.upgradeCta', { credits: price }) : t('builder.payCta', { credits: price }) }}
        </v-btn>
      </div>
    </div>

    <!-- UNLOCKED: the component builder -->
    <template v-else>
      <ThemeBar v-if="companyId" :company-id="companyId" @open-ai="aiOpen = true" />

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
          <SectionEditor v-if="companyId" :company-id="companyId" />
        </aside>
      </div>

      <div v-if="error" class="wb__err">
        <v-icon icon="mdi-alert-circle-outline" size="16" /> {{ errText(error) }}
      </div>

      <div v-if="!view.locationSet" class="wb__note">
        <strong>{{ t('builder.doneTitle') }}</strong>
        <span>{{ t('builder.doneText') }}</span>
        <v-btn
          class="mt-2"
          color="primary"
          size="small"
          append-icon="mdi-arrow-right"
          :to="{ name: 'create-location', query: { c: companyId } }"
        >
          {{ t('builder.continueLocation') }}
        </v-btn>
      </div>
      <div v-else class="wb__note wb__note--ok">
        <v-icon icon="mdi-check-circle-outline" size="16" />
        <span>{{ t('builder.autosaved') }}</span>
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
  color: rgb(var(--v-theme-on-surface) / 0.66);
  font-size: 0.9rem;
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
  color: rgb(var(--v-theme-on-surface) / 0.55);
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
  background: rgb(var(--v-theme-on-surface) / 0.06);
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
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.wb__tabs button.is-on {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  box-shadow: var(--tvz-shadow-sm);
}

.wb__grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr) minmax(280px, 340px);
  gap: 0.8rem;
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
  color: rgb(var(--v-theme-on-surface) / 0.5);
  border: 1px dashed var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
}
.wb__note {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.8rem 1rem;
  border-radius: var(--tvz-radius-md);
  background: var(--tvz-ai-soft);
  border: 1px solid var(--tvz-glass-border);
  font-size: 0.82rem;
}
.wb__note--ok {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  background: rgb(var(--v-theme-on-surface) / 0.04);
  color: rgb(var(--v-theme-on-surface) / 0.6);
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
  background: rgb(var(--v-theme-error) / 0.1);
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
