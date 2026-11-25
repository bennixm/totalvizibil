<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminHint from '@/components/admin/AdminHint.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdsChangePreview from '@/components/ads/AdsChangePreview.vue'
import { adsMoney } from '@/components/ads/format'
import { ApiError } from '@/services/api'
import {
  adminUserAdsApi,
  type AdminAdsChangeKind,
  type AdsEditorData,
} from '@/services/adminUserAds'
import type { UserAction } from '@/services/googleAdsUser'
import { useToastStore } from '@/stores/toast'

/**
 * Edits the campaign itself, in Google Ads. Each block is its own change:
 * previewed exactly, confirmed with a reason, checked by Google, applied and
 * read back. The daily budget is only proposed; the owner approves it.
 */
const props = defineProps<{ userId: string; campaignId: string }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const { t, locale } = useI18n()
const toasts = useToastStore()
const api = computed(() => adminUserAdsApi(props.userId))

interface Row {
  old: string | null
  text: string
  pinned: boolean
}
const data = ref<AdsEditorData | null>(null)
const error = ref('')
const headlines = ref<Row[]>([])
const descriptions = ref<Row[]>([])
const budget = ref<number | null>(null)
const kwAdd = ref('')
const kwNeg = ref('')
const kwMatch = ref<'PHRASE' | 'EXACT' | 'BROAD'>('PHRASE')
const kwPause = ref<string[]>([])
const linkText = ref('')
const linkUrl = ref('')
const callout = ref('')

async function load(): Promise<void> {
  data.value = null
  error.value = ''
  try {
    const d = await api.value.editor(props.campaignId)
    data.value = d
    const rows = (l: { text: string; pinned: boolean }[]) => l.map((x) => ({ old: x.text, ...x }))
    headlines.value = rows(d.ad?.headlines ?? [])
    descriptions.value = rows(d.ad?.descriptions ?? [])
    budget.value = d.budget ? Number(d.budget.amountMicros) / 1e6 : null
    kwAdd.value = kwNeg.value = linkText.value = linkUrl.value = callout.value = ''
    kwPause.value = []
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('admin.genericError')
  }
}
onMounted(load)
watch(() => props.campaignId, load)

const LIMITS = { headlines: { max: 15, min: 3, chars: 30 }, descriptions: { max: 4, min: 2, chars: 90 } }
const lists = computed(() => [
  { key: 'headlines' as const, rows: headlines.value, ...LIMITS.headlines },
  { key: 'descriptions' as const, rows: descriptions.value, ...LIMITS.descriptions },
])
function edits(rows: Row[], before: string[]) {
  const kept = new Set(rows.map((r) => r.old).filter(Boolean))
  return {
    replace: rows.filter((r) => r.old && r.text.trim() !== r.old).map((r) => ({ old: r.old, new: r.text.trim() })),
    add: rows.filter((r) => !r.old && r.text.trim()).map((r) => r.text.trim()),
    remove: before.filter((b) => !kept.has(b)),
  }
}
const textInput = computed(() => ({
  headlines: edits(headlines.value, data.value?.ad?.headlines.map((x) => x.text) ?? []),
  descriptions: edits(descriptions.value, data.value?.ad?.descriptions.map((x) => x.text) ?? []),
}))
const textsDirty = computed(() => Object.values(textInput.value).some((e) => e.replace.length + e.add.length + e.remove.length > 0))
const textsValid = computed(() =>
  lists.value.every((l) => {
    const n = l.rows.filter((r) => r.text.trim()).length
    return n >= l.min && n <= l.max && l.rows.every((r) => [...r.text.trim()].length <= l.chars && (!r.old || r.text.trim()))
  }),
)
const words = (s: string) => [...new Set(s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean))]
const keywordInput = computed(() => ({
  add: words(kwAdd.value).map((text) => ({ text, match_type: kwMatch.value })),
  add_negative: words(kwNeg.value).map((text) => ({ text, match_type: kwMatch.value })),
  pause: kwPause.value,
}))
const keywordsDirty = computed(() => Object.values(keywordInput.value).some((x) => x.length))
const extensionInput = computed(() => ({
  sitelinks: linkText.value.trim() && linkUrl.value.trim() ? [{ text: linkText.value.trim(), url: linkUrl.value.trim() }] : [],
  callouts: words(callout.value),
}))
const extensionsDirty = computed(() => extensionInput.value.sitelinks.length + extensionInput.value.callouts.length > 0)
const budgetMicros = computed(() => Math.round((budget.value ?? 0) * 100) * 10_000)
const budgetDirty = computed(() => !!data.value?.budget && budgetMicros.value > 0 && String(budgetMicros.value) !== data.value.budget.amountMicros)
const active = computed(() => data.value?.keywords.filter((k) => !k.negative && k.status === 'ENABLED') ?? [])
const others = computed(() => data.value?.keywords.filter((k) => k.negative || k.status !== 'ENABLED') ?? [])
const host = computed(() => {
  try {
    return new URL(data.value?.landingUrl ?? '').host
  } catch {
    return ''
  }
})

