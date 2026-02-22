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
.footer {
  margin-top: 2rem;
  padding: 1.5rem;
  background-color: #f5f5f5;
  color: #555;
  text-align: center;
  border-top: 1px solid #ddd;
}

.footer-links {
  margin-top: 0.5rem;
  display: flex;
  justify-content: center;
  gap: 1rem;
}

.footer a {
  color: #333;
  text-decoration: none;
  transition: color 0.2s;
}

.footer a:hover {
  color: #42b983;
}
</style>
