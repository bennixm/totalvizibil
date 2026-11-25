<script setup lang="ts">
import { uiLocale } from '@/plugins/i18n'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AdminSection from '@/components/admin/AdminSection.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminUserActivity from '@/components/admin/user/AdminUserActivity.vue'
import AdminUserAds from '@/components/admin/user/AdminUserAds.vue'
import AdminUserInvoices from '@/components/admin/user/AdminUserInvoices.vue'
import CreditsValue from '@/components/CreditsValue.vue'
import { useMoney } from '@/composables/useMoney'
import { useAuthStore, type PlatformRole } from '@/stores/auth'
import {
  useAdminStore,
  type AdminUserDetail,
  type AdminUserCompany,
  type AdminUserTxn,
} from '@/stores/admin'
import type { BillingKind } from '@/stores/billing'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { ApiError } from '@/services/api'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const admin = useAdminStore()
const money = useMoney()
const confirm = useConfirmStore()

const id = computed(() => String(route.params.id))
const user = ref<AdminUserDetail | null>(null)
const loading = ref(true)

const TABS = ['overview', 'wallet', 'invoices', 'businesses', 'activity', 'google-ads'] as const
type UserTab = (typeof TABS)[number]
/** In the URL (`?tab=`), so a reload or a shared link opens the same tab. */
const tab = computed<UserTab>({
  get: () => (TABS.includes(route.query.tab as UserTab) ? (route.query.tab as UserTab) : 'overview'),
  set: (v) => void router.replace({ query: { ...route.query, tab: v } }),
})
const adsCount = ref<number | null>(null)

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
/** The credit amount's "≈" equivalent in the currency picked in the top-nav
 *  EUR/RON toggle, like every other admin page (finance, dashboard). It used
 *  to be pinned to the viewed owner's own wallet currency, so the toggle had
 *  no effect here. */
function ownerEq(v: number): string {
  return money.approx(v)
}
function dt(s: string | null) {
  return s ? new Date(s).toLocaleString(uiLocale()) : 'N/A'
}
function d(s: string | null) {
  return s ? new Date(s).toLocaleDateString(uiLocale()) : t('admin.never')
}
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
}

// Click-to-copy user id in the profile header (same behaviour the shared
// AdminDetailHeader gave this page before it got its own profile hero).
const idCopied = ref(false)
async function copyUserId(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    idCopied.value = true
    setTimeout(() => (idCopied.value = false), 1500)
  } catch {
    /* clipboard blocked */
  }
}
function shortId(v: string): string {
  return v.length > 16 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v
}

const isSelf = computed(() => user.value?.id === auth.user?.id)
/** Display currency for the transaction table's "≈" line: the top-nav toggle. */
const walletCur = computed(() => money.currency.value)

/**
 * This route is `allowedRoles: ['admin','finance']` — a Contabil reaches it
 * by clicking a buyer name in the Facturi table. But only the wallet,
 * invoice and billing-profile endpoints are `admin`+`finance`; everything
 * that edits the ACCOUNT (`PATCH /admin/users/:id`,
 * `POST /admin/users/:id/password`, `PATCH /admin/companies/:id/status`) and
 * the company detail page behind "Administrează"
 * (`GET /admin/companies/:id`) are admin-only. Those controls used to render
 * with no gating at all, so a finance viewer got a full set of buttons that
 * each 403'd on click — or, for "Administrează", a link that ejected them to
 * /account. Mirrors the lock pattern in `AdminFinanceExpensesView`.
 */
const isAdmin = computed(() => auth.user?.platformRoles.includes('admin') ?? false)

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

/**
 * The billing identity this user's invoices are made out to. `PATCH
 * /admin/users/:id/billing-profile` is `admin`+`finance` on the backend but
 * had ZERO frontend callers — a dead endpoint, and no way for anyone on
 * staff to correct a wrong CUI/address while looking at the invoices it was
 * snapshotted onto. Deliberately the SAME field set as the customer's own
 * form in `AccountView.vue`, because the backend shares the DTO.
 */
const bf = reactive({
  kind: 'individual' as BillingKind,
  name: '',
  taxId: '',
  regCom: '',
  vatPayer: false,
  address: '',
  city: '',
  county: '',
  postalCode: '',
  country: 'RO',
  billingEmail: '',
  iban: '',
  bankName: '',
})
const savingBilling = ref(false)
const billingValid = computed(
  () =>
    bf.name.trim().length > 1 &&
    bf.address.trim().length > 2 &&
    bf.city.trim().length > 1 &&
    (bf.kind === 'individual' || (bf.taxId.trim().length > 1 && bf.regCom.trim().length > 1)),
)

function hydrateBilling(u: AdminUserDetail) {
  const p = u.billingProfile
  if (!p) return
  bf.kind = p.kind
  bf.name = p.name
  bf.taxId = p.taxId ?? ''
  bf.regCom = p.regCom ?? ''
  bf.vatPayer = p.vatPayer
  bf.address = p.address
  bf.city = p.city
  bf.county = p.county ?? ''
  bf.postalCode = p.postalCode ?? ''
  bf.country = p.country
  bf.billingEmail = p.billingEmail ?? ''
  bf.iban = p.iban ?? ''
  bf.bankName = p.bankName ?? ''
}

async function saveBilling() {
  if (!billingValid.value || savingBilling.value) return
  savingBilling.value = true
  try {
    const res = await admin.updateUserBillingProfile(id.value, {
      kind: bf.kind,
      name: bf.name.trim(),
      taxId: bf.kind === 'company' ? bf.taxId.trim() : undefined,
      regCom: bf.kind === 'company' ? bf.regCom.trim() : undefined,
      vatPayer: bf.vatPayer,
      address: bf.address.trim(),
      city: bf.city.trim(),
      county: bf.county.trim() || undefined,
      postalCode: bf.postalCode.trim() || undefined,
      country: bf.country.trim() || 'RO',
      billingEmail: bf.billingEmail.trim() || undefined,
      iban: bf.iban.trim() || undefined,
      bankName: bf.bankName.trim() || undefined,
    })
    // Completing a previously-incomplete profile also backfills the pending
    // invoices server-side, so the detail payload (and its invoice list) has
    // to be re-read rather than patched locally.
    await load()
    flash(
      res.invoicesIssued > 0
        ? t('account.billingSavedBackfilled', { n: res.invoicesIssued })
        : t('account.billingSaved'),
    )
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    savingBilling.value = false
  }
}

function hydrate(u: AdminUserDetail) {
  user.value = u
  form.name = u.name
  form.email = u.email
  form.status = u.status
  form.roles = [...u.platformRoles]
  hydrateBilling(u)
  if (refundAmount.value == null) refundAmount.value = u.wallet.refundable.credits || null
}

/** The whole page hangs off this one fetch. It used to have no `catch`, so a
 *  failure (a 403 for a non-admin staffer who reached this page from the
 *  Facturi table, a deleted user's 404, a dropped connection) logged an
 *  unhandled rejection and left an entirely blank page behind the spinner —
 *  nothing rendered, because every block below is inside `v-else-if="user"`.
 *  Now the reason is surfaced instead. */
