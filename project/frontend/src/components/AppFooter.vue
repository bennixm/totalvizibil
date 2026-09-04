<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'

const { t } = useI18n()
const year = new Date().getFullYear()
</script>

<template>
  <v-footer color="transparent" class="tvz-footer pa-0">
    <v-container class="py-10">
      <div class="d-flex flex-column flex-md-row ga-8 justify-space-between">
        <div class="d-flex flex-column ga-3" style="max-width: 32ch">
          <div class="d-flex align-center ga-3">
            <span class="brand__mark">
              <v-icon icon="mdi-compass-outline" size="18" />
            </span>
            <span class="text-h6 font-weight-bold font-display">
              {{ t('app.name') }}
            </span>
          </div>
          <p class="text-body-2 text-medium-emphasis mb-0">{{ t('app.tagline') }}</p>
        </div>

        <div class="d-flex flex-column ga-4 align-start align-md-end">
          <ThemeToggle />
          <div class="d-flex align-center ga-2">
            <span class="text-caption text-medium-emphasis">{{ t('language.label') }}</span>
            <LocaleSwitcher />
          </div>
        </div>
      </div>

      <v-divider class="my-6" />

      <div
        class="d-flex flex-column flex-sm-row ga-3 align-center justify-space-between text-body-2 text-medium-emphasis"
      >
        <span>© {{ year }} {{ t('app.name') }}. {{ t('footer.rights') }}</span>
        <div class="d-flex ga-5">
          <router-link :to="{ name: 'feed' }" class="footer-link">
            {{ t('footer.contact') }}
          </router-link>
        </div>
      </div>
    </v-container>
  </v-footer>
</template>

<style scoped>
.tvz-footer {
  border-top: 1px solid var(--tvz-hairline);
  background: var(--tvz-glass-bg);
}

.brand__mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: #fff;
  background: var(--tvz-gradient-brand);
}

.footer-link {
  color: inherit;
  text-decoration: none;
  transition: color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.footer-link:hover {
  color: rgb(var(--v-theme-primary));
}
</style>
