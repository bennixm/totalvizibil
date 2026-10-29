<script setup lang="ts">
/**
 * Website settings — NOT the editor. File export (dist or raw source as a
 * zip) and custom domain purchase live here; a single button hands off into
 * the actual AI editor (PRO V2 chat, or the Site Simplu guided editor).
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { apiFetch, BASE_URL } from '@/services/api'
import { useMoney } from '@/composables/useMoney'
import { useCompaniesStore, type DashboardPayload } from '@/stores/companies'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'

interface Money {
  minor: number
  credits: number
}
interface FileEntry {
  path: string
  size: number
}
interface FilesListing {
  source: FileEntry[]
  dist: FileEntry[] | null
  publishedAt: string | null
}
interface DomainCheck {
  domain: string
  available: boolean
  domainPrice: Money
  platformFee: Money
  total: Money
  registrarConfigured: boolean
}
interface DomainRecord {
  id: string
  domain: string
  status: 'pending' | 'active' | 'failed'
  feeCredits: Money
  domainPriceCredits: Money
  registrarProvider: string
  dnsConfigured: boolean
  createdAt: string
}

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const confirm = useConfirmStore()
const toasts = useToastStore()
const money = useMoney()

const companyId = ref<string | null>(null)
const loading = ref(true)
const website = ref<DashboardPayload['website'] | null>(null)
/** The overview fetch FAILED, as opposed to legitimately reporting that this
 *  business has no website yet — the old `catch { website = null }` rendered
 *  both as the same "you have no website" empty state. */
const websiteError = ref(false)

const isAdvanced = computed(() => !!website.value && 'mode' in website.value && website.value.mode === 'advanced')
const hasWebsite = computed(() => !!website.value && website.value.status !== 'none')

const editorRoute = computed(() =>
  isAdvanced.value
    ? { name: 'website-builder', query: { c: companyId.value } }
    : { name: 'easy-site-editor', query: { c: companyId.value } },
)

// --- files -----------------------------------------------------------
const files = ref<FilesListing | null>(null)
const filesLoading = ref(false)
/** The listing FAILED (transient error, or a role that can't read it) — kept
 *  distinct from a genuinely empty file list, which the old
 *  `catch { files = null }` was indistinguishable from. */
const filesError = ref(false)
const activeTab = ref<'source' | 'dist'>('source')
const activeList = computed(() => (activeTab.value === 'source' ? files.value?.source : files.value?.dist) ?? [])

async function loadFiles(): Promise<void> {
  if (!companyId.value || !isAdvanced.value) return
  filesLoading.value = true
  filesError.value = false
  try {
    files.value = await apiFetch<FilesListing>(`/companies/${companyId.value}/pro-v2/files`)
  } catch {
    files.value = null
    filesError.value = true
  } finally {
    filesLoading.value = false
  }
}
function exportUrl(kind: 'source' | 'dist'): string {
  return `${BASE_URL}/companies/${companyId.value}/pro-v2/export?kind=${kind}`
}
function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// --- custom domain -----------------------------------------------------
const domains = ref<DomainRecord[]>([])
const domainInput = ref('')
const checking = ref(false)
const purchasing = ref(false)
const checkResult = ref<DomainCheck | null>(null)

const DOMAIN_KNOWN_ERR = [
  'insufficient_credits',
  'domain_not_available',
  'domain_already_registered',
  'not_your_company',
]
function domainErrText(code: string): string {
  return DOMAIN_KNOWN_ERR.includes(code) ? t('websiteSettings.domainErr.' + code) : t('websiteSettings.domainErr.generic')
}
/** The one domain-purchase error that needs action, not just an
 *  acknowledgement — same persistent, actionable toast as the AI editor's
 *  own out-of-credits alert. */
function reportDomainError(err: unknown): void {
  const code = err instanceof Error ? err.message : 'error'
  if (code === 'insufficient_credits') {
    toasts.error(domainErrText(code), {
      timeout: 0,
      action: { label: t('wallet.topUpCta'), to: { name: 'wallet' } },
    })
  } else {
    toasts.error(domainErrText(code))
  }
}

