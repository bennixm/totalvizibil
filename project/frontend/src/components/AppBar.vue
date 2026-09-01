<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import { storeToRefs } from 'pinia'

import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import ThemeQuickToggle from '@/components/ThemeQuickToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { useCompaniesStore } from '@/stores/companies'
import { useMoneyStore } from '@/stores/money'

const { t } = useI18n()
const { mdAndUp } = useDisplay()
const router = useRouter()
const auth = useAuthStore()
const companies = useCompaniesStore()
const money = useMoneyStore()
const { overview, currentId } = storeToRefs(companies)

const menuOpen = ref(false)

const navLinks = computed(() => {
  const items = [{ to: { name: 'feed' }, key: 'nav.discover', icon: 'mdi-compass-outline' }]
  if (auth.isAuthenticated) {
    items.push({ to: { name: 'dashboard' }, key: 'nav.dashboard', icon: 'mdi-view-dashboard-outline' })
  }
  return items
})

// "Go to" — the everyday destinations, one roomy row each.
const goLinks = [
  { to: { name: 'dashboard' }, key: 'nav.dashboard', icon: 'mdi-view-dashboard-outline' },
  { to: { name: 'leads' }, key: 'nav.leads', icon: 'mdi-inbox-arrow-down-outline' },
  { to: { name: 'wallet' }, key: 'nav.wallet', icon: 'mdi-wallet-outline' },
  { to: { name: 'support' }, key: 'nav.support', icon: 'mdi-lifebuoy' },
]

// Staff-only tools.
const staffLinks = computed(() =>
  auth.isPlatformStaff
    ? [
        { to: { name: 'support' }, key: 'nav.supportQueue', icon: 'mdi-face-agent' },
        { to: { name: 'admin-dashboard' }, key: 'nav.admin', icon: 'mdi-shield-crown-outline' },
      ]
    : [],
)