// --- confirm: exact preview + reason -------------------------------------
const ask = ref<{ kind: AdminAdsChangeKind; input: object; preview: UserAction } | null>(null)
const reason = ref('')
const saving = ref(false)

function prepare(kind: AdminAdsChangeKind, input: object, action: string, before: unknown, after: unknown): void {
  reason.value = ''
  ask.value = {
    kind,
    input,
    preview: { action, before, after } as UserAction,
  }
}
const texts = (rows: Row[]) => rows.filter((r) => r.text.trim()).map((r) => ({ text: r.text.trim() }))
const prepareTexts = () =>
  prepare('ad_texts', textInput.value, 'chat.ad_texts', data.value?.ad, { headlines: texts(headlines.value), descriptions: texts(descriptions.value) })
const prepareKeywords = () =>
  prepare('keywords', keywordInput.value, 'chat.keywords', {}, {
    add: keywordInput.value.add.map((k) => ({ text: k.text, matchType: k.match_type })),
    negatives: keywordInput.value.add_negative.map((k) => ({ text: k.text, matchType: k.match_type })),
    pause: kwPause.value.map((text) => ({ text })),
  })
const prepareExtensions = () =>
  prepare('extensions', extensionInput.value, 'chat.extensions', {}, {
    sitelinks: extensionInput.value.sitelinks.map((s) => ({ linkText: s.text, url: s.url })),
    callouts: extensionInput.value.callouts,
  })
function prepareStatus(): void {
  const to = data.value?.status === 'ENABLED' ? 'PAUSED' : 'ENABLED'
  prepare('status', { status: to }, 'chat.status', { status: data.value?.status }, { status: to })
}
const prepareBudget = () =>
  prepare('budget', { dailyAmount: budget.value }, 'budget.change.proposed', { amountMicros: data.value?.budget?.amountMicros }, { amountMicros: String(budgetMicros.value) })

