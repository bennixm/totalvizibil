<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import { useAuthStore } from '@/stores/auth'
import { useCompaniesStore } from '@/stores/companies'
import { useDraftStore } from '@/stores/draft'

const { t } = useI18n()
const { mdAndUp } = useDisplay()
const router = useRouter()
const auth = useAuthStore()
const companies = useCompaniesStore()
const draft = useDraftStore()

const drawer = ref(false)

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
  router.push({ name: 'feed' })
}
</script>

<template>
  <v-app-bar :height="72" color="transparent" flat class="tvz-appbar">
    <v-container class="d-flex align-center ga-2 py-0">
      <v-app-bar-nav-icon v-if="!mdAndUp" @click="drawer = !drawer" />

      <router-link :to="{ name: 'feed' }" class="d-flex align-center ga-2 text-decoration-none brand">
        <span class="brand__mark"><v-icon icon="mdi-compass-outline" size="20" /></span>
        <span class="text-h6 font-weight-bold font-display">{{ t('app.name') }}</span>
      </router-link>

      <template v-if="mdAndUp">
        <v-btn :to="{ name: 'feed' }" variant="text" rounded="pill" class="text-none ms-3 nav-link">
          {{ t('nav.discover') }}
        </v-btn>
        <v-btn
          v-if="auth.isAuthenticated"
          :to="{ name: 'dashboard' }"
          variant="text"
          rounded="pill"
          class="text-none nav-link"
        >
          {{ t('nav.dashboard') }}
        </v-btn>
      </template>

      <v-spacer />

      <LocaleSwitcher />

      <v-btn
        :to="{ name: draft.hasDraft ? 'create-preview' : 'create' }"
        color="primary"
        variant="flat"
        rounded="pill"
        class="text-none"
        prepend-icon="mdi-sparkles"
      >
        {{ draft.hasDraft ? t('nav.resumeDraft') : t('nav.createBusiness') }}
      </v-btn>

      <template v-if="auth.isAuthenticated">
        <v-menu location="bottom end">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon variant="text" class="ms-1">
              <v-avatar color="primary" size="32">
                <span class="text-caption font-weight-bold">{{ initials }}</span>
              </v-avatar>
            </v-btn>
          </template>
          <v-list nav density="compact" min-width="200">
            <v-list-item
              :to="{ name: 'dashboard' }"
              prepend-icon="mdi-view-dashboard-outline"
              :title="t('account.dashboard')"
            />
            <v-divider class="my-1" />
            <v-list-item prepend-icon="mdi-logout" :title="t('account.signOut')" @click="signOut" />
          </v-list>
        </v-menu>
      </template>
      <v-btn
        v-else
        :to="{ name: 'login' }"
        variant="text"
        rounded="pill"
        class="text-none d-none d-sm-inline-flex"
      >
        {{ t('nav.login') }}
      </v-btn>
    </v-container>
  </v-app-bar>

  <v-navigation-drawer v-model="drawer" temporary class="tvz-glass--strong">
    <v-list nav>
      <v-list-item
        :to="{ name: 'feed' }"
        :title="t('nav.discover')"
        rounded="lg"
        @click="drawer = false"
      />
      <v-list-item
        :to="{ name: 'create' }"
        :title="t('nav.createBusiness')"
        rounded="lg"
        @click="drawer = false"
      />
      <v-divider class="my-2" />
      <template v-if="auth.isAuthenticated">
        <v-list-item
          :to="{ name: 'dashboard' }"
          :title="t('account.dashboard')"
          rounded="lg"
          @click="drawer = false"
        />
        <v-list-item
          prepend-icon="mdi-logout"
          :title="t('account.signOut')"
          rounded="lg"
          @click="signOut"
        />
      </template>
      <v-list-item
        v-else
        :to="{ name: 'login' }"
        :title="t('nav.login')"
        rounded="lg"
        @click="drawer = false"
      />
    </v-list>
  </v-navigation-drawer>
</template>

<style scoped>
.tvz-appbar {
  background: var(--tvz-glass-bg-strong) !important;
  backdrop-filter: blur(var(--tvz-glass-blur)) saturate(1.4);
  -webkit-backdrop-filter: blur(var(--tvz-glass-blur)) saturate(1.4);
  border-bottom: 1px solid var(--tvz-hairline);
}
.brand__mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  color: #fff;
  background: var(--tvz-gradient-brand);
}
.nav-link {
  opacity: 0.72;
  transition: opacity var(--tvz-dur-fast) var(--tvz-ease-out);
}
.nav-link:hover,
.nav-link.router-link-active {
  opacity: 1;
}
</style>