const loadError = ref<string | null>(null)
async function load() {
  loading.value = true
  try {
    hydrate(await admin.fetchUser(id.value))
    loadError.value = null
  } catch (e) {
    loadError.value = errText(e, t('admin.genericError'))
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

/**
 * Returns whether `fn` actually succeeded. Two things this fixes:
 * - Re-entrancy: Vuetify's `loading` state only sets `pointer-events: none`
 *   on the button (blocks a mouse click, not a keyboard-dispatched Enter on
 *   an already-focused button), so without this guard a double-Enter could
 *   fire a wallet adjustment or refund twice before the first round-trip
 *   even returns.
 * - Callers used to chain `.then()` onto this to clear a form on completion
 *   — but a caught error still resolves the promise, so those `.then()`s
 *   ran (and wiped what the admin typed) on FAILURE too. Call sites now
 *   check the returned boolean before clearing anything.
 */
async function run<T>(
  key: string,
  fn: () => Promise<T>,
  okMsg: string | ((result: T) => string),
): Promise<{ ok: boolean; value?: T }> {
  if (busy.value) return { ok: false }
  busy.value = key
  try {
    const value = await fn()
    await load()
    flash(typeof okMsg === 'function' ? okMsg(value) : okMsg)
    return { ok: true, value }
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
    return { ok: false }
  } finally {
    busy.value = null
  }
}

async function saveDetails() {
  if (savingDetails.value) return
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
  const doIt = async () => {
    await run(
      'ban',
      () => admin.updateUser(id.value, { status: suspend ? 'suspended' : 'active' }),
      t(suspend ? 'admin.userBanned' : 'admin.userUnbanned'),
    )
  }
  if (suspend) confirm.ask(t('admin.banUser'), t('admin.banUserConfirm'), doIt)
  else void doIt()
}

function runUserAction(key: 'disableTotp' | 'revokeSessions') {
  void run(key, () => admin.updateUser(id.value, { [key]: true }), t(`admin.${key}Done`))
}

async function savePassword() {
  if (newPassword.value.length < 8 || savingPassword.value || isSelf.value) return
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
  if (isSelf.value) return
  const blocked = !user.value?.wallet.blocked
  void run(
    'walletBlock',
    () => admin.blockWallet(id.value, blocked, blocked ? blockReason.value.trim() : undefined),
    t(blocked ? 'admin.walletBlocked' : 'admin.walletUnblocked'),
  ).then(({ ok }) => {
    if (ok) blockReason.value = ''
  })
}

function submitAdjust() {
  if (!adjust.credits || adjust.reason.trim().length < 3 || isSelf.value) return
  const requested = adjust.credits
  void run(
    'adjust',
    () => admin.adjustWallet(id.value, requested, adjust.reason.trim()),
    (detail) => {
      const applied = detail.lastAdjustment?.appliedCredits ?? requested
      return Math.abs(applied) !== Math.abs(requested)
        ? t('admin.walletAdjustedClamped', {
            applied: fmtCr(Math.abs(applied)),
            requested: fmtCr(Math.abs(requested)),
          })
        : t('admin.walletAdjusted')
    },
  ).then(({ ok }) => {
    if (ok) {
      adjust.credits = null
      adjust.reason = ''
    }
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
        ({ ok }) => {
          if (ok) refundAmount.value = null
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
  ).then(({ ok }) => {
    // `run()` already re-hydrates `user.value.transactions` — only the
    // Activity tab's OWN paginated/filtered view (once it's been used)
    // needs its own refresh on top of that.
    if (ok && activityOverride.value !== null) void loadActivity(false)
  })
}
function daysLeft(processAt: string): number {
  return Math.max(0, Math.ceil((new Date(processAt).getTime() - Date.now()) / 86_400_000))
}

// --- Activity tab: paginated/filterable, on top of the ≤20 unfiltered rows
// already embedded in the user-detail payload above. `activityOverride`
// stays null (falling back to that embedded snapshot) until a filter is
// used or the tab is opened for the first time, at which point it takes
// over so "load more" has a real cursor to continue from. -----------------
type ActivityType = '' | AdminUserTxn['type']
const activityOverride = ref<AdminUserTxn[] | null>(null)
const activityCursor = ref<string | null>(null)
const activityLoading = ref(false)
const activityFilterType = ref<ActivityType>('')
const activitySearch = ref('')
const activityTxns = computed(() => activityOverride.value ?? user.value?.transactions ?? [])
const activityHasFilters = computed(() => !!activityFilterType.value || !!activitySearch.value)
const ACTIVITY_TYPE_OPTIONS: AdminUserTxn['type'][] = ['purchase', 'spend', 'refund', 'adjustment']

// Bumped on every call — a reply is discarded if a newer request has
// started by the time it resolves, so an overlapping type-filter change +
// debounced search (or two rapid filter changes) can never land out of
// order and show results that don't match the currently-visible filters.
let activitySeq = 0
async function loadActivity(append: boolean): Promise<void> {
  const seq = ++activitySeq
  activityLoading.value = true
  try {
    const res = await admin.listUserTransactions(id.value, {
      cursor: append ? (activityCursor.value ?? undefined) : undefined,
      type: activityFilterType.value || undefined,
      search: activitySearch.value || undefined,
    })
    if (seq !== activitySeq) return
    activityOverride.value = append ? [...(activityOverride.value ?? []), ...res.items] : res.items
    activityCursor.value = res.nextCursor
  } catch (e) {
    if (seq !== activitySeq) return
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    // A superseded request's `finally` must not clear the spinner out from
    // under a still-in-flight newer one.
    if (seq === activitySeq) activityLoading.value = false
  }
}
function clearActivityFilters(): void {
  activityFilterType.value = ''
  activitySearch.value = ''
  activityOverride.value = null
  activityCursor.value = null
}
watch(activityFilterType, () => void loadActivity(false))
// Typing a search term shouldn't fire a request per keystroke.
let activitySearchDebounce: ReturnType<typeof setTimeout> | undefined
watch(activitySearch, () => {
  clearTimeout(activitySearchDebounce)
  activitySearchDebounce = setTimeout(() => void loadActivity(false), 300)
})
// First time the tab is actually opened, switch from the embedded snapshot
// to the real paginated endpoint so "load more" has a cursor to work with.
watch(tab, (v) => {
  if (v === 'activity' && activityOverride.value === null) void loadActivity(false)
}, { immediate: true })

function companyStatus(c: AdminUserCompany, status: 'active' | 'suspended') {
  const go = async () => {
    await run(
      'co-' + c.id,
      () => admin.setCompanyStatus(c.id, status),
      t(status === 'suspended' ? 'admin.bizSuspended' : 'admin.bizUnsuspended'),
    )
  }
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
      <RouterLink :to="{ name: 'admin-users' }" class="ud__back">
        <v-icon icon="mdi-arrow-left" size="15" />
        {{ t('admin.backToUsers') }}
      </RouterLink>

      <!-- ============ PROFILE HERO ============ -->
      <section class="hero" :class="{ 'hero--off': user.status !== 'active' }">
        <div class="hero__cover" aria-hidden="true" />
        <div class="hero__body">
          <div class="hero__top">
            <span class="hero__av">{{ initials(user.name) }}</span>
            <!-- `PATCH /admin/users/:id` is admin-only. -->
            <div v-if="!isSelf && isAdmin" class="hero__actions">
              <v-btn
                :color="user.status === 'active' ? 'error' : 'success'"
                :variant="user.status === 'active' ? 'tonal' : 'flat'"
                size="small"
                rounded="pill"
                :loading="busy === 'ban'"
                :prepend-icon="
                  user.status === 'active' ? 'mdi-account-cancel-outline' : 'mdi-account-check-outline'
                "
                @click="setBan(user.status === 'active')"
              >
                {{ user.status === 'active' ? t('admin.banUser') : t('admin.unbanUser') }}
              </v-btn>
            </div>
          </div>

          <div class="hero__id">
            <h1 class="hero__name">{{ user.name }}</h1>
            <div class="hero__sub">
              <span class="hero__mail">
                <v-icon icon="mdi-email-outline" size="15" />
                {{ user.email }}
              </span>
              <button type="button" class="hero__idbtn" @click="copyUserId(user.id)">
                <v-icon :icon="idCopied ? 'mdi-check' : 'mdi-content-copy'" size="12" />
                {{ shortId(user.id) }}
              </button>
            </div>
            <div class="hero__pills">
              <v-chip
                size="small"
                :color="user.status === 'active' ? 'success' : 'error'"
                variant="tonal"
              >
                {{
                  user.status === 'active'
                    ? t('dashboard.statusActive')
                    : t('dashboard.statusSuspended')
                }}
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
                variant="tonal"
                :prepend-icon="user.twoFactorEnabled ? 'mdi-shield-check' : 'mdi-shield-off-outline'"
                :color="user.twoFactorEnabled ? 'success' : undefined"
                :class="{ 'tvz-chip-neutral': !user.twoFactorEnabled }"
              >
                {{ user.twoFactorEnabled ? t('account.twoFaOn') : t('account.twoFaOff') }}
              </v-chip>
              <v-chip v-if="isSelf" size="small" color="primary" variant="text">
                {{ t('admin.thisIsYou') }}
              </v-chip>
            </div>
          </div>
        </div>

        <dl class="hero__stats">
          <div class="hstat">
            <v-icon icon="mdi-calendar-account-outline" size="18" class="hstat__ic" />
            <dt>{{ t('admin.metaJoined') }}</dt>
            <dd>{{ d(user.createdAt) }}</dd>
          </div>
          <div class="hstat">
            <v-icon icon="mdi-login-variant" size="18" class="hstat__ic" />
            <dt>{{ t('admin.colLastLogin') }}</dt>
            <dd>{{ d(user.lastLoginAt) }}</dd>
          </div>
          <div class="hstat">
            <v-icon icon="mdi-domain" size="18" class="hstat__ic" />
            <dt>{{ t('admin.navBusinesses') }}</dt>
            <dd>{{ user.companies.length }}</dd>
          </div>
          <div class="hstat">
            <v-icon icon="mdi-wallet-outline" size="18" class="hstat__ic" />
            <dt>{{ t('admin.walletTitle') }}</dt>
            <dd>
              {{ fmtCr(user.wallet.balance.credits) }}
              <v-icon icon="mdi-poker-chip" size="0.7em" class="hstat__unit" />
            </dd>
          </div>
        </dl>
      </section>

      <v-tabs v-model="tab" color="primary" class="ud__tabs" show-arrows>
        <v-tab value="overview" prepend-icon="mdi-account-outline">{{ t('admin.tabOverview') }}</v-tab>
        <v-tab value="wallet" prepend-icon="mdi-wallet-outline">{{ t('admin.tabWallet') }}</v-tab>
        <v-tab value="invoices" prepend-icon="mdi-receipt-text-outline">{{ t('admin.navInvoices') }}</v-tab>
        <v-tab value="businesses" prepend-icon="mdi-domain">
          {{ t('admin.tabBusinesses') }}
          <span class="ud__tabCount">{{ user.companies.length }}</span>
        </v-tab>
        <v-tab value="activity" prepend-icon="mdi-history">{{ t('admin.tabActivity') }}</v-tab>
        <v-tab v-if="isAdmin" value="google-ads" prepend-icon="mdi-google-ads">
          {{ t('admin.ads.tab') }}
          <span v-if="adsCount !== null" class="ud__tabCount">{{ adsCount }}</span>
        </v-tab>
      </v-tabs>

      <v-window v-model="tab" class="ud__window">
        <!-- ============ OVERVIEW ============ -->
        <v-window-item value="overview">
          <div class="ud__split">
            <div class="ud__stack">
              <!-- Everything a finance-only viewer can't do, said once, instead
                   of four buttons that each 403 on click. The account's name,
                   email, status and roles are all already in the profile header
                   above, so nothing readable is lost by hiding the form itself. -->
              <div v-if="!isAdmin" class="ud__locked">
                <v-icon icon="mdi-lock-outline" size="16" />
                <span>{{ t('admin.adminOnlyHint') }}</span>
              </div>

              <AdminSection
                v-if="isAdmin"
                :title="t('admin.detailsTitle')"
                icon="mdi-card-account-details-outline"
              >
                <div class="ud__form">
                  <div class="ud__formRow">
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
                  </div>
                  <v-select
                    v-model="form.status"
                    :items="[
                      { value: 'active', title: t('dashboard.statusActive') },
                      { value: 'suspended', title: t('dashboard.statusSuspended') },
                    ]"
                    :label="t('admin.colStatus')"
                    :disabled="isSelf"
                    :hint="isSelf ? t('admin.selfStatusHint') : ''"
                    :persistent-hint="isSelf"
                    :hide-details="!isSelf"
                    variant="outlined"
                    density="comfortable"
                  />
                  <div class="ud__roles">
                    <span class="ud__fieldLabel">{{ t('admin.rolesLabel') }}</span>
                    <div class="ud__roleGrid">
                      <label
                        v-for="r in ALL_ROLES"
                        :key="r"
                        class="ud__role"
                        :class="{
                          'ud__role--on': form.roles.includes(r),
                          'ud__role--off': isSelf && r === 'admin',
                        }"
                      >
                        <v-checkbox
                          :model-value="form.roles.includes(r)"
                          :disabled="isSelf && r === 'admin'"
                          color="primary"
                          density="compact"
                          hide-details
                          @update:model-value="toggleRole(r)"
                        />
                        <span>{{ r }}</span>
                      </label>
                    </div>
                  </div>
                  <div class="ud__formActions">
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

              <!-- disable TOTP / revoke sessions / set password are all
                   admin-only (`PATCH /admin/users/:id`,
                   `POST /admin/users/:id/password`). -->
              <AdminSection
                v-if="isAdmin"
                :title="t('admin.securityTitle')"
                icon="mdi-shield-key-outline"
              >
                <p v-if="isSelf" class="ud__note ud__note--top">{{ t('admin.selfSecurityHint') }}</p>
                <div class="sec">
                  <div class="sec__row">
                    <span class="sec__ic" :class="{ 'sec__ic--ok': user.twoFactorEnabled }">
                      <v-icon
                        :icon="user.twoFactorEnabled ? 'mdi-shield-check' : 'mdi-shield-off-outline'"
                        size="18"
                      />
                    </span>
                    <div class="sec__text">
                      <p class="sec__label">{{ t('account.twoFaTitle') }}</p>
                      <p class="sec__val">
                        {{ user.twoFactorEnabled ? t('account.twoFaOn') : t('account.twoFaOff') }}
                      </p>
                    </div>
                    <v-btn
                      variant="tonal"
                      size="small"
                      rounded="pill"
                      :disabled="isSelf || !user.twoFactorEnabled"
                      :loading="busy === 'disableTotp'"
                      prepend-icon="mdi-shield-off-outline"
                      @click="runUserAction('disableTotp')"
                    >
                      {{ t('admin.disableTotp') }}
                    </v-btn>
                  </div>
                  <div class="sec__row">
                    <span class="sec__ic"><v-icon icon="mdi-devices" size="18" /></span>
                    <div class="sec__text">
                      <p class="sec__label">{{ t('account.sessionsTitle') }}</p>
                      <p class="sec__val">{{ user.sessions.length }}</p>
                    </div>
                    <v-btn
                      variant="tonal"
                      size="small"
                      rounded="pill"
                      :disabled="isSelf || !user.sessions.length"
                      :loading="busy === 'revokeSessions'"
                      prepend-icon="mdi-logout-variant"
                      @click="runUserAction('revokeSessions')"
                    >
                      {{ t('admin.revokeSessions') }}
                    </v-btn>
                  </div>
                  <div class="sec__row sec__row--stack">
                    <div class="sec__head">
                      <span class="sec__ic"><v-icon icon="mdi-form-textbox-password" size="18" /></span>
                      <div class="sec__text">
                        <p class="sec__label">{{ t('admin.setPasswordTitle') }}</p>
                        <p class="sec__val">{{ t('admin.setPasswordNote') }}</p>
                      </div>
                    </div>
                    <div class="ud__pwRow">
                      <v-text-field
                        v-model="newPassword"
                        :label="t('account.newPassword')"
                        type="password"
                        variant="outlined"
                        density="compact"
                        hide-details
                        autocomplete="new-password"
                        :disabled="isSelf"
                      />
                      <v-btn
                        variant="flat"
                        color="primary"
                        rounded="pill"
                        :loading="savingPassword"
                        :disabled="isSelf || newPassword.length < 8"
                        @click="savePassword"
                      >
                        {{ t('admin.setPassword') }}
                      </v-btn>
                    </div>
                  </div>
                </div>
              </AdminSection>
            </div>

            <aside class="ud__stack">
              <AdminSection :title="t('admin.accountFactsTitle')" icon="mdi-information-outline">
                <ul class="facts">
                  <li class="facts__row">
                    <v-icon icon="mdi-calendar-plus-outline" size="17" class="facts__ic" />
                    <span class="facts__k">{{ t('admin.metaJoined') }}</span>
                    <span class="facts__v">{{ dt(user.createdAt) }}</span>
                  </li>
                  <li class="facts__row">
                    <v-icon icon="mdi-calendar-edit-outline" size="17" class="facts__ic" />
                    <span class="facts__k">{{ t('admin.updated') }}</span>
                    <span class="facts__v">{{ dt(user.updatedAt) }}</span>
                  </li>
                  <li class="facts__row">
                    <v-icon icon="mdi-key-change" size="17" class="facts__ic" />
                    <span class="facts__k">{{ t('admin.factPasswordChanged') }}</span>
                    <span class="facts__v">{{ dt(user.passwordChangedAt) }}</span>
                  </li>
                </ul>
              </AdminSection>
            </aside>
          </div>
        </v-window-item>

        <!-- ============ WALLET ============ -->
        <v-window-item value="wallet">
          <div class="ud__stack">
            <AdminSection :title="t('admin.walletTitle')" icon="mdi-wallet-outline">
              <template #actions>
                <v-btn
                  :color="user.wallet.blocked ? 'success' : 'error'"
                  variant="tonal"
                  size="small"
                  rounded="pill"
                  :disabled="isSelf"
                  :loading="busy === 'walletBlock'"
                  :prepend-icon="user.wallet.blocked ? 'mdi-lock-open-variant' : 'mdi-lock'"
                  @click="toggleWalletBlock"
                >
                  {{ user.wallet.blocked ? t('admin.unblockWallet') : t('admin.blockWallet') }}
                </v-btn>
              </template>
              <p v-if="isSelf" class="ud__note ud__note--top">{{ t('admin.selfSecurityHint') }}</p>

              <div class="wal">
                <div class="wal__balance" :class="{ 'wal__balance--frozen': user.wallet.blocked }">
                  <span class="wal__label">{{ t('admin.walletTitle') }}</span>
                  <strong>
                    {{ fmtCr(user.wallet.balance.credits) }}
                    <v-icon icon="mdi-poker-chip" size="0.55em" class="wal__unit" />
                  </strong>
                  <span class="wal__eq">{{ ownerEq(user.wallet.balance.credits) }}</span>
                </div>
                <div class="wal__stats">
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
                prepend-inner-icon="mdi-lock-outline"
                variant="outlined"
                density="compact"
                hide-details
                class="wal__reason"
              />
            </AdminSection>

            <div class="ud__pair" :class="{ 'ud__pair--single': !(user.wallet.refundable.credits > 0) }">
              <AdminSection :title="t('admin.adjustTitle')" icon="mdi-tune-vertical">
                <p class="ud__note ud__note--top">
                  {{ isSelf ? t('admin.selfSecurityHint') : t('admin.adjustHint') }}
                </p>
                <div class="ud__inline">
                  <v-text-field
                    v-model.number="adjust.credits"
                    type="number"
                    :label="t('admin.adjustCredits')"
                    variant="outlined"
                    density="compact"
                    hide-details
                    class="ud__inlineNum"
                    :disabled="isSelf"
                  />
                  <v-text-field
                    v-model="adjust.reason"
                    :label="t('admin.adjustReason')"
                    variant="outlined"
                    density="compact"
                    hide-details
                    :disabled="isSelf"
                  />
                  <v-btn
                    variant="flat"
                    color="primary"
                    rounded="pill"
                    :loading="busy === 'adjust'"
                    :disabled="isSelf || !adjust.credits || adjust.reason.trim().length < 3"
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
                <p class="ud__note ud__note--top">
                  {{ t('wallet.refundAvailable', { credits: fmtCr(user.wallet.refundable.credits) }) }}
                </p>
                <div class="ud__inline">
                  <v-text-field
                    v-model.number="refundAmount"
                    type="number"
                    :max="user.wallet.refundable.credits"
                    :label="t('admin.refundAmountLabel')"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                  <v-btn
                    variant="flat"
                    color="primary"
                    rounded="pill"
                    :loading="busy === 'refund'"
                    :disabled="!refundAmountValid"
                    @click="submitRefund"
                  >
                    {{ t('admin.refund') }}
                  </v-btn>
                </div>
              </AdminSection>
            </div>

            <!-- Billing identity — `admin`+`finance`, matching the backend's
                 `PATCH /admin/users/:id/billing-profile`. Same field set as
                 the customer's own form, so a staff edit can't produce a
                 profile shape the self-service form never could. -->
            <AdminSection
              v-if="auth.isFinanceStaff"
              :title="t('account.billingTitle')"
              icon="mdi-file-document-outline"
            >
              <template #actions>
                <v-btn-toggle v-model="bf.kind" mandatory density="compact" divided class="ud__kind">
                  <v-btn value="individual" size="small">{{ t('account.billingKindIndividual') }}</v-btn>
                  <v-btn value="company" size="small">{{ t('account.billingKindCompany') }}</v-btn>
                </v-btn-toggle>
              </template>
              <div v-if="!user.billingProfile" class="ud__callout">
                <v-icon icon="mdi-alert-circle-outline" size="16" />
                <span>{{ t('account.billingIncompleteAlert') }}</span>
              </div>
              <p v-else class="ud__note ud__note--top">{{ t('account.billingNote') }}</p>

              <div class="bill">
                <v-text-field
                  v-model="bf.name"
                  :label="bf.kind === 'company' ? t('account.billingLegalName') : t('account.billingFullName')"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="bill__full"
                />
                <template v-if="bf.kind === 'company'">
                  <v-text-field
                    v-model="bf.taxId"
                    :label="t('account.billingTaxId')"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                  <v-text-field
                    v-model="bf.regCom"
                    :label="t('account.billingRegCom')"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                  <v-checkbox
                    v-model="bf.vatPayer"
                    :label="t('account.billingVatPayer')"
                    color="primary"
                    density="compact"
                    hide-details
                    class="bill__full"
                  />
                </template>
                <v-text-field
                  v-model="bf.address"
                  :label="t('account.billingAddress')"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="bill__full"
                />
                <v-text-field
                  v-model="bf.city"
                  :label="t('account.billingCity')"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
                <v-text-field
                  v-model="bf.county"
                  :label="t('account.billingCounty')"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
                <v-text-field
                  v-model="bf.postalCode"
                  :label="t('account.billingPostalCode')"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
                <v-text-field
                  v-model="bf.country"
                  :label="t('account.billingCountry')"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
                <v-text-field
                  v-model="bf.billingEmail"
                  :label="t('account.billingEmail')"
                  type="email"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="bill__full"
                />
                <template v-if="bf.kind === 'company'">
                  <v-text-field
                    v-model="bf.iban"
                    :label="t('account.billingIban')"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                  <v-text-field
                    v-model="bf.bankName"
                    :label="t('account.billingBankName')"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                </template>
                <div class="bill__full ud__formActions">
                  <v-btn
                    color="primary"
                    variant="flat"
                    rounded="pill"
                    :loading="savingBilling"
                    :disabled="!billingValid"
                    prepend-icon="mdi-content-save-outline"
                    @click="saveBilling"
                  >
                    {{ t('common.save') }}
                  </v-btn>
                </div>
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
            <div v-else class="bizgrid">
              <article v-for="c in user.companies" :key="c.id" class="biz">
                <header class="biz__head">
                  <span class="biz__logo">{{ initials(c.displayName) }}</span>
                  <div class="biz__id">
                    <strong>{{ c.displayName }}</strong>
                    <span class="biz__slug">/{{ c.slug }}</span>
                  </div>
                </header>

                <div class="biz__tags">
                  <v-chip
                    size="x-small"
                    :color="c.status === 'active' ? 'success' : c.status === 'suspended' ? 'error' : 'grey'"
                    variant="tonal"
                  >
                    {{
                      c.status === 'active'
                        ? t('dashboard.statusActive')
                        : c.status === 'suspended'
                          ? t('dashboard.statusSuspended')
                          : t('dashboard.statusDraft')
                    }}
                  </v-chip>
                  <v-chip v-if="c.isOwner" size="x-small" variant="tonal" class="tvz-chip-neutral">
                    {{ t('admin.owner') }}
                  </v-chip>
                  <span v-else class="biz__role">{{ c.role }}</span>
                </div>

                <div class="biz__camp">
                  <v-icon icon="mdi-bullhorn-outline" size="15" class="biz__campIc" />
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
                  <span v-else class="ud__muted">{{ t('admin.noCampaign') }}</span>
                </div>

                <dl class="biz__stats">
                  <div>
                    <dt>{{ t('admin.bizLeads') }}</dt>
                    <dd>{{ c.leadCount }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('admin.bizClicks') }}</dt>
                    <dd>{{ c.clickCount }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('admin.bizConsumed') }}</dt>
                    <dd>{{ fmtCr(c.consumed.credits) }}</dd>
                  </div>
                </dl>

                <!-- `admin-company` has no `allowedRoles` (admin-only) and
                     `GET /admin/companies/:id` is genuinely admin-only, so
                     this link used to eject a finance viewer to /account.
                     `PATCH /admin/companies/:id/status` is admin-only too. -->
                <footer v-if="isAdmin" class="biz__actions">
                  <v-btn
                    :to="{ name: 'admin-company', params: { id: c.id } }"
                    size="small"
                    color="primary"
                    variant="flat"
                    rounded="pill"
                    append-icon="mdi-arrow-right"
                  >
                    {{ t('admin.manageBiz') }}
                  </v-btn>
                  <v-btn
                    v-if="c.isOwner"
                    size="small"
                    variant="tonal"
                    rounded="pill"
                    :color="c.status === 'suspended' ? 'success' : 'error'"
                    :loading="busy === 'co-' + c.id"
                    @click="companyStatus(c, c.status === 'suspended' ? 'active' : 'suspended')"
                  >
                    {{ c.status === 'suspended' ? t('admin.unsuspendBiz') : t('admin.suspendBiz') }}
                  </v-btn>
                </footer>
              </article>
            </div>
          </AdminSection>
        </v-window-item>

        <!-- ============ INVOICES ============ -->
        <v-window-item value="invoices">
          <AdminUserInvoices :user-id="user.id" />
        </v-window-item>

        <!-- ============ GOOGLE ADS ============ -->
        <v-window-item v-if="isAdmin" value="google-ads">
          <AdminUserAds :user-id="user.id" @count="adsCount = $event" />
        </v-window-item>

        <!-- ============ ACTIVITY ============ -->
        <v-window-item value="activity">
          <div class="ud__stack">
            <!-- Reads the staff log, admin-only on the backend. -->
            <AdminUserActivity v-if="isAdmin" :user-id="user.id" />
            <AdminSection :title="t('admin.txnsTitle')" icon="mdi-swap-vertical">
              <template #actions>
                <v-btn
                  v-if="activityTxns.length"
                  :href="
                    admin.userTransactionsExportUrl(id, {
                      type: activityFilterType || undefined,
                      search: activitySearch || undefined,
                    })
                  "
                  variant="tonal"
                  size="small"
                  rounded="pill"
                  prepend-icon="mdi-file-pdf-box"
                >
                  {{ t('transactions.exportPdf') }}
                </v-btn>
              </template>
              <div class="ud__txnFilters">
                <v-text-field
                  v-model="activitySearch"
                  :label="t('transactions.filterId')"
                  :placeholder="t('transactions.filterIdPlaceholder')"
                  prepend-inner-icon="mdi-magnify"
                  density="compact"
                  variant="outlined"
                  hide-details
                  clearable
                />
                <v-select
                  v-model="activityFilterType"
                  :items="[
                    { title: t('transactions.filterAllTypes'), value: '' },
                    ...ACTIVITY_TYPE_OPTIONS.map((v) => ({ title: t('wallet.txnType.' + v), value: v })),
                  ]"
                  :label="t('transactions.filterType')"
                  density="compact"
                  variant="outlined"
                  hide-details
                />
                <v-btn
                  v-if="activityHasFilters"
                  variant="text"
                  size="small"
                  prepend-icon="mdi-filter-remove-outline"
                  @click="clearActivityFilters"
                >
                  {{ t('transactions.clearFilters') }}
                </v-btn>
              </div>

              <AdminEmptyState
                v-if="!activityLoading && !activityTxns.length"
                :text="activityHasFilters ? t('transactions.noneMatch') : t('admin.noTxns')"
                icon="mdi-swap-vertical"
              />
              <div v-else class="ud__tableWrap">
                <table class="ud__table">
                  <thead>
                    <tr>
                      <th>{{ t('wallet.colId') }}</th>
                      <th>{{ t('admin.colType') }}</th>
                      <th>{{ t('invoice.colDescription') }}</th>
                      <th class="num">{{ t('admin.colTotal') }}</th>
                      <th class="num">{{ t('admin.colDate') }}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="tx in activityTxns" :key="tx.id">
                      <td class="ud__txnId" :data-label="t('wallet.colId')">#{{ tx.id.slice(0, 8) }}</td>
                      <td :data-label="t('admin.colType')">
                        <v-chip size="x-small" :color="txnColor[tx.type]" variant="tonal">
                          {{ t('wallet.txnType.' + tx.type) }}
                        </v-chip>
                      </td>
                      <td class="ud__desc">
                        {{ tx.description || 'N/A' }}
                        <span v-if="tx.companyName" class="ud__muted">· {{ tx.companyName }}</span>
                        <span v-if="tx.clicks != null" class="ud__muted">
                          · {{ t('wallet.nClicks', { n: tx.clicks }) }}
                        </span>
                        <span v-if="tx.type === 'refund' && tx.status === 'pending'" class="ud__muted">
                          ·
                          {{
                            t('admin.refundProcessesIn', { d: tx.processAt ? daysLeft(tx.processAt) : 0 })
                          }}
                        </span>
                      </td>
                      <td class="num" :data-label="t('admin.colTotal')">
                        <CreditsValue :credits="tx.amount.credits" :currency="walletCur" signed stacked />
                      </td>
                      <td class="num ud__date" :data-label="t('admin.colDate')">{{ dt(tx.createdAt) }}</td>
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
              <v-btn
                v-if="activityOverride !== null && activityCursor"
                class="ud__more"
                variant="tonal"
                size="small"
                rounded="pill"
                :loading="activityLoading"
                @click="loadActivity(true)"
              >
                {{ t('wallet.loadMore') }}
              </v-btn>
              <p v-else-if="activityOverride === null && user.transactions.length >= 20" class="ud__note">
                {{ t('admin.txnsRecentNote') }}
              </p>
            </AdminSection>

            <div class="ud__pair ud__pair--single">
              <AdminSection :title="t('account.sessionsTitle')" icon="mdi-devices">
                <AdminEmptyState
                  v-if="!user.sessions.length"
                  :text="t('admin.noSessions')"
                  icon="mdi-devices"
                />
                <ul v-else class="sessions">
                  <li v-for="s in user.sessions" :key="s.id" class="sessions__row">
                    <span class="sessions__ic"><v-icon icon="mdi-monitor-cellphone" size="17" /></span>
                    <div class="sessions__text">
                      <span class="sessions__ua">{{ (s.userAgent || t('account.unknownDevice')).slice(0, 60) }}</span>
                      <span class="ud__muted">{{ s.ip || 'N/A' }} · {{ dt(s.createdAt) }}</span>
                    </div>
                  </li>
                </ul>
              </AdminSection>
            </div>
          </div>
        </v-window-item>
      </v-window>
    </template>

    <AdminEmptyState v-else :text="loadError ?? t('admin.genericError')" icon="mdi-alert-circle-outline" />
  </div>
