<script setup lang="ts">
import { uiLocale } from '@/plugins/i18n'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import {
  useAdminStore,
  type AdminAuditLogRow,
  type AdminBusinessActionLogRow,
} from '@/stores/admin'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const admin = useAdminStore()
const auth = useAuthStore()

const isAdmin = computed(() => auth.user?.platformRoles.includes('admin') ?? false)
const canSeeOwnerLog = computed(() => isAdmin.value || auth.isSupportStaff)

const tab = ref<'staff' | 'owners'>(isAdmin.value ? 'staff' : 'owners')

// --- action taxonomy -----------------------------------------------------
// The codes actually written by the backend (admin/audit-log.service.ts call
// sites for staff, business-action-log.service.ts call sites for owners) —
// shown verbatim rather than individually translated: they're short, stable,
// self-describing machine codes, and a 30-entry i18n map would just go stale
// every time a new one is wired up.
const STAFF_ACTIONS = [
  'wallet.adjust',
  'wallet.block',
  'wallet.unblock',
  'wallet.refund.initiate',
  'refund.cancel',
  'invoice.void',
  'invoice.unvoid',
  'settings.update',
  'billing_profile.update',
  'maintenance.broadcast',
  'company.update',
  'company.location.update',
  'company.website.publish',
  'company.website.unpublish',
  'company.status.update',
  'company.deletion.cancel',
  'company.campaign.update',
  'company.campaign.action',
  'company.website.upgrade_advanced',
  'company.lead.status.update',
  'category.create',
  'category.update',
  'category.delete',
  'user.update',
  'user.password.reset',
  'google_ads.ad_texts',
  'google_ads.keywords',
  'google_ads.extensions',
  'google_ads.status',
  'google_ads.budget.propose',
  'google_ads.settings',
  'google_ads.agent.pause',
  'google_ads.agent.resume',
  'google_ads.cycle.start',
  'google_ads.proposal.approve',
  'google_ads.proposal.reject',
]
const STAFF_TARGET_TYPES = [
  'wallet',
  'wallet_transaction',
  'billing_profile',
  'invoice',
  'platform_settings',
  'notification_broadcast',
  'company',
  'website',
  'campaign',
  'lead',
  'category',
  'user',
  'google_ads_user_campaign',
]
const OWNER_ACTIONS = [
  'campaign.activate',
  'campaign.pause',
  'campaign.remove',
  'campaign.update',
  'company.publish',
  'company.unpublish',
  'website.bundle.publish',
]

/** Chips are colored by the action's category prefix, not the exact code —
 *  money-moving actions read green, lifecycle/security-sensitive ones read
 *  amber, everything else (plain config/content edits) stays the neutral
 *  accent. Matches the tone vocabulary the rest of the admin panel uses. */
