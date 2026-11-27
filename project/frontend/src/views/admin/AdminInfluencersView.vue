<script setup lang="ts">
/**
 * Admin › Influenceri: every influencer with their code and results, and
 * the "new influencer" dialog. Creating/changing is admin-only (the backend
 * enforces it); finance sees the list read-only.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminFilterChip from '@/components/admin/AdminFilterChip.vue'
import { ApiError } from '@/services/api'
import {
  adminCreateInfluencer,
  adminListInfluencers,
  type AdminInfluencerRow,
} from '@/services/influencers'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const { t, n } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const toasts = useToastStore()
const canManage = computed(() => auth.user?.platformRoles.includes('admin') ?? false)

const rows = ref<AdminInfluencerRow[]>([])
const loading = ref(true)
const failed = ref(false)
const query = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter(
    (r) =>
      r.code.toLowerCase().includes(q) ||
      r.user.name.toLowerCase().includes(q) ||
      r.user.email.toLowerCase().includes(q),
  )
})
const totals = computed(() => ({
  influencers: rows.value.length,
  active: rows.value.filter((r) => r.active).length,
  users: rows.value.reduce((s, r) => s + r.users, 0),
  commissions: rows.value.reduce((s, r) => s + r.commissions.minor, 0),
}))

function eur(minor: number): string {
  return '€' + n(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function cr(minor: number): string {
  return n(minor / 100, { maximumFractionDigits: 2 })
}

async function load(): Promise<void> {
  loading.value = true
  failed.value = false
  try {
    rows.value = (await adminListInfluencers()).items
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

// --- create dialog --------------------------------------------------------
const showCreate = ref(false)
const saving = ref(false)
const form = reactive({ email: '', name: '', code: '', discountPct: 10, commissionPct: 10, note: '' })
const CODE_RE = /^[A-Z0-9-]{3,24}$/
const formValid = computed(
  () =>
    /^\S+@\S+\.\S+$/.test(form.email.trim()) &&
    form.name.trim().length >= 2 &&
    CODE_RE.test(form.code.trim().toUpperCase()) &&
    Number.isInteger(form.discountPct) &&
    form.discountPct >= 0 &&
    form.discountPct <= 90 &&
    Number.isInteger(form.commissionPct) &&
    form.commissionPct >= 0 &&
    form.commissionPct <= 90,
)
function openCreate(): void {
  Object.assign(form, { email: '', name: '', code: '', discountPct: 10, commissionPct: 10, note: '' })
  showCreate.value = true
}
const ERRORS: Record<string, string> = {
  influencer_code_taken: 'adminInfl.errCodeTaken',
  influencer_code_invalid: 'adminInfl.errCodeInvalid',
  already_influencer: 'adminInfl.errAlready',
  influencer_pct_invalid: 'adminInfl.errPct',
}
function errText(e: unknown): string {
  if (e instanceof ApiError && ERRORS[e.message]) return t(ERRORS[e.message])
  return e instanceof Error ? e.message : t('admin.genericError')
}
async function create(): Promise<void> {
  if (!formValid.value) return
  saving.value = true
  try {
    const res = await adminCreateInfluencer({
      email: form.email.trim(),
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      discountPct: form.discountPct,
      commissionPct: form.commissionPct,
      note: form.note.trim() || undefined,
    })
    showCreate.value = false
    toasts.success(res.invited ? t('adminInfl.createdInvited') : t('adminInfl.created'))
    void router.push({ name: 'admin-influencer', params: { id: res.influencer.id } })
  } catch (e) {
    toasts.error(errText(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="ainf">
    <AdminPageHeader
      :title="t('admin.navInfluencers')"
      :eyebrow="t('admin.navGroupClients')"
      :count="rows.length"
      :hint="t('adminInfl.pageHint')"
    >
      <template v-if="canManage" #actions>
        <v-btn color="primary" prepend-icon="mdi-account-star-outline" @click="openCreate">
          {{ t('adminInfl.new') }}
        </v-btn>
      </template>
    </AdminPageHeader>

    <div class="ainf__chips">
      <AdminFilterChip :label="t('adminInfl.chipInfluencers')" :value="n(totals.influencers)" icon="mdi-account-star-outline" />
      <AdminFilterChip :label="t('adminInfl.chipActive')" :value="n(totals.active)" icon="mdi-check-circle-outline" tone="success" />
      <AdminFilterChip :label="t('adminInfl.chipUsers')" :value="n(totals.users)" icon="mdi-account-multiple-outline" />
      <AdminFilterChip :label="t('adminInfl.chipCommissions')" :value="`${cr(totals.commissions)} cr`" icon="mdi-gift-outline" tone="primary" />
    </div>

    <v-text-field
      v-model="query"
      :placeholder="t('adminInfl.search')"
      prepend-inner-icon="mdi-magnify"
      density="compact"
      hide-details
      clearable
      class="ainf__search"
    />

    <div v-if="loading" class="ainf__center"><v-progress-circular indeterminate color="primary" /></div>
    <AdminEmptyState v-else-if="failed" icon="mdi-alert-circle-outline" :text="t('adminInfl.loadError')" />
    <AdminEmptyState v-else-if="!filtered.length" icon="mdi-account-star-outline" :text="t('adminInfl.none')" />

    <div v-else class="atable">
      <div class="atable__head" aria-hidden="true">
        <span>{{ t('adminInfl.colInfluencer') }}</span>
        <span>{{ t('adminInfl.colCode') }}</span>
        <span class="num">{{ t('adminInfl.colTerms') }}</span>
        <span class="num">{{ t('adminInfl.colUsers') }}</span>
        <span class="num">{{ t('adminInfl.colRevenue') }}</span>
        <span class="num">{{ t('adminInfl.colCommissions') }}</span>
      </div>
      <ul class="atable__list">
        <li v-for="r in filtered" :key="r.id">
          <router-link :to="{ name: 'admin-influencer', params: { id: r.id } }" class="arow">
            <span class="arow__person">
              <span class="arow__name">{{ r.user.name }}</span>
              <span class="arow__sub">{{ r.user.email }}</span>
            </span>
            <span class="arow__cell">
              <span class="arow__code">{{ r.code }}</span>
              <span class="arow__state" :class="r.active ? 'is-on' : 'is-off'">
                {{ r.active ? t('influencer.active') : t('influencer.inactive') }}
              </span>
            </span>
            <span class="arow__cell num" :data-label="t('adminInfl.colTerms')">
              -{{ r.discountPct }}% / {{ r.commissionPct }}%
            </span>
            <span class="arow__cell num" :data-label="t('adminInfl.colUsers')">
              {{ n(r.users) }} <small>({{ n(r.depositors) }})</small>
            </span>
            <span class="arow__cell num" :data-label="t('adminInfl.colRevenue')">{{ eur(r.firstDepositsPaid.minor) }}</span>
            <span class="arow__cell num" :data-label="t('adminInfl.colCommissions')"><b>{{ cr(r.commissions.minor) }} cr</b></span>
          </router-link>
        </li>
      </ul>
    </div>

    <v-dialog v-model="showCreate" max-width="560">
      <v-card class="ainf__dialog">
        <v-card-title>{{ t('adminInfl.new') }}</v-card-title>
        <v-card-text class="ainf__form">
          <p class="ainf__formNote">{{ t('adminInfl.createNote') }}</p>
          <v-text-field v-model="form.name" :label="t('adminInfl.fName')" />
          <v-text-field v-model="form.email" :label="t('adminInfl.fEmail')" type="email" />
          <v-text-field
            v-model="form.code"
            :label="t('adminInfl.fCode')"
            :hint="t('adminInfl.fCodeHint')"
            persistent-hint
            class="ainf__codeField"
            @update:model-value="form.code = String($event ?? '').toUpperCase()"
          />
          <div class="ainf__pcts">
            <v-text-field v-model.number="form.discountPct" :label="t('adminInfl.fDiscount')" type="number" suffix="%" :min="0" :max="90" :hint="t('adminInfl.fDiscountHint')" persistent-hint />
            <v-text-field v-model.number="form.commissionPct" :label="t('adminInfl.fCommission')" type="number" suffix="%" :min="0" :max="90" :hint="t('adminInfl.fCommissionHint')" persistent-hint />
          </div>
          <v-textarea v-model="form.note" :label="t('adminInfl.fNote')" rows="2" auto-grow variant="outlined" rounded="lg" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showCreate = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="saving" :disabled="!formValid" @click="create">{{ t('adminInfl.create') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.ainf__chips {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.7rem;
  margin: 0 0 1rem;
}
.ainf__search {
  max-width: 420px;
  margin-bottom: 1rem;
}
.ainf__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.atable {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
}
.atable__head,
.arow {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 0.7fr) minmax(0, 0.8fr) minmax(0, 0.8fr);
  gap: 1rem;
  align-items: center;
}
.atable__head {
  align-items: end;
  padding: 0.65rem 1.1rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-bottom: 1px solid var(--tvz-hairline);
}
.atable__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.atable__list li + li {
  border-top: 1px solid var(--tvz-hairline);
}
.arow {
  padding: 0.75rem 1.1rem;
  color: inherit;
  text-decoration: none;
  font-size: var(--tvz-fs-small);
  transition: background 0.15s ease;
}
.arow:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* Header labels may wrap onto two lines instead of running into each other. */
.atable__head .num {
  white-space: normal;
  line-height: 1.3;
}
.arow__person {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.arow__name {
  font-weight: 600;
}
.arow__sub {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arow__cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.arow__cell.num {
  align-items: flex-end;
  display: block;
}
.arow__code {
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgb(var(--v-theme-primary));
}
.arow__state {
  font-size: var(--tvz-fs-caption);
}
.arow__state.is-on {
  color: rgb(var(--v-theme-success));
}
.arow__state.is-off {
  color: rgb(var(--v-theme-warning));
}
.ainf__form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.ainf__formNote {
  margin: 0 0 0.3rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.ainf__pcts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}
.ainf__codeField :deep(input) {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
@media (max-width: 760px) {
  .ainf__chips {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .atable__head {
    display: none;
  }
  .arow {
    grid-template-columns: 1fr 1fr;
  }
  .arow__person {
    grid-column: 1 / -1;
  }
  .num {
    text-align: left;
  }
  .arow__cell.num::before {
    content: attr(data-label);
    display: block;
    font-size: var(--tvz-fs-micro);
    text-transform: uppercase;
    color: rgba(var(--v-theme-on-surface), 0.45);
  }
  .ainf__pcts {
    grid-template-columns: 1fr;
  }
}
</style>