</template>

<style scoped>
/* One spacing unit for the whole page (gaps between cards, grid gutters),
   and layout driven by the page column's own width (container queries),
   since the admin sidebar takes a different share of the screen at each
   size. */
.ud {
  --ud-gap: 1rem;
  max-width: 1320px;
  container-type: inline-size;
}
.ud__center {
  display: grid;
  place-items: center;
  min-height: 320px;
}
.ud__back {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: var(--ud-gap);
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  text-decoration: none;
}
.ud__back:hover {
  color: rgb(var(--v-theme-primary));
}

/* ---------------------------------------------------------------- hero */
.hero {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg, 18px);
  background: var(--tvz-glass-bg);
  backdrop-filter: blur(var(--tvz-glass-blur));
  -webkit-backdrop-filter: blur(var(--tvz-glass-blur));
}
.hero__cover {
  height: 92px;
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(var(--v-theme-primary), 0.55), transparent 60%),
    radial-gradient(90% 120% at 100% 0%, rgba(var(--v-theme-secondary, var(--v-theme-primary)), 0.35), transparent 65%),
    linear-gradient(115deg, rgba(var(--v-theme-primary), 0.22), rgba(var(--v-theme-primary), 0.06));
  border-bottom: 1px solid var(--tvz-hairline);
}
/* A suspended account reads as such at a glance: the cover goes neutral. */
.hero--off .hero__cover {
  background: linear-gradient(115deg, rgba(var(--v-theme-error), 0.28), rgba(var(--v-theme-on-surface), 0.04));
}
.hero__body {
  padding: 0 1.5rem 1.25rem;
}
.hero__top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
}
.hero__av {
  display: grid;
  place-items: center;
  width: 88px;
  height: 88px;
  flex: none;
  margin-top: -44px;
  border-radius: 24px;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.9rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #fff;
  background: var(--tvz-gradient-brand, linear-gradient(115deg, #3f63e8, #6d5ef0));
  box-shadow:
    0 0 0 4px rgb(var(--v-theme-surface)),
    0 10px 28px -10px rgba(var(--v-theme-primary), 0.7);
}
.hero--off .hero__av {
  filter: grayscale(0.7);
}
.hero__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding-top: 0.75rem;
}
.hero__id {
  margin-top: 0.85rem;
  min-width: 0;
}
.hero__name {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: var(--tvz-fs-title);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.12;
  overflow-wrap: anywhere;
}
.hero__sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem 0.8rem;
  margin-top: 0.4rem;
}
.hero__mail {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  font-size: var(--tvz-fs-section);
  color: rgba(var(--v-theme-on-surface), 0.65);
  overflow-wrap: anywhere;
}
.hero__idbtn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.12rem 0.45rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
  transition:
    color 0.14s ease,
    border-color 0.14s ease;
}
.hero__idbtn:hover {
  color: rgb(var(--v-theme-primary));
  border-color: rgba(var(--v-theme-primary), 0.4);
}
.hero__pills {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.85rem;
}

