<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import WebsiteRenderer from '@/components/WebsiteRenderer.vue'
import InfoHint from '@/components/InfoHint.vue'
import BarChart from '@/components/BarChart.vue'
import VisibilityMeter from '@/components/VisibilityMeter.vue'
import { useCompaniesStore, type DashboardPayload } from '@/stores/companies'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const { overview } = storeToRefs(companies)

const loading = ref(true)
const error = ref('')
const companyId = ref<string | null>(null)
const dash = ref<DashboardPayload | null>(null)
const showSite = ref(false)
const showDelete = ref(false)
const deleting = ref(false)

const company = computed(() => dash.value?.company ?? null)
const hasCompanies = computed(() => overview.value.length > 0)
const companyItems = computed(() =>
  overview.value.map((c) => ({ title: c.displayName, value: c.id })),
)

const website = computed(() => dash.value?.website ?? null)
const websiteReady = computed(
  (): boolean => !!website.value && website.value.status !== 'none' && 'content' in website.value,
)
const location = computed(() => dash.value?.company.primaryLocation ?? null)
const wallet = computed(() => dash.value?.wallet ?? null)
const a = computed(() => dash.value?.analytics ?? null)
const tasks = computed(() => dash.value?.tasks ?? [])
const chartSeries = computed(() =>
  a.value
    ? [
        { label: t('analytics.clicks'), values: a.value.series.clicks },
        { label: t('analytics.messages'), values: a.value.series.messages },
      ]
    : [],
)

function fmtNum(v: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: maxFractionDigits }).format(v)
}
function fmtMinutes(m: number | null): string {
  if (m == null) return '—'
  if (m < 60) return `${m} min`
  if (m < 60 * 24) return `${Math.round(m / 60)} h`
  return `${Math.round(m / 1440)} ${t('dashboard.days')}`
}

interface TaskDef {
  title: string
  text: string
  route: string
  done: string
  cta: string
  manage: string
}
const TASK_COPY: Record<string, TaskDef> = {
  unlock_advanced_builder: {
    title: 'dashboard.taskAdvancedTitle',
    text: 'dashboard.taskAdvancedText',
    route: 'website-builder',
    done: 'dashboard.taskAdvancedDone',
    cta: 'dashboard.taskAdvancedCta',
    manage: 'dashboard.taskAdvancedManage',
  },
  set_location: {
    title: 'dashboard.taskLocationTitle',
    text: 'dashboard.taskLocationText',
    route: 'create-location',
    done: 'dashboard.taskLocationDone',
    cta: 'dashboard.taskLocationCta',
    manage: 'dashboard.taskEdit',
  },
  set_campaign_budget: {
    title: 'dashboard.taskBudgetTitle',
    text: 'dashboard.taskBudgetText',
    route: 'campaign',
    done: 'dashboard.taskBudgetDone',
    cta: 'dashboard.taskCta',
    manage: 'dashboard.taskManage',
  },
}
function taskTitle(key: string): string {
  return TASK_COPY[key] ? t(TASK_COPY[key].title) : key
}
function taskText(key: string): string {
  return TASK_COPY[key] ? t(TASK_COPY[key].text) : ''
}
function taskRoute(key: string): string {
  return TASK_COPY[key]?.route ?? 'dashboard'
}
function taskDoneText(key: string): string {
  return TASK_COPY[key] ? t(TASK_COPY[key].done) : ''
}
function taskButton(key: string, done: boolean): string {
  const d = TASK_COPY[key]
  if (!d) return t('dashboard.taskCta')
  return t(done ? d.manage : d.cta)
}

function campBadge(s: string): string {
  if (s === 'active') return 'is-live'
  if (s === 'depleted') return 'is-warn'
  return 'is-idle'
}

async function loadDashboard(id: string): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    companyId.value = id
    companies.select(id)
    dash.value = await companies.fetchDashboard(id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'error'
  } finally {
    loading.value = false
  }
}

function switchCompany(id: string): void {
  if (id === companyId.value) return
  void router.replace({ name: 'dashboard', query: { c: id } })
  void loadDashboard(id)
}

