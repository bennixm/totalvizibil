<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import AdminDetailHeader from '@/components/admin/AdminDetailHeader.vue'
import AdminMetaItem from '@/components/admin/AdminMetaItem.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import CreditsValue from '@/components/CreditsValue.vue'
import { useMoney } from '@/composables/useMoney'
import { useAuthStore, type PlatformRole } from '@/stores/auth'
import { useAdminStore, type AdminUserDetail, type AdminUserCompany } from '@/stores/admin'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { ApiError } from '@/services/api'

const { t, n } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const admin = useAdminStore()
const money = useMoney()
const confirm = useConfirmStore()

const id = computed(() => String(route.params.id))
const user = ref<AdminUserDetail | null>(null)
const loading = ref(true)

const tab = ref<'overview' | 'wallet' | 'businesses' | 'activity'>('overview')

const toasts = useToastStore()
function flash(text: string, color: 'success' | 'error' = 'success') {
  toasts.push(color === 'error' ? 'error' : 'success', text)
}
function errText(e: unknown, fb: string) {
  return e instanceof ApiError ? e.message : fb
}
function fmtCr(v: number) {
  return n(v, { maximumFractionDigits: 2 })
}
/** The credit amount's equivalent in this owner's chosen wallet currency. */
function ownerEq(v: number): string {
  const cur = user.value?.wallet.currency === 'RON' ? 'RON' : 'EUR'
  return money.approx(v, cur)
}
function dt(s: string | null) {
  return s ? new Date(s).toLocaleString() : '—'
}
function d(s: string | null) {
  return s ? new Date(s).toLocaleDateString() : t('admin.never')
}
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
}

const isSelf = computed(() => user.value?.id === auth.user?.id)
const walletCur = computed(() => (user.value?.wallet.currency === 'RON' ? 'RON' : 'EUR'))

const ALL_ROLES: PlatformRole[] = ['admin', 'support', 'finance', 'moderator']
const form = reactive({
  name: '',
  email: '',
  status: 'active' as 'active' | 'suspended',
  roles: [] as PlatformRole[],
})
const newPassword = ref('')
const adjust = reactive({ credits: null as number | null, reason: '' })
const blockReason = ref('')
const savingDetails = ref(false)
const savingPassword = ref(false)
const busy = ref<string | null>(null)

function hydrate(u: AdminUserDetail) {
  user.value = u
  form.name = u.name
  form.email = u.email
  form.status = u.status
  form.roles = [...u.platformRoles]
  if (refundAmount.value == null) refundAmount.value = u.wallet.refundable.credits || null
}

async function load() {
  loading.value = true
  try {
    hydrate(await admin.fetchUser(id.value))
  } finally {
    loading.value = false
  }
}
onMounted(load)

function toggleRole(r: PlatformRole) {
  const i = form.roles.indexOf(r)
  if (i === -1) form.roles.push(r)
  else form.roles.splice(i, 1)
}

async function run<T>(key: string, fn: () => Promise<T>, okMsg: string) {
  busy.value = key
  try {
    await fn()
    await load()
    flash(okMsg)
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    busy.value = null
  }
}

