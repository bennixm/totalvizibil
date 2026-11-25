<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import { creditsOf, dateTime } from '@/components/ads/format'
import { ApiError } from '@/services/api'
import { useToastStore } from '@/stores/toast'
import {
  adminGoogleAdsUserApi,
  type AdminOauthConfig,
  type AdminOptimizerUsage,
  type ChatPricing,
  type OptimizerPricing,
} from '@/services/googleAdsUser'

/**
 * Admin of the customers' Google Ads optimizer: consumption (credits
 * charged vs. real AI cost, per cycle), the credit pricing algorithm's
 * parameters, and the Google OAuth client customers connect through.
 */
const { t, locale } = useI18n()
const toasts = useToastStore()

const tab = ref<'usage' | 'pricing' | 'oauth'>('usage')
const usage = ref<AdminOptimizerUsage | null>(null)
const pricing = ref<OptimizerPricing | null>(null)
const chatPricing = ref<ChatPricing | null>(null)
const chatDefaults = ref<ChatPricing | null>(null)
const savingChat = ref(false)
const defaults = ref<OptimizerPricing | null>(null)
const oauth = ref<AdminOauthConfig | null>(null)
const savingPricing = ref(false)
const savingOauth = ref(false)
const oauthForm = reactive({ clientId: '', clientSecret: '' })

const TASKS = ['analysis', 'rsa_text', 'keyword_headlines', 'extensions', 'images', 'text_rewrite', 'budget_proposal']

const marginMinor = computed(() =>
  usage.value ? usage.value.totals.chargedMinor + usage.value.chat.chargedMinor - usage.value.totals.aiCostMinor - usage.value.chat.aiCostMinor : 0,
)

/** Live example with the edited values: what a typical cycle would cost. */
const example = computed(() => {
  const p = pricing.value
  if (!p) return null
  const units: Record<string, number> = { analysis: 1, rsa_text: 6, extensions: 8, keyword_headlines: 2 }
  const points =
    Object.entries(units).reduce((s, [k, u]) => s + u * (p.taskCredits[k] ?? 0), 0) + 40 * p.perElementCredits
  const level = [...p.levels].sort((a, b) => a.minPoints - b.minPoints).reduce(
    (acc, l) => (points >= l.minPoints ? l : acc),
    p.levels[0],
  )
  const credits = Math.min(p.maxCredits, Math.max(p.minCredits, points * (level?.multiplier ?? 1)))
  return { points: Math.round(points * 100) / 100, level: level?.label ?? '', credits: Math.round(credits * 100) / 100 }
})

async function loadUsage(): Promise<void> {
  try {
    usage.value = await adminGoogleAdsUserApi.usage()
  } catch {
    toasts.error(t('admin.genericError'))
  }
}
async function loadPricing(): Promise<void> {
  const r = await adminGoogleAdsUserApi.pricing()
  pricing.value = structuredClone(r.pricing)
  defaults.value = r.defaults
}
async function loadChatPricing(): Promise<void> {
  const r = await adminGoogleAdsUserApi.chatPricing()
  chatPricing.value = structuredClone(r.pricing)
  chatDefaults.value = r.defaults
}
function resetChatDefaults(): void {
  if (chatDefaults.value) chatPricing.value = structuredClone(toRaw(chatDefaults.value))
}
async function saveChatPricing(): Promise<void> {
  if (!chatPricing.value || savingChat.value) return
  savingChat.value = true
  try {
    const r = await adminGoogleAdsUserApi.saveChatPricing(chatPricing.value)
    chatPricing.value = structuredClone(r.pricing)
    toasts.success(t('adminAdsOpt.saved'))
  } catch (e) {
    toasts.error(e instanceof ApiError ? e.message : t('admin.genericError'))
  } finally {
    savingChat.value = false
  }
}
/** A typical answer: 2 AI calls (about $0.04), 3 texts prepared. */
const chatExample = computed(() => {
  const p = chatPricing.value
  if (!p) return 0
  const raw = p.baseCredits + 0.04 * p.aiMarkup + 3 * (p.changeCredits.text ?? 0)
  return Math.round(Math.min(p.maxCredits, Math.max(p.minCredits, raw)) * 100) / 100
})
async function loadOauth(): Promise<void> {
  oauth.value = await adminGoogleAdsUserApi.oauth()
  oauthForm.clientId = oauth.value.clientId
  oauthForm.clientSecret = ''
}

