<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import ThemeQuickToggle from '@/components/ThemeQuickToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { useCompaniesStore } from '@/stores/companies'
import { useDraftStore } from '@/stores/draft'

const { t } = useI18n()
const { mdAndUp } = useDisplay()
const router = useRouter()
const auth = useAuthStore()
const companies = useCompaniesStore()
const draft = useDraftStore()

const links = computed(() => {
  const items = [{ to: { name: 'feed' }, key: 'nav.discover', icon: 'mdi-compass-outline' }]
  if (auth.isAuthenticated) {
    items.push({ to: { name: 'dashboard' }, key: 'nav.dashboard', icon: 'mdi-view-dashboard-outline' })
  }
  return items
})

const createTarget = computed(() => (draft.hasDraft ? { name: 'create-preview' } : { name: 'create' }))
const createLabel = computed(() => (draft.hasDraft ? t('nav.resumeDraft') : t('nav.createBusiness')))

const initials = computed(() =>
  (auth.user?.name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join(''),
)

async function signOut() {
  await auth.logout()
  companies.reset()
  router.push({ name: 'feed' })
}
</script>

<template>
  <v-app-bar :height="64" color="transparent" flat class="topbar" :class="{ 'topbar--mobile': !mdAndUp }">
    <div class="topbar__inner">
      <!-- Brand -->
      <router-link :to="{ name: 'feed' }" class="brand" aria-label="Totalvizibil">
        <span class="brand__mark"><v-icon icon="mdi-compass-outline" size="19" /></span>
        <span class="brand__word">{{ t('app.name') }}</span>
      </router-link>

      <!-- Desktop nav -->
      <nav v-if="mdAndUp" class="navlinks">
        <router-link
          v-for="link in links"
          :key="link.key"
          :to="link.to"
          class="navlink"
        >
          <v-icon :icon="link.icon" size="18" />
          <span>{{ t(link.key) }}</span>
        </router-link>
      </nav>

      <div class="topbar__spacer" />

      <!-- Right cluster -->
      <div class="topbar__actions">
        <ThemeQuickToggle />
        <LocaleSwitcher />

        <template v-if="mdAndUp">
          <span class="topbar__divider" />
          <v-btn
            :to="createTarget"
            color="primary"
            variant="flat"
            rounded="pill"
            class="text-none create-btn"
            prepend-icon="mdi-sparkles"
          >
            {{ createLabel }}
          </v-btn>
        </template>

        <!-- Account -->
        <v-menu v-if="auth.isAuthenticated" location="bottom end" transition="slide-y-transition">
          <template #activator="{ props }">
            <button v-bind="props" class="avatar-btn" :aria-label="t('account.menu')">
              <span class="avatar-btn__ini">{{ initials }}</span>
            </button>
          </template>
          <v-list nav density="comfortable" min-width="220" class="acct-menu">
            <v-list-item class="acct-menu__head" :title="auth.user?.name" :subtitle="auth.user?.email" />
            <v-divider />
            <v-list-item
              :to="{ name: 'dashboard' }"
              prepend-icon="mdi-view-dashboard-outline"
              :title="t('account.dashboard')"
            />
            <v-list-item
              v-if="!mdAndUp"
              :to="createTarget"
              prepend-icon="mdi-sparkles"
              :title="createLabel"
            />
            <v-divider />
            <v-list-item
              prepend-icon="mdi-logout"
              :title="t('account.signOut')"
              base-color="error"
              @click="signOut"
            />
          </v-list>
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
  backdrop-filter: blur(var(--tvz-glass-blur)) saturate(1.5);
  -webkit-backdrop-filter: blur(var(--tvz-glass-blur)) saturate(1.5);
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

/* Brand */
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

/* Desktop nav links */
.navlinks {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: 0.75rem;
}
.navlink {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.42rem 0.85rem;
  border-radius: 999px;
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
  background: rgb(var(--v-theme-primary) / 0.12);
}

/* Right cluster */
.topbar__actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.topbar__divider {
  width: 1px;
  height: 24px;
  background: var(--tvz-hairline);
  margin-inline: 0.35rem;
}
.create-btn {
  box-shadow: 0 6px 18px rgba(var(--v-theme-primary), 0.28);
}

/* Avatar button */
.avatar-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--tvz-gradient-brand);
  color: #fff;
  margin-left: 0.25rem;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.avatar-btn:hover {
  border-color: rgb(var(--v-theme-primary) / 0.4);
}
.avatar-btn__ini {
  font-size: 0.75rem;
  font-weight: 700;
}
.acct-menu {
  border-radius: var(--tvz-radius-md);
}
.acct-menu__head :deep(.v-list-item-title) {
  font-weight: 600;
}
</style>
