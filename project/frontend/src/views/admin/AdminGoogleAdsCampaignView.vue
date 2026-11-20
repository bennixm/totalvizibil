<script setup lang="ts">
/**
 * One campaign's optimization dashboard: performance, our score with its
 * full breakdown (what is missing for 100%), Google's own Ad Strength
 * shown separately, prioritized issues, every asset as Google returned it,
 * the agent's history of changes, and its recent activity on this campaign.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminHintText from '@/components/admin/AdminHintText.vue'
import GoogleAdsProposalPreview from '@/components/admin/GoogleAdsProposalPreview.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import GoogleAdsActionOutcome from '@/components/admin/google-ads/GoogleAdsActionOutcome.vue'
import GoogleAdsScoreRing from '@/components/admin/google-ads/GoogleAdsScoreRing.vue'
import GoogleAdsIssueList from '@/components/admin/google-ads/GoogleAdsIssueList.vue'
import GoogleAdsActivityFeed from '@/components/admin/google-ads/GoogleAdsActivityFeed.vue'
import {
  adStrengthTone,
  googleAdsOptimizationApi,
  scoreTone,
  type ComponentStatus,
  type GoogleAdsOptimizationCampaignDetail,
  type GoogleAdsTextItem,
} from '@/services/google-ads-optimization'
import { ApiError } from '@/services/api'

const { t, te } = useI18n()
const route = useRoute()
const id = computed(() => String(route.params.googleCampaignId ?? ''))
const data = ref<GoogleAdsOptimizationCampaignDetail | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  try {
    data.value = await googleAdsOptimizationApi.campaign(id.value)
    error.value = null
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 404
        ? t('adminGoogleAdsOpt.notFound')
        : e instanceof ApiError
          ? e.message
          : t('admin.genericError')
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(id, load)

const s = computed(() => data.value?.snapshot)
const m = computed(() => s.value?.metrics)
const isSearch = computed(() => s.value?.channelType === 'SEARCH')

function label(prefix: string, v: string | null | undefined) {
  if (!v) return '–'
  const key = `adminGoogleAdsOpt.${prefix}.${v}`
  return te(key) ? t(key) : v
}
function money(micros: number) {
  return `${(micros / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${s.value?.currencyCode ?? ''}`.trim()
}
function pct(v: number | null | undefined, digits = 2) {
  return v === null || v === undefined ? '–' : `${(v * 100).toFixed(digits)}%`
}
function change(v: number | null | undefined) {
  if (v === null || v === undefined) return null
  return `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`
}
function fmt(iso?: string | null) {
  return iso
    ? new Date(iso).toLocaleString(undefined, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '–'
}
const STATUS_TONE: Record<ComponentStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  ok: 'success',
  attention: 'warning',
  missing: 'error',
  na: 'neutral',
}
function perfTone(l?: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (l === 'BEST' || l === 'GOOD') return 'success'
  if (l === 'LOW') return 'error'
  return 'neutral'
}
function maxChars(kind: 'headline' | 'long' | 'description') {
  return kind === 'headline' ? 30 : 90
}
function textRows(list: GoogleAdsTextItem[] | undefined) {
  return list ?? []
}
const applicableMax = computed(() =>
  (s.value?.scoreBreakdown ?? []).filter((c) => c.status !== 'na').reduce((a, c) => a + c.max, 0),
)
const historyTone = (st: string) =>
  st === 'applied'
    ? 'success'
    : st === 'pending_approval' || st === 'approved'
      ? 'warning'
      : st === 'failed'
        ? 'error'
        : 'neutral'
const historyLabel = (st: string) =>
  st === 'applied'
    ? t('adminGoogleAds.statusApplied')
    : st === 'pending_approval'
      ? t('adminGoogleAds.statusPendingApproval')
      : st === 'rejected'
        ? t('adminGoogleAds.statusRejected')
        : st === 'approved'
          ? t('adminGoogleAdsOpt.statusApproved')
          : st === 'superseded'
            ? t('adminGoogleAdsOpt.statusSuperseded')
            : t('adminGoogleAdsOpt.statusFailed')
const tab = ref<'overview' | 'assets' | 'history' | 'activity'>('overview')
/** Score components whose explanation is open. */
const openComp = ref<Set<string>>(new Set())
function toggleComp(key: string) {
  if (openComp.value.has(key)) openComp.value.delete(key)
  else openComp.value.add(key)
}
/** History rows whose details are open. */
const openHist = ref<Set<string>>(new Set())
function toggleHist(id: string) {
  if (openHist.value.has(id)) openHist.value.delete(id)
  else openHist.value.add(id)
}
const issueCount = computed(() => s.value?.issues.length ?? 0)
</script>

