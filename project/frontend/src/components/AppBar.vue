<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDisplay } from 'vuetify'

import LocaleSwitcher from '@/components/LocaleSwitcher.vue'

const { t } = useI18n()
const { mdAndUp } = useDisplay()

const drawer = ref(false)

const links = [
  { to: { name: 'home' }, key: 'nav.home' },
  { to: { name: 'search' }, key: 'nav.search' },
  { to: { name: 'onboarding' }, key: 'nav.forBusiness' },
  { to: { name: 'dashboard' }, key: 'nav.dashboard' },
] as const
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
      <v-list-item
        :to="{ name: 'login' }"
        :title="t('nav.login')"
        rounded="lg"
        @click="drawer = false"
      />
      <v-list-item
        :to="{ name: 'admin' }"
        :title="t('nav.admin')"
        rounded="lg"
        @click="drawer = false"
      />
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