async function confirmDelete(): Promise<void> {
  if (!companyId.value || deleting.value) return
  deleting.value = true
  try {
    await companies.remove(companyId.value)
    showDelete.value = false
    const next = companies.currentId
    if (next) {
      await router.replace({ name: 'dashboard', query: { c: next } })
      await loadDashboard(next)
    } else {
      await router.replace({ name: 'feed' })
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'error'
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  try {
    await companies.fetchOverview()
  } catch {
    /* handled by empty state */
  }
  const id = companies.resolveId(route.query.c)
  if (!id) {
    loading.value = false
    return
  }
  await loadDashboard(id)
})
</script>

<template>
  <v-container class="dash">
    <div v-if="loading" class="dash__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="error" class="dash__center dash__error">
      <v-icon icon="mdi-alert-circle-outline" size="20" /> {{ error }}
    </div>

    <!-- No business yet -->
    <div v-else-if="!hasCompanies" class="dash__empty">
      <v-icon icon="mdi-storefront-outline" size="40" />
      <h2>{{ t('dashboard.noBusinessTitle') }}</h2>
      <p>{{ t('dashboard.noBusinessText') }}</p>
      <v-btn color="primary" :to="{ name: 'create' }" append-icon="mdi-arrow-right">
        {{ t('dashboard.createCta') }}
      </v-btn>
    </div>

    <template v-else-if="company">
      <header class="dash__head">
        <div class="dash__ident">
          <p class="dash__eyebrow">{{ t('dashboard.eyebrow') }}</p>
          <div class="dash__pick">
            <v-select
              v-if="overview.length > 1"
              :model-value="companyId"
              :items="companyItems"
              variant="plain"
              density="compact"
              hide-details
              class="dash__select"
              @update:model-value="switchCompany"
            />
            <h1 v-else>{{ company.displayName }}</h1>
            <v-chip
              :color="company.status === 'active' ? 'success' : 'default'"
              size="small"
              variant="flat"
            >
              {{
                company.status === 'active' ? t('dashboard.statusActive') : t('dashboard.statusDraft')
              }}
            </v-chip>
          </div>
        </div>
        <v-btn
          variant="tonal"
          size="small"
          prepend-icon="mdi-plus"
          :to="{ name: 'create' }"
        >
          {{ t('dashboard.addBusiness') }}
        </v-btn>
      </header>

      <!-- Configurare -->
      <div v-if="tasks.length" class="dtasks">
        <div
          v-for="task in tasks"
          :key="task.key"
          class="dash__task"
          :class="{ 'dash__task--done': task.status === 'done' }"
        >
          <v-icon
            :icon="task.status === 'done' ? 'mdi-check-circle' : 'mdi-rocket-launch-outline'"
            size="22"
          />
          <div class="dash__taskBody">
            <strong>
              {{ taskTitle(task.key) }}
              <InfoHint v-if="task.status !== 'done'" :text="taskText(task.key)" />
            </strong>
            <span v-if="task.status === 'done'">{{ taskDoneText(task.key) }}</span>
          </div>
          <div class="dash__taskAction">
            <v-btn
              color="primary"
              size="small"
              :variant="task.status === 'done' ? 'tonal' : 'flat'"
              :to="{ name: taskRoute(task.key), query: { c: company.id } }"
            >
              {{ taskButton(task.key, task.status === 'done') }}
            </v-btn>
          </div>
        </div>
      </div>

      <!-- Status cards -->
      <div class="dgrid">
        <!-- Website -->
        <article class="dcard dcard--website">          <p class="dcard__k">{{ t('dashboard.websiteTitle') }}</p>
          <div class="dcard__body">
            <template v-if="websiteReady && website && website.status !== 'none'">
              <div class="dcard__badges">
                <span class="dcard__badge" :class="website.isLive ? 'is-live' : 'is-idle'">
                  {{ website.isLive ? t('dashboard.websiteLive') : t('dashboard.websiteIdle') }}
                </span>
                <span class="dcard__tag">
                  {{ website.mode === 'advanced' ? t('dashboard.modeAdvanced') : t('dashboard.modeEasy') }}
                </span>
              </div>
              <button type="button" class="dcard__go" @click="showSite = true">
                {{ t('dashboard.viewSite') }} <v-icon icon="mdi-arrow-right" size="15" />
              </button>
            </template>
            <p v-else class="dcard__sub">{{ t('dashboard.websiteNone') }}</p>
          </div>
        </article>

        <!-- Location -->
        <article class="dcard dcard--location">          <p class="dcard__k">{{ t('dashboard.locationTitle') }}</p>
          <div class="dcard__body">
            <template v-if="location">
              <p class="dcard__hero">
                {{ location.city }}<span v-if="location.region">, {{ location.region }}</span>
              </p>
              <p class="dcard__sub">
                {{
                  location.serviceRadiusKm
                    ? t('dashboard.radius', { n: location.serviceRadiusKm })
                    : t('dashboard.radiusUnset')
                }}
              </p>
              <router-link
                class="dcard__go"
                :to="{ name: 'create-location', query: { c: companyId } }"
              >
                {{ t('dashboard.taskEdit') }} <v-icon icon="mdi-arrow-right" size="15" />
              </router-link>
            </template>
            <p v-else class="dcard__sub">{{ t('dashboard.locationNone') }}</p>
          </div>
        </article>

        <!-- Wallet -->
        <article v-if="wallet" class="dcard dcard--wallet">          <p class="dcard__k">
            {{ t('dashboard.walletTitle') }}
            <InfoHint :text="t('dashboard.walletShared')" />
          </p>
          <div class="dcard__body">
            <p class="dcard__hero">
              {{ fmtNum(wallet.balance.credits) }} <small>{{ t('dashboard.walletCredits') }}</small>
            </p>
            <p class="dcard__sub">
              ≈ €{{ fmtNum(wallet.balance.credits) }} /
              ~{{ fmtNum(wallet.balance.credits * wallet.eurRonRate, 0) }} RON
            </p>
            <router-link class="dcard__go" :to="{ name: 'wallet' }">
              {{ t('dashboard.walletCta') }} <v-icon icon="mdi-arrow-right" size="15" />
            </router-link>
          </div>
        </article>

        <!-- Campaign -->
        <article v-if="dash" class="dcard dcard--campaign">          <p class="dcard__k">{{ t('dashboard.campaignTitle') }}</p>
          <div class="dcard__body">
            <template v-if="dash.campaign">
              <div class="dcard__badges">
                <span class="dcard__badge" :class="campBadge(dash.campaign.status)">
                  {{ t('dashboard.campaignStatus.' + dash.campaign.status) }}
                </span>
              </div>
              <p class="dcard__sub">
                {{ t('dashboard.campaignBudget', { n: fmtNum(dash.campaign.dailyBudget.credits) }) }} ·
                CPC {{ fmtNum(dash.campaign.cpc.credits) }}
              </p>
            </template>
            <p v-else class="dcard__sub">{{ t('dashboard.campaignNone') }}</p>
            <router-link
              class="dcard__go"
              :to="{ name: 'campaign', query: { c: companyId } }"
            >
              {{ t('dashboard.campaignCta') }} <v-icon icon="mdi-arrow-right" size="15" />
            </router-link>
          </div>
        </article>

        <!-- Leads / Cereri -->
        <article v-if="dash" class="dcard dcard--leads">          <p class="dcard__k">{{ t('dashboard.leadsTitle') }}</p>
          <div class="dcard__body">
            <p class="dcard__hero">
              {{ dash.leads.new }} <small>{{ t('dashboard.leadsNewWord') }}</small>
            </p>
            <p class="dcard__sub">
              {{ t('dashboard.leadsTotal', { n: dash.leads.total }) }} ·
              {{ t('dashboard.leadsBreakdown', { form: dash.leads.form, call: dash.leads.call }) }}
            </p>
            <router-link class="dcard__go" :to="{ name: 'leads', query: { c: companyId } }">
              {{ t('dashboard.leadsCta') }} <v-icon icon="mdi-arrow-right" size="15" />
            </router-link>
          </div>
        </article>
      </div>

      <!-- Analiză -->
      <div v-if="a" class="ana">
        <div class="ana__hero">
          <div class="ana__heroHead">
            <span>{{ t('dashboard.secAnalytics') }}</span>
            <InfoHint :text="t('analytics.intro')" />
          </div>
          <VisibilityMeter :score="a.visibility.score" :parts="a.visibility.parts" />
        </div>

        <div class="ana__chart">
          <p class="ana__chartHead">{{ t('analytics.last14') }}</p>
          <BarChart :labels="a.series.days" :series="chartSeries" />
        </div>

        <div class="ana__stats">
          <div class="astat">
            <span class="astat__k">{{ t('analytics.clicks') }}</span>
            <strong class="astat__v">{{ fmtNum(a.clicks.total, 0) }}</strong>
            <span class="astat__x">{{ t('analytics.today', { n: fmtNum(a.clicks.today, 0) }) }}</span>
          </div>
          <div class="astat">
            <span class="astat__k">{{ t('analytics.calls') }}</span>
            <strong class="astat__v">{{ fmtNum(a.calls.total, 0) }}</strong>
            <span class="astat__x">{{ t('analytics.fromSite') }}</span>
          </div>
          <div class="astat">
            <span class="astat__k">{{ t('analytics.messages') }}</span>
            <strong class="astat__v">{{ fmtNum(a.messages.total, 0) }}</strong>
            <span class="astat__x">{{ t('analytics.newN', { n: a.messages.new }) }}</span>
          </div>
          <div class="astat">
            <span class="astat__k">{{ t('analytics.responseTime') }}</span>
            <strong class="astat__v">{{ fmtMinutes(a.response.avgMinutes) }}</strong>
            <span class="astat__x">
              {{ a.response.ratePct != null
                ? t('analytics.rate', { p: a.response.ratePct })
                : t('analytics.noData') }}
            </span>
          </div>
          <div class="astat">
            <span class="astat__k">{{ t('analytics.spend') }}</span>
            <strong class="astat__v">{{ fmtNum(a.campaign.consumedTotal.credits) }} cr</strong>
            <span class="astat__x">
              {{ t('analytics.today', { n: fmtNum(a.campaign.consumedToday.credits) + ' cr' }) }}
            </span>
          </div>
          <div class="astat">
            <span class="astat__k">{{ t('analytics.activeDays') }}</span>
            <strong class="astat__v">{{ a.campaign.activeDays }}</strong>
            <span class="astat__x">{{ t('dashboard.days') }}</span>
          </div>
        </div>
      </div>

      <!-- Zonă periculoasă -->
      <div class="dash__danger">
        <div>
          <strong>{{ t('dashboard.deleteTitle') }}</strong>
          <span>{{ t('dashboard.deleteText') }}</span>
        </div>
        <v-btn
          variant="outlined"
          color="error"
          size="small"
          prepend-icon="mdi-trash-can-outline"
          @click="showDelete = true"
        >
          {{ t('dashboard.deleteCta') }}
        </v-btn>
      </div>
    </template>

    <v-dialog v-model="showDelete" max-width="440">
      <v-card>
        <v-card-title class="text-h6">{{ t('dashboard.deleteConfirmTitle') }}</v-card-title>
        <v-card-text>
          {{ t('dashboard.deleteConfirmText', { name: company?.displayName }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="deleting" @click="showDelete = false">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn color="error" variant="flat" :loading="deleting" @click="confirmDelete">
            {{ t('dashboard.deleteConfirmCta') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showSite" max-width="960" scrollable>
      <v-card>
        <v-card-text class="pa-2">
          <WebsiteRenderer
            v-if="websiteReady && website && 'content' in website"
            :content="website.content"
            :theme="website.theme"
            framed
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showSite = false">{{ t('common.cancel') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.dash {
  max-width: 960px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.dash__ident {
  min-width: 0;
}

/* --- Configurare --- */
.dtasks {
  margin-top: 1.5rem;
}

/* --- Status cards --- */
.dgrid {
  display: grid;
  gap: 1.1rem;
  grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
  margin-top: 1.75rem;
}
.dcard {
  --acc: var(--v-theme-primary);
  --acc-c: rgb(var(--acc));
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 134px;
  padding: 1.25rem 1.35rem 1.3rem;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--acc-c) 26%, transparent);
  background:
    linear-gradient(150deg, color-mix(in srgb, var(--acc-c) 13%, transparent), transparent 44%),
    rgb(var(--v-theme-surface));
  transition:
    transform 0.16s var(--tvz-ease-out),
    box-shadow 0.16s var(--tvz-ease-out),
    border-color 0.16s var(--tvz-ease-out);
}
.dcard::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(var(--acc-c), color-mix(in srgb, var(--acc-c) 25%, transparent));
}
.dcard:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--acc-c) 55%, transparent);
  box-shadow: 0 16px 34px color-mix(in srgb, var(--acc-c) 18%, transparent);
}
.dcard--website {
  --acc: var(--v-theme-primary);
}
.dcard--location {
  --acc: var(--v-theme-secondary);
}
.dcard--wallet {
  --acc: var(--v-theme-success);
}
.dcard--campaign {
  --acc: var(--v-theme-warning);
}
.dcard--leads {
  --acc: var(--v-theme-info, var(--v-theme-primary));
}
.dcard__k {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0 0 0.9rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: rgb(var(--acc));
}
.dcard__k :deep(.infohint) {
  margin-left: auto;
  color: color-mix(in srgb, var(--acc-c) 75%, transparent);
}
.dcard__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  position: relative;
  z-index: 1;
}
.dcard__hero {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.55rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.12;
  margin: 0;
}
.dcard__hero small {
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.dcard__sub {
  margin: 0.35rem 0 0;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.62);
}
.dcard__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.dcard__badge {
  font-size: 0.66rem;
  font-weight: 700;
  padding: 0.24rem 0.62rem;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: color-mix(in srgb, var(--acc-c) 15%, transparent);
  color: var(--acc-c);
}
.dcard__badge.is-idle {
  background: rgb(var(--v-theme-on-surface) / 0.08);
  color: rgb(var(--v-theme-on-surface) / 0.65);
}
.dcard__badge.is-live {
  background: rgb(var(--v-theme-success) / 0.16);
  color: rgb(var(--v-theme-success));
}
.dcard__badge.is-warn {
  background: rgb(var(--v-theme-warning) / 0.16);
  color: rgb(var(--v-theme-warning));
}
.dcard__tag {
  font-size: 0.66rem;
  font-weight: 600;
  padding: 0.24rem 0.58rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--acc-c) 32%, transparent);
  color: rgb(var(--v-theme-on-surface) / 0.62);
  text-transform: capitalize;
}
.dcard__go {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: auto;
  padding-top: 0.9rem;
  padding-inline: 0;
  border: 0;
  background: none;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--acc));
  text-decoration: none;
  transition: gap 0.14s var(--tvz-ease-out);
}
.dcard__go:hover {
  gap: 0.6rem;
}

