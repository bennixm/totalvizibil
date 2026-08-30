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

const { t } = useI18n()
const { mdAndUp } = useDisplay()
const router = useRouter()
const auth = useAuthStore()
const companies = useCompaniesStore()
const { overview, currentId } = storeToRefs(companies)

const menuOpen = ref(false)

const navLinks = computed(() => {
  const items = [{ to: { name: 'feed' }, key: 'nav.discover', icon: 'mdi-compass-outline' }]
  if (auth.isAuthenticated) {
    items.push({ to: { name: 'dashboard' }, key: 'nav.dashboard', icon: 'mdi-view-dashboard-outline' })
  }
  return items
})

const accountLinks = computed(() => {
  const items = [
    { to: { name: 'dashboard' }, key: 'nav.dashboard', icon: 'mdi-view-dashboard-outline' },
    { to: { name: 'leads' }, key: 'nav.leads', icon: 'mdi-inbox-arrow-down-outline' },
    { to: { name: 'wallet' }, key: 'nav.wallet', icon: 'mdi-wallet-outline' },
    { to: { name: 'account' }, key: 'nav.account', icon: 'mdi-account-cog-outline' },
  ]
  if (auth.isPlatformStaff) {
    items.push({ to: { name: 'admin-dashboard' }, key: 'nav.admin', icon: 'mdi-shield-crown-outline' })
  }
  return items
})

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

          <v-card class="menu" rounded="xl" :elevation="14">
            <header class="menu__head">
              <span class="menu__av">{{ initials }}</span>
              <div class="menu__id">
                <strong>{{ auth.user?.name }}</strong>
                <span>{{ auth.user?.email }}</span>
              </div>
            </header>

            <div class="menu__scroll">
              <section class="menu__sec">
                <p class="menu__label">{{ t('nav.myBusinesses') }}</p>
                <button
                  v-for="c in overview"
                  :key="c.id"
                  type="button"
                  class="menu__row menu__biz"
                  :class="{ 'is-current': c.id === currentId }"
                  @click="pickCompany(c.id)"
                >
                  <span class="menu__bizDot" :class="`t-${STATUS_TONE[c.status] || 'idle'}`" />
                  <span class="menu__bizName">{{ c.displayName }}</span>
                  <span
                    class="menu__chip"
                    :class="c.campaignStatus === 'active' ? 'menu__chip--live' : ''"
                  >
                    {{ c.campaignStatus === 'active' ? t('nav.bizLive') : t('nav.bizDraft') }}
                  </span>
                </button>
                <p v-if="!overview.length" class="menu__empty">{{ t('nav.noBusinesses') }}</p>
                <button type="button" class="menu__row menu__row--add" @click="go({ name: 'create' })">
                  <span class="menu__ic menu__ic--add"><v-icon icon="mdi-plus" size="16" /></span>
                  <span>{{ t('nav.addBusiness') }}</span>
                </button>
              </section>

              <div class="menu__divider" />

              <section class="menu__sec">
                <button
                  v-for="link in accountLinks"
                  :key="link.key"
                  type="button"
                  class="menu__row"
                  @click="go(link.to)"
                >
                  <span class="menu__ic"><v-icon :icon="link.icon" size="16" /></span>
                  <span>{{ t(link.key) }}</span>
                  <v-icon class="menu__chev" icon="mdi-chevron-right" size="16" />
                </button>
              </section>

              <div class="menu__divider" />

              <section class="menu__sec">
                <button type="button" class="menu__row menu__row--danger" @click="signOut">
                  <span class="menu__ic menu__ic--danger"><v-icon icon="mdi-logout" size="16" /></span>
                  <span>{{ t('account.signOut') }}</span>
                </button>
              </section>
            </div>
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
  width: min(21.5rem, calc(100vw - 1.5rem));
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-on-surface) / 0.08);
}
.menu__head {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 1.15rem 1.15rem 1rem;
  background:
    radial-gradient(120% 120% at 0% 0%, rgb(var(--v-theme-primary) / 0.16), transparent 60%),
    rgb(var(--v-theme-primary) / 0.05);
  border-bottom: 1px solid rgb(var(--v-theme-on-surface) / 0.08);
}
.menu__av {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  flex: none;
  color: #fff;
  font-size: 0.9rem;
  font-weight: 700;
  background: var(--tvz-gradient-brand, linear-gradient(115deg, #3f63e8, #6d5ef0));
  box-shadow: 0 4px 14px rgb(var(--v-theme-primary) / 0.4);
}
.menu__id {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.35;
}
.menu__id strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.98rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu__id span {
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu__scroll {
  max-height: min(72vh, 32rem);
  overflow-y: auto;
  padding: 0.5rem;
}
.menu__sec {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}
.menu__divider {
  height: 1px;
  margin: 0.5rem 0.35rem;
  background: rgb(var(--v-theme-on-surface) / 0.09);
}
.menu__label {
  margin: 0.5rem 0.7rem 0.35rem;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface) / 0.42);
}
.menu__empty {
  margin: 0.1rem 0.7rem 0.4rem;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

.menu__row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  min-height: 44px;
  padding: 0.45rem 0.6rem;
  border-radius: 12px;
  font-size: 0.9rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface) / 0.92);
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    transform var(--tvz-dur-fast) var(--tvz-ease-out);
}
.menu__row:hover,
.menu__row:focus-visible {
  background: rgb(var(--v-theme-on-surface) / 0.06);
  outline: none;
}
.menu__row:active {
  transform: scale(0.985);
}
.menu__ic {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  flex: none;
  background: rgb(var(--v-theme-on-surface) / 0.07);
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.menu__ic--add {
  background: rgb(var(--v-theme-primary) / 0.14);
  color: rgb(var(--v-theme-primary));
}
.menu__ic--danger {
  background: rgb(var(--v-theme-error) / 0.14);
  color: rgb(var(--v-theme-error));
}
.menu__chev {
  margin-left: auto;
  color: rgb(var(--v-theme-on-surface) / 0.3);
}
.menu__row--add {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.menu__row--danger {
  color: rgb(var(--v-theme-error));
}

.menu__biz.is-current {
  background: rgb(var(--v-theme-primary) / 0.1);
}
.menu__bizDot {
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 9px;
  background: rgb(var(--v-theme-on-surface) / 0.06);
  position: relative;
}
.menu__bizDot::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-on-surface) / 0.4);
}
.menu__bizDot.t-live {
  background: rgb(var(--v-theme-success) / 0.14);
}
.menu__bizDot.t-live::after {
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 3px rgb(var(--v-theme-success) / 0.2);
}
.menu__bizDot.t-error::after {
  background: rgb(var(--v-theme-error));
}
.menu__bizName {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.menu__chip {
  flex: none;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.16rem 0.5rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.menu__chip--live {
  background: rgb(var(--v-theme-success) / 0.16);
  color: rgb(var(--v-theme-success));
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