const initials = computed(() =>
  (auth.user?.name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join(''),
)

const STATUS_TONE: Record<string, string> = {
  active: 'live',
  draft: 'idle',
  suspended: 'error',
}

function pickCompany(id: string): void {
  companies.select(id)
  menuOpen.value = false
  void router.push({ name: 'dashboard', query: { c: id } })
}

function go(to: { name: string }): void {
  menuOpen.value = false
  void router.push(to)
}

function signOut(): void {
  menuOpen.value = false
  auth.logout()
  companies.reset()
  money.reset()
  void router.push({ name: 'feed' })
}

async function loadCompanies(): Promise<void> {
  if (auth.isAuthenticated) await companies.fetchOverview().catch(() => {})
}
onMounted(loadCompanies)
watch(() => auth.isAuthenticated, loadCompanies)
</script>

<template>
  <v-app-bar :height="64" color="transparent" flat class="topbar" :class="{ 'topbar--mobile': !mdAndUp }">
    <div class="topbar__inner">
      <router-link :to="{ name: 'feed' }" class="brand" aria-label="Totalvizibil">
        <span class="brand__mark"><v-icon icon="mdi-compass-outline" size="19" /></span>
        <span class="brand__word">{{ t('app.name') }}</span>
      </router-link>

      <nav v-if="mdAndUp" class="navlinks">
        <router-link v-for="link in navLinks" :key="link.key" :to="link.to" class="navlink">
          <v-icon :icon="link.icon" size="18" />
          <span>{{ t(link.key) }}</span>
        </router-link>
      </nav>

      <div class="topbar__spacer" />

      <div class="topbar__actions">
        <v-btn
          v-if="mdAndUp"
          :to="{ name: 'create' }"
          color="primary"
          variant="flat"
          rounded="pill"
          class="text-none create-btn"
          prepend-icon="mdi-creation"
        >
          {{ t('nav.createBusiness') }}
        </v-btn>

        <ThemeQuickToggle />
        <LocaleSwitcher />

        <!-- Account menu -->
        <v-menu
          v-if="auth.isAuthenticated"
          v-model="menuOpen"
          location="bottom end"
          origin="top end"
          transition="scale-transition"
          :close-on-content-click="false"
          content-class="acctmenu"
        >
          <template #activator="{ props }">
            <button v-bind="props" class="avatar-btn" :aria-label="t('account.menu')">
              <span class="avatar-btn__ini">{{ initials }}</span>
            </button>
          </template>

          <v-card class="menu" rounded="0" :elevation="16">
            <header class="menu__head">
              <span class="menu__av">{{ initials }}</span>
              <div class="menu__id">
                <strong>{{ auth.user?.name }}</strong>
                <span>{{ auth.user?.email }}</span>
              </div>
              <span v-if="auth.isPlatformStaff" class="menu__staffTag">{{ t('nav.staff') }}</span>
            </header>

            <div class="menu__scroll">
              <!-- Businesses -->
              <section class="menu__sec">
                <p class="menu__label">{{ t('nav.myBusinesses') }}</p>
                <button
                  v-for="c in overview"
                  :key="c.id"
                  type="button"
                  class="menu__biz"
                  :class="{ 'is-current': c.id === currentId }"
                  @click="pickCompany(c.id)"
                >
                  <span class="menu__bizDot" :class="`t-${STATUS_TONE[c.status] || 'idle'}`" />
                  <span class="menu__bizName">{{ c.displayName }}</span>
                  <span
                    v-if="c.deletionScheduledAt"
                    class="menu__chip menu__chip--del"
                  >{{ t('nav.bizDeleting') }}</span>
                  <span
                    v-else-if="c.campaignStatus === 'active'"
                    class="menu__chip menu__chip--live"
                  >{{ t('nav.bizLive') }}</span>
                  <span v-else class="menu__chip">{{ t('nav.bizDraft') }}</span>
                </button>
                <p v-if="!overview.length" class="menu__empty">{{ t('nav.noBusinesses') }}</p>
                <button type="button" class="menu__biz menu__biz--add" @click="go({ name: 'create' })">
                  <span class="menu__addIco"><v-icon icon="mdi-plus" size="15" /></span>
                  <span class="menu__bizName">{{ t('nav.addBusiness') }}</span>
                </button>
              </section>

              <div class="menu__rule" />

              <!-- Go to -->
              <section class="menu__sec">
                <p class="menu__label">{{ t('nav.manage') }}</p>
                <button
                  v-for="link in goLinks"
                  :key="link.key"
                  type="button"
                  class="menu__row"
                  @click="go(link.to)"
                >
                  <span class="menu__ic"><v-icon :icon="link.icon" size="17" /></span>
                  <span>{{ t(link.key) }}</span>
                </button>
              </section>

              <template v-if="staffLinks.length">
                <div class="menu__rule" />
                <section class="menu__sec">
                  <p class="menu__label">{{ t('nav.staff') }}</p>
                  <button
                    v-for="link in staffLinks"
                    :key="link.key"
                    type="button"
                    class="menu__row"
                    @click="go(link.to)"
                  >
                    <span class="menu__ic menu__ic--staff"><v-icon :icon="link.icon" size="17" /></span>
                    <span>{{ t(link.key) }}</span>
                  </button>
                </section>
              </template>
            </div>

            <footer class="menu__foot">
              <button type="button" class="menu__row" @click="go({ name: 'account' })">
                <span class="menu__ic"><v-icon icon="mdi-account-cog-outline" size="17" /></span>
                <span>{{ t('nav.account') }}</span>
              </button>
              <button type="button" class="menu__row menu__row--danger" @click="signOut">
                <span class="menu__ic menu__ic--danger"><v-icon icon="mdi-logout" size="17" /></span>
                <span>{{ t('account.signOut') }}</span>
              </button>
            </footer>
          </v-card>
        </v-menu>

        <v-btn
          v-else-if="mdAndUp"
          :to="{ name: 'login' }"
          variant="tonal"
          rounded="pill"
          class="text-none"
          prepend-icon="mdi-login-variant"
        >
          {{ t('nav.login') }}
        </v-btn>
        <v-btn
          v-else
          :to="{ name: 'login' }"
          icon="mdi-login-variant"
          variant="text"
          size="small"
          :aria-label="t('nav.login')"
        />
      </div>
    </div>
  </v-app-bar>
</template>

<style scoped>
.topbar {
  background: var(--tvz-glass-bg-strong) !important;
  border-bottom: 1px solid var(--tvz-hairline);
}
.topbar :deep(.v-toolbar__content) {
  padding-inline: 0;
}
.topbar__inner {
  width: 100%;
  max-width: var(--tvz-content-width);
  margin-inline: auto;
  padding-inline: clamp(0.9rem, 3vw, 1.5rem);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.topbar__spacer {
  flex: 1;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  text-decoration: none;
  color: rgb(var(--v-theme-on-surface));
  margin-right: 0.5rem;
}
.brand__mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  color: #fff;
  background: var(--tvz-gradient-brand);
  box-shadow: 0 2px 10px rgba(var(--v-theme-primary), 0.35);
}
.brand__word {
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 1.05rem;
  letter-spacing: -0.02em;
}
.topbar--mobile .brand__word {
  font-size: 1rem;
}

.navlinks {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: 0.75rem;
}
.navlink {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.42rem 0.9rem;
  border-radius: 10px;
  font-size: 0.88rem;
  font-weight: 500;
  text-decoration: none;
  color: rgb(var(--v-theme-on-surface) / 0.66);
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.navlink:hover {
  color: rgb(var(--v-theme-on-surface));
  background: rgb(var(--v-theme-on-surface) / 0.05);
}
.navlink.router-link-active {
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.1);
}
.navlink.router-link-active::after {
  content: '';
  position: absolute;
  left: 0.9rem;
  right: 0.9rem;
  bottom: 3px;
  height: 2px;
  border-radius: 2px;
  background: var(--tvz-gradient-brand);
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.create-btn {
  box-shadow: 0 6px 18px rgba(var(--v-theme-primary), 0.28);
  margin-right: 0.4rem;
}

.avatar-btn {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--tvz-gradient-brand);
  color: #fff;
  margin-left: 0.4rem;
  cursor: pointer;
  border: 0;
  box-shadow: 0 2px 10px rgb(var(--v-theme-primary) / 0.35);
  transition:
    transform var(--tvz-dur-fast) var(--tvz-ease-out),
    box-shadow var(--tvz-dur-fast) var(--tvz-ease-out);
}
.avatar-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgb(var(--v-theme-primary) / 0.45);
}
.avatar-btn__ini {
  font-size: 0.78rem;
  font-weight: 700;
}