function actionTone(action: string): 'success' | 'warning' | 'primary' {
  if (/^(wallet|refund|invoice|billing_profile)\./.test(action)) return 'success'
  if (
    /^(user\.(update|password)|company\.(status|deletion)|category\.delete)/.test(action)
  ) {
    return 'warning'
  }
  return 'primary'
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(uiLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// --- staff tab filters -----------------------------------------------------
const staffActor = ref(admin.auditLogFilters.actor)
let staffActorDeb: ReturnType<typeof setTimeout> | undefined
watch(staffActor, (v) => {
  clearTimeout(staffActorDeb)
  staffActorDeb = setTimeout(() => admin.setAuditLogFilter('actor', v), 300)
})
const staffActionItems = computed(() => [
  { value: '', title: t('admin.jurnalFilterAnyAction') },
  ...STAFF_ACTIONS.map((a) => ({ value: a, title: a })),
])
const staffTargetItems = computed(() => [
  { value: '', title: t('admin.jurnalFilterAnyTarget') },
  ...STAFF_TARGET_TYPES.map((v) => ({ value: v, title: v })),
])

// --- owner tab filters -------------------------------------------------
const ownerActor = ref(admin.businessActionLogFilters.actor)
let ownerActorDeb: ReturnType<typeof setTimeout> | undefined
watch(ownerActor, (v) => {
  clearTimeout(ownerActorDeb)
  ownerActorDeb = setTimeout(() => admin.setBusinessActionLogFilter('actor', v), 300)
})
const ownerCompany = ref(admin.businessActionLogFilters.company)
let ownerCompanyDeb: ReturnType<typeof setTimeout> | undefined
watch(ownerCompany, (v) => {
  clearTimeout(ownerCompanyDeb)
  ownerCompanyDeb = setTimeout(() => admin.setBusinessActionLogFilter('company', v), 300)
})
const ownerActionItems = computed(() => [
  { value: '', title: t('admin.jurnalFilterAnyAction') },
  ...OWNER_ACTIONS.map((a) => ({ value: a, title: a })),
])

// --- diff dialog, shared by both tabs ------------------------------------
type DiffRow = { id: string; createdAt: string; action: string; before: unknown; after: unknown; reason?: string | null }
const diffTarget = ref<DiffRow | null>(null)
const diffKeys = computed(() => {
  const b = (diffTarget.value?.before ?? {}) as Record<string, unknown>
  const a = (diffTarget.value?.after ?? {}) as Record<string, unknown>
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
})
function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

onMounted(() => {
  if (isAdmin.value) void admin.fetchAuditLog()
  if (canSeeOwnerLog.value) void admin.fetchBusinessActionLog()
})
watch(tab, (v) => {
  if (v === 'staff' && !admin.auditLog.length) void admin.fetchAuditLog()
  if (v === 'owners' && !admin.businessActionLog.length) void admin.fetchBusinessActionLog()
})
</script>

<template>
  <div class="jrn">
    <AdminPageHeader
      :title="t('admin.navJurnal')"
      :eyebrow="t('admin.navGroupConfig')"
    />

    <v-tabs v-model="tab" color="primary" class="jrn__tabs" show-arrows>
      <v-tab v-if="isAdmin" value="staff" prepend-icon="mdi-shield-account-outline">
        {{ t('admin.tabStaffLog') }}
      </v-tab>
      <v-tab v-if="canSeeOwnerLog" value="owners" prepend-icon="mdi-store-outline">
        {{ t('admin.tabOwnerLog') }}
      </v-tab>
    </v-tabs>

    <v-window v-model="tab" class="jrn__window">
      <!-- ============ Staff log ============ -->
      <v-window-item v-if="isAdmin" value="staff">
        <div class="jrn__filters jrn__filters--staff">
          <v-text-field
            v-model="staffActor"
            :placeholder="t('admin.jurnalSearchActorPlaceholder')"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            class="jrn__search"
          />
          <v-select
            :model-value="admin.auditLogFilters.action"
            :items="staffActionItems"
            prepend-inner-icon="mdi-lightning-bolt-outline"
            variant="outlined"
            density="compact"
            hide-details
            class="jrn__sel mono"
            @update:model-value="admin.setAuditLogFilter('action', $event as string)"
          />
          <v-select
            :model-value="admin.auditLogFilters.targetType"
            :items="staffTargetItems"
            prepend-inner-icon="mdi-target"
            variant="outlined"
            density="compact"
            hide-details
            class="jrn__sel mono"
            @update:model-value="admin.setAuditLogFilter('targetType', $event as string)"
          />
          <div class="jrn__range">
            <v-text-field
              :model-value="admin.auditLogFilters.dateFrom"
              type="date"
              :label="t('admin.jurnalDateFrom')"
              variant="outlined"
              density="compact"
              hide-details
              class="jrn__date"
              @update:model-value="admin.setAuditLogFilter('dateFrom', ($event as string) ?? '')"
            />
            <v-text-field
              :model-value="admin.auditLogFilters.dateTo"
              type="date"
              :label="t('admin.jurnalDateTo')"
              variant="outlined"
              density="compact"
              hide-details
              class="jrn__date"
              @update:model-value="admin.setAuditLogFilter('dateTo', ($event as string) ?? '')"
            />
          </div>
        </div>

        <div v-if="admin.loadingAuditLog && !admin.auditLog.length" class="jrn__center">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <AdminEmptyState
          v-else-if="admin.auditLogError"
          icon="mdi-alert-circle-outline"
          :text="admin.auditLogError"
        />
        <AdminEmptyState
          v-else-if="!admin.auditLog.length"
          icon="mdi-shield-search-outline"
          :text="t('admin.jurnalStaffNone')"
        />

        <div v-else class="jtable jtable--staff">
          <div class="jtable__head" aria-hidden="true">
            <span>{{ t('admin.colDate') }}</span>
            <span>{{ t('admin.colActor') }}</span>
            <span>{{ t('admin.colRole') }}</span>
            <span>{{ t('admin.colAction') }}</span>
            <span>{{ t('admin.colTarget') }}</span>
            <span class="jtable__headActions">{{ t('admin.detailsTitle') }}</span>
          </div>
          <ul class="jrn__list">
            <li v-for="row in (admin.auditLog as AdminAuditLogRow[])" :key="row.id" class="jrow">
              <span class="jrow__cell jrow__date">{{ fmtDate(row.createdAt) }}</span>
              <span class="jrow__cell jrow__actor">
                <b>{{ row.actor.name }}</b>
                <span class="jrow__actorEmail">{{ row.actor.email }}</span>
              </span>
              <span class="jrow__cell">
                <span v-for="r in row.actorRoles" :key="r" class="tag">{{ r }}</span>
              </span>
              <span class="jrow__cell">
                <span class="achip mono" :class="`achip--${actionTone(row.action)}`">{{ row.action }}</span>
              </span>
              <span class="jrow__cell jrow__target">
                <code>{{ row.targetType }}</code>
                <span v-if="row.targetId" class="jrow__targetId">{{ row.targetId.slice(0, 8) }}…</span>
              </span>
              <div class="jrow__actions">
                <v-btn size="small" variant="tonal" @click="diffTarget = row">
                  {{ t('admin.detailsTitle') }}
                </v-btn>
              </div>
            </li>
          </ul>
        </div>

        <AdminPager
          :page="admin.auditLogFilters.page"
          :page-size="admin.auditLogFilters.pageSize"
          :total="admin.auditLogTotal"
          @update:page="admin.setAuditLogFilter('page', $event)"
        />
      </v-window-item>

      <!-- ============ Owner log ============ -->
      <v-window-item v-if="canSeeOwnerLog" value="owners">
        <div class="jrn__filters jrn__filters--owner">
          <v-text-field
            v-model="ownerActor"
            :placeholder="t('admin.jurnalSearchActorPlaceholder')"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            class="jrn__search"
          />
          <v-text-field
            v-model="ownerCompany"
            :placeholder="t('admin.jurnalSearchCompanyPlaceholder')"
            prepend-inner-icon="mdi-domain"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            class="jrn__search"
          />
          <v-select
            :model-value="admin.businessActionLogFilters.action"
            :items="ownerActionItems"
            prepend-inner-icon="mdi-lightning-bolt-outline"
            variant="outlined"
            density="compact"
            hide-details
            class="jrn__sel mono"
            @update:model-value="admin.setBusinessActionLogFilter('action', $event as string)"
          />
          <div class="jrn__range">
            <v-text-field
              :model-value="admin.businessActionLogFilters.dateFrom"
              type="date"
              :label="t('admin.jurnalDateFrom')"
              variant="outlined"
              density="compact"
              hide-details
              class="jrn__date"
              @update:model-value="admin.setBusinessActionLogFilter('dateFrom', ($event as string) ?? '')"
            />
            <v-text-field
              :model-value="admin.businessActionLogFilters.dateTo"
              type="date"
              :label="t('admin.jurnalDateTo')"
              variant="outlined"
              density="compact"
              hide-details
              class="jrn__date"
              @update:model-value="admin.setBusinessActionLogFilter('dateTo', ($event as string) ?? '')"
            />
          </div>
        </div>

        <div v-if="admin.loadingBusinessActionLog && !admin.businessActionLog.length" class="jrn__center">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <AdminEmptyState
          v-else-if="admin.businessActionLogError"
          icon="mdi-alert-circle-outline"
          :text="admin.businessActionLogError"
        />
        <AdminEmptyState
          v-else-if="!admin.businessActionLog.length"
          icon="mdi-store-search-outline"
          :text="t('admin.jurnalOwnerNone')"
        />

        <div v-else class="jtable jtable--owner">
          <div class="jtable__head" aria-hidden="true">
            <span>{{ t('admin.colDate') }}</span>
            <span>{{ t('admin.colActor') }}</span>
            <span>{{ t('admin.colRole') }}</span>
            <span>{{ t('admin.colCompany') }}</span>
            <span>{{ t('admin.colAction') }}</span>
            <span class="jtable__headActions">{{ t('admin.detailsTitle') }}</span>
          </div>
          <ul class="jrn__list">
            <li v-for="row in (admin.businessActionLog as AdminBusinessActionLogRow[])" :key="row.id" class="jrow">
              <span class="jrow__cell jrow__date">{{ fmtDate(row.createdAt) }}</span>
              <span class="jrow__cell jrow__actor">
                <b>{{ row.actor.name }}</b>
                <span class="jrow__actorEmail">{{ row.actor.email }}</span>
              </span>
              <span class="jrow__cell">
                <span class="tag">{{ row.actorRole }}</span>
              </span>
              <span class="jrow__cell">
                <router-link :to="{ name: 'admin-company', params: { id: row.company.id } }" class="jrow__company">
                  {{ row.company.displayName }}
                </router-link>
              </span>
              <span class="jrow__cell">
                <span class="achip mono" :class="`achip--${actionTone(row.action)}`">{{ row.action }}</span>
              </span>
              <div class="jrow__actions">
                <v-btn size="small" variant="tonal" @click="diffTarget = row">
                  {{ t('admin.detailsTitle') }}
                </v-btn>
              </div>
            </li>
          </ul>
        </div>

        <AdminPager
          :page="admin.businessActionLogFilters.page"
          :page-size="admin.businessActionLogFilters.pageSize"
          :total="admin.businessActionLogTotal"
          @update:page="admin.setBusinessActionLogFilter('page', $event)"
        />
      </v-window-item>
    </v-window>

    <!-- Shared diff dialog -->
    <v-dialog :model-value="!!diffTarget" max-width="640" @update:model-value="diffTarget = null">
      <v-card v-if="diffTarget" rounded="lg">
        <v-card-title class="jrn__dTitle">
          <span class="achip mono" :class="`achip--${actionTone(diffTarget.action)}`">{{ diffTarget.action }}</span>
          <span class="jrn__dDate">{{ fmtDate(diffTarget.createdAt) }}</span>
        </v-card-title>
        <v-card-text>
          <p v-if="diffTarget.reason" class="jrn__reason">
            <strong>{{ t('admin.jurnalReason') }}:</strong> {{ diffTarget.reason }}
          </p>
          <div v-if="diffKeys.length" class="jrn__diff">
            <div class="jrn__diffHead">
              <span></span>
              <span>{{ t('admin.jurnalDiffBefore') }}</span>
              <span>{{ t('admin.jurnalDiffAfter') }}</span>
            </div>
            <div v-for="k in diffKeys" :key="k" class="jrn__diffRow">
              <span class="jrn__diffKey">{{ k }}</span>
              <span class="jrn__diffVal mono">{{ fmtVal((diffTarget.before as Record<string, unknown> | null)?.[k]) }}</span>
              <span class="jrn__diffVal mono jrn__diffVal--after">{{ fmtVal((diffTarget.after as Record<string, unknown> | null)?.[k]) }}</span>
            </div>
          </div>
          <p v-else class="jrn__diffEmpty">{{ t('admin.jurnalDiffEmpty') }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="tonal" @click="diffTarget = null">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.jrn {
  max-width: 1320px;
  /* The filter bar lays itself out by this column's width (see below). */
  container-type: inline-size;
}
.jrn__tabs {
  margin-bottom: 1.1rem;
}
/* Keep Vuetify's default overflow:hidden on the window so the outgoing pane
   never flashes visible sliding out to the side. */
.jrn__window {
  overflow: hidden;
}

/* Filter bar: free-text searches on the first row, the pickers (action /
   target) and the From–To period on the second, and every row completely
   filled, so no field is ever left alone on a half-empty line and no
   placeholder gets cut off. Laid out by the page column's width (container
   query on `.jrn`), not the viewport's, since the admin sidebar takes a
   different amount at each screen size.

   phone (< 480):  everything full width, From | To side by side
   tablet:         owners  [person][business] / [action      ] / [from][to]
                   staff   [person          ] / [action][type] / [from][to]
   wide (>= 860):  owners  [person][business] / [action][from][to]
                   staff   [person                 ] / [action][type][from][to] */
.jrn__filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
  padding: 0.75rem;
  margin-bottom: 1.1rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.jrn__filters > *,
.jrn__range > * {
  min-width: 0;
}
/* From / To sit directly in the bar's grid, so they line up with the
   fields above them. */
.jrn__range {
  display: contents;
}
.jrn__search,
.jrn__sel {
  grid-column: span 2;
}
.jrn__date {
  grid-column: span 1;
}
@container (min-width: 480px) {
  .jrn__filters--owner .jrn__search,
  .jrn__filters--staff .jrn__sel {
    grid-column: span 1;
  }
}
@container (min-width: 860px) {
  .jrn__filters--owner {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  .jrn__filters--owner .jrn__search {
    grid-column: span 3;
  }
  .jrn__filters--owner .jrn__sel,
  .jrn__filters--owner .jrn__date {
    grid-column: span 2;
  }
  .jrn__filters--staff {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .jrn__filters--staff .jrn__search {
    grid-column: span 4;
  }
}
/* The native picker's own text is sized like the other fields' text. */
.jrn__date :deep(input) {
  font-size: var(--tvz-fs-input);
  min-width: 0;
}
.jrn__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

/* Table shell — same shared-grid-template pattern as the invoices table. */
.jtable {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
}
.jtable__head,
.jrow {
  display: grid;
  align-items: center;
  gap: 1rem;
}
.jtable--staff .jtable__head,
.jtable--staff .jrow {
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.2fr) minmax(0, 0.75fr) minmax(0, 1.5fr) minmax(0, 0.95fr) auto;
}
.jtable--owner .jtable__head,
.jtable--owner .jrow {
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.15fr) minmax(0, 0.65fr) minmax(0, 1.05fr) minmax(0, 1.3fr) auto;
}
.jtable__head {
  padding: 0.65rem 1.1rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-bottom: 1px solid var(--tvz-hairline);
}
.jtable__headActions {
  text-align: right;
}
.jrn__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.jrow {
  padding: 0.7rem 1.1rem;
  border-bottom: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
  transition: background 0.15s ease;
}
.jrow:last-child {
  border-bottom: none;
}
.jrow:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.jrow__cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.jrow__date {
  font-variant-numeric: tabular-nums;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.jrow__actor b {
  font-size: var(--tvz-fs-body);
  font-weight: 600;
}
.jrow__actorEmail {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.jrow__company {
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}
.jrow__company:hover {
  text-decoration: underline;
}
.jrow__target {
  flex-direction: row;
  align-items: baseline;
  gap: 0.4rem;
  min-width: 0;
}
.jrow__target code {
  font-size: var(--tvz-fs-caption);
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  /* A long `targetType` (e.g. `google_ads_agent_run`) would otherwise
     overflow its grid column and visually run into the actions button next
     to it — flex items don't shrink below their content width by default. */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jrow__targetId {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.4);
  flex-shrink: 0;
}
.jrow__actions {
  display: flex;
  justify-content: flex-end;
}

.tag {
  display: inline-flex;
  align-items: center;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin-right: 0.25rem;
}
.achip {
  display: inline-flex;
  align-items: center;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.achip--success {
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}
.achip--warning {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}
.achip--primary {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

/* Diff dialog */
.jrn__dTitle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.jrn__dDate {
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.jrn__reason {
  margin: 0 0 1rem;
  font-size: var(--tvz-fs-body);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.jrn__diff {
  border: 1px solid var(--tvz-hairline);
  border-radius: 10px;
  overflow: hidden;
}
.jrn__diffHead,
.jrn__diffRow {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.6rem;
}
.jrn__diffHead {
  padding: 0.5rem 0.8rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.jrn__diffHead span:first-child {
  visibility: hidden;
}
.jrn__diffRow {
  padding: 0.5rem 0.8rem;
  border-top: 1px solid var(--tvz-hairline);
  align-items: baseline;
}
.jrn__diffKey {
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.jrn__diffVal {
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
  word-break: break-word;
}
.jrn__diffVal--after {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 600;
}
.jrn__diffEmpty {
  font-size: var(--tvz-fs-body);
  color: rgba(var(--v-theme-on-surface), 0.55);
}

@media (max-width: 920px) {
  .jtable__head {
    display: none;
  }
  .jtable--staff .jrow,
  .jtable--owner .jrow {
    grid-template-columns: 1fr;
    row-gap: 0.4rem;
  }
  .jrow__actions {
    justify-content: flex-start;
  }
}
</style>