<template>
  <div class="gcv">
    <RouterLink
      :to="{ name: 'admin-google-ads-agent', query: { tab: 'campaigns' } }"
      class="gcv__back"
    >
      <v-icon icon="mdi-arrow-left" size="16" />{{ t('adminGoogleAdsOpt.back') }}
    </RouterLink>

    <div v-if="loading && !data" class="d-flex justify-center py-16">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <AdminEmptyState v-else-if="error" icon="mdi-alert-circle-outline" :text="error" />

    <template v-else-if="s && m">
      <!-- Header -->
      <header class="gcv__head">
        <h1>{{ s.name }}</h1>
        <div class="gcv__meta">
          <GaChip tone="neutral">{{ label('channel', s.channelType) }}</GaChip>
          <GaChip :tone="s.status === 'ENABLED' ? 'success' : 'neutral'">
            {{ label('campaignStatus', s.status) }}
          </GaChip>
          <GaChip
            v-if="s.managed"
            tone="primary"
            icon="mdi-robot-outline"
            :title="t('adminGoogleAdsOpt.managedHint')"
          >
            {{ t('adminGoogleAdsOpt.managedBadge') }}
          </GaChip>
          <GaChip v-else tone="neutral" icon="mdi-eye-outline">
            {{ t('adminGoogleAdsOpt.monitoredOnly') }}
          </GaChip>
          <span v-if="s.primaryStatusReasons.length" class="gcv__reasons">
            {{ s.primaryStatusReasons.join(' · ') }}
          </span>
          <span class="gcv__sync">
            {{ t('adminGoogleAdsOpt.syncedAt', { when: fmt(s.syncedAt) }) }} ·
            {{ t('adminGoogleAdsOpt.colLastOptimized') }}: {{ fmt(s.lastOptimizedAt) }}
          </span>
        </div>
      </header>

      <!-- Summary strip -->
      <section class="strip">
        <div class="strip__score">
          <GoogleAdsScoreRing :score="s.score" :size="72" :stroke="7" />
          <div>
            <AdminHintText
              :label="t('adminGoogleAdsOpt.scoreLabel')"
              :hint="t('adminGoogleAdsOpt.scoreExplainer')"
            />
            <div class="strip__strength">
              <span>{{ t('adminGoogleAdsOpt.colAdStrength') }}</span>
              <GaChip :tone="adStrengthTone(s.adStrength)">{{
                label('adStrength', s.adStrength)
              }}</GaChip>
            </div>
          </div>
        </div>
        <dl class="strip__kpis">
          <div>
            <dt>{{ t('adminGoogleAdsOpt.colImpressions') }}</dt>
            <dd>{{ m.current.impressions.toLocaleString() }}</dd>
          </div>
          <div>
            <dt>{{ t('adminGoogleAdsOpt.colClicks') }}</dt>
            <dd>
              {{ m.current.clicks.toLocaleString() }}
              <small
                v-if="change(m.clicksChange)"
                :class="(m.clicksChange ?? 0) < 0 ? 'neg' : 'pos'"
              >
                {{ change(m.clicksChange) }}
              </small>
            </dd>
            <span>CTR {{ pct(m.current.ctr) }}</span>
          </div>
          <div>
            <dt>{{ t('adminGoogleAdsOpt.colConversions') }}</dt>
            <dd>{{ m.current.conversions.toLocaleString() }}</dd>
          </div>
          <div>
            <dt>{{ t('adminGoogleAdsOpt.colCost') }}</dt>
            <dd>{{ money(m.current.costMicros) }}</dd>
            <span>
              {{
                m.current.roas !== null
                  ? `ROAS ${m.current.roas.toFixed(2)}`
                  : m.current.cpa !== null
                    ? `CPA ${m.current.cpa.toFixed(2)}`
                    : 'CPA –'
              }}
            </span>
          </div>
        </dl>
        <p class="strip__note">
          {{ t('adminGoogleAdsOpt.period30') }} ·
          {{
            m.comparable ? t('adminGoogleAdsOpt.vsPrevious') : t('adminGoogleAdsOpt.notComparable')
          }}
        </p>
      </section>

      <v-tabs v-model="tab" color="primary" density="comfortable" class="gcv__tabs" show-arrows>
        <v-tab value="overview">
          {{ t('adminGoogleAds.tabOverview') }}
          <span v-if="issueCount" class="gcv__count">{{ issueCount }}</span>
        </v-tab>
        <v-tab value="assets">{{ t('adminGoogleAdsOpt.tabAssets') }}</v-tab>
        <v-tab value="history">
          {{ t('adminGoogleAds.tabHistory') }}
          <span v-if="data?.history.length" class="gcv__count gcv__count--muted">{{
            data.history.length
          }}</span>
        </v-tab>
        <v-tab value="activity">{{ t('adminGoogleAdsOpt.tabActivity') }}</v-tab>
      </v-tabs>

      <v-window v-model="tab" class="gcv__window">
        <!-- Overview: issues + score breakdown -->
        <v-window-item value="overview">
          <div class="gcv__cols">
            <section>
              <h2 class="gcv__h">{{ t('adminGoogleAdsOpt.sectionIssues') }}</h2>
              <GoogleAdsIssueList :issues="s.issues" />
            </section>
            <section>
              <h2 class="gcv__h">
                <AdminHintText
                  :label="t('adminGoogleAdsOpt.sectionScore')"
                  :hint="t('adminGoogleAdsOpt.naExplain')"
                />
              </h2>
              <ul class="comps">
                <li
                  v-for="c in s.scoreBreakdown"
                  :key="c.key"
                  class="comp"
                  :class="{ 'comp--open': openComp.has(c.key) }"
                >
                  <button
                    type="button"
                    class="comp__row"
                    :aria-expanded="openComp.has(c.key)"
                    @click="toggleComp(c.key)"
                  >
                    <span class="comp__label">{{ c.label }}</span>
                    <span v-if="c.status !== 'na'" class="comp__bar">
                      <span
                        :class="`fill--${scoreTone(Math.round((c.earned / c.max) * 100))}`"
                        :style="{ width: `${(c.earned / c.max) * 100}%` }"
                      />
                    </span>
                    <span v-else class="comp__na">{{ t('adminGoogleAdsOpt.naComponent') }}</span>
                    <span class="comp__pts" :class="`comp__pts--${STATUS_TONE[c.status]}`">
                      {{ c.status === 'na' ? '–' : `${c.earned}/${c.max}` }}
                    </span>
                  </button>
                  <p v-if="c.missing.length && !openComp.has(c.key)" class="comp__missing">
                    {{ t('adminGoogleAdsOpt.missingLabel') }}: {{ c.missing.join(', ') }}
                  </p>
                  <div v-if="openComp.has(c.key)" class="comp__body">
                    <p>{{ c.explanation }}</p>
                    <p v-if="c.missing.length" class="comp__missingFull">
                      <b>{{ t('adminGoogleAdsOpt.missingLabel') }}:</b> {{ c.missing.join(', ') }}
                    </p>
                    <a v-if="c.source" :href="c.source" target="_blank" rel="noopener noreferrer">
                      {{ t('adminGoogleAdsOpt.sourceLink')
                      }}<v-icon icon="mdi-open-in-new" size="12" />
                    </a>
                  </div>
                </li>
              </ul>
              <p class="gcv__foot">Σ {{ applicableMax }} p</p>
            </section>
          </div>
        </v-window-item>

        <!-- Assets -->
        <v-window-item value="assets">
          <section class="asec">
            <h2 class="gcv__h">{{ t('adminGoogleAdsOpt.textsTitle') }}</h2>
            <div class="tcols">
              <div>
                <h3 class="asec__sub">
                  {{ t('adminGoogleAdsOpt.sectionHeadlines') }}
                  <span>{{ s.assets.headlines.length }}</span>
                </h3>
                <ul v-if="s.assets.headlines.length" class="tlist">
                  <li v-for="(h, i) in textRows(s.assets.headlines)" :key="i">
                    <span class="tlist__text">{{ h.text }}</span>
                    <v-icon
                      v-if="h.pinnedField"
                      icon="mdi-pin-outline"
                      size="14"
                      :title="t('adminGoogleAdsOpt.pinned')"
                    />
                    <GaChip
                      v-if="h.approvalStatus && h.approvalStatus !== 'APPROVED'"
                      tone="error"
                      >{{ h.approvalStatus }}</GaChip
                    >
                    <GaChip
                      v-if="h.performanceLabel && h.performanceLabel !== 'PENDING'"
                      :tone="perfTone(h.performanceLabel)"
                    >
                      {{ label('perfLabel', h.performanceLabel) }}
                    </GaChip>
                    <span class="tlist__chars" :class="{ over: h.length > maxChars('headline') }"
                      >{{ h.length }}/{{ maxChars('headline') }}</span
                    >
                  </li>
                </ul>
                <p v-else class="muted">{{ t('adminGoogleAdsOpt.emptyList') }}</p>

                <template v-if="!isSearch">
                  <h3 class="asec__sub">
                    {{ t('adminGoogleAdsOpt.sectionLongHeadlines') }}
                    <span>{{ s.assets.longHeadlines.length }}</span>
                  </h3>
                  <ul v-if="s.assets.longHeadlines.length" class="tlist">
                    <li v-for="(h, i) in s.assets.longHeadlines" :key="i">
                      <span class="tlist__text">{{ h.text }}</span>
                      <span class="tlist__chars">{{ h.length }}/{{ maxChars('long') }}</span>
                    </li>
                  </ul>
                  <p v-else class="muted">{{ t('adminGoogleAdsOpt.emptyList') }}</p>
                </template>
              </div>
              <div>
                <h3 class="asec__sub">
                  {{ t('adminGoogleAdsOpt.sectionDescriptions') }}
                  <span>{{ s.assets.descriptions.length }}</span>
                </h3>
                <ul v-if="s.assets.descriptions.length" class="tlist">
                  <li v-for="(d, i) in textRows(s.assets.descriptions)" :key="i">
                    <span class="tlist__text">{{ d.text }}</span>
                    <GaChip
                      v-if="d.approvalStatus && d.approvalStatus !== 'APPROVED'"
                      tone="error"
                      >{{ d.approvalStatus }}</GaChip
                    >
                    <GaChip
                      v-if="d.performanceLabel && d.performanceLabel !== 'PENDING'"
                      :tone="perfTone(d.performanceLabel)"
                    >
                      {{ label('perfLabel', d.performanceLabel) }}
                    </GaChip>
                    <span class="tlist__chars" :class="{ over: d.length > maxChars('description') }"
                      >{{ d.length }}/{{ maxChars('description') }}</span
                    >
                  </li>
                </ul>
                <p v-else class="muted">{{ t('adminGoogleAdsOpt.emptyList') }}</p>
              </div>
            </div>
          </section>

          <section class="asec">
            <h2 class="gcv__h">{{ t('adminGoogleAdsOpt.extensionsTitle') }}</h2>
            <h3 class="asec__sub">
              {{ t('adminGoogleAdsOpt.sectionSitelinks') }}
              <span>{{ s.assets.sitelinks.length }}</span>
            </h3>
            <div v-if="s.assets.sitelinks.length" class="sitelinks">
              <div v-for="(sl, i) in s.assets.sitelinks" :key="i" class="sitelink">
                <strong>{{ sl.linkText }}</strong>
                <span v-if="sl.description1 || sl.description2">
                  {{ [sl.description1, sl.description2].filter(Boolean).join(' · ') }}
                </span>
                <a
                  v-if="sl.finalUrl"
                  :href="sl.finalUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ sl.finalUrl }}</a
                >
                <small v-if="sl.level === 'account'">{{
                  t('adminGoogleAdsOpt.accountScope')
                }}</small>
              </div>
            </div>
            <p v-else class="muted">{{ t('adminGoogleAdsOpt.emptyList') }}</p>
            <h3 class="asec__sub">
              {{ t('adminGoogleAdsOpt.sectionCallouts') }}
              <span>{{ s.assets.callouts.length }}</span>
            </h3>
            <div v-if="s.assets.callouts.length" class="chipwrap">
              <GaChip v-for="(c, i) in s.assets.callouts" :key="i" tone="neutral">{{
                c.text
              }}</GaChip>
            </div>
            <p v-else class="muted">{{ t('adminGoogleAdsOpt.emptyList') }}</p>
          </section>

          <section class="asec">
            <h2 class="gcv__h">{{ t('adminGoogleAdsOpt.visualsTitle') }}</h2>
            <h3 class="asec__sub">
              {{ t('adminGoogleAdsOpt.sectionImages') }} <span>{{ s.assets.images.length }}</span>
            </h3>
            <div v-if="s.assets.images.length" class="imgs">
              <div
                v-for="(img, i) in s.assets.images"
                :key="i"
                class="img"
                :class="{ bad: !img.valid }"
                :title="img.problems.join('; ')"
              >
                <div class="img__box">
                  <span
                    class="img__shape"
                    :style="{ aspectRatio: `${img.width} / ${img.height}` }"
                  />
                </div>
                <div class="img__meta">
                  <span>{{ img.width }}×{{ img.height }}</span>
                  <v-icon
                    :icon="
                      img.valid
                        ? img.problems.length
                          ? 'mdi-alert-outline'
                          : 'mdi-check'
                        : 'mdi-close'
                    "
                    size="14"
                    :color="img.valid ? (img.problems.length ? 'warning' : 'success') : 'error'"
                  />
                </div>
                <small>{{ img.format }} · {{ Math.round(img.fileSize / 1024) }} KB</small>
                <small v-if="img.problems.length" class="img__problem">{{
                  img.problems.join('; ')
                }}</small>
              </div>
            </div>
            <p v-else class="muted">{{ t('adminGoogleAdsOpt.emptyList') }}</p>

            <h3 class="asec__sub">{{ t('adminGoogleAdsOpt.sectionLogos') }}</h3>
            <dl class="kv">
              <dt>{{ t('adminGoogleAdsOpt.businessName') }}</dt>
              <dd>{{ s.assets.businessName ?? t('adminGoogleAdsOpt.emptyList') }}</dd>
              <template v-for="(img, i) in s.assets.logos" :key="`logo-${i}`">
                <dt>Logo {{ s.assets.logos.length > 1 ? i + 1 : '' }}</dt>
                <dd>
                  {{ img.width }}×{{ img.height }} · {{ img.format }}
                  <span v-if="img.level === 'account'" class="muted"
                    >· {{ t('adminGoogleAdsOpt.accountScope') }}</span
                  >
                  <GaChip :tone="img.valid ? 'success' : 'error'">
                    {{ img.valid ? t('adminGoogleAdsOpt.valid') : t('adminGoogleAdsOpt.invalid') }}
                  </GaChip>
                  <span v-if="img.problems.length" class="img__problem">{{
                    img.problems.join('; ')
                  }}</span>
                </dd>
              </template>
            </dl>

            <h3 class="asec__sub">
              {{ t('adminGoogleAdsOpt.sectionVideos') }} <span>{{ s.assets.videos.length }}</span>
            </h3>
            <p v-if="isSearch" class="muted">{{ t('adminGoogleAdsOpt.noVideosSearch') }}</p>
            <template v-else>
              <ul v-if="s.assets.videos.length" class="videos">
                <li v-for="v in s.assets.videos" :key="v.youtubeVideoId">
                  <v-icon icon="mdi-youtube" size="16" />
                  <a
                    :href="`https://www.youtube.com/watch?v=${v.youtubeVideoId}`"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ v.title || v.youtubeVideoId }}
                  </a>
                </li>
              </ul>
              <p class="muted">
                <AdminHintText
                  :label="t('adminGoogleAdsOpt.details')"
                  :hint="t('adminGoogleAdsOpt.videoApiNote')"
                />
              </p>
            </template>
          </section>
        </v-window-item>

        <!-- History -->
        <v-window-item value="history">
          <ul v-if="data?.history.length" class="hlist">
            <li v-for="a in data.history" :key="a.id" class="hrow">
              <button
                type="button"
                class="hrow__line"
                :aria-expanded="openHist.has(a.id)"
                @click="toggleHist(a.id)"
              >
                <span class="hrow__label">{{ a.label ?? a.action }}</span>
                <v-icon
                  v-if="a.verifiedAt"
                  icon="mdi-check-decagram"
                  size="15"
                  color="success"
                  :title="t('adminGoogleAdsOpt.historyVerified')"
                />
                <v-icon
                  :icon="a.requiredApproval ? 'mdi-account-check-outline' : 'mdi-robot-outline'"
                  size="15"
                  class="hrow__mode"
                  :title="
                    a.requiredApproval
                      ? t('adminGoogleAdsOpt.historyRequiredApproval')
                      : t('adminGoogleAdsOpt.historyAutomatic')
                  "
                />
                <GaChip :tone="historyTone(a.status)">{{ historyLabel(a.status) }}</GaChip>
                <time class="hrow__date">{{ fmt(a.createdAt) }}</time>
                <v-icon
                  :icon="openHist.has(a.id) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                  size="18"
                  class="hrow__mode"
                />
              </button>
              <div v-if="openHist.has(a.id)" class="hrow__body">
                <p v-if="a.reasoning" class="hrow__reason">{{ a.reasoning }}</p>
                <GoogleAdsActionOutcome :action="a" />
                <GoogleAdsProposalPreview
                  v-if="a.preview?.sections.length"
                  :preview="a.preview"
                  compact
                />
                <p v-if="a.approvedBy" class="muted">
                  {{
                    t('adminGoogleAds.decidedBy', {
                      name: a.approvedBy.name,
                      date: fmt(a.approvedAt),
                    })
                  }}
                </p>
              </div>
            </li>
          </ul>
          <AdminEmptyState
            v-else
            icon="mdi-clipboard-text-clock-outline"
            :text="t('adminGoogleAds.historyNone')"
          />
        </v-window-item>

        <!-- Activity -->
        <v-window-item value="activity">
          <GoogleAdsActivityFeed
            v-if="tab === 'activity'"
            :google-campaign-id="s.googleCampaignId"
            :limit="60"
            hide-campaign
          />
        </v-window-item>
      </v-window>
    </template>
  </div>