async function confirm(): Promise<void> {
  const a = ask.value
  if (!a || saving.value || reason.value.trim().length < 3) return
  saving.value = true
  try {
    const res = await api.value.change(props.campaignId, a.kind, a.input, reason.value.trim())
    if (res.status === 'failed') toasts.error(res.errorMessage ?? t('ads.prop.failed'))
    else toasts.success(t(a.kind === 'budget' ? 'admin.ads.budgetProposed' : 'ads.prop.applied'))
    ask.value = null
    emit('changed')
    await load()
  } catch (e) {
    toasts.error(e instanceof ApiError ? e.message : t('ads.prop.failed'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="error" class="ed__err">
    <AdminEmptyState icon="mdi-alert-circle-outline" :text="error === 'google_ads_reconnect_required' ? t('ads.agent.disconnected') : error" />
    <v-btn variant="tonal" size="small" @click="load">{{ t('common.retry') }}</v-btn>
  </div>
  <div v-else-if="!data" class="ed__center">
    <v-progress-circular indeterminate color="primary" />
    <span>{{ t('admin.ads.reading') }}</span>
  </div>
  <div v-else class="ed">
    <p v-if="!data.writesAllowed" class="ab-note ab-note--warn">
      <v-icon icon="mdi-lock-outline" size="18" /> <span>{{ t('admin.ads.writesBlocked') }}</span>
    </p>

    <div class="ed__two">
      <section class="ed__box">
        <h3>{{ t('ads.action.chat.status') }}</h3>
        <p>{{ t(`ads.status.${data.status}`, data.status) }}</p>
        <v-btn variant="tonal" :color="data.status === 'ENABLED' ? 'warning' : 'success'" :disabled="!data.writesAllowed" @click="prepareStatus">
          {{ t(data.status === 'ENABLED' ? 'admin.ads.pauseCampaign' : 'admin.ads.enableCampaign') }}
        </v-btn>
      </section>

      <section class="ed__box">
        <h3>{{ t('admin.ads.budgetTitle') }} <AdminHint :text="t('admin.ads.budgetHint')" /></h3>
        <template v-if="data.budget && !data.budget.shared">
          <v-text-field v-model.number="budget" type="number" min="0" step="0.01" :suffix="data.currencyCode ?? ''" variant="outlined" density="compact" hide-details :aria-label="t('admin.ads.budgetTitle')" />
          <p v-if="data.pendingBudgetMicros" class="ed__hint">{{ t('admin.ads.budgetPending', { amount: adsMoney(data.pendingBudgetMicros, data.currencyCode, locale) }) }}</p>
          <v-btn variant="tonal" color="primary" :disabled="!budgetDirty || !data.writesAllowed" @click="prepareBudget">{{ t('admin.ads.proposeBudget') }}</v-btn>
        </template>
        <p v-else class="ed__hint">{{ t('admin.ads.budgetShared') }}</p>
      </section>
    </div>

    <section class="ed__box">
      <h3>{{ t('ads.action.chat.ad_texts') }}</h3>
      <p v-if="!data.ad" class="ed__hint">{{ t('admin.ads.noAd') }}</p>
      <div v-else class="ed__ad">
        <div class="ed__lists">
          <div v-for="l in lists" :key="l.key">
            <p class="ed__label">{{ t(`ads.element.${l.key}`) }} ({{ l.rows.length }}/{{ l.max }})</p>
            <div v-for="(r, i) in l.rows" :key="i" class="ed__line">
              <v-text-field v-model="r.text" :maxlength="l.chars + 10" :error="[...r.text.trim()].length > l.chars || (!!r.old && !r.text.trim())" variant="outlined" density="compact" hide-details :aria-label="`${t(`ads.element.${l.key}`)} ${i + 1}`">
                <template #append-inner><small class="ed__count">{{ [...r.text.trim()].length }}/{{ l.chars }}</small></template>
              </v-text-field>
              <v-icon v-if="r.pinned" icon="mdi-pin" size="16" :title="t('admin.ads.pinned')" />
              <v-btn icon="mdi-close" size="x-small" variant="text" :aria-label="t('common.delete')" :disabled="l.rows.length <= l.min" @click="l.rows.splice(i, 1)" />
            </div>
            <v-btn v-if="l.rows.length < l.max" size="small" variant="text" prepend-icon="mdi-plus" @click="l.rows.push({ old: null, text: '', pinned: false })">
              {{ t('admin.ads.addText') }}
            </v-btn>
          </div>
        </div>
        <aside class="pv">
          <p class="ed__label">{{ t('admin.ads.preview') }} <AdminHint :text="t('admin.ads.previewHint')" size="sm" /></p>
          <div class="pv__ad">
            <span class="pv__src"><b>{{ t('admin.ads.sponsored') }}</b> {{ host }}</span>
            <span class="pv__title">{{ texts(headlines).slice(0, 3).map((x) => x.text).join(' | ') }}</span>
            <span class="pv__desc">{{ texts(descriptions).slice(0, 2).map((x) => x.text).join(' ') }}</span>
            <span v-if="data.sitelinks.length" class="pv__links">{{ data.sitelinks.slice(0, 4).map((s) => s.text).join(' · ') }}</span>
          </div>
        </aside>
      </div>
      <v-btn v-if="data.ad" color="primary" :disabled="!textsDirty || !textsValid || !data.writesAllowed" @click="prepareTexts">{{ t('admin.ads.review') }}</v-btn>
    </section>

    <section class="ed__box">
      <h3>{{ t('ads.action.chat.keywords') }}</h3>
      <p class="ed__label">{{ t('admin.ads.kwActive', { n: active.length }) }}</p>
      <div class="ed__chips">
        <button v-for="k in active" :key="k.text + k.matchType" type="button" class="kwc" :class="{ 'is-off': kwPause.includes(k.text) }" :title="t(`ads.chat.match.${k.matchType}`, k.matchType)" @click="kwPause = kwPause.includes(k.text) ? kwPause.filter((x) => x !== k.text) : [...kwPause, k.text]">
          {{ k.text }} <v-icon :icon="kwPause.includes(k.text) ? 'mdi-play' : 'mdi-pause'" size="13" />
        </button>
      </div>
      <p v-if="others.length" class="ed__hint">{{ t('admin.ads.kwOthers') }}: {{ others.map((k) => (k.negative ? `−${k.text}` : k.text)).join(', ') }}</p>
      <div class="ed__two">
        <v-textarea v-model="kwAdd" :label="t('admin.ads.kwAdd')" variant="outlined" density="compact" rows="2" auto-grow>
        <template #append-inner><AdminHint :text="t('admin.ads.kwHint')" /></template>
      </v-textarea>
        <v-textarea v-model="kwNeg" :label="t('admin.ads.kwNeg')" variant="outlined" density="compact" rows="2" auto-grow hide-details />
      </div>
      <v-select v-model="kwMatch" class="ed__sel" :items="(['PHRASE', 'EXACT', 'BROAD'] as const).map((value) => ({ value, title: t(`ads.chat.match.${value}`) }))" :label="t('admin.ads.kwMatch')" variant="outlined" density="compact" hide-details />
      <v-btn color="primary" :disabled="!keywordsDirty || !data.writesAllowed" @click="prepareKeywords">{{ t('admin.ads.review') }}</v-btn>
    </section>

    <section class="ed__box">
      <h3>{{ t('ads.action.chat.extensions') }}</h3>
      <p class="ed__hint">Sitelink: {{ data.sitelinks.map((s) => s.text).join(', ') || '–' }}</p>
      <p class="ed__hint">Callout: {{ data.callouts.join(', ') || '–' }}</p>
      <div class="ed__two">
        <v-text-field v-model="linkText" :label="t('admin.ads.linkText')" maxlength="25" variant="outlined" density="compact" hide-details />
        <v-text-field v-model="linkUrl" :label="t('admin.ads.linkUrl')" variant="outlined" density="compact" hide-details />
      </div>
      <v-text-field v-model="callout" :label="t('admin.ads.callouts')" variant="outlined" density="compact">
        <template #append-inner><AdminHint :text="t('admin.ads.kwHint')" /></template>
      </v-text-field>
      <v-btn color="primary" :disabled="!extensionsDirty || !data.writesAllowed" @click="prepareExtensions">{{ t('admin.ads.review') }}</v-btn>
    </section>

    <v-dialog :model-value="!!ask" max-width="560" scrollable @update:model-value="!saving && (ask = null)">
      <v-card v-if="ask" rounded="lg">
        <v-card-title>{{ t('admin.ads.confirmTitle') }}</v-card-title>
        <v-card-text>
          <AdsChangePreview :action="ask.preview" :currency="data.currencyCode" />
          <p class="ed__hint ed__gap">{{ t(ask.kind === 'budget' ? 'admin.ads.confirmBudget' : 'admin.ads.confirmText') }}</p>
          <v-textarea v-model="reason" :label="t('admin.ads.reason')" variant="outlined" density="compact" rows="2" maxlength="300" counter autofocus />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="saving" @click="ask = null">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="saving" :disabled="reason.trim().length < 3" @click="confirm">
            {{ t(ask.kind === 'budget' ? 'admin.ads.proposeBudget' : 'admin.ads.apply') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.ed,
.ed__box,
.ed__err {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 1rem;
}
.ed__box > .v-btn,
.ed__err > .v-btn {
  align-self: flex-start;
}
.ed__center {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 0.6rem;
  min-height: 180px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ed__box {
  gap: 0.75rem;
  min-width: 0;
  padding: 1.1rem 1.2rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.ed h3 {
  margin: 0;
  font-size: var(--tvz-fs-section);
}
.ed p {
  margin: 0;
}
.ed__two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  gap: 1rem;
}
.ed__hint,
.ed__label {
  font-size: var(--tvz-fs-caption);
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.62);
  overflow-wrap: anywhere;
}
.ed__label {
  font-weight: 600;
  margin-bottom: 0.4rem !important;
}
.ed__gap {
  margin: 0.9rem 0 !important;
}
.ed__ad {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 1.2rem;
  align-items: start;
}
.ed__lists {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}
.ed__line {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.4rem;
}
.ed__count {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ed__sel {
  max-width: 260px;
}
.ed__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.kwc {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 100%;
  min-height: 28px;
  padding: 0.15rem 0.65rem;
  border-radius: 999px;
  overflow-wrap: anywhere;
  text-align: left;
  font-size: var(--tvz-fs-caption);
  background: rgba(var(--v-theme-primary), 0.12);
}
.kwc.is-off {
  text-decoration: line-through;
  background: rgba(var(--v-theme-warning), 0.16);
}
.pv__ad {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 1rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-hairline);
  overflow-wrap: anywhere;
}
.pv__src,
.pv__links {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.pv__title {
  font-size: 1.1rem;
  line-height: 1.3;
  color: rgb(var(--v-theme-primary));
}
.pv__desc {
  font-size: var(--tvz-fs-small);
  line-height: 1.45;
}
.pv .ed__hint {
  margin-top: 0.5rem;
}
</style>
