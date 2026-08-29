<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import WebsiteRenderer from '@/components/WebsiteRenderer.vue'
import { useDraftStore, type Section, type WebsiteContent } from '@/stores/draft'

const { t } = useI18n()
const router = useRouter()
const draft = useDraftStore()

const loading = ref(true)
const savedFlash = ref(false)

// Local editable copy of the content tree.
const content = ref<WebsiteContent | null>(null)

const edit = reactive({
  heroHeadline: '',
  heroSub: '',
  aboutTitle: '',
  aboutBody: '',
  ctaHeadline: '',
})

function sectionOf(type: Section['type']): Section | undefined {
  return content.value?.pages[0]?.sections.find((s) => s.type === type)
}

function hydrateEditFields() {
  const hero = sectionOf('hero')
  const about = sectionOf('about')
  const cta = sectionOf('cta')
  edit.heroHeadline = (hero?.headline as string) ?? ''
  edit.heroSub = (hero?.subheadline as string) ?? ''
  edit.aboutTitle = (about?.title as string) ?? ''
  edit.aboutBody = (about?.body as string) ?? ''
  edit.ctaHeadline = (cta?.headline as string) ?? ''
}

onMounted(async () => {
  if (!draft.draft) await draft.load()
  if (!draft.draft) {
    router.replace({ name: 'create' })
    return
  }
  content.value = JSON.parse(JSON.stringify(draft.draft.content))
  hydrateEditFields()
  loading.value = false
})

// Live-apply edits to the local preview tree.
watch(edit, () => {
  const hero = sectionOf('hero')
  const about = sectionOf('about')
  const cta = sectionOf('cta')
  if (hero) {
    hero.headline = edit.heroHeadline
    hero.subheadline = edit.heroSub
  }
  if (about) {
    about.title = edit.aboutTitle
    about.body = edit.aboutBody
  }
  if (cta) cta.headline = edit.ctaHeadline
})

const palettes = ['indigo', 'emerald', 'amber', 'slate', 'rose'] as const
const paletteHex: Record<string, string> = {
  indigo: '#4f46e5',
  emerald: '#059669',
  amber: '#d97706',
  slate: '#475569',
  rose: '#e11d48',
}
const theme = computed(() => draft.draft?.theme)

function setPalette(p: (typeof palettes)[number]) {
  if (draft.draft) draft.draft.theme.palette = p
}

async function save() {
  if (!content.value) return
  await draft.saveContent(content.value)
  savedFlash.value = true
  setTimeout(() => (savedFlash.value = false), 1800)
}

async function continueToAccount() {
  if (content.value) await draft.saveContent(content.value)
  router.push({ name: 'create-account' })
}
</script>

<template>
  <div class="pv">
    <div v-if="loading" class="pv__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="content && theme">
      <header class="pv__bar page-container">
        <div>
          <p class="pv__eyebrow">
            <v-icon icon="mdi-sparkles" size="14" /> {{ t('preview.eyebrow') }}
          </p>
          <h1>{{ t('preview.title') }}</h1>
        </div>
        <div class="pv__bar-actions">
          <v-btn variant="text" size="small" @click="draft.clear(); router.push({ name: 'create' })">
            {{ t('create.startOver') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            rounded="pill"
            append-icon="mdi-arrow-right"
            @click="continueToAccount"
          >
            {{ t('preview.publishCta') }}
          </v-btn>
        </div>
      </header>

      <div class="page-container pv__grid">
        <!-- Live preview -->
        <div class="pv__frame">
          <WebsiteRenderer :content="content" :theme="theme" framed />
        </div>

        <!-- Assistant / edit panel -->
        <aside class="pv__panel">
          <div class="pv__panel-head">
            <span class="pv__panel-dot" />
            <span>{{ t('preview.panelTitle') }}</span>
          </div>

          <label class="pv__label">{{ t('preview.palette') }}</label>
          <div class="pv__swatches">
            <button
              v-for="p in palettes"
              :key="p"
              class="sw"
              :class="{ 'sw--on': theme.palette === p }"
              :style="{ '--sw': paletteHex[p] }"
              @click="setPalette(p)"
            />
          </div>

          <v-divider class="my-4" />

          <v-text-field
            v-model="edit.heroHeadline"
            :label="t('preview.heroHeadline')"
            density="comfortable"
          />
          <v-textarea
            v-model="edit.heroSub"
            :label="t('preview.heroSub')"
            rows="2"
            auto-grow
            density="comfortable"
          />
          <v-text-field
            v-model="edit.aboutTitle"
            :label="t('preview.aboutTitle')"
            density="comfortable"
          />
          <v-textarea
            v-model="edit.aboutBody"
            :label="t('preview.aboutBody')"
            rows="3"
            auto-grow
            density="comfortable"
          />
          <v-text-field
            v-model="edit.ctaHeadline"
            :label="t('preview.ctaHeadline')"
            density="comfortable"
          />

          <v-btn
            block
            variant="tonal"
            :loading="draft.saving"
            prepend-icon="mdi-content-save-outline"
            @click="save"
          >
            {{ savedFlash ? t('preview.saved') : t('preview.saveDraft') }}
          </v-btn>

          <p class="pv__note">{{ t('preview.moreEditsNote') }}</p>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pv__center {
  display: flex;
  justify-content: center;
  padding: 6rem 1rem;
}
.pv__bar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
  padding-block: 1.4rem 1rem;
}
.pv__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 11px;
  font-weight: 600;
  color: var(--tvz-ai);
  margin: 0 0 0.3rem;
}
.pv__bar h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.pv__bar-actions {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}
.pv__grid {
  display: grid;
  gap: 1.6rem;
  grid-template-columns: minmax(0, 1fr) 340px;
  align-items: start;
  padding-bottom: 5rem;
}
@media (max-width: 960px) {
  .pv__grid {
    grid-template-columns: 1fr;
  }
}
.pv__frame {
  position: sticky;
  top: 88px;
}
@media (max-width: 960px) {
  .pv__frame {
    position: static;
  }
}
.pv__panel {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  padding: 1.3rem;
  box-shadow: var(--tvz-shadow-sm);
}
.pv__panel-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 1.2rem;
}
.pv__panel-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.pv__label {
  display: block;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  margin-bottom: 0.5rem;
}
.pv__swatches {
  display: flex;
  gap: 0.45rem;
}
.sw {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--sw);
  border: 2px solid transparent;
  cursor: pointer;
}
.sw--on {
  border-color: rgb(var(--v-theme-on-surface));
  outline: 2px solid var(--sw);
  outline-offset: 1px;
}
.pv__note {
  margin: 0.9rem 0 0;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
</style>