async function savePricing(): Promise<void> {
  if (!pricing.value || savingPricing.value) return
  savingPricing.value = true
  try {
    const r = await adminGoogleAdsUserApi.savePricing(pricing.value)
    pricing.value = structuredClone(r.pricing)
    toasts.success(t('adminAdsOpt.saved'))
  } catch (e) {
    toasts.error(e instanceof ApiError ? e.message : t('admin.genericError'))
  } finally {
    savingPricing.value = false
  }
}
function resetDefaults(): void {
  // toRaw: structuredClone throws on a reactive proxy.
  if (defaults.value) pricing.value = structuredClone(toRaw(defaults.value))
}
function addLevel(): void {
  const p = pricing.value
  if (!p || p.levels.length >= 10) return
  const last = p.levels[p.levels.length - 1]
  p.levels.push({ key: `level${p.levels.length + 1}`, label: '', minPoints: (last?.minPoints ?? 0) + 10, multiplier: (last?.multiplier ?? 1) + 0.1 })
}
function removeLevel(i: number): void {
  if (pricing.value && pricing.value.levels.length > 1 && i > 0) pricing.value.levels.splice(i, 1)
}

async function saveOauth(): Promise<void> {
  if (savingOauth.value) return
  savingOauth.value = true
  try {
    oauth.value = await adminGoogleAdsUserApi.saveOauth({
      clientId: oauthForm.clientId.trim(),
      ...(oauthForm.clientSecret.trim() ? { clientSecret: oauthForm.clientSecret.trim() } : {}),
    })
    oauthForm.clientSecret = ''
    toasts.success(t('adminAdsOpt.saved'))
  } catch (e) {
    toasts.error(e instanceof ApiError ? e.message : t('admin.genericError'))
  } finally {
    savingOauth.value = false
  }
}
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toasts.success(t('adminAdsOpt.copied'))
  } catch {
    /* clipboard blocked */
  }
}

onMounted(() => {
  void loadUsage()
  void loadPricing().catch(() => toasts.error(t('admin.genericError')))
  void loadChatPricing().catch(() => toasts.error(t('admin.genericError')))
  void loadOauth().catch(() => undefined)
})
</script>

