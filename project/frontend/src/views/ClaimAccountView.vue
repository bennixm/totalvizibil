<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useDraftStore } from '@/stores/draft'
import { ApiError } from '@/services/api'

const { t } = useI18n()
const router = useRouter()
const draft = useDraftStore()

const name = ref('')
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

const businessName = computed(() => {
  const hero = draft.homePage?.sections.find((s) => s.type === 'hero')
  return (draft.draft?.content.pages[0]?.title as string) ?? (hero?.headline as string) ?? ''
})

onMounted(async () => {
  if (!draft.draft) await draft.load()
  if (!draft.hasDraft) router.replace({ name: 'create' })
})

async function submit() {
  loading.value = true
  error.value = null
  try {
    const { slug } = await draft.claim({
      name: name.value.trim(),
      email: email.value.trim(),
      password: password.value,
    })
    router.push({ name: 'dashboard', query: { published: slug } })
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('claim.error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <v-container class="cl">
    <div class="cl__head">
      <v-btn :to="{ name: 'create-preview' }" variant="text" size="small" prepend-icon="mdi-arrow-left">
        {{ t('claim.backToPreview') }}
      </v-btn>
      <h1>{{ t('claim.title') }}</h1>
      <p class="cl__lead">{{ t('claim.lead') }}</p>
    </div>

    <div class="cl__recap">
      <v-icon icon="mdi-web" size="20" />
      <div>
        <strong>{{ businessName }}</strong>
        <span>{{ t('claim.recap') }}</span>
      </div>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4" :text="error" />

    <v-form class="cl__form" @submit.prevent="submit">
      <v-text-field v-model="name" :label="t('auth.name')" autocomplete="name" autofocus />
      <v-text-field v-model="email" :label="t('auth.email')" type="email" autocomplete="email" />
      <v-text-field
        v-model="password"
        :label="t('auth.password')"
        :hint="t('auth.passwordHint')"
        type="password"
        autocomplete="new-password"
      />
      <v-btn
        type="submit"
        color="primary"
        size="large"
        rounded="pill"
        block
        :loading="loading"
        class="mt-2"
      >
        {{ t('claim.submit') }}
      </v-btn>
    </v-form>

    <p class="cl__foot">
      {{ t('auth.haveAccount') }}
      <router-link :to="{ name: 'login' }">{{ t('auth.loginTitle') }}</router-link>
    </p>
  </v-container>
</template>

<style scoped>
.cl {
  max-width: 460px;
  padding-block: clamp(2rem, 6vw, 4rem);
}
.cl__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.7rem, 4.5vw, 2.3rem);
  letter-spacing: -0.02em;
  margin: 1rem 0 0;
}
.cl__lead {
  margin: 0.6rem 0 1.5rem;
  color: rgb(var(--v-theme-on-surface) / 0.66);
}
.cl__recap {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 1rem 1.1rem;
  border-radius: var(--tvz-radius-md);
  background: var(--tvz-ai-soft);
  border: 1px solid var(--tvz-glass-border);
  margin-bottom: 1.5rem;
}
.cl__recap .v-icon {
  color: var(--tvz-ai);
}
.cl__recap strong {
  display: block;
  font-size: 0.95rem;
}
.cl__recap span {
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.cl__form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.cl__foot {
  text-align: center;
  margin-top: 1.5rem;
  font-size: 0.85rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
</style>