async function loadDomains(): Promise<void> {
  if (!companyId.value) return
  try {
    domains.value = await apiFetch<DomainRecord[]>(`/companies/${companyId.value}/domains`)
  } catch {
    domains.value = []
  }
}
async function checkDomain(): Promise<void> {
  const domain = domainInput.value.trim().toLowerCase()
  if (!domain || !companyId.value) return
  checking.value = true
  checkResult.value = null
  try {
    checkResult.value = await apiFetch<DomainCheck>(
      `/companies/${companyId.value}/domains/check?domain=${encodeURIComponent(domain)}`,
    )
  } catch (err) {
    reportDomainError(err)
  } finally {
    checking.value = false
  }
}
function confirmPurchase(): void {
  if (!checkResult.value?.available || !companyId.value) return
  confirm.ask(
    t('websiteSettings.domainConfirmTitle'),
    t('websiteSettings.domainConfirmText', {
      domain: checkResult.value.domain,
      total: n(checkResult.value.total.credits, { maximumFractionDigits: 2 }),
    }),
    purchaseDomain,
    { confirmLabel: t('websiteSettings.domainBuyCta') },
  )
}
async function purchaseDomain(): Promise<void> {
  if (!checkResult.value || !companyId.value) return
  purchasing.value = true
  try {
    await apiFetch<DomainRecord>(`/companies/${companyId.value}/domains`, {
      method: 'POST',
      body: { domain: checkResult.value.domain },
    })
    toasts.success(t('websiteSettings.domainBought'))
    domainInput.value = ''
    checkResult.value = null
    await loadDomains()
  } catch (err) {
    reportDomainError(err)
  } finally {
    purchasing.value = false
  }
}

// --- appointments ------------------------------------------------------
// Toggling is disabled: no site generator produces a public booking section
// yet, so turning this on would promise a feature the live site can't
// deliver. The panel's own appointments management (schedule, requests)
// still works independently of this toggle.

async function loadFor(id: string): Promise<void> {
  companyId.value = id
  companies.select(id)
  loading.value = true
  websiteError.value = false
  try {
    const dash = await companies.fetchDashboard(id)
    website.value = dash.website
  } catch {
    website.value = null
    websiteError.value = true
  } finally {
    loading.value = false
  }
  await Promise.all([loadFiles(), loadDomains()])
}

async function retryLoad(): Promise<void> {
  if (companyId.value) await loadFor(companyId.value)
}

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  await loadFor(id)
})
</script>