async function saveDetails() {
  savingDetails.value = true
  try {
    hydrate(
      await admin.updateUser(id.value, {
        name: form.name.trim(),
        email: form.email.trim(),
        status: form.status,
        platformRoles: form.roles,
      }),
    )
    flash(t('admin.saved'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    savingDetails.value = false
  }
}

function setBan(suspend: boolean) {
  const doIt = () =>
    run(
      'ban',
      () => admin.updateUser(id.value, { status: suspend ? 'suspended' : 'active' }),
      t(suspend ? 'admin.userBanned' : 'admin.userUnbanned'),
    )
  if (suspend) confirm.ask(t('admin.banUser'), t('admin.banUserConfirm'), doIt)
  else void doIt()
}

function runUserAction(key: 'disableTotp' | 'revokeSessions') {
  void run(key, () => admin.updateUser(id.value, { [key]: true }), t(`admin.${key}Done`))
}

async function savePassword() {
  if (newPassword.value.length < 8) return
  savingPassword.value = true
  try {
    await admin.setUserPassword(id.value, newPassword.value)
    newPassword.value = ''
    await load()
    flash(t('admin.passwordSet'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    savingPassword.value = false
  }
}

function toggleWalletBlock() {
  const blocked = !user.value?.wallet.blocked
  void run(
    'walletBlock',
    () => admin.blockWallet(id.value, blocked, blocked ? blockReason.value.trim() : undefined),
    t(blocked ? 'admin.walletBlocked' : 'admin.walletUnblocked'),
  ).then(() => (blockReason.value = ''))
}

function submitAdjust() {
  if (!adjust.credits || adjust.reason.trim().length < 3) return
  void run(
    'adjust',
    () => admin.adjustWallet(id.value, adjust.credits as number, adjust.reason.trim()),
    t('admin.walletAdjusted'),
  ).then(() => {
    adjust.credits = null
    adjust.reason = ''
  })
}

const refundAmount = ref<number | null>(null)
const refundAmountValid = computed(
  () =>
    typeof refundAmount.value === 'number' &&
    refundAmount.value > 0 &&
    refundAmount.value <= (user.value?.wallet.refundable.credits ?? 0),
)
function submitRefund() {
  if (!refundAmountValid.value) return
  const credits = refundAmount.value as number
  confirm.ask(
    t('admin.refundConfirmTitle'),
    t('admin.refundConfirmText'),
    () =>
      run('refund', () => admin.refundBalance(id.value, credits), t('admin.refundRequested')).then(
        () => {
          refundAmount.value = null
        },
      ),
    { danger: false },
  )
}
function cancelWalletRefund(refundId: string) {
  void run(
    `cancelRefund-${refundId}`,
    () => admin.cancelWalletRefund(id.value, refundId),
    t('admin.refundCanceled'),
  )
}
function daysLeft(processAt: string): number {
  return Math.max(0, Math.ceil((new Date(processAt).getTime() - Date.now()) / 86_400_000))
}

function companyStatus(c: AdminUserCompany, status: 'active' | 'suspended') {
  const go = () =>
    run(
      'co-' + c.id,
      () => admin.setCompanyStatus(c.id, status),
      t(status === 'suspended' ? 'admin.bizSuspended' : 'admin.bizUnsuspended'),
    )
  if (status === 'suspended') {
    confirm.ask(t('admin.suspendBiz'), t('admin.suspendBizConfirm', { name: c.displayName }), go)
  } else {
    void go()
  }
}

const campColor: Record<string, string> = {
  active: 'success',
  paused: 'warning',
  depleted: 'error',
  draft: 'grey',
}
const txnColor: Record<string, string> = {
  purchase: 'success',
  spend: 'error',
  refund: 'info',
  adjustment: 'primary',
}
</script>

<template>
  <div class="ud">
    <div v-if="loading" class="ud__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="user">
      <AdminDetailHeader
        :back-to="{ name: 'admin-users' }"
        :back-label="t('admin.backToUsers')"
        :avatar="initials(user.name)"
        :title="user.name"
        :subtitle="user.email"
        :id="user.id"
      >
        <template #pills>
          <v-chip
            size="small"
            :color="user.status === 'active' ? 'success' : 'error'"
            variant="tonal"
          >
            {{ user.status === 'active' ? t('dashboard.statusActive') : t('dashboard.statusSuspended') }}
          </v-chip>
          <v-chip
            v-for="r in user.platformRoles"
            :key="r"
            size="small"
            color="primary"
            variant="tonal"
          >
            {{ r }}
          </v-chip>
          <v-chip
            v-if="user.wallet.blocked"
            size="small"
            color="error"
            variant="flat"
            prepend-icon="mdi-lock"
          >
            {{ t('admin.walletFrozen') }}
          </v-chip>
          <v-chip
            size="small"
            variant="outlined"
            :prepend-icon="user.twoFactorEnabled ? 'mdi-shield-check' : 'mdi-shield-off-outline'"
            :color="user.twoFactorEnabled ? 'success' : undefined"
          >
            {{ user.twoFactorEnabled ? t('account.twoFaOn') : t('account.twoFaOff') }}
          </v-chip>
          <v-chip v-if="isSelf" size="small" color="primary" variant="text">
            {{ t('admin.thisIsYou') }}
          </v-chip>
        </template>

        <template #actions>
          <v-btn
            v-if="!isSelf"
            :color="user.status === 'active' ? 'error' : 'success'"
            :variant="user.status === 'active' ? 'tonal' : 'flat'"
            size="small"
            rounded="pill"
            :loading="busy === 'ban'"
            :prepend-icon="user.status === 'active' ? 'mdi-account-cancel-outline' : 'mdi-account-check-outline'"
            @click="setBan(user.status === 'active')"
          >
            {{ user.status === 'active' ? t('admin.banUser') : t('admin.unbanUser') }}
          </v-btn>
        </template>

        <template #meta>
          <AdminMetaItem :label="t('admin.metaJoined')" :value="d(user.createdAt)" />
          <AdminMetaItem :label="t('admin.colLastLogin')" :value="d(user.lastLoginAt)" />
          <AdminMetaItem :label="t('admin.navBusinesses')" :value="user.companies.length" />
          <AdminMetaItem
            :label="t('admin.walletTitle')"
            :value="`${fmtCr(user.wallet.balance.credits)} ${t('wallet.credits')}`"
          />
        </template>
      </AdminDetailHeader>

      <v-tabs v-model="tab" color="primary" class="ud__tabs" show-arrows>
        <v-tab value="overview" prepend-icon="mdi-account-outline">{{ t('admin.tabOverview') }}</v-tab>
        <v-tab value="wallet" prepend-icon="mdi-wallet-outline">{{ t('admin.tabWallet') }}</v-tab>
        <v-tab value="businesses" prepend-icon="mdi-domain">
          {{ t('admin.tabBusinesses') }} ({{ user.companies.length }})
        </v-tab>
        <v-tab value="activity" prepend-icon="mdi-history">{{ t('admin.tabActivity') }}</v-tab>
      </v-tabs>

      <v-window v-model="tab" class="ud__window">
        <!-- ============ OVERVIEW ============ -->
        <v-window-item value="overview">
          <div class="ud__stack ud__stack--narrow">
            <AdminSection :title="t('admin.detailsTitle')" icon="mdi-card-account-details-outline">
              <div class="ud__form">
                <v-text-field
                  v-model="form.name"
                  :label="t('auth.name')"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                />
                <v-text-field
                  v-model="form.email"
                  :label="t('auth.email')"
                  type="email"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                />
                <v-select
                  v-model="form.status"
                  :items="[
                    { value: 'active', title: t('dashboard.statusActive') },
                    { value: 'suspended', title: t('dashboard.statusSuspended') },
                  ]"
                  :label="t('admin.colStatus')"
                  :disabled="isSelf"
                  :hint="isSelf ? t('admin.selfStatusHint') : ''"
                  persistent-hint
                  variant="outlined"
                  density="comfortable"
                />
                <div class="ud__roles">
                  <span class="ud__roles-label">{{ t('admin.rolesLabel') }}</span>
                  <v-checkbox
                    v-for="r in ALL_ROLES"
                    :key="r"
                    :model-value="form.roles.includes(r)"
                    :label="r"
                    :disabled="isSelf && r === 'admin'"
                    color="primary"
                    density="compact"
                    hide-details
                    @update:model-value="toggleRole(r)"
                  />
                </div>
                <div>
                  <v-btn
                    color="primary"
                    variant="flat"
                    rounded="pill"
                    :loading="savingDetails"
                    prepend-icon="mdi-content-save-outline"
                    @click="saveDetails"
                  >
                    {{ t('common.save') }}
                  </v-btn>
                </div>
              </div>
            </AdminSection>

            <AdminSection :title="t('admin.accountFactsTitle')" icon="mdi-information-outline">
              <div class="ud__facts">
                <AdminMetaItem :label="t('admin.metaJoined')" :value="dt(user.createdAt)" />
                <AdminMetaItem :label="t('admin.updated')" :value="dt(user.updatedAt)" />
                <AdminMetaItem
                  :label="t('admin.factPasswordChanged')"
                  :value="dt(user.passwordChangedAt)"
                />
              </div>
            </AdminSection>

            <AdminSection :title="t('admin.securityTitle')" icon="mdi-shield-key-outline">
              <div class="ud__secRow">
                <div>
                  <p class="ud__secLabel">{{ t('account.twoFaTitle') }}</p>
                  <p class="ud__secVal">
                    {{ user.twoFactorEnabled ? t('account.twoFaOn') : t('account.twoFaOff') }}
                  </p>
                </div>
                <v-btn
                  variant="tonal"
                  size="small"
                  rounded="pill"
                  :disabled="!user.twoFactorEnabled"
                  :loading="busy === 'disableTotp'"
                  prepend-icon="mdi-shield-off-outline"
                  @click="runUserAction('disableTotp')"
                >
                  {{ t('admin.disableTotp') }}
                </v-btn>
              </div>
              <v-divider class="my-3" />
              <div class="ud__secRow">
                <div>
                  <p class="ud__secLabel">{{ t('account.sessionsTitle') }}</p>
                  <p class="ud__secVal">{{ user.sessions.length }}</p>
                </div>
                <v-btn
                  variant="tonal"
                  size="small"
                  rounded="pill"
                  :disabled="!user.sessions.length"
                  :loading="busy === 'revokeSessions'"
                  prepend-icon="mdi-logout-variant"
                  @click="runUserAction('revokeSessions')"
                >
                  {{ t('admin.revokeSessions') }}
                </v-btn>
              </div>
              <v-divider class="my-3" />
              <p class="ud__secLabel mb-2">{{ t('admin.setPasswordTitle') }}</p>
              <div class="ud__pwRow">
                <v-text-field
                  v-model="newPassword"
                  :label="t('account.newPassword')"
                  type="password"
                  variant="outlined"
                  density="compact"
                  hide-details
                  autocomplete="new-password"
                />
                <v-btn
                  variant="flat"
                  color="primary"
                  :loading="savingPassword"
                  :disabled="newPassword.length < 8"
                  @click="savePassword"
                >
                  {{ t('admin.setPassword') }}
                </v-btn>
              </div>
              <p class="ud__note">{{ t('admin.setPasswordNote') }}</p>
            </AdminSection>
          </div>
        </v-window-item>

        <!-- ============ WALLET ============ -->
        <v-window-item value="wallet">
          <div class="ud__stack ud__stack--narrow">
            <AdminSection :title="t('admin.walletTitle')" icon="mdi-wallet-outline">
              <template #actions>
                <v-btn
                  :color="user.wallet.blocked ? 'success' : 'error'"
                  variant="tonal"
                  size="small"
                  rounded="pill"
                  :loading="busy === 'walletBlock'"
                  :prepend-icon="user.wallet.blocked ? 'mdi-lock-open-variant' : 'mdi-lock'"
                  @click="toggleWalletBlock"
                >
                  {{ user.wallet.blocked ? t('admin.unblockWallet') : t('admin.blockWallet') }}
                </v-btn>
              </template>

              <div class="ud__balance">
                <strong>{{ fmtCr(user.wallet.balance.credits) }}</strong>
                <span>{{ t('wallet.credits') }} · {{ ownerEq(user.wallet.balance.credits) }}</span>
              </div>

              <div class="ud__wstats">
                <AdminStatCard
                  :label="t('admin.walletPurchased')"
                  :value="fmtCr(user.wallet.purchased.credits)"
                  :sub="ownerEq(user.wallet.purchased.credits)"
                  icon="mdi-arrow-down-circle-outline"
                  tone="success"
                />
                <AdminStatCard
                  :label="t('admin.walletSpent')"
                  :value="fmtCr(user.wallet.spent.credits)"
                  :sub="ownerEq(user.wallet.spent.credits)"
                  icon="mdi-arrow-up-circle-outline"
                  tone="error"
                />
              </div>

              <div v-if="user.wallet.blocked" class="ud__frozen">
                <v-icon icon="mdi-lock" size="15" />
                {{ t('admin.walletFrozenNote') }}
                <em v-if="user.wallet.blockedReason">“{{ user.wallet.blockedReason }}”</em>
              </div>
              <v-text-field
                v-else
                v-model="blockReason"
                :label="t('admin.walletBlockReason')"
                variant="outlined"
                density="compact"
                hide-details
                class="mt-3"
              />
            </AdminSection>

            <AdminSection :title="t('admin.adjustTitle')" icon="mdi-tune-vertical">
              <p class="ud__note mt-0 mb-3">{{ t('admin.adjustHint') }}</p>
              <div class="ud__adjust">
                <v-text-field
                  v-model.number="adjust.credits"
                  type="number"
                  :label="t('admin.adjustCredits')"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="ud__adjustCredits"
                />
                <v-text-field
                  v-model="adjust.reason"
                  :label="t('admin.adjustReason')"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
                <v-btn
                  variant="flat"
                  color="primary"
                  :loading="busy === 'adjust'"
                  :disabled="!adjust.credits || adjust.reason.trim().length < 3"
                  @click="submitAdjust"
                >
                  {{ t('admin.apply') }}
                </v-btn>
              </div>
            </AdminSection>

            <AdminSection
              v-if="user.wallet.refundable.credits > 0"
              :title="t('admin.refundTitle')"
              icon="mdi-cash-refund"
            >
              <p class="ud__note mt-0 mb-3">
                {{ t('wallet.refundAvailable', { credits: fmtCr(user.wallet.refundable.credits) }) }}
              </p>
              <div class="ud__adjust">
                <v-text-field
                  v-model.number="refundAmount"
                  type="number"
                  :max="user.wallet.refundable.credits"
                  :label="t('admin.refundAmountLabel')"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="ud__adjustCredits"
                />
                <v-btn
                  variant="flat"
                  color="primary"
                  :loading="busy === 'refund'"
                  :disabled="!refundAmountValid"
                  @click="submitRefund"
                >
                  {{ t('admin.refund') }}
                </v-btn>
              </div>
            </AdminSection>
          </div>
        </v-window-item>

        <!-- ============ BUSINESSES ============ -->
        <v-window-item value="businesses">
          <AdminSection :title="t('admin.bizTitle')" icon="mdi-domain">
            <AdminEmptyState
              v-if="!user.companies.length"
              :text="t('admin.noCompanies')"
              icon="mdi-domain-off"
            />
            <div v-else class="ud__biz">
              <article v-for="c in user.companies" :key="c.id" class="bizrow">
                <div class="bizrow__main">
                  <div class="bizrow__id">
                    <strong>{{ c.displayName }}</strong>
                    <span class="bizrow__slug">/{{ c.slug }}</span>
                  </div>
                  <div class="bizrow__tags">
                    <v-chip
                      size="x-small"
                      :color="c.status === 'active' ? 'success' : c.status === 'suspended' ? 'error' : 'grey'"
                      variant="tonal"
                    >
                      {{ c.status === 'active' ? t('dashboard.statusActive') : c.status === 'suspended' ? t('dashboard.statusSuspended') : t('dashboard.statusDraft') }}
                    </v-chip>
                    <v-chip v-if="c.isOwner" size="x-small" variant="outlined">
                      {{ t('admin.owner') }}
                    </v-chip>
                    <span v-else class="bizrow__role">{{ c.role }}</span>
                  </div>
                  <div class="bizrow__camp">
                    <template v-if="c.campaign">
                      <v-chip size="x-small" :color="campColor[c.campaign.status]" variant="flat">
                        {{ t('admin.camp_' + c.campaign.status) }}
                      </v-chip>
                      <span>{{
                        t('admin.campBudget', {
                          b: fmtCr(c.campaign.dailyBudget.credits),
                          c: fmtCr(c.campaign.cpc.credits),
                        })
                      }}</span>
                    </template>
                    <span v-else class="bizrow__muted">{{ t('admin.noCampaign') }}</span>
                  </div>
                </div>

                <div class="bizrow__stats">
                  <span><em>{{ t('admin.bizLeads') }}</em><b>{{ c.leadCount }}</b></span>
                  <span><em>{{ t('admin.bizClicks') }}</em><b>{{ c.clickCount }}</b></span>
                  <span><em>{{ t('admin.bizConsumed') }}</em><b>{{ fmtCr(c.consumed.credits) }}</b></span>
                </div>

                <div class="bizrow__actions">
                  <v-btn
                    :to="{ name: 'admin-company', params: { id: c.id } }"
                    size="small"
                    color="primary"
                    variant="flat"
                    append-icon="mdi-arrow-right"
                  >
                    {{ t('admin.manageBiz') }}
                  </v-btn>
                  <v-btn
                    v-if="c.isOwner"
                    size="small"
                    variant="tonal"
                    :color="c.status === 'suspended' ? 'success' : 'error'"
                    :loading="busy === 'co-' + c.id"
                    @click="companyStatus(c, c.status === 'suspended' ? 'active' : 'suspended')"
                  >
                    {{ c.status === 'suspended' ? t('admin.unsuspendBiz') : t('admin.suspendBiz') }}
                  </v-btn>
                </div>
              </article>
            </div>
          </AdminSection>
        </v-window-item>

        <!-- ============ ACTIVITY ============ -->
        <v-window-item value="activity">
          <div class="ud__stack">
            <AdminSection :title="t('admin.txnsTitle')" icon="mdi-swap-vertical">
              <AdminEmptyState
                v-if="!user.transactions.length"
                :text="t('admin.noTxns')"
                icon="mdi-swap-vertical"
              />
              <div v-else class="ud__tableWrap">
                <table class="ud__table">
                  <thead>
                    <tr>
                      <th>{{ t('admin.colType') }}</th>
                      <th>{{ t('invoice.colDescription') }}</th>
                      <th class="num">{{ t('admin.colTotal') }}</th>
                      <th class="num">{{ t('admin.colDate') }}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="tx in user.transactions" :key="tx.id">
                      <td>
                        <v-chip size="x-small" :color="txnColor[tx.type]" variant="tonal">
                          {{ t('wallet.txnType.' + tx.type) }}
                        </v-chip>
                      </td>
                      <td class="ud__desc">
                        {{ tx.description || '—' }}
                        <span v-if="tx.companyName" class="ud__muted">· {{ tx.companyName }}</span>
                        <span v-if="tx.clicks != null" class="ud__muted">
                          · {{ t('wallet.nClicks', { n: tx.clicks }) }}
                        </span>
                        <span v-if="tx.type === 'refund' && tx.status === 'pending'" class="ud__muted">
                          · {{ t('admin.refundProcessesIn', { d: tx.processAt ? daysLeft(tx.processAt) : 0 }) }}
                        </span>
                      </td>
                      <td class="num">
                        <CreditsValue
                          :credits="tx.amount.credits"
                          :currency="walletCur"
                          signed
                          stacked
                        />
                      </td>
                      <td class="num ud__date">{{ dt(tx.createdAt) }}</td>
                      <td class="ud__txnAction">
                        <v-btn
                          v-if="tx.type === 'refund' && tx.status === 'pending'"
                          size="x-small"
                          variant="text"
                          color="warning"
                          :loading="busy === `cancelRefund-${tx.id}`"
                          @click="cancelWalletRefund(tx.id)"
                        >
                          {{ t('common.cancel') }}
                        </v-btn>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="user.transactions.length >= 20" class="ud__note">
                {{ t('admin.txnsRecentNote') }}
              </p>
            </AdminSection>

            <AdminSection :title="t('admin.navInvoices')" icon="mdi-receipt-text-outline">
              <template #actions>
                <RouterLink :to="{ name: 'admin-invoices' }" class="ud__link">
                  {{ t('admin.invSeeAll') }}
                </RouterLink>
              </template>
              <AdminEmptyState
                v-if="!user.invoices.length"
                :text="t('admin.invoicesNone')"
                icon="mdi-receipt-text-outline"
              />
              <div v-else class="ud__tableWrap">
                <table class="ud__table">
                  <thead>
                    <tr>
                      <th>{{ t('invoices.colNumber') }}</th>
                      <th class="num">{{ t('admin.colTotal') }}</th>
                      <th class="num">{{ t('admin.colDate') }}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="inv in user.invoices" :key="inv.id">
                      <td>
                        {{ inv.number }}
                        <v-chip
                          v-if="inv.voided"
                          size="x-small"
                          color="error"
                          variant="tonal"
                          class="ms-1"
                        >
                          {{ t('admin.invStatusVoid') }}
                        </v-chip>
                      </td>
                      <td class="num">{{ fmtCr(inv.totalMinor / 100) }} {{ inv.currency }}</td>
                      <td class="num ud__date">{{ d(inv.issuedAt) }}</td>
                      <td class="num">
                        <a
                          :href="`/account/invoices/${inv.id}`"
                          target="_blank"
                          rel="noopener"
                          class="ud__link"
                        >
                          {{ t('invoices.view') }}
                        </a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </AdminSection>

            <AdminSection :title="t('account.sessionsTitle')" icon="mdi-devices">
              <AdminEmptyState
                v-if="!user.sessions.length"
                :text="t('admin.noSessions')"
                icon="mdi-devices"
              />
              <ul v-else class="ud__sessions">
                <li v-for="s in user.sessions" :key="s.id">
                  <span>{{ (s.userAgent || t('account.unknownDevice')).slice(0, 60) }}</span>
                  <span class="ud__muted">{{ s.ip || '—' }} · {{ dt(s.createdAt) }}</span>
                </li>
              </ul>
            </AdminSection>
          </div>
        </v-window-item>
      </v-window>
    </template>

  </div>
</template>

<style scoped>
.ud {
  max-width: 1000px;
}
.ud__center {
  display: grid;
  place-items: center;
  min-height: 320px;
}
.ud__tabs {
  border-bottom: 1px solid var(--tvz-hairline);
  margin-bottom: 1.4rem;
}
/* keep Vuetify's default `overflow: hidden` on .v-window so the outgoing
   tab pane is never briefly visible sliding out to the side. */
.ud__stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
/* form-heavy tabs read better at a narrower measure */
.ud__stack--narrow {
  max-width: 720px;
}

/* forms */
.ud__form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.ud__roles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1.1rem;
  align-items: center;
}
.ud__roles-label {
  width: 100%;
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ud__facts {
  display: flex;
  gap: 2rem;
  flex-wrap: wrap;
}
.ud__note {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin: 0.7rem 0 0;
}

/* security */
.ud__secRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.ud__secLabel {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
}
.ud__secVal {
  margin: 0.1rem 0 0;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ud__pwRow {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}
.ud__pwRow .v-btn {
  flex: none;
}

/* wallet */
.ud__balance {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
  margin-bottom: 1.1rem;
}
.ud__balance strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: clamp(1.8rem, 5vw, 2.4rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.ud__balance span {
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-top: 0.3rem;
}
.ud__wstats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.75rem;
}
.ud__frozen {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-top: 0.9rem;
  padding: 0.55rem 0.8rem;
  border-radius: 10px;
  background: rgba(var(--v-theme-error), 0.12);
  color: rgb(var(--v-theme-error));
  font-size: 0.8rem;
}
.ud__adjust {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  flex-wrap: wrap;
}
.ud__adjustCredits {
  max-width: 160px;
}
.ud__adjust .v-btn {
  margin-top: 0.15rem;
}

/* businesses */
.ud__biz {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.bizrow {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  flex-wrap: wrap;
  padding: 0.9rem 1rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.bizrow__main {
  flex: 1;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.bizrow__id {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.bizrow__id strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.95rem;
}
.bizrow__slug {
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.bizrow__tags {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.bizrow__role {
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.bizrow__camp {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.bizrow__muted,
.ud__muted {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.bizrow__stats {
  display: flex;
  gap: 1.3rem;
}
.bizrow__stats span {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.bizrow__stats em {
  font-style: normal;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.bizrow__stats b {
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
}
.bizrow__actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

/* tables */
.ud__tableWrap {
  overflow-x: auto;
}
.ud__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.ud__table th {
  text-align: left;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
  padding: 0.35rem 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
  white-space: nowrap;
}
.ud__table td {
  padding: 0.55rem 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
  vertical-align: middle;
}
.ud__table tr:last-child td {
  border-bottom: none;
}
.ud__table .num {
  text-align: right;
  white-space: nowrap;
}
.ud__desc {
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.ud__date {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.74rem;
}
.ud__txnAction {
  white-space: nowrap;
  text-align: right;
}
.ud__link {
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}
.ud__sessions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  font-size: 0.84rem;
}
.ud__sessions li {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.ud__sessions .ud__muted {
  font-size: 0.74rem;
}
</style>