</template>

<style scoped>
.gcv__back {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
  text-decoration: none;
}
.gcv__back:hover {
  color: rgb(var(--v-theme-primary));
}
.gcv__head h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.gcv__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.6rem;
  margin-top: 0.5rem;
}
.gcv__reasons,
.gcv__sync {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.gcv__sync {
  margin-left: auto;
}
.muted {
  margin: 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.pos {
  color: rgb(var(--v-theme-success));
}
.neg {
  color: rgb(var(--v-theme-error));
}

/* summary strip */
.strip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  margin-top: 1.25rem;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.strip__score {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.9rem 1.25rem;
  border-right: 1px solid var(--tvz-hairline);
  font-size: var(--tvz-fs-small);
  font-weight: 600;
}
.strip__strength {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.35rem;
  font-weight: 400;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.strip__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
}
.strip__kpis > div {
  padding: 0.9rem 1.1rem;
  border-left: 1px solid var(--tvz-hairline);
}
.strip__kpis > div:first-child {
  border-left: 0;
}
.strip__kpis dt {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.strip__kpis dd {
  margin: 0.1rem 0 0;
  font-size: 1.2rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.strip__kpis small {
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
}
.strip__kpis span {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.strip__note {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0.4rem 1.25rem;
  border-top: 1px solid var(--tvz-hairline);
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* tabs */
.gcv__tabs {
  margin: 1.5rem 0 1.25rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.gcv__count {
  margin-left: 0.4rem;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-warning), 0.18);
  color: rgb(var(--v-theme-warning));
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1.25rem;
  text-align: center;
}
.gcv__count--muted {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.gcv__window {
  overflow: visible;
}
.gcv__h {
  margin: 0 0 0.6rem;
  font-size: var(--tvz-fs-body, 1rem);
  font-weight: 600;
}
.gcv__foot {
  margin: 0.4rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-align: right;
}
.gcv__cols {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 1.75rem;
  align-items: start;
}

/* score components */
.comps {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.comp + .comp {
  border-top: 1px solid var(--tvz-hairline);
}
.comp__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 90px 3.5rem;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.55rem 0.85rem;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.comp__row:hover {
  background: rgba(var(--v-theme-on-surface), 0.025);
}
.comp__label {
  font-size: var(--tvz-fs-small);
  font-weight: 500;
}
.comp__bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  overflow: hidden;
}
.comp__bar span {
  display: block;
  height: 100%;
  border-radius: 3px;
}
.fill--success {
  background: rgb(var(--v-theme-success));
}
.fill--warning {
  background: rgb(var(--v-theme-warning));
}
.fill--error {
  background: rgb(var(--v-theme-error));
}
.fill--neutral {
  background: rgba(var(--v-theme-on-surface), 0.3);
}
.comp__na {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.comp__pts {
  text-align: right;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.comp__pts--success {
  color: rgb(var(--v-theme-success));
}
.comp__pts--warning {
  color: rgb(var(--v-theme-warning));
}
.comp__pts--error {
  color: rgb(var(--v-theme-error));
}
.comp__pts--neutral {
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.comp__missing {
  margin: -0.25rem 0 0;
  padding: 0 0.85rem 0.5rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.comp__body {
  padding: 0 0.85rem 0.75rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.comp__body p {
  margin: 0 0 0.35rem;
}
.comp__missingFull b {
  color: rgb(var(--v-theme-error));
}
.comp__body a {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: var(--tvz-fs-caption);
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

/* assets */
.asec + .asec {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--tvz-hairline);
}
.asec__sub {
  margin: 1rem 0 0.45rem;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.asec__sub:first-child {
  margin-top: 0;
}
.asec__sub span {
  margin-left: 0.25rem;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.tcols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.75rem;
}
.tlist {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tlist li {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--tvz-hairline);
  font-size: var(--tvz-fs-small);
}
.tlist li:last-child {
  border-bottom: 0;
}
.tlist__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.tlist__chars {
  flex: none;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-variant-numeric: tabular-nums;
}
.tlist__chars.over {
  color: rgb(var(--v-theme-error));
}
.sitelinks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.5rem;
}
.sitelink {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-sm);
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.7);
  min-width: 0;
}
.sitelink strong {
  font-size: var(--tvz-fs-small);
  color: rgb(var(--v-theme-primary));
}
.sitelink a {
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chipwrap {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.imgs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.75rem;
}
.img {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.img__box {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64px;
  margin-bottom: 0.2rem;
}
.img__shape {
  height: 100%;
  max-width: 100%;
  border-radius: var(--tvz-radius-xs);
  background: rgba(var(--v-theme-on-surface), 0.07);
  border: 1px solid var(--tvz-hairline);
}
.img.bad .img__shape {
  border-color: rgba(var(--v-theme-error), 0.55);
}
.img__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}
.img__problem {
  color: rgb(var(--v-theme-error));
  font-size: var(--tvz-fs-caption);
}
.kv {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.4rem 1.25rem;
  margin: 0;
  font-size: var(--tvz-fs-small);
}
.kv dt {
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.kv dd {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}
.videos {
  list-style: none;
  margin: 0 0 0.4rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: var(--tvz-fs-small);
}
.videos li {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.videos a {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
  overflow-wrap: anywhere;
}

/* history */
.hlist {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.hrow + .hrow {
  border-top: 1px solid var(--tvz-hairline);
}
.hrow__line {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.6rem 0.9rem;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.hrow__line:hover {
  background: rgba(var(--v-theme-on-surface), 0.025);
}
.hrow__label {
  flex: 1;
  min-width: 0;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hrow__mode {
  opacity: 0.55;
  flex: none;
}
.hrow__date {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.45);
  white-space: nowrap;
}
.hrow__body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0 0.9rem 0.9rem;
}
.hrow__reason {
  margin: 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.75);
}

/* responsive */
@media (max-width: 1100px) {
  .strip {
    grid-template-columns: minmax(0, 1fr);
  }
  .strip__score {
    border-right: 0;
    border-bottom: 1px solid var(--tvz-hairline);
  }
  .gcv__cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 700px) {
  .gcv__head h1 {
    font-size: 1.25rem;
  }
  .gcv__sync {
    margin-left: 0;
    flex-basis: 100%;
  }
  .strip__kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .strip__kpis > div {
    border-left: 0;
    border-top: 1px solid var(--tvz-hairline);
  }
  .strip__kpis > div:nth-child(even) {
    border-left: 1px solid var(--tvz-hairline);
  }
  .strip__kpis > div:nth-child(-n + 2) {
    border-top: 0;
  }
  .strip__note {
    padding: 0.4rem 1rem;
  }
  .tcols {
    grid-template-columns: minmax(0, 1fr);
  }
  .hrow__date {
    display: none;
  }
  .comp__row {
    grid-template-columns: minmax(0, 1fr) 60px 3rem;
  }
}
</style>