<template>
  <div class="gao">
    <AdminPageHeader :eyebrow="t('admin.navGroupGoogleAds')" :title="t('adminAdsOpt.title')" />

    <p v-if="oauth && oauth.missing.length" class="gao__warn">
      <v-icon icon="mdi-alert-circle-outline" size="18" />
      <span class="gao__warnText">{{ t('adminAdsOpt.notReady') }}</span>
      <button type="button" class="gao__link" @click="tab = 'oauth'">{{ t('adminAdsOpt.configure') }}</button>
    </p>

    <v-tabs v-model="tab" color="primary" show-arrows density="comfortable" class="gao__tabs">
      <v-tab value="usage">{{ t('adminAdsOpt.tabUsage') }}</v-tab>
      <v-tab value="pricing">{{ t('adminAdsOpt.tabPricing') }}</v-tab>
      <v-tab value="oauth">{{ t('adminAdsOpt.tabOauth') }}</v-tab>
    </v-tabs>

    <!-- Usage -->
    <div v-if="tab === 'usage'" class="gao__body">
      <div v-if="!usage" class="d-flex justify-center py-12"><v-progress-circular indeterminate color="primary" /></div>
      <template v-else>
        <div class="gao__stats">
          <AdminStatCard :label="t('adminAdsOpt.cycles')" :value="usage.totals.cycles" icon="mdi-sync" :sub="t('adminAdsOpt.campaigns', { n: usage.totals.campaigns, a: usage.totals.connectedAccounts })" />
          <AdminStatCard :label="t('adminAdsOpt.charged')" :value="creditsOf(usage.totals.chargedMinor, locale)" value-is-credits icon="mdi-cash-check" tone="success" :sub="t('adminAdsOpt.refunded', { credits: creditsOf(usage.totals.refundedMinor, locale) })" />
          <AdminStatCard :label="t('adminAdsOpt.aiCost')" :value="`€${creditsOf(usage.totals.aiCostMinor, locale)}`" icon="mdi-chip" :sub="t('adminAdsOpt.aiCalls', { n: usage.totals.aiCalls })" />
          <AdminStatCard :label="t('adminAdsOpt.margin')" :value="creditsOf(marginMinor, locale)" value-is-credits icon="mdi-trending-up" tone="primary" :hint="t('adminAdsOpt.marginHint')" />
        </div>

        <AdminSection :title="t('adminAdsOpt.chatTitle')" icon="mdi-chat-outline" class="mb-4">
          <p class="gao__muted">
            {{ t('adminAdsOpt.chatLine', { n: usage.chat.messages, failed: usage.chat.failed, credits: creditsOf(usage.chat.chargedMinor, locale), cost: creditsOf(usage.chat.aiCostMinor, locale), calls: usage.chat.aiCalls }) }}
          </p>
        </AdminSection>

        <AdminSection :title="t('adminAdsOpt.byLevel')" icon="mdi-chart-bell-curve-cumulative">
          <p v-if="!usage.byLevel.length" class="gao__muted">{{ t('adminAdsOpt.noCycles') }}</p>
          <div v-else class="gao__levels">
            <div v-for="l in usage.byLevel" :key="l.level ?? 'none'" class="gao__level">
              <b>{{ l.level ?? '–' }}</b>
              <span>{{ t('adminAdsOpt.levelLine', { n: l.cycles, credits: creditsOf(l.chargedMinor, locale) }) }}</span>
            </div>
          </div>
        </AdminSection>

        <AdminSection :title="t('adminAdsOpt.history')" icon="mdi-history" class="mt-4">
          <p v-if="!usage.cycles.length" class="gao__muted">{{ t('adminAdsOpt.noCycles') }}</p>
          <div v-else class="gao__tw">
            <table class="gao__tb">
              <thead>
                <tr>
                  <th>{{ t('adminAdsOpt.colDate') }}</th>
                  <th>{{ t('adminAdsOpt.colUser') }}</th>
                  <th>{{ t('adminAdsOpt.colCampaign') }}</th>
                  <th>{{ t('adminAdsOpt.colLevel') }}</th>
                  <th class="num">{{ t('adminAdsOpt.colWork') }}</th>
                  <th class="num">{{ t('adminAdsOpt.colQuoted') }}</th>
                  <th class="num">{{ t('adminAdsOpt.colCharged') }}</th>
                  <th class="num">{{ t('adminAdsOpt.colAi') }}</th>
                  <th>{{ t('adminAdsOpt.colStatus') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in usage.cycles" :key="c.id">
                  <td>{{ dateTime(c.startedAt, locale) }}<span v-if="c.trigger === 'scheduled'" class="gao__muted"> · {{ t('adminAdsOpt.scheduled') }}</span></td>
                  <td>
                    <RouterLink :to="{ name: 'admin-user', params: { id: c.user.id } }">{{ c.user.email }}</RouterLink>
                  </td>
                  <td>{{ c.campaign.name }}<span v-if="c.campaign.customerName" class="gao__muted"> · {{ c.campaign.customerName }}</span></td>
                  <td>{{ c.complexityLevel ?? '–' }}<span v-if="c.complexityPoints != null" class="gao__muted"> ({{ c.complexityPoints }})</span></td>
                  <td class="num">{{ c.tasksApplied }} / {{ c.tasksProposed }} · {{ c.elementsAnalyzed }}</td>
                  <td class="num">{{ creditsOf(c.quotedMinor, locale) }}</td>
                  <td class="num"><b>{{ creditsOf(c.chargedMinor, locale) }}</b></td>
                  <td class="num">€{{ creditsOf(c.aiCostMinor, locale) }}</td>
                  <td>
                    <GaChip :tone="c.status === 'completed' ? 'success' : c.status === 'failed' ? 'error' : 'primary'">{{ t(`ads.cycle.${c.status}`) }}</GaChip>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="gao__muted mt-2">{{ t('adminAdsOpt.colWorkHint') }}</p>
        </AdminSection>
      </template>
    </div>

    <!-- Pricing -->
    <div v-else-if="tab === 'pricing'" class="gao__body">
      <div v-if="!pricing" class="d-flex justify-center py-12"><v-progress-circular indeterminate color="primary" /></div>
      <form v-else class="gao__form" @submit.prevent="savePricing">
        <AdminSection :title="t('adminAdsOpt.limits')" icon="mdi-cash-lock" :hint="t('adminAdsOpt.limitsHint')">
          <div class="gao__grid">
            <v-text-field v-model.number="pricing.minCredits" type="number" min="1" step="0.5" :label="t('adminAdsOpt.minCredits')" :hint="t('adminAdsOpt.minCreditsHint')" persistent-hint />
            <v-text-field v-model.number="pricing.maxCredits" type="number" min="1" step="1" :label="t('adminAdsOpt.maxCredits')" :hint="t('adminAdsOpt.maxCreditsHint')" persistent-hint />
            <v-text-field v-model.number="pricing.perElementCredits" type="number" min="0" step="0.01" :label="t('adminAdsOpt.perElement')" :hint="t('adminAdsOpt.perElementHint')" persistent-hint />
          </div>
        </AdminSection>

        <AdminSection :title="t('adminAdsOpt.tasks')" icon="mdi-format-list-numbered" :hint="t('adminAdsOpt.tasksHint')">
          <div class="gao__grid">
            <v-text-field
              v-for="k in TASKS"
              :key="k"
              v-model.number="pricing.taskCredits[k]"
              type="number"
              min="0"
              step="0.05"
              :label="t(`ads.task.${k}`)"
            />
          </div>
        </AdminSection>

        <AdminSection :title="t('adminAdsOpt.levels')" icon="mdi-stairs" :hint="t('adminAdsOpt.levelsHint')">
          <div v-for="(l, i) in pricing.levels" :key="i" class="gao__lvrow">
            <v-text-field v-model="l.label" :label="t('adminAdsOpt.levelLabel')" density="compact" hide-details />
            <v-text-field v-model="l.key" :label="t('adminAdsOpt.levelKey')" density="compact" hide-details />
            <v-text-field v-model.number="l.minPoints" type="number" min="0" :disabled="i === 0" :label="t('adminAdsOpt.levelFrom')" density="compact" hide-details />
            <v-text-field v-model.number="l.multiplier" type="number" min="0.1" step="0.05" :label="t('adminAdsOpt.levelMult')" density="compact" hide-details />
            <v-btn icon="mdi-delete-outline" variant="text" size="small" :disabled="i === 0" :aria-label="t('adminAdsOpt.removeLevel')" @click="removeLevel(i)" />
          </div>
          <v-btn variant="tonal" size="small" prepend-icon="mdi-plus" class="mt-2" @click="addLevel">{{ t('adminAdsOpt.addLevel') }}</v-btn>
        </AdminSection>

        <p v-if="example" class="gao__example">
          <v-icon icon="mdi-calculator-variant-outline" size="18" />
          {{ t('adminAdsOpt.example', { points: example.points, level: example.level, credits: example.credits }) }}
        </p>
        <div class="gao__actions">
          <v-btn variant="text" @click="resetDefaults">{{ t('adminAdsOpt.defaults') }}</v-btn>
          <v-btn type="submit" color="primary" :loading="savingPricing" prepend-icon="mdi-content-save-outline">{{ t('common.save') }}</v-btn>
        </div>
      </form>

      <form v-if="chatPricing" class="gao__form mt-6" @submit.prevent="saveChatPricing">
        <AdminSection :title="t('adminAdsOpt.chatPricing')" icon="mdi-chat-outline" :hint="t('adminAdsOpt.chatPricingHint')">
          <div class="gao__grid">
            <v-text-field v-model.number="chatPricing.minCredits" type="number" min="0.01" step="0.05" :label="t('adminAdsOpt.chatMin')" />
            <v-text-field v-model.number="chatPricing.maxCredits" type="number" min="0.01" step="0.5" :label="t('adminAdsOpt.chatMax')" :hint="t('adminAdsOpt.chatMaxHint')" persistent-hint />
            <v-text-field v-model.number="chatPricing.baseCredits" type="number" min="0" step="0.05" :label="t('adminAdsOpt.chatBase')" />
            <v-text-field v-model.number="chatPricing.aiMarkup" type="number" min="1" step="0.5" :label="t('adminAdsOpt.chatMarkup')" :hint="t('adminAdsOpt.chatMarkupHint')" persistent-hint />
            <v-text-field v-model.number="chatPricing.maxAiCalls" type="number" min="1" max="12" step="1" :label="t('adminAdsOpt.chatCalls')" />
            <v-text-field
              v-for="(_, k) in chatPricing.changeCredits"
              :key="k"
              v-model.number="chatPricing.changeCredits[k]"
              type="number"
              min="0"
              step="0.05"
              :label="t(`ads.chat.unit.${k}`)"
            />
          </div>
        </AdminSection>
        <p class="gao__example">
          <v-icon icon="mdi-calculator-variant-outline" size="18" />
          {{ t('adminAdsOpt.chatExample', { credits: chatExample }) }}
        </p>
        <div class="gao__actions">
          <v-btn variant="text" @click="resetChatDefaults">{{ t('adminAdsOpt.defaults') }}</v-btn>
          <v-btn type="submit" color="primary" :loading="savingChat" prepend-icon="mdi-content-save-outline">{{ t('common.save') }}</v-btn>
        </div>
      </form>
    </div>

    <!-- OAuth -->
    <div v-else class="gao__body">
      <div v-if="!oauth" class="d-flex justify-center py-12"><v-progress-circular indeterminate color="primary" /></div>
      <form v-else class="gao__form" @submit.prevent="saveOauth">
        <AdminSection :title="t('adminAdsOpt.oauthStatus')" icon="mdi-google">
          <ul class="gao__checks">
            <li><v-icon :icon="oauth.clientId || oauth.clientIdFromEnv ? 'mdi-check-circle' : 'mdi-close-circle'" :color="oauth.clientId || oauth.clientIdFromEnv ? 'success' : 'error'" size="18" /> {{ t('adminAdsOpt.checkClient') }}</li>
            <li><v-icon :icon="oauth.clientSecretSet ? 'mdi-check-circle' : 'mdi-close-circle'" :color="oauth.clientSecretSet ? 'success' : 'error'" size="18" /> {{ t('adminAdsOpt.checkSecret') }}</li>
            <li><v-icon :icon="oauth.tokenKeyConfigured ? 'mdi-check-circle' : 'mdi-close-circle'" :color="oauth.tokenKeyConfigured ? 'success' : 'error'" size="18" /> {{ t('adminAdsOpt.checkKey') }}</li>
          </ul>
          <div class="gao__redirect">
            <span>{{ t('adminAdsOpt.redirect') }}</span>
            <code>{{ oauth.redirectUri }}</code>
            <v-btn size="x-small" variant="tonal" prepend-icon="mdi-content-copy" @click="copy(oauth.redirectUri)">{{ t('adminAdsOpt.copy') }}</v-btn>
          </div>
          <p class="gao__muted">{{ t('adminAdsOpt.oauthHelp') }}</p>
        </AdminSection>
        <AdminSection :title="t('adminAdsOpt.oauthClient')" icon="mdi-key-outline">
          <v-text-field v-model="oauthForm.clientId" :label="t('adminAdsOpt.clientId')" placeholder="….apps.googleusercontent.com" />
          <v-text-field v-model="oauthForm.clientSecret" type="password" autocomplete="new-password" :label="t('adminAdsOpt.clientSecret')" :hint="oauth.clientSecretSet ? t('adminAdsOpt.secretKeep') : ''" persistent-hint />
          <div class="gao__actions">
            <v-btn type="submit" color="primary" :loading="savingOauth">{{ t('common.save') }}</v-btn>
          </div>
        </AdminSection>
      </form>
    </div>
  </div>
</template>

<style scoped>
.gao__warn {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.5rem;
  margin: -0.5rem 0 1rem;
  padding: 0.7rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-warning), 0.1);
  font-size: var(--tvz-fs-small);
}
.gao__warn .v-icon {
  color: rgb(var(--v-theme-warning));
}
.gao__warnText {
  flex: 1 1 12rem;
  min-width: 0;
}
.gao__link {
  min-height: 28px;
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}
.gao__tabs {
  border-bottom: 1px solid var(--tvz-hairline);
}
.gao__body {
  padding-top: 1.5rem;
}
.gao__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.gao__levels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.6rem;
}
.gao__level {
  display: flex;
  flex-direction: column;
  padding: 0.65rem 0.8rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: var(--tvz-fs-small);
}
.gao__level span,
.gao__muted {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.gao__tw {
  overflow-x: auto;
}
.gao__tb {
  width: 100%;
  min-width: 1080px;
  border-collapse: collapse;
  font-size: var(--tvz-fs-small);
}
.gao__tb th {
  text-align: left;
  padding: 0.55rem 0.7rem;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  border-bottom: 1px solid var(--tvz-hairline);
  white-space: nowrap;
}
.gao__tb td {
  padding: 0.55rem 0.7rem;
  border-bottom: 1px solid var(--tvz-hairline);
  vertical-align: top;
  max-width: 220px;
  min-width: 92px;
  overflow-wrap: anywhere;
}
.gao__tb .num {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.gao__form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 980px;
}
.gao__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr));
  gap: 0.75rem 1rem;
}
.gao :deep(.v-messages__message) {
  line-height: 1.35;
}
.gao__lvrow {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 0.6rem;
}
.gao__example {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0.75rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-primary), 0.07);
  font-size: var(--tvz-fs-small);
}
.gao__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.gao__checks {
  list-style: none;
  margin: 0 0 0.9rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  font-size: var(--tvz-fs-small);
}
.gao__checks li {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}
.gao__redirect {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
  font-size: var(--tvz-fs-small);
}
.gao__redirect code {
  padding: 0.15rem 0.45rem;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  overflow-wrap: anywhere;
}
@media (max-width: 900px) {
  .gao__lvrow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding-bottom: 0.6rem;
    border-bottom: 1px solid var(--tvz-hairline);
  }
  .gao__lvrow .v-btn {
    grid-column: 2;
    justify-self: end;
  }
}
</style>