/* --- Analiză --- */
.ana {
  margin-top: 1.75rem;
  display: grid;
  gap: 1rem;
}
.ana__hero {
  padding: 1.5rem 1.6rem;
  border-radius: 20px;
  border: 1px solid var(--tvz-glass-border);
  background:
    radial-gradient(150% 110% at 100% 0%, rgb(var(--v-theme-primary) / 0.08), transparent 55%),
    rgb(var(--v-theme-surface));
}
.ana__heroHead,
.ana__chartHead {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0 0 1.1rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.ana__chart {
  padding: 1.4rem 1.6rem 1.1rem;
  border-radius: 20px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
}
.ana__chartHead {
  margin-bottom: 0.7rem;
}
.ana__stats {
  display: grid;
  gap: 1px;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  background: var(--tvz-hairline);
  border: 1px solid var(--tvz-hairline);
  border-radius: 16px;
  overflow: hidden;
}
.astat {
  background: rgb(var(--v-theme-surface));
  padding: 0.95rem 1.05rem;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}
.astat__k {
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.astat__v {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.3rem;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.astat__x {
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}

.dash__danger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 1.75rem;
  padding: 1rem 1.25rem;
  border: 1px solid rgb(var(--v-theme-error) / 0.3);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-error) / 0.04);
}
.dash__danger strong {
  display: block;
  font-size: 0.9rem;
}
.dash__danger span {
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.dash__pick {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.dash__select {
  max-width: 260px;
}
.dash__select :deep(.v-field__input) {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.4rem, 4vw, 2rem);
  letter-spacing: -0.02em;
  padding-top: 0;
  min-height: unset;
}
.dash__center {
  display: grid;
  place-items: center;
  min-height: 240px;
}
.dash__error {
  gap: 0.5rem;
  color: rgb(var(--v-theme-error));
}

.dash__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  text-align: center;
  padding: 3rem 1rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.dash__empty h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.3rem;
  margin: 0;
}
.dash__empty p {
  margin: 0;
  max-width: 36ch;
}

