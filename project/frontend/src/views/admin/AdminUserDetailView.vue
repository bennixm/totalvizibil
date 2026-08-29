<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { useAuthStore, type PlatformRole } from '@/stores/auth'
import { useAdminStore, type AdminUserDetail } from '@/stores/admin'
import { ApiError } from '@/services/api'

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const admin = useAdminStore()

const id = computed(() => String(route.params.id))
const user = ref<AdminUserDetail | null>(null)
const loading = ref(true)
const toast = reactive({ show: false, text: '', color: 'success' })
function flash(text: string, color: 'success' | 'error' = 'success') {
  Object.assign(toast, { show: true, text, color })
}
function errText(e: unknown, fb: string) {
  return e instanceof ApiError ? e.message : fb
}

const isSelf = computed(() => user.value?.id === auth.user?.id)

const ALL_ROLES: PlatformRole[] = ['admin', 'support', 'finance', 'moderator']
const form = reactive({
  name: '',
  email: '',
  status: 'active' as 'active' | 'suspended',
  roles: [] as PlatformRole[],
})
const newPassword = ref('')
const savingDetails = ref(false)
const savingPassword = ref(false)
const busyAction = ref<string | null>(null)

function hydrate(u: AdminUserDetail) {
  user.value = u
  form.name = u.name
  form.email = u.email
  form.status = u.status
  form.roles = [...u.platformRoles]
}

async function load() {
  loading.value = true
  try {
    hydrate(await admin.fetchUser(id.value))
  } finally {
    loading.value = false
  }
}
onMounted(load)

function toggleRole(r: PlatformRole) {
  const i = form.roles.indexOf(r)
  if (i === -1) form.roles.push(r)
  else form.roles.splice(i, 1)
}

