<template>
  <nav class="navbar">
    <router-link :to="routeWithLang('/')">{{ t('home') }}</router-link>
    <router-link :to="routeWithLang('/about')">{{ t('about') }}</router-link>
    <router-link :to="routeWithLang('/contact')">{{ t('contact') }}</router-link>

    <div class="ml-auto space-x-2">
      <button @click="changeLang('en')">EN</button>
      <button @click="changeLang('de')">DE</button>
      <button @click="changeLang('ro')">RO</button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import type { SupportedLang } from '@/types/i18n'

const router = useRouter()
const route = useRoute()
const { locale, t } = useI18n()

const routeWithLang = (path: string) => `/${locale.value}${path}`

function changeLang(newLang: SupportedLang) {
  if (locale.value === newLang) return
  locale.value = newLang

  const segments = route.fullPath.split('/')
  segments[1] = newLang
  router.push(segments.join('/'))
}

</script>

<style scoped>
.navbar {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: #eee;
}
.router-link-active {
  font-weight: bold;
}
.ml-auto {
  margin-left: auto;
}
</style>