.dash__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.dash__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin: 0 0 0.3rem;
}
.dash__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}

.dash__task {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.1rem 1.25rem;
  border-radius: var(--tvz-radius-lg);
  background: var(--tvz-ai-soft);
  border: 1px solid var(--tvz-glass-border);
}
.dash__task + .dash__task {
  margin-top: 0.75rem;
}
.dash__task > .v-icon {
  color: var(--tvz-ai);
}
.dash__task--done {
  background: rgb(var(--v-theme-success) / 0.1);
}
.dash__task--done > .v-icon {
  color: rgb(var(--v-theme-success));
}
.dash__taskBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.dash__taskBody strong {
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.dash__taskBody span {
  font-size: 0.83rem;
  color: rgb(var(--v-theme-on-surface) / 0.65);
}
.dash__taskAction {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.3rem;
  text-align: right;
}
.dash__taskAction small {
  font-size: 0.7rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

@media (max-width: 560px) {
  .dash__task {
    flex-wrap: wrap;
  }
  .dash__taskBody {
    flex: 1 1 100%;
    order: 2;
  }
  .dash__task > .v-icon {
    order: 1;
  }
  .dash__taskAction {
    order: 3;
    flex: 1 1 100%;
    align-items: stretch;
  }
  .dash__taskAction .v-btn {
    width: 100%;
  }
}
</style>