.hero__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
  border-top: 1px solid var(--tvz-hairline);
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.hstat {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 0.65rem;
  align-items: center;
  padding: 0.9rem 1.5rem;
}
@container (max-width: 420px) {
  .hstat {
    column-gap: 0.45rem;
    padding: 0.8rem 0.7rem;
  }
  .hstat dt {
    letter-spacing: 0;
    overflow-wrap: anywhere;
  }
  .hstat dd {
    font-size: var(--tvz-fs-body);
  }
}
/* Hairlines between the cells, whatever the column count. */
.hstat:nth-child(even) {
  border-left: 1px solid var(--tvz-hairline);
}
.hstat:nth-child(n + 3) {
  border-top: 1px solid var(--tvz-hairline);
}
.hstat__ic {
  grid-row: 1 / span 2;
  color: rgb(var(--v-theme-primary));
  opacity: 0.85;
}
.hstat dt {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.hstat dd {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: var(--tvz-fs-lead);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.hstat__unit {
  margin-left: 0.1em;
  opacity: 0.7;
}
@container (min-width: 640px) {
  .hero__stats {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .hstat + .hstat {
    border-left: 1px solid var(--tvz-hairline);
  }
  .hstat:nth-child(n + 3) {
    border-top: none;
  }
}

/* ---------------------------------------------------------------- tabs */
.ud__tabs {
  margin: var(--ud-gap) 0;
  border-bottom: 1px solid var(--tvz-hairline);
}
.ud__tabCount {
  display: inline-grid;
  place-items: center;
  min-width: 1.35rem;
  height: 1.2rem;
  margin-left: 0.4rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  background: rgba(var(--v-theme-on-surface), 0.1);
}
/* keep Vuetify's default `overflow: hidden` on .v-window so the outgoing
   tab pane is never briefly visible sliding out to the side. */

/* -------------------------------------------------------------- layout */
.ud__stack {
  display: flex;
  flex-direction: column;
  gap: var(--ud-gap);
  min-width: 0;
}
/* Overview: main column + facts sidebar; one column when narrow. */
.ud__split {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--ud-gap);
  align-items: start;
}
/* Two cards side by side (adjust + refund, invoices + sessions). */
.ud__pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--ud-gap);
  align-items: start;
}
@container (min-width: 820px) {
  .ud__split {
    grid-template-columns: minmax(0, 1fr) minmax(0, 18rem);
  }
  .ud__pair {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ud__pair--single {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* --------------------------------------------------------------- forms */
.ud__form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.ud__formRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.9rem;
}
@container (min-width: 560px) {
  .ud__formRow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.ud__formActions {
  display: flex;
  justify-content: flex-end;
  padding-top: 0.25rem;
}
.ud__fieldLabel {
  display: block;
  margin-bottom: 0.45rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
/* Roles as selectable tiles; the real v-checkbox inside stays the control. */
.ud__roleGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}
@container (min-width: 560px) {
  .ud__roleGrid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.ud__role {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.1rem 0.75rem 0.1rem 0.2rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 12px;
  font-size: var(--tvz-fs-body);
  font-weight: 600;
  text-transform: capitalize;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.ud__role:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
}
.ud__role--on {
  border-color: rgba(var(--v-theme-primary), 0.55);
  background: rgba(var(--v-theme-primary), 0.08);
}
.ud__role--off {
  cursor: not-allowed;
  opacity: 0.55;
}
.ud__role :deep(.v-checkbox) {
  flex: none;
}
.ud__locked,
.ud__callout {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  font-size: var(--tvz-fs-small);
}
.ud__locked {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.ud__callout {
  margin-bottom: 1rem;
  border: 1px solid rgba(var(--v-theme-warning), 0.35);
  background: rgba(var(--v-theme-warning), 0.08);
  color: rgb(var(--v-theme-on-surface));
}
.ud__callout .v-icon {
  flex: none;
  color: rgb(var(--v-theme-warning));
}
.ud__note {
  margin: 0.7rem 0 0;
  font-size: var(--tvz-fs-caption);
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ud__note--top {
  margin: 0 0 0.9rem;
}

/* ------------------------------------------------------------ security */
.sec {
  display: flex;
  flex-direction: column;
}
.sec__row {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 0;
}
.sec__row + .sec__row {
  border-top: 1px solid var(--tvz-hairline);
}
.sec__row:first-child {
  padding-top: 0;
}
.sec__row:last-child {
  padding-bottom: 0;
}
.sec__row--stack {
  flex-direction: column;
  align-items: stretch;
  gap: 0.75rem;
}
.sec__head {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}
.sec__ic {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.sec__ic--ok {
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}
.sec__text {
  flex: 1;
  min-width: 0;
}
.sec__label {
  margin: 0;
  font-size: var(--tvz-fs-body);
  font-weight: 600;
}
.sec__val {
  margin: 0.1rem 0 0;
  font-size: var(--tvz-fs-small);
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
@container (max-width: 480px) {
  .sec__row:not(.sec__row--stack) {
    flex-wrap: wrap;
  }
  .sec__row:not(.sec__row--stack) .sec__text {
    flex-basis: calc(100% - 36px - 0.85rem);
  }
  .sec__row:not(.sec__row--stack) .v-btn {
    margin-left: calc(36px + 0.85rem);
  }
}

/* --------------------------------------------------------------- facts */
.facts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.facts__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 0.65rem;
  padding: 0.7rem 0;
}
.facts__row + .facts__row {
  border-top: 1px dashed var(--tvz-hairline);
}
.facts__row:first-child {
  padding-top: 0;
}
.facts__row:last-child {
  padding-bottom: 0;
}
.facts__ic {
  grid-row: 1 / span 2;
  margin-top: 0.1rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.facts__k {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.facts__v {
  margin-top: 0.1rem;
  font-size: var(--tvz-fs-body);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* -------------------------------------------------------------- wallet */
.wal {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--ud-gap);
}
@container (min-width: 700px) {
  .wal {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  }
}
.wal__balance {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 1.1rem 1.2rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(var(--v-theme-primary), 0.2), transparent 65%),
    rgba(var(--v-theme-primary), 0.05);
  line-height: 1.1;
}
.wal__balance--frozen {
  border-color: rgba(var(--v-theme-error), 0.35);
  background: rgba(var(--v-theme-error), 0.06);
}
.wal__label {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.wal__balance strong {
  margin-top: 0.45rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: clamp(1.9rem, 5vw, 2.5rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.wal__unit {
  margin-left: 0.12em;
  opacity: 0.7;
  vertical-align: 0.08em;
}
.wal__eq {
  margin-top: 0.35rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.wal__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ud-gap);
}
.wal__reason {
  margin-top: var(--ud-gap);
}
.ud__frozen {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: var(--ud-gap);
  padding: 0.6rem 0.85rem;
  border-radius: 10px;
  background: rgba(var(--v-theme-error), 0.12);
  color: rgb(var(--v-theme-error));
  font-size: var(--tvz-fs-small);
}
.ud__inline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.ud__inline > .v-input {
  flex: 1 1 160px;
  min-width: 0;
}
.ud__inline > .ud__inlineNum {
  flex: 0 1 130px;
}
.ud__inline > .v-btn {
  flex: none;
}

/* billing: two-column field grid, full-width rows where it reads better */
.bill {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
}
@container (min-width: 560px) {
  .bill {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .bill__full {
    grid-column: 1 / -1;
  }
}
.ud__kind :deep(.v-btn) {
  text-transform: none;
}

/* ----------------------------------------------------------- businesses */
.bizgrid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--ud-gap);
}
@container (min-width: 720px) {
  .bizgrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.biz {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem 1.1rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  transition: border-color 0.15s ease;
}
.biz:hover {
  border-color: rgba(var(--v-theme-primary), 0.35);
}
.biz__head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}
.biz__logo {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 11px;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: var(--tvz-fs-body);
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.13);
}
.biz__id {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.biz__id strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: var(--tvz-fs-lead);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.biz__slug {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.45);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.biz__tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.biz__role {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.biz__camp {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.biz__campIc {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.biz__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  border: 1px solid var(--tvz-hairline);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.025);
}
.biz__stats > div {
  padding: 0.55rem 0.7rem;
}
.biz__stats > div + div {
  border-left: 1px solid var(--tvz-hairline);
}
.biz__stats dt {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.biz__stats dd {
  margin: 0.1rem 0 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: var(--tvz-fs-lead);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.biz__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: auto;
  padding-top: 0.8rem;
  border-top: 1px solid var(--tvz-hairline);
}

/* -------------------------------------------------------------- tables */
.ud__txnFilters {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.6rem;
  margin-bottom: 1rem;
}
@container (min-width: 560px) {
  .ud__txnFilters {
    grid-template-columns: minmax(0, 15rem) minmax(0, 13rem) auto;
    justify-content: start;
    align-items: center;
  }
}
.ud__txnFilters > .v-btn {
  justify-self: start;
}
.ud__txnId {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--tvz-fs-caption);
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.45);
  white-space: nowrap;
}
.ud__tableWrap {
  overflow-x: auto;
}
.ud__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--tvz-fs-small);
}
.ud__table th {
  padding: 0.5rem 0.65rem;
  border-bottom: 1px solid var(--tvz-hairline);
  background: rgba(var(--v-theme-on-surface), 0.03);
  text-align: left;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  white-space: nowrap;
}
.ud__table th:first-child {
  border-top-left-radius: 8px;
}
.ud__table th:last-child {
  border-top-right-radius: 8px;
}
.ud__table td {
  padding: 0.65rem;
  border-bottom: 1px solid var(--tvz-hairline);
  vertical-align: middle;
}
.ud__table tbody tr {
  transition: background 0.12s ease;
}
.ud__table tbody tr:hover {
  background: rgba(var(--v-theme-on-surface), 0.025);
}
.ud__table tr:last-child td {
  border-bottom: none;
}
.ud__table .num {
  text-align: right;
  white-space: nowrap;
}
.ud__desc {
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.ud__muted {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ud__date {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ud__txnAction {
  white-space: nowrap;
  text-align: right;
}
.ud__link {
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}
.ud__more {
  margin-top: 0.9rem;
}

/* Mobile: both the Activity and Invoices tables (they share `.ud__table`)
   stop scrolling sideways — each row becomes a card with the free-form
   title (description/invoice number) up top and every other fact on its
   own clearly labeled line, instead of a cramped multi-column strip. */
@media (max-width: 640px) {
  .ud__tableWrap {
    overflow-x: visible;
  }
  .ud__table thead {
    display: none;
  }
  .ud__table,
  .ud__table tbody,
  .ud__table tr {
    display: block;
    width: 100%;
  }
  .ud__table tr {
    display: flex;
    flex-direction: column;
    row-gap: 0.4rem;
    padding: 0.75rem 0;
  }
  .ud__table tbody tr:hover {
    background: none;
  }
  .ud__table tr:not(:last-child) {
    border-bottom: 1px solid var(--tvz-hairline);
  }
  .ud__table td {
    display: block;
    width: 100%;
    padding: 0;
    border-bottom: none;
    text-align: left;
    white-space: normal;
  }
  .ud__table td[data-label] {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    column-gap: 0.75rem;
  }
  .ud__table td[data-label]::before {
    content: attr(data-label);
    flex-shrink: 0;
    font-size: var(--tvz-fs-micro);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(var(--v-theme-on-surface), 0.45);
  }
  .ud__table .ud__txnAction {
    text-align: left;
  }
}

/* ------------------------------------------------------------ sessions */
.sessions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.sessions__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0;
}
.sessions__row + .sessions__row {
  border-top: 1px solid var(--tvz-hairline);
}
.sessions__row:first-child {
  padding-top: 0;
}
.sessions__row:last-child {
  padding-bottom: 0;
}
.sessions__ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.sessions__text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.sessions__ua {
  font-size: var(--tvz-fs-small);
  overflow-wrap: anywhere;
}
.sessions__text .ud__muted {
  font-size: var(--tvz-fs-caption);
}

@container (max-width: 520px) {
  .hero__body {
    padding: 0 1.1rem 1.1rem;
  }
  .hero__av {
    width: 72px;
    height: 72px;
    margin-top: -36px;
    border-radius: 20px;
    font-size: 1.5rem;
  }
  .hstat {
    padding: 0.8rem 1.1rem;
  }
  .wal__stats {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
