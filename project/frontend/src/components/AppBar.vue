<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import { useAuthStore } from '@/stores/auth'
import { useCompaniesStore } from '@/stores/companies'

const { t } = useI18n()
const { mdAndUp } = useDisplay()
const router = useRouter()
const auth = useAuthStore()
const companies = useCompaniesStore()

const drawer = ref(false)

const links = computed(() => {
  const base = [
    { to: { name: 'home' }, key: 'nav.home' },
    { to: { name: 'search' }, key: 'nav.search' },
    { to: { name: 'onboarding' }, key: 'nav.forBusiness' },
  ]
  if (auth.isAuthenticated) base.push({ to: { name: 'dashboard' }, key: 'nav.dashboard' })
  return base
})

const initials = computed(() =>
  (auth.user?.name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join(''),
)

async function signOut() {
  drawer.value = false
  await auth.logout()
  companies.reset()
  router.push({ name: 'home' })
}
</script>

<template>
  <v-app-bar :height="72" color="transparent" flat class="tvz-appbar">
    <v-container class="d-flex align-center ga-2 py-0">
      <v-app-bar-nav-icon v-if="!mdAndUp" @click="drawer = !drawer" />

      <router-link
        :to="{ name: 'home' }"
        class="d-flex align-center ga-2 text-decoration-none brand"
      >
        <span class="brand__mark">
          <v-icon icon="mdi-hexagon-multiple-outline" size="22" />
        </span>
        <span class="text-h6 font-weight-bold font-display text-gradient">{{ t('app.name') }}</span>
      </router-link>

      <template v-if="mdAndUp">
        <v-btn
          v-for="link in links"
          :key="link.key"
          :to="link.to"
          variant="text"
          rounded="pill"
          class="text-none ms-1 nav-link"
        >
          {{ t(link.key) }}
        </v-btn>
      </template>

      <v-spacer />

      <LocaleSwitcher />

      <template v-if="auth.isAuthenticated">
        <v-menu location="bottom end">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" rounded="pill" class="text-none">
              <v-avatar color="primary" size="30" class="me-2">
                <span class="text-caption font-weight-bold">{{ initials }}</span>
              </v-avatar>
              <span class="d-none d-sm-inline">{{ auth.user?.name }}</span>
            </v-btn>
          </template>
          <v-list nav density="compact" min-width="200">
            <v-list-item
              :to="{ name: 'dashboard' }"
              prepend-icon="mdi-view-dashboard-outline"
              :title="t('account.dashboard')"
            />
            <v-divider class="my-1" />
            <v-list-item
              prepend-icon="mdi-logout"
              :title="t('account.signOut')"
              @click="signOut"
            />
          </v-list>
        </v-menu>
      </template>
      <template v-else>
        <v-btn
          :to="{ name: 'login' }"
          variant="text"
          rounded="pill"
          class="text-none d-none d-sm-inline-flex"
        >
          {{ t('nav.login') }}
        </v-btn>
        <v-btn
          :to="{ name: 'register' }"
          color="primary"
          variant="flat"
          rounded="pill"
          class="text-none tvz-glow"
        >
          {{ t('nav.register') }}
        </v-btn>
      </template>
    </v-container>
  </v-app-bar>

  <v-navigation-drawer v-model="drawer" temporary class="tvz-glass--strong">
    <v-list nav>
      <v-list-item
        v-for="link in links"
        :key="link.key"
        :to="link.to"
        :title="t(link.key)"
        rounded="lg"
        @click="drawer = false"
      />
      <v-divider class="my-2" />
      <template v-if="auth.isAuthenticated">
        <v-list-item
          prepend-icon="mdi-logout"
          :title="t('account.signOut')"
          rounded="lg"
          @click="signOut"
        />
      </template>
      <template v-else>
        <v-list-item
          :to="{ name: 'login' }"
          :title="t('nav.login')"
          rounded="lg"
          @click="drawer = false"
        />
        <v-list-item
          :to="{ name: 'register' }"
          :title="t('nav.register')"
          rounded="lg"
          @click="drawer = false"
        />
      </template>
    </v-list>
  </v-navigation-drawer>
</template>

<style scoped>
.tvz-appbar {
  background: var(--tvz-glass-bg-strong) !important;
  backdrop-filter: blur(var(--tvz-glass-blur)) saturate(1.6);
  -webkit-backdrop-filter: blur(var(--tvz-glass-blur)) saturate(1.6);
  border-bottom: 1px solid var(--tvz-hairline);
}

.brand__mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: #fff;
  background: var(--tvz-gradient-brand);
  box-shadow: var(--tvz-glow-primary);
}

.nav-link {
  opacity: 0.78;
  transition: opacity var(--tvz-dur-fast) var(--tvz-ease-out);
}
.nav-link:hover,
.nav-link.router-link-active {
  opacity: 1;
}
</style>
