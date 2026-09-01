<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import CreditsValue from '@/components/CreditsValue.vue'
import { useMoney } from '@/composables/useMoney'
import { useAuthStore, type PlatformRole } from '@/stores/auth'
import { useAdminStore, type AdminUserDetail, type AdminUserCompany } from '@/stores/admin'
import { ApiError } from '@/services/api'

const { t, n } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const admin = useAdminStore()
const money = useMoney()

const id = computed(() => String(route.params.id))
const user = ref<AdminUserDetail | null>(null)
const loading = ref(true)
const toast = reactive({ show: false, text: '', color: 'success' })
function flash(text: string, color: 'success' | 'error' = 'success') {
  Object.assign(toast, { show: true, text, color })
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

const isSelf = computed(() => user.value?.id === auth.user?.id)

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

// Confirm dialog
const confirmState = reactive({
  show: false,
  title: '',
  text: '',
  danger: true,
  run: async () => {},
})
function askConfirm(title: string, text: string, run: () => Promise<void>, danger = true) {
  Object.assign(confirmState, { show: true, title, text, danger, run })
}
async function doConfirm() {
  const fn = confirmState.run
  confirmState.show = false
  await fn()
}

function hydrate(u: AdminUserDetail) {
  user.value = u
  form.name = u.name
  form.email = u.email
  form.status = u.status
  form.roles = [...u.platformRoles]
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
  if (suspend) {
    askConfirm(t('admin.banUser'), t('admin.banUserConfirm'), doIt)
  } else {
    void doIt()
  }
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


function companyStatus(c: AdminUserCompany, status: 'active' | 'suspended') {
  const go = () =>
    run(
      'co-' + c.id,
      () => admin.setCompanyStatus(c.id, status),
      t(status === 'suspended' ? 'admin.bizSuspended' : 'admin.bizUnsuspended'),
    )
  if (status === 'suspended') {
    askConfirm(t('admin.suspendBiz'), t('admin.suspendBizConfirm', { name: c.displayName }), go)
  } else {
    void go()
  }
}

const campColor: Record<string, string> = {
  active: 'success',
  paused: 'warning',
  depleted: 'error',
  draft: 'default',
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
    <v-btn :to="{ name: 'admin-users' }" variant="text" size="small" prepend-icon="mdi-arrow-left">
      {{ t('admin.backToUsers') }}
    </v-btn>

    <div v-if="loading" class="d-flex justify-center py-16">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="user">
      <header class="ud__head">
        <div>
          <h1>{{ user.name }}</h1>
          <span class="ud__mail">{{ user.email }}</span>
          <code class="ud__id">{{ user.id }}</code>
        </div>
        <div class="ud__headActions">
          <div class="ud__badges">
            <v-chip size="small" :color="user.status === 'active' ? 'success' : 'error'" variant="tonal">
              {{ t(`dashboard.status${user.status.charAt(0).toUpperCase()}${user.status.slice(1)}`) }}
            </v-chip>
            <v-chip v-if="user.wallet.blocked" size="small" color="error" variant="flat" prepend-icon="mdi-lock">
              {{ t('admin.walletFrozen') }}
            </v-chip>
            <v-chip v-if="isSelf" size="small" color="primary" variant="outlined">{{ t('admin.thisIsYou') }}</v-chip>
          </div>
          <v-btn
            v-if="!isSelf"
            :color="user.status === 'active' ? 'error' : 'success'"
            :variant="user.status === 'active' ? 'flat' : 'tonal'"
            size="small"
            :loading="busy === 'ban'"
            :prepend-icon="user.status === 'active' ? 'mdi-account-cancel' : 'mdi-account-check'"
            @click="setBan(user.status === 'active')"
          >
            {{ user.status === 'active' ? t('admin.banUser') : t('admin.unbanUser') }}
          </v-btn>
        </div>
      </header>

      <div class="ud__grid">
        <!-- Details -->
        <section class="card">
          <h2>{{ t('admin.detailsTitle') }}</h2>
          <v-text-field v-model="form.name" :label="t('auth.name')" density="comfortable" />
          <v-text-field v-model="form.email" :label="t('auth.email')" type="email" density="comfortable" />
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
          <v-btn
            color="primary"
            variant="flat"
            rounded="pill"
            class="mt-2"
            :loading="savingDetails"
            @click="saveDetails"
          >
            {{ t('common.save') }}
          </v-btn>
        </section>

        <!-- Wallet -->
        <section class="card">
          <h2>{{ t('admin.walletTitle') }}</h2>
          <div class="ud__wallet">
            <div class="ud__balance">
              <strong>{{ fmtCr(user.wallet.balance.credits) }}</strong>
              <span>{{ t('wallet.credits') }}</span>
              <em class="ud__eq">{{ ownerEq(user.wallet.balance.credits) }}</em>
            </div>
            <div class="ud__wstat">
              <span>{{ t('admin.walletPurchased') }}</span>
              <b>{{ fmtCr(user.wallet.purchased.credits) }}</b>
              <em class="ud__eq">{{ ownerEq(user.wallet.purchased.credits) }}</em>
            </div>
            <div class="ud__wstat">
              <span>{{ t('admin.walletSpent') }}</span>
              <b>{{ fmtCr(user.wallet.spent.credits) }}</b>
              <em class="ud__eq">{{ ownerEq(user.wallet.spent.credits) }}</em>
            </div>
          </div>

          <div v-if="user.wallet.blocked" class="ud__frozen">
            <v-icon icon="mdi-lock" size="16" />
            {{ t('admin.walletFrozenNote') }}
            <em v-if="user.wallet.blockedReason">“{{ user.wallet.blockedReason }}”</em>
          </div>
          <v-text-field
            v-if="!user.wallet.blocked"
            v-model="blockReason"
            :label="t('admin.walletBlockReason')"
            density="compact"
            hide-details
            class="mt-2"
          />
          <v-btn
            :color="user.wallet.blocked ? 'success' : 'error'"
            variant="tonal"
            size="small"
            rounded="pill"
            class="mt-2"
            :loading="busy === 'walletBlock'"
            :prepend-icon="user.wallet.blocked ? 'mdi-lock-open-variant' : 'mdi-lock'"
            @click="toggleWalletBlock"
          >
            {{ user.wallet.blocked ? t('admin.unblockWallet') : t('admin.blockWallet') }}
          </v-btn>

          <v-divider class="my-4" />
          <span class="ud__roles-label">{{ t('admin.adjustTitle') }}</span>
          <div class="ud__adjust">
            <v-text-field
              v-model.number="adjust.credits"
              type="number"
              :label="t('admin.adjustCredits')"
              :hint="t('admin.adjustHint')"
              persistent-hint
              density="compact"
              style="max-width: 150px"
            />
            <v-text-field
              v-model="adjust.reason"
              :label="t('admin.adjustReason')"
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
        </section>

        <!-- Security -->
        <section class="card">
          <h2>{{ t('admin.securityTitle') }}</h2>
          <div class="ud__line">
            <span>{{ t('account.twoFaTitle') }}</span>
            <v-chip
              size="x-small"
              :color="user.twoFactorEnabled ? 'success' : undefined"
              variant="tonal"
            >
              {{ user.twoFactorEnabled ? t('account.twoFaOn') : t('account.twoFaOff') }}
            </v-chip>
          </div>
          <div class="d-flex ga-2 flex-wrap mt-2">
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
            <v-btn
              variant="tonal"
              size="small"
              rounded="pill"
              :disabled="!user.sessions.length"
              :loading="busy === 'revokeSessions'"
              prepend-icon="mdi-logout-variant"
              @click="runUserAction('revokeSessions')"
            >
              {{ t('admin.revokeSessions') }} ({{ user.sessions.length }})
            </v-btn>
          </div>

          <v-divider class="my-4" />
          <span class="ud__roles-label">{{ t('admin.setPasswordTitle') }}</span>
          <div class="d-flex ga-2 align-start mt-2">
            <v-text-field
              v-model="newPassword"
              :label="t('account.newPassword')"
              :hint="t('auth.passwordHint')"
              type="password"
              density="comfortable"
              autocomplete="new-password"
            />
            <v-btn
              variant="flat"
              color="primary"
              class="mt-1"
              :loading="savingPassword"
              :disabled="newPassword.length < 8"
              @click="savePassword"
            >
              {{ t('admin.setPassword') }}
            </v-btn>
          </div>
          <p class="ud__note">{{ t('admin.setPasswordNote') }}</p>
        </section>

        <!-- Businesses & campaigns -->
        <section class="card card--wide">
          <h2>{{ t('admin.bizTitle') }} ({{ user.companies.length }})</h2>
          <p v-if="!user.companies.length" class="text-medium-emphasis text-body-2">
            {{ t('admin.noCompanies') }}
          </p>
          <div class="bizgrid">
            <article v-for="c in user.companies" :key="c.id" class="bizcard">
              <div class="bizcard__top">
                <div class="bizcard__id">
                  <strong>{{ c.displayName }}</strong>
                  <span class="bizcard__slug">/{{ c.slug }}</span>
                </div>
                <v-chip
                  size="x-small"
                  :color="c.status === 'active' ? 'success' : c.status === 'suspended' ? 'error' : undefined"
                  variant="tonal"
                >
                  {{ t(`dashboard.status${c.status.charAt(0).toUpperCase()}${c.status.slice(1)}`) }}
                </v-chip>
                <v-chip v-if="c.isOwner" size="x-small" variant="outlined">{{ t('admin.owner') }}</v-chip>
                <span v-else class="bizcard__role">{{ c.role }}</span>
              </div>

              <div class="bizcard__camp">
                <template v-if="c.campaign">
                  <v-chip size="x-small" :color="campColor[c.campaign.status]" variant="flat">
                    {{ t('admin.camp_' + c.campaign.status) }}
                  </v-chip>
                  <span>{{ t('admin.campBudget', { b: fmtCr(c.campaign.dailyBudget.credits), c: fmtCr(c.campaign.cpc.credits) }) }}</span>
                </template>
                <span v-else class="ac__muted">{{ t('admin.noCampaign') }}</span>
              </div>

              <div class="bizcard__stats">
                <div><span>{{ t('admin.bizLeads') }}</span><b>{{ c.leadCount }}</b></div>
                <div><span>{{ t('admin.bizClicks') }}</span><b>{{ c.clickCount }}</b></div>
                <div>
                  <span>{{ t('admin.bizConsumed') }}</span>
                  <b>{{ fmtCr(c.consumed.credits) }}</b>
                  <em class="ud__eq">{{ ownerEq(c.consumed.credits) }}</em>
                </div>
                <div v-if="c.campaign">
                  <span>{{ t('admin.campSpentTodayShort') }}</span>
                  <b>{{ fmtCr(c.campaign.spentToday.credits) }}</b>
                </div>
              </div>

              <div class="bizcard__actions">
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
                  variant="text"
                  :color="c.status === 'suspended' ? 'success' : 'error'"
                  :loading="busy === 'co-' + c.id"
                  @click="companyStatus(c, c.status === 'suspended' ? 'active' : 'suspended')"
                >
                  {{ c.status === 'suspended' ? t('admin.unsuspendBiz') : t('admin.suspendBiz') }}
                </v-btn>
              </div>
            </article>
          </div>
        </section>

        <!-- Transactions -->
        <section class="card card--wide">
          <h2>{{ t('admin.txnsTitle') }} ({{ user.transactions.length }})</h2>
          <p v-if="!user.transactions.length" class="text-medium-emphasis text-body-2">
            {{ t('admin.noTxns') }}
          </p>
          <table v-else class="txn">
            <tbody>
              <tr v-for="tx in user.transactions" :key="tx.id">
                <td>
                  <v-chip size="x-small" :color="txnColor[tx.type]" variant="tonal">{{ t('wallet.txnType.' + tx.type) }}</v-chip>
                </td>
                <td class="txn__desc">
                  {{ tx.description || '—' }}
                  <span v-if="tx.companyName" class="txn__co">· {{ tx.companyName }}</span>
                  <span v-if="tx.clicks != null" class="txn__co">· {{ t('wallet.nClicks', { n: tx.clicks }) }}</span>
                </td>
                <td class="txn__amt" :class="{ 'txn__amt--neg': tx.amount.credits < 0 }">
                  <CreditsValue
                    :credits="tx.amount.credits"
                    :currency="user.wallet.currency === 'RON' ? 'RON' : 'EUR'"
                    signed
                    stacked
                  />
                </td>
                <td class="txn__date">{{ dt(tx.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Sessions -->
        <section class="card">
          <h2>{{ t('account.sessionsTitle') }} ({{ user.sessions.length }})</h2>
          <ul v-if="user.sessions.length" class="ud__list">
            <li v-for="s in user.sessions" :key="s.id">
              <span>{{ (s.userAgent || t('account.unknownDevice')).slice(0, 46) }}</span>
              <span class="ud__list-meta">{{ s.ip || '—' }} · {{ dt(s.createdAt) }}</span>
            </li>
          </ul>
          <p v-else class="text-medium-emphasis text-body-2">{{ t('admin.noSessions') }}</p>
        </section>
      </div>
    </template>

    <v-dialog v-model="confirmState.show" max-width="420">
      <v-card rounded="lg">
        <v-card-title>{{ confirmState.title }}</v-card-title>
        <v-card-text>{{ confirmState.text }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmState.show = false">{{ t('common.cancel') }}</v-btn>
          <v-btn :color="confirmState.danger ? 'error' : 'primary'" variant="flat" @click="doConfirm">
            {{ t('admin.confirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="toast.show" :color="toast.color" timeout="2600">{{ toast.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.ud__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  margin: 0.6rem 0 1.5rem;
}
.ud__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.3rem, 3vw, 1.7rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.ud__mail {
  color: rgb(var(--v-theme-on-surface) / 0.6);
  font-size: 0.9rem;
}
.ud__id {
  display: block;
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.4);
  margin-top: 0.2rem;
}
.ud__headActions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.6rem;
}
.ud__badges {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.ud__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}
.card {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 1.3rem;
}
.card--wide {
  grid-column: 1 / -1;
}
.card h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 1rem;
}
.ud__roles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  align-items: center;
  margin: 0.4rem 0 0.6rem;
}
.ud__roles-label {
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  width: 100%;
}
.ud__line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.9rem;
}
.ud__note {
  font-size: 0.75rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  margin: 0.6rem 0 0;
}
.ud__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  font-size: 0.86rem;
}
.ud__list li {
  display: flex;
  flex-direction: column;
}
.ud__list-meta {
  font-size: 0.74rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

/* Wallet */
.ud__wallet {
  display: flex;
  align-items: flex-end;
  gap: 1.4rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;
}
.ud__balance {
  display: flex;
  flex-direction: column;
  line-height: 1;
}
.ud__balance strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.9rem;
  font-weight: 700;
}
.ud__balance span {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  margin-top: 0.25rem;
}
.ud__wstat {
  display: flex;
  flex-direction: column;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.ud__wstat b {
  font-size: 0.95rem;
  color: rgb(var(--v-theme-on-surface));
}
.ud__eq {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.72rem;
  font-style: normal;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.ud__frozen {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-top: 0.6rem;
  padding: 0.5rem 0.7rem;
  border-radius: 8px;
  background: rgb(var(--v-theme-error) / 0.12);
  color: rgb(var(--v-theme-error));
  font-size: 0.78rem;
}
.ud__adjust {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}

/* Businesses */
.ac__muted {
  color: rgb(var(--v-theme-on-surface) / 0.5);
  font-size: 0.8rem;
}
.bizgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.9rem;
}
.bizcard {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 1rem 1.1rem 1.1rem;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-primary)) 20%, transparent);
  background: linear-gradient(
    155deg,
    rgb(var(--v-theme-primary) / 0.14) 0%,
    rgb(var(--v-theme-primary) / 0.04) 45%,
    rgb(var(--v-theme-surface)) 100%
  );
}
.bizcard__top {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.bizcard__id {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
  margin-right: auto;
  min-width: 0;
}
.bizcard__id strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.95rem;
}
.bizcard__slug {
  font-size: 0.68rem;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.bizcard__role {
  font-size: 0.7rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.bizcard__camp {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.bizcard__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(64px, 1fr));
  gap: 0.4rem;
}
.bizcard__stats > div {
  padding: 0.4rem 0.5rem;
  border-radius: 9px;
  background: rgb(var(--v-theme-surface) / 0.6);
  border: 1px solid var(--tvz-hairline);
}
.bizcard__stats span {
  display: block;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.bizcard__stats b {
  font-size: 0.9rem;
}
.bizcard__actions {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 0.3rem;
}

/* Transactions */
.txn {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.txn td {
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid var(--tvz-hairline);
  vertical-align: middle;
}
.txn tr:last-child td {
  border-bottom: none;
}
.txn__desc {
  color: rgb(var(--v-theme-on-surface) / 0.8);
}
.txn__co {
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.txn__amt {
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-success));
  white-space: nowrap;
}
.txn__amt--neg {
  color: rgb(var(--v-theme-error));
}
.txn__date {
  text-align: right;
  white-space: nowrap;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  font-size: 0.74rem;
}
</style>
