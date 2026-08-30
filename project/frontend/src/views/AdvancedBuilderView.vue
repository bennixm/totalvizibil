<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import AiAgentPanel from '@/components/AiAgentPanel.vue'
import WebsiteRenderer from '@/components/WebsiteRenderer.vue'
import { useCompaniesStore } from '@/stores/companies'
import { useBuilderStore } from '@/stores/builder'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const builder = useBuilderStore()
const { data, loading, working, error } = storeToRefs(builder)

const companyId = ref<string | null>(null)
const mobilePane = ref<'chat' | 'preview'>('chat')

const balance = computed(() => data.value?.wallet.balance.credits ?? 0)
const price = computed(() => data.value?.priceCredits ?? 0)
const funded = computed(() => balance.value >= price.value)
const disabled = computed(() => !data.value || working.value || !!data.value.complete)

const KNOWN_ERR = ['insufficient_credits', 'advanced_builder_locked', 'not_an_advanced_website']
function errText(code: string): string {
  return KNOWN_ERR.includes(code) ? t('builder.err.' + code) : code
}

async function unlock(): Promise<void> {
  if (companyId.value) await builder.unlock(companyId.value)
}
function onSend(text: string): void {
  if (companyId.value) void builder.send(companyId.value, text)
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

    <div v-if="loading && !data" class="wb__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="!data" class="wb__lock">
      <v-icon icon="mdi-alert-circle-outline" size="34" />
      <h2>{{ t('builder.loadErrorTitle') }}</h2>
      <p class="wb__lockText">{{ error ? errText(error) : t('builder.loadErrorText') }}</p>
      <v-btn color="primary" variant="tonal" :to="{ name: 'dashboard' }">{{ t('builder.back') }}</v-btn>
    </div>

    <!-- LOCKED: pay to unlock -->
    <div v-else-if="data && !data.unlocked" class="wb__lock">
      <v-icon icon="mdi-lock-open-variant-outline" size="34" />
      <h2>{{ t('builder.lockTitle') }}</h2>
      <p class="wb__lockText">{{ t('builder.lockText') }}</p>
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
          {{ t('builder.payCta', { credits: price }) }}
        </v-btn>
      </div>
    </div>

    <!-- UNLOCKED: the split studio -->
    <template v-else-if="data">
      <div class="wb__tabs">
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

      <div class="wb__grid">
        <section
          class="wb__preview"
          :class="{ 'is-hidden-mobile': mobilePane !== 'preview' }"
          :aria-label="t('studio.panePreview')"
        >
          <WebsiteRenderer
            v-if="data.content && data.theme"
            :content="data.content"
            :theme="data.theme"
            framed
          />
          <div v-else class="wb__empty">
            <v-icon icon="mdi-image-frame" size="34" />
            <p>{{ t('studio.previewEmpty') }}</p>
          </div>
        </section>

        <aside
          class="wb__agent"
          :class="{ 'is-hidden-mobile': mobilePane !== 'chat' }"
          :aria-label="t('studio.agentName')"
        >
          <AiAgentPanel
            :transcript="data.transcript"
            :sending="working"
            :disabled="disabled"
            :note="data.complete ? t('builder.doneNote') : t('builder.liveNote')"
            msg-prefix="builder.msg."
            @send="onSend"
          />
          <div v-if="error" class="wb__err">
            <v-icon icon="mdi-alert-circle-outline" size="16" /> {{ errText(error) }}
          </div>
          <div v-if="data.complete" class="wb__note">
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
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wb {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - var(--tvz-topbar-h) - 2px);
  padding: clamp(1rem, 3vw, 1.75rem);
  gap: 1rem;
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
  grid-template-columns: minmax(0, 1.35fr) minmax(340px, 1fr);
  gap: 1rem;
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
.wb__agent {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.wb__agent > :first-child {
  flex: 1;
  min-height: 0;
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

@media (max-width: 900px) {
  .wb__tabs {
    display: flex;
  }
  .wb__grid {
    grid-template-columns: 1fr;
  }
  .is-hidden-mobile {
    display: none;
  }
}
</style>