/* --- Account dropdown ---------------------------------------------------
   Rendered in a teleported overlay: rely only on Vuetify theme tokens
   (--v-theme-*), never on page-scoped --tvz-* custom properties. */
.menu {
  width: min(23rem, calc(100vw - 1.5rem));
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgb(var(--v-theme-on-surface) / 0.1);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.22), 0 8px 20px rgb(0 0 0 / 0.14);
}

/* Header --------------------------------------------------------------- */
.menu__head {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 1.35rem 1.35rem 1.25rem;
  border-bottom: 1px solid rgb(var(--v-theme-on-surface) / 0.1);
}
.menu__av {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  flex: none;
  color: #fff;
  font-size: 0.88rem;
  font-weight: 700;
  background: var(--tvz-gradient-brand, linear-gradient(115deg, #3f63e8, #6d5ef0));
}
.menu__id {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.4;
}
.menu__id strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.96rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu__id span {
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu__staffTag {
  flex: none;
  margin-left: auto;
  align-self: flex-start;
  font-size: 0.54rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.18rem 0.42rem;
  border-radius: 4px;
  background: rgb(var(--v-theme-primary) / 0.16);
  color: rgb(var(--v-theme-primary));
}

/* Body ---------------------------------------------------------------- */
.menu__scroll {
  max-height: min(68vh, 34rem);
  overflow-y: auto;
  padding: 0.85rem 0.75rem 0.5rem;
}
.menu__sec {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.menu__sec + .menu__sec {
  margin-top: 0.35rem;
}
.menu__rule {
  height: 1px;
  margin: 0.85rem 0.35rem;
  background: rgb(var(--v-theme-on-surface) / 0.1);
}
.menu__label {
  margin: 0.35rem 0.6rem 0.55rem;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface) / 0.4);
}
.menu__empty {
  margin: 0.1rem 0.6rem 0.5rem;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

/* Rows -------------------------------------------------------------- */
.menu__row {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  width: 100%;
  min-height: 46px;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  font-size: 0.92rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface) / 0.9);
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
  transition: background 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}
.menu__row:hover,
.menu__row:focus-visible {
  background: rgb(var(--v-theme-on-surface) / 0.055);
  outline: none;
}
.menu__ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  flex: none;
  background: rgb(var(--v-theme-on-surface) / 0.06);
  color: rgb(var(--v-theme-on-surface) / 0.72);
}
.menu__ic--staff {
  background: rgb(var(--v-theme-primary) / 0.14);
  color: rgb(var(--v-theme-primary));
}
.menu__ic--danger {
  background: rgb(var(--v-theme-error) / 0.12);
  color: rgb(var(--v-theme-error));
}
.menu__row--danger {
  color: rgb(var(--v-theme-error));
}

