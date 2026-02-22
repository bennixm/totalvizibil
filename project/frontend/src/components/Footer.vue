<template>
  <footer class="footer">
    <p>© {{ currentYear }} Copyright @ All rights reserved.</p>
    <nav class="footer-links">
      <router-link to="/">{{ $t('home') }}</router-link>
      <router-link to="/about">{{ $t('about') }}</router-link>
      <router-link to="/contact">{{ $t('contact') }}</router-link>
    </nav>
  </footer>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const currentYear = ref(new Date().getFullYear())
const { t } = useI18n()

</script>

<style scoped>

</style>
