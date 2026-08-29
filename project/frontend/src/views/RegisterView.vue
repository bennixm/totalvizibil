<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const email = ref('')
const password = ref('')
</script>

<template>
  <v-container class="py-12">
    <v-row justify="center">
      <v-col cols="12" sm="8" md="5" lg="4">
        <v-card border flat class="pa-4">
          <v-card-title class="text-h5 font-weight-bold">
            {{ t('auth.registerTitle') }}
          </v-card-title>
          <v-card-text>
            <v-form @submit.prevent>
              <v-text-field v-model="email" :label="t('auth.email')" type="email" autocomplete="email" />
              <v-text-field
                v-model="password"
                :label="t('auth.password')"
                type="password"
                autocomplete="new-password"
              />
              <v-btn type="submit" color="primary" variant="flat" block class="mt-2">
                {{ t('auth.submitRegister') }}
              </v-btn>
            </v-form>
          </v-card-text>
          <v-card-actions>
            <v-btn :to="{ name: 'login' }" variant="text" size="small">
              {{ t('nav.login') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>
