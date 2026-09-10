<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import EasyStudioAgent from '@/components/studio/EasyStudioAgent.vue'
import WebsiteRenderer from '@/components/WebsiteRenderer.vue'
import { useCompaniesStore } from '@/stores/companies'
import { useEasySiteStore } from '@/stores/easySite'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const store = useEasySiteStore()
const { easy, theme, content, loading, error } = storeToRefs(store)

const companyId = ref<string | null>(null)
const mobilePane = ref<'editor' | 'preview'>('editor')

const KNOWN_ERR = ['not_a_simple_site', 'forbidden', 'company_pending_deletion', 'rate_limited']
const errText = computed(() =>
  error.value && KNOWN_ERR.includes(error.value)
    ? t('easyEditor.err.' + error.value)
    : t('easyEditor.loadErrorText'),
)

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = companies.resolveId(route.query.c)
  const entry = id ? companies.overview.find((c) => c.id === id) : null
  // Only easy-plan sites have this editor; anything else belongs in the builder.
  if (!id || entry?.website?.mode !== 'easy') {
    void router.replace({ name: 'dashboard' })
    return
  }
  companyId.value = id
  await store.load(id)
})
</script>

<template>
  <div class="ese">
    <header class="ese__bar">
      <div class="ese__title">
        <p class="ese__eyebrow"><span class="ese__dot" /> {{ t('easyEditor.eyebrow') }}</p>
        <h1>{{ t('easyEditor.title') }}</h1>
      </div>
      <div class="ese__tabs">
        <button
          :class="{ 'is-on': mobilePane === 'editor' }"
          type="button"
          @click="mobilePane = 'editor'"
        >
          <v-icon icon="mdi-tune-variant" size="18" /> {{ t('easyEditor.paneEditor') }}
        </button>
        <button
          :class="{ 'is-on': mobilePane === 'preview' }"
          type="button"
          @click="mobilePane = 'preview'"
        >
          <v-icon icon="mdi-monitor" size="18" /> {{ t('easyEditor.panePreview') }}
        </button>
      </div>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'dashboard' }">
        {{ t('easyEditor.back') }}
      </v-btn>
    </header>

    <div v-if="loading && !easy && !error" class="ese__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="error && !easy" class="ese__lock">
      <v-icon icon="mdi-alert-circle-outline" size="34" />
      <h2>{{ t('easyEditor.loadErrorTitle') }}</h2>
      <p class="ese__lockText">{{ errText }}</p>
      <v-btn color="primary" variant="tonal" :to="{ name: 'dashboard' }">
        {{ t('easyEditor.back') }}
      </v-btn>
    </div>

    <div v-else class="ese__grid">
      <!-- LEFT: live website preview -->
      <section
        class="ese__preview"
        :class="{ 'is-hidden-mobile': mobilePane !== 'preview' }"
        :aria-label="t('easyEditor.panePreview')"
      >
        <WebsiteRenderer v-if="content && theme" :content="content" :theme="theme" framed />
        <div v-else class="ese__empty">
          <v-progress-circular indeterminate color="primary" />
        </div>
      </section>

      <!-- RIGHT: the same guided widgets as setup, editing the live site -->
      <aside
        class="ese__agent"
        :class="{ 'is-hidden-mobile': mobilePane !== 'editor' }"
        :aria-label="t('easyEditor.paneEditor')"
      >
        <EasyStudioAgent standalone />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ese {
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--tvz-topbar-h) - 2px);
  padding: clamp(1rem, 3vw, 1.75rem);
  gap: 1rem;
}

.ese__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  flex-wrap: wrap;
}
.ese__title {
  flex: 1 1 auto;
  min-width: 0;
}
.ese__eyebrow {
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
.ese__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.ese__title h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.35rem, 3.5vw, 1.9rem);
  letter-spacing: -0.02em;
  margin: 0;
}

.ese__tabs {
  display: none;
  gap: 0.35rem;
  padding: 0.25rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.ese__tabs button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ese__tabs button.is-on {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  box-shadow: var(--tvz-shadow-sm);
}

.ese__center,
.ese__lock {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  text-align: center;
}
.ese__lock .v-icon {
  color: rgb(var(--v-theme-error));
}
.ese__lock h2 {
  margin: 0;
  font-size: 1.15rem;
}
.ese__lockText {
  margin: 0;
  max-width: 40ch;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.ese__grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 0.86fr) minmax(520px, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 1rem;
}

.ese__preview {
  min-height: 0;
  overflow: hidden;
  border-radius: var(--tvz-radius-lg);
}
.ese__preview :deep(.site) {
  height: 100%;
}
.ese__preview :deep(.site--framed .site__scroll) {
  max-height: none;
  height: calc(100% - 34px);
}
.ese__empty {
  height: 100%;
  display: grid;
  place-items: center;
  border: 1px dashed var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  background: rgba(var(--v-theme-surface), 0.4);
}

.ese__agent {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ese__agent > :first-child {
  flex: 1;
  min-height: 0;
}

@media (max-width: 900px) {
  .ese {
    height: calc(
      100dvh - var(--tvz-topbar-h) - var(--tvz-tabbar-h) - env(safe-area-inset-bottom, 0px) - 18px
    );
  }
  .ese__tabs {
    display: flex;
  }
  .ese__grid {
    grid-template-columns: 1fr;
  }
  .is-hidden-mobile {
    display: none;
  }
  .ese__preview :deep(.site--framed .site__scroll) {
    height: auto;
    max-height: 62dvh;
  }
}
</style>