/* Business rows --------------------------------------------------- */
.menu__biz {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  min-height: 46px;
  padding: 0.55rem 0.65rem 0.55rem 0.75rem;
  border-radius: 8px;
  border: 0;
  border-left: 2px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.14s cubic-bezier(0.22, 1, 0.36, 1),
    border-color 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}
.menu__biz:hover,
.menu__biz:focus-visible {
  background: rgb(var(--v-theme-on-surface) / 0.055);
  outline: none;
}
.menu__biz.is-current {
  border-left-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.06);
}
.menu__biz--add {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
  margin-top: 0.1rem;
}
.menu__bizDot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: rgb(var(--v-theme-on-surface) / 0.32);
  margin-inline: 0.65rem 0.3rem;
}
.menu__bizDot.t-live {
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 3px rgb(var(--v-theme-success) / 0.18);
}
.menu__bizDot.t-error {
  background: rgb(var(--v-theme-error));
}
.menu__addIco {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: none;
  margin-inline: 0.15rem 0.15rem;
  border-radius: 6px;
  background: rgb(var(--v-theme-primary) / 0.14);
  color: rgb(var(--v-theme-primary));
}
.menu__bizName {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.92rem;
  font-weight: 500;
}
.menu__chip {
  flex: none;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.16rem 0.45rem;
  border-radius: 4px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.menu__chip--live {
  background: rgb(var(--v-theme-success) / 0.16);
  color: rgb(var(--v-theme-success));
}
.menu__chip--del {
  background: rgb(var(--v-theme-error) / 0.16);
  color: rgb(var(--v-theme-error));
}

/* Footer ---------------------------------------------------------- */
.menu__foot {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.5rem 0.75rem 0.75rem;
  border-top: 1px solid rgb(var(--v-theme-on-surface) / 0.1);
  background: rgb(var(--v-theme-on-surface) / 0.02);
}
</style>

<style>
/* Overlay content wrapper (teleported, so not scoped): kill the default
   surface box so only our rounded v-card shows — fixes the square-corner
   bleed that was most visible on the light theme. */
.acctmenu.v-overlay__content {
  background: transparent;
  box-shadow: none;
  border-radius: 0;
}
</style>