<template>
  <v-container class="ws">
    <header class="ws__head">
      <p class="ws__eyebrow">{{ t('websiteSettings.eyebrow') }}</p>
      <h1>{{ t('websiteSettings.title') }}</h1>
    </header>

    <div v-if="loading" class="ws__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <!-- A failed overview fetch is NOT "you have no website yet". -->
    <template v-else-if="websiteError">
      <div class="ws__empty">
        <v-icon icon="mdi-alert-circle-outline" size="30" color="error" />
        <p>{{ t('websiteSettings.loadError') }}</p>
        <v-btn color="primary" variant="tonal" size="small" prepend-icon="mdi-refresh" @click="retryLoad">
          {{ t('common.retry') }}
        </v-btn>
      </div>
    </template>

    <template v-else-if="!hasWebsite">
      <div class="ws__empty">
        <v-icon icon="mdi-web-off" size="30" />
        <p>{{ t('websiteSettings.none') }}</p>
      </div>
    </template>

    <template v-else>
      <section class="card ws__editorCard">
        <div>
          <strong>{{ t('websiteSettings.editorTitle') }}</strong>
          <p>{{ t('websiteSettings.editorText') }}</p>
        </div>
        <v-btn color="primary" append-icon="mdi-arrow-right" :to="editorRoute">
          {{ t('websiteSettings.editorCta') }}
        </v-btn>
      </section>

      <!-- File export: PRO V2 (advanced) sites only — a Site Simplu page has
           no editable source-file tree to export. -->
      <section v-if="isAdvanced" class="card ws__section">
        <div class="ws__sectionHead">
          <h2>{{ t('websiteSettings.filesTitle') }}</h2>
          <div class="ws__tabs">
            <button
              type="button"
              class="ws__tab"
              :class="{ 'is-active': activeTab === 'source' }"
              @click="activeTab = 'source'"
            >
              {{ t('websiteSettings.tabSource') }}
            </button>
            <button
              type="button"
              class="ws__tab"
              :class="{ 'is-active': activeTab === 'dist' }"
              @click="activeTab = 'dist'"
            >
              {{ t('websiteSettings.tabDist') }}
            </button>
          </div>
        </div>

        <div v-if="filesLoading" class="ws__center ws__center--sm">
          <v-progress-circular indeterminate color="primary" size="22" />
        </div>
        <!-- A failed listing is NOT "you have no files". -->
        <div v-else-if="filesError" class="ws__filesError">
          <v-icon icon="mdi-alert-circle-outline" size="18" />
          <span>{{ t('websiteSettings.filesLoadError') }}</span>
          <v-btn variant="tonal" color="primary" size="x-small" prepend-icon="mdi-refresh" @click="loadFiles">
            {{ t('common.retry') }}
          </v-btn>
        </div>
        <template v-else>
          <p v-if="activeTab === 'dist' && !files?.dist" class="ws__hint">
            {{ t('websiteSettings.distNone') }}
          </p>
          <ul v-else-if="activeList.length" class="ws__files">
            <li v-for="f in activeList" :key="f.path">
              <v-icon icon="mdi-file-code-outline" size="15" />
              <span class="ws__filePath">{{ f.path }}</span>
              <span class="ws__fileSize">{{ fmtBytes(f.size) }}</span>
            </li>
          </ul>
          <p v-else class="ws__hint">{{ t('websiteSettings.filesEmpty') }}</p>

          <div class="ws__exportRow">
            <v-btn
              variant="tonal"
              color="primary"
              size="small"
              prepend-icon="mdi-download"
              :disabled="!files?.source.length"
              :href="exportUrl('source')"
            >
              {{ t('websiteSettings.exportSource') }}
            </v-btn>
            <v-btn
              variant="tonal"
              color="primary"
              size="small"
              prepend-icon="mdi-download"
              :disabled="!files?.dist?.length"
              :href="exportUrl('dist')"
            >
              {{ t('websiteSettings.exportDist') }}
            </v-btn>
          </div>
          <p class="ws__hint ws__exportNote">
            <v-icon icon="mdi-information-outline" size="13" />
            {{ t('websiteSettings.exportNote') }}
          </p>
        </template>
      </section>

      <!-- Custom domain — the registrar integration is a manual/beta dev
           stub (see domains.service.ts's doc comment): a purchase charges
           the wallet and records the intent, but no DNS is actually
           configured automatically yet. Said plainly here rather than
           implying an automated activation that never comes. -->
      <section class="card ws__section">
        <h2>{{ t('websiteSettings.domainTitle') }}</h2>
        <p class="ws__hint">{{ t('websiteSettings.domainHint') }}</p>
        <p class="ws__hint ws__hint--muted">
          <v-icon icon="mdi-information-outline" size="13" />
          {{ t('websiteSettings.domainManualNote') }}
        </p>

        <ul v-if="domains.length" class="ws__domainList">
          <li v-for="d in domains" :key="d.id" class="ws__domainRow">
            <div class="ws__domainRowMain">
              <span class="ws__domainName">{{ d.domain }}</span>
              <span class="chip" :class="`chip--${d.status === 'active' ? 'success' : d.status === 'failed' ? 'error' : 'warning'}`">
                {{ t(`websiteSettings.domainStatus.${d.status}`) }}
              </span>
            </div>
            <p v-if="d.status === 'pending'" class="ws__domainNote">
              {{ d.dnsConfigured ? t('websiteSettings.domainDnsOk') : t('websiteSettings.domainPendingNote') }}
            </p>
            <p v-else-if="d.status === 'failed'" class="ws__domainNote ws__domainNote--error">
              {{ t('websiteSettings.domainFailedNote') }}
            </p>
          </li>
        </ul>

        <div class="ws__domainForm">
          <v-text-field
            v-model="domainInput"
            :placeholder="t('websiteSettings.domainPlaceholder')"
            density="compact"
            variant="outlined"
            hide-details
            class="ws__domainInput"
            @keyup.enter="checkDomain"
          />
          <v-btn variant="tonal" color="primary" :loading="checking" @click="checkDomain">
            {{ t('websiteSettings.domainCheckCta') }}
          </v-btn>
        </div>

        <div v-if="checkResult" class="ws__checkResult">
          <template v-if="checkResult.available">
            <p class="ws__checkOk">
              <v-icon icon="mdi-check-circle-outline" size="16" color="success" />
              {{ t('websiteSettings.domainAvailable', { domain: checkResult.domain }) }}
            </p>
            <p class="ws__checkPrice">
              {{
                t('websiteSettings.domainPriceBreakdown', {
                  domain: n(checkResult.domainPrice.credits, { maximumFractionDigits: 2 }),
                  fee: n(checkResult.platformFee.credits, { maximumFractionDigits: 2 }),
                  total: n(checkResult.total.credits, { maximumFractionDigits: 2 }),
                })
              }}
              <span class="ws__checkApprox">{{ money.approx(checkResult.total.credits) }}</span>
            </p>
            <v-btn
              color="primary"
              size="small"
              :loading="purchasing"
              @click="confirmPurchase"
            >
              {{ t('websiteSettings.domainBuyCta') }}
            </v-btn>
          </template>
          <p v-else class="ws__checkTaken">
            <v-icon icon="mdi-close-circle-outline" size="16" color="error" />
            {{ t('websiteSettings.domainTaken', { domain: checkResult.domain }) }}
          </p>
        </div>
      </section>

      <!-- Appointments — the public booking widget has no generator support
           yet (no site produces an actual booking section), so the toggle
           is disabled rather than promising a feature the live site can't
           deliver. Re-enable once a builder can emit a real booking section. -->
      <section class="card ws__section">
        <h2>{{ t('websiteSettings.appointmentsTitle') }}</h2>
        <p class="ws__hint">{{ t('websiteSettings.appointmentsHint') }}</p>
        <p class="ws__hint ws__hint--muted">{{ t('websiteSettings.appointmentsUnavailable') }}</p>
        <v-switch
          :model-value="companies.currentOverview?.appointmentsEnabled ?? false"
          :label="t('appointments.enableToggle')"
          color="primary"
          density="comfortable"
          hide-details
          disabled
        />
        <router-link
          v-if="companies.currentOverview?.appointmentsEnabled"
          class="ws__apptLink"
          :to="{ name: 'appointments', query: { c: companyId } }"
        >
          {{ t('websiteSettings.appointmentsManage') }} <v-icon icon="mdi-arrow-right" size="15" />
        </router-link>
      </section>
    </template>
  </v-container>
</template>

<style scoped>
.ws {
  max-width: 720px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.ws__head {
  margin-bottom: 1.5rem;
}
.ws__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin: 0 0 0.3rem;
}
.ws__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.ws__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.ws__center--sm {
  min-height: 80px;
}
.ws__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.card {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 1.2rem 1.3rem;
  margin-bottom: 1.25rem;
}
.ws__editorCard {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  background: var(--tvz-ai-soft);
  border-color: rgba(var(--v-theme-primary), 0.3);
}
.ws__editorCard strong {
  font-size: 0.95rem;
}
.ws__editorCard p {
  margin: 0.2rem 0 0;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.ws__section h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.92rem;
  font-weight: 600;
  margin: 0 0 0.6rem;
}
.ws__sectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.6rem;
}
.ws__sectionHead h2 {
  margin: 0;
}
.ws__tabs {
  display: flex;
  gap: 0.3rem;
  padding: 0.2rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.ws__tab {
  padding: 0.3rem 0.8rem;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ws__tab.is-active {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  box-shadow: var(--tvz-shadow-sm);
}
.ws__hint {
  margin: 0.4rem 0;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ws__hint--muted {
  font-style: italic;
}
.ws__filesError {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.7rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
  font-size: 0.82rem;
}
.ws__apptLink {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.9rem;
  font-size: 0.84rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}
.ws__files {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 260px;
  overflow-y: auto;
}
.ws__files li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0;
  font-size: 0.82rem;
  border-top: 1px solid var(--tvz-hairline);
}
.ws__files li:first-child {
  border-top: none;
}
.ws__filePath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
}
.ws__fileSize {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ws__exportRow {
  display: flex;
  gap: 0.6rem;
  margin-top: 0.9rem;
}
.ws__exportNote {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.ws__domainList {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
}
.ws__domainRow {
  padding: 0.55rem 0;
  border-top: 1px solid var(--tvz-hairline);
}
.ws__domainRow:first-child {
  border-top: none;
}
.ws__domainRowMain {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.ws__domainName {
  font-weight: 600;
  font-size: 0.88rem;
}
.ws__domainNote {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ws__domainNote--error {
  color: rgb(var(--v-theme-error));
}
.chip {
  font-size: 0.64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
}
.chip--success {
  background: rgba(var(--v-theme-success), 0.16);
  color: rgb(var(--v-theme-success));
}
.chip--warning {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}
.chip--error {
  background: rgba(var(--v-theme-error), 0.16);
  color: rgb(var(--v-theme-error));
}

.ws__domainForm {
  display: flex;
  gap: 0.6rem;
}
.ws__domainInput {
  flex: 1;
}
.ws__checkResult {
  margin-top: 0.9rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--tvz-hairline);
}
.ws__checkOk,
.ws__checkTaken {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0 0 0.4rem;
  font-size: 0.86rem;
  font-weight: 600;
}
.ws__checkPrice {
  margin: 0 0 0.7rem;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.ws__checkApprox {
  display: block;
  margin-top: 0.1rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
</style>
