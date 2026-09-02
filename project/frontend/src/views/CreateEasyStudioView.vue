<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import EasyStudioAgent from '@/components/studio/EasyStudioAgent.vue'
import WebsiteRenderer from '@/components/WebsiteRenderer.vue'
import { useWebsiteDraftStore } from '@/stores/websiteDraft'

const { t } = useI18n()
const store = useWebsiteDraftStore()
const { draft, loading } = storeToRefs(store)

// Mobile: toggle between the preview and the chat (the app-like split doesn't
// fit a phone). Desktop shows both side by side.
const mobilePane = ref<'chat' | 'preview'>('chat')

onMounted(async () => {
  await store.resumeOrCreate()
  // If a stale advanced draft was resumed, start a fresh easy one (user picked "Easy").
  if (store.draft?.mode === 'advanced') await store.restart()
})
</script>

<template>
  <div class="studio">
    <header class="studio__bar">
      <div class="studio__title">
        <p class="studio__eyebrow"><span class="studio__dot" /> {{ t('studio.eyebrow') }}</p>
        <h1>{{ t('studio.title') }}</h1>
      </div>
      <div class="studio__tabs">
        <button :class="{ 'is-on': mobilePane === 'chat' }" type="button" @click="mobilePane = 'chat'">
          <v-icon icon="mdi-message-text-outline" size="18" /> {{ t('studio.paneChat') }}
        </button>
        <button
          :class="{ 'is-on': mobilePane === 'preview' }"
          type="button"
          @click="mobilePane = 'preview'"
        >
          <v-icon icon="mdi-monitor" size="18" /> {{ t('studio.panePreview') }}
        </button>
      </div>
    </header>

    <div class="studio__grid">
      <!-- LEFT: live website preview -->
      <section
        class="studio__preview"
        :class="{ 'is-hidden-mobile': mobilePane !== 'preview' }"
        :aria-label="t('studio.panePreview')"
      >
        <WebsiteRenderer
          v-if="draft?.content && draft?.theme"
          :content="draft.content"
          :theme="draft.theme"
          framed
        />
        <div v-else class="studio__empty">
          <v-progress-circular v-if="loading" indeterminate color="primary" />
          <template v-else>
            <v-icon icon="mdi-image-frame" size="34" />
            <p>{{ t('studio.previewEmpty') }}</p>
          </template>
        </div>
      </section>

      <!-- RIGHT: AI agent + guided tools -->
      <aside
        class="studio__agent"
        :class="{ 'is-hidden-mobile': mobilePane !== 'chat' }"
        :aria-label="t('studio.agentName')"
      >
        <EasyStudioAgent v-if="draft" />
        <div v-else-if="loading" class="studio__agentLoading">
          <v-progress-circular indeterminate color="primary" size="26" />
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.studio {
  display: flex;
  flex-direction: column;
  /* fill the shell minus the top bar (fixed so inner panels can scroll) */
  height: calc(100dvh - var(--tvz-topbar-h) - 2px);
  padding: clamp(1rem, 3vw, 1.75rem);
  gap: 1rem;
}

.studio__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.studio__eyebrow {
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
.studio__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.studio__title h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.35rem, 3.5vw, 1.9rem);
  letter-spacing: -0.02em;
  margin: 0;
}

.studio__tabs {
  display: none;
  gap: 0.35rem;
  padding: 0.25rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.06);
}
.studio__tabs button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.studio__tabs button.is-on {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  box-shadow: var(--tvz-shadow-sm);
}

.studio__grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 0.86fr) minmax(520px, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 1rem;
}

.studio__preview {
  min-height: 0;
  overflow: hidden;
  border-radius: var(--tvz-radius-lg);
}
.studio__preview :deep(.site) {
  height: 100%;
}
.studio__preview :deep(.site--framed .site__scroll) {
  max-height: none;
  height: calc(100% - 34px);
}

.studio__empty {
  height: 100%;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  text-align: center;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  border: 1px dashed var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface) / 0.4);
}
.studio__empty p {
  margin: 0;
  max-width: 28ch;
  font-size: 0.9rem;
}

.studio__agent {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.studio__agent > :first-child {
  flex: 1;
  min-height: 0;
}
.studio__agentLoading {
  flex: 1;
  display: grid;
  place-items: center;
}

@media (max-width: 900px) {
  .studio {
    /* leave room for the fixed mobile tab bar so the chat input stays reachable */
    height: calc(
      100dvh - var(--tvz-topbar-h) - var(--tvz-tabbar-h) - env(safe-area-inset-bottom, 0px) - 18px
    );
  }
  .studio__tabs {
    display: flex;
  }
  .studio__grid {
    grid-template-columns: 1fr;
  }
  .is-hidden-mobile {
    display: none;
  }
  .studio__preview :deep(.site--framed .site__scroll) {
    height: auto;
    max-height: 62dvh;
  }
}
</style>