async function saveDetails() {
  savingDetails.value = true
  try {
    hydrate(
      await admin.updateUser(id.value, {
        name: form.name.trim(),
        email: form.email.trim(),
        status: form.status,
        platformRoles: form.roles,
      }),
    )
    flash(t('admin.saved'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    savingDetails.value = false
  }
}

async function runAction(key: 'disableTotp' | 'revokeSessions') {
  busyAction.value = key
  try {
    hydrate(await admin.updateUser(id.value, { [key]: true }))
    flash(t(`admin.${key}Done`))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    busyAction.value = null
  }
}

async function savePassword() {
  if (newPassword.value.length < 8) return
  savingPassword.value = true
  try {
    await admin.setUserPassword(id.value, newPassword.value)
    newPassword.value = ''
    await load()
    flash(t('admin.passwordSet'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    savingPassword.value = false
  }
}
</script>

<template>
  <div class="ud">
    <v-btn :to="{ name: 'admin-users' }" variant="text" size="small" prepend-icon="mdi-arrow-left">
      {{ t('admin.backToUsers') }}
    </v-btn>

    <div v-if="loading" class="d-flex justify-center py-16">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="user">
      <header class="ud__head">
        <div>
          <h1>{{ user.name }}</h1>
          <span class="ud__mail">{{ user.email }}</span>
          <code class="ud__id">{{ user.id }}</code>
        </div>
        <div class="ud__badges">
          <v-chip size="small" :color="user.status === 'active' ? 'success' : 'error'" variant="tonal">
            {{ t(`dashboard.status${user.status.charAt(0).toUpperCase()}${user.status.slice(1)}`) }}
          </v-chip>
          <v-chip v-if="isSelf" size="small" color="primary" variant="outlined">{{ t('admin.thisIsYou') }}</v-chip>
        </div>
      </header>

      <div class="ud__grid">
        <!-- Details -->
        <section class="card">
          <h2>{{ t('admin.detailsTitle') }}</h2>
          <v-text-field v-model="form.name" :label="t('auth.name')" density="comfortable" />
          <v-text-field v-model="form.email" :label="t('auth.email')" type="email" density="comfortable" />
          <v-select
            v-model="form.status"
            :items="[
              { value: 'active', title: t('dashboard.statusActive') },
              { value: 'suspended', title: t('dashboard.statusSuspended') },
            ]"
            :label="t('admin.colStatus')"
            :disabled="isSelf"
            :hint="isSelf ? t('admin.selfStatusHint') : ''"
            persistent-hint
            density="comfortable"
          />
          <div class="ud__roles">
            <span class="ud__roles-label">{{ t('admin.rolesLabel') }}</span>
            <v-checkbox
              v-for="r in ALL_ROLES"
              :key="r"
              :model-value="form.roles.includes(r)"
              :label="r"
              :disabled="isSelf && r === 'admin'"
              color="primary"
              density="compact"
              hide-details
              @update:model-value="toggleRole(r)"
            />
          </div>
          <v-btn
            color="primary"
            variant="flat"
            rounded="pill"
            class="mt-2"
            :loading="savingDetails"
            @click="saveDetails"
          >
            {{ t('common.save') }}
          </v-btn>
        </section>

        <!-- Security -->
        <section class="card">
          <h2>{{ t('admin.securityTitle') }}</h2>
          <div class="ud__line">
            <span>{{ t('account.twoFaTitle') }}</span>
            <v-chip
              size="x-small"
              :color="user.twoFactorEnabled ? 'success' : undefined"
              variant="tonal"
            >
              {{ user.twoFactorEnabled ? t('account.twoFaOn') : t('account.twoFaOff') }}
            </v-chip>
          </div>
          <div class="d-flex ga-2 flex-wrap mt-2">
            <v-btn
              variant="tonal"
              size="small"
              rounded="pill"
              :disabled="!user.twoFactorEnabled"
              :loading="busyAction === 'disableTotp'"
              prepend-icon="mdi-shield-off-outline"
              @click="runAction('disableTotp')"
            >
              {{ t('admin.disableTotp') }}
            </v-btn>
            <v-btn
              variant="tonal"
              size="small"
              rounded="pill"
              :disabled="!user.sessions.length"
              :loading="busyAction === 'revokeSessions'"
              prepend-icon="mdi-logout-variant"
              @click="runAction('revokeSessions')"
            >
              {{ t('admin.revokeSessions') }} ({{ user.sessions.length }})
            </v-btn>
          </div>

          <v-divider class="my-4" />
          <span class="ud__roles-label">{{ t('admin.setPasswordTitle') }}</span>
          <div class="d-flex ga-2 align-start mt-2">
            <v-text-field
              v-model="newPassword"
              :label="t('account.newPassword')"
              :hint="t('auth.passwordHint')"
              type="password"
              density="comfortable"
              autocomplete="new-password"
            />
            <v-btn
              variant="flat"
              color="primary"
              class="mt-1"
              :loading="savingPassword"
              :disabled="newPassword.length < 8"
              @click="savePassword"
            >
              {{ t('admin.setPassword') }}
            </v-btn>
          </div>
          <p class="ud__note">{{ t('admin.setPasswordNote') }}</p>
        </section>

        <!-- Companies -->
        <section class="card">
          <h2>{{ t('admin.companiesTitle') }} ({{ user.companies.length }})</h2>
          <p v-if="!user.companies.length" class="text-medium-emphasis text-body-2">
            {{ t('admin.noCompanies') }}
          </p>
          <ul v-else class="ud__list">
            <li v-for="c in user.companies" :key="c.id">
              <router-link :to="{ name: 'company', params: { slug: c.slug } }" target="_blank">
                {{ c.displayName }}
              </router-link>
              <span class="ud__list-meta">{{ c.role }} · {{ c.status }}</span>
            </li>
          </ul>
        </section>

        <!-- Sessions -->
        <section class="card">
          <h2>{{ t('account.sessionsTitle') }} ({{ user.sessions.length }})</h2>
          <ul v-if="user.sessions.length" class="ud__list">
            <li v-for="s in user.sessions" :key="s.id">
              <span>{{ (s.userAgent || t('account.unknownDevice')).slice(0, 46) }}</span>
              <span class="ud__list-meta">{{ s.ip || '—' }} · {{ new Date(s.createdAt).toLocaleString() }}</span>
            </li>
          </ul>
          <p v-else class="text-medium-emphasis text-body-2">{{ t('admin.noSessions') }}</p>
        </section>
      </div>
    </template>

    <v-snackbar v-model="toast.show" :color="toast.color" timeout="2600">{{ toast.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.ud__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  margin: 0.6rem 0 1.5rem;
}
.ud__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.3rem, 3vw, 1.7rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.ud__mail {
  color: rgb(var(--v-theme-on-surface) / 0.6);
  font-size: 0.9rem;
}
.ud__id {
  display: block;
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.4);
  margin-top: 0.2rem;
}
.ud__badges {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.ud__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}
.card {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 1.3rem;
}
.card h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 1rem;
}
.ud__roles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  align-items: center;
  margin: 0.4rem 0 0.6rem;
}
.ud__roles-label {
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  width: 100%;
}
.ud__line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.9rem;
}
.ud__note {
  font-size: 0.75rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  margin: 0.6rem 0 0;
}
.ud__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  font-size: 0.86rem;
}
.ud__list li {
  display: flex;
  flex-direction: column;
}
.ud__list-meta {
  font-size: 0.74rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
</style>
