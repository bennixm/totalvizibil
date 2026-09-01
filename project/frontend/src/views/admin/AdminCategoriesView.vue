<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  useAdminStore,
  type AdminCategory,
  type AdminCategoryGroup,
  type CreateCategoryInput,
} from '@/stores/admin'
import { ApiError } from '@/services/api'

const { t, locale } = useI18n()
const admin = useAdminStore()

const toast = reactive({ show: false, text: '', color: 'success' })
function flash(text: string, color: 'success' | 'error' = 'success') {
  Object.assign(toast, { show: true, text, color })
}
function errText(e: unknown, fb: string) {
  return e instanceof ApiError ? e.message : fb
}
function nm(c: AdminCategory) {
  return c.name[locale.value] ?? c.name.en ?? c.slug
}

const busy = ref<string | null>(null)
onMounted(() => admin.fetchCategories())

// --- editor dialog (create or edit) ---
const emptyName = () => ({ ro: '', en: '', de: '' })
const editor = reactive({
  show: false,
  mode: 'create' as 'create' | 'edit',
  id: '' as string,
  parentId: '' as string,
  slug: '',
  name: emptyName(),
  icon: '',
  isActive: true,
  position: 0,
})
const parentOptions = computed(() => [
  { value: '', title: t('adminCat.topLevel') },
  ...admin.categories.map((g) => ({ value: g.id, title: nm(g) })),
])

function openCreate(parentId = '') {
  Object.assign(editor, {
    show: true,
    mode: 'create',
    id: '',
    parentId,
    slug: '',
    name: emptyName(),
    icon: '',
    isActive: true,
    position: 0,
  })
}
function openEdit(c: AdminCategory) {
  Object.assign(editor, {
    show: true,
    mode: 'edit',
    id: c.id,
    parentId: c.parentId ?? '',
    slug: c.slug,
    name: { ro: c.name.ro ?? '', en: c.name.en ?? '', de: c.name.de ?? '' },
    icon: c.icon ?? '',
    isActive: c.isActive,
    position: c.position,
  })
}

const canSave = computed(
  () =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editor.slug) &&
    editor.name.ro.trim().length >= 2 &&
    editor.name.en.trim().length >= 2 &&
    editor.name.de.trim().length >= 2,
)

async function save() {
  if (!canSave.value) return
  busy.value = 'save'
  try {
    const payload = {
      slug: editor.slug.trim().toLowerCase(),
      name: {
        ro: editor.name.ro.trim(),
        en: editor.name.en.trim(),
        de: editor.name.de.trim(),
      },
      icon: editor.icon.trim() || undefined,
      isActive: editor.isActive,
      position: Number(editor.position) || 0,
    }
    if (editor.mode === 'create') {
      await admin.createCategory({
        ...payload,
        parentId: editor.parentId || undefined,
      } as CreateCategoryInput)
    } else {
      await admin.updateCategory(editor.id, { ...payload, parentId: editor.parentId || null })
    }
    editor.show = false
    flash(t('adminCat.saved'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    busy.value = null
  }
}

async function toggleActive(c: AdminCategory) {
  busy.value = c.id
  try {
    await admin.updateCategory(c.id, { isActive: !c.isActive })
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    busy.value = null
  }
}

const confirmState = reactive({ show: false, name: '', run: async () => {} })
function askDelete(c: AdminCategory) {
  confirmState.name = nm(c)
  confirmState.run = async () => {
    busy.value = c.id
    try {
      await admin.deleteCategory(c.id)
      flash(t('adminCat.deleted'))
    } catch (e) {
      flash(errText(e, t('admin.genericError')), 'error')
    } finally {
      busy.value = null
    }
  }
  confirmState.show = true
}
async function doDelete() {
  const fn = confirmState.run
  confirmState.show = false
  await fn()
}

function groupCompanyTotal(g: AdminCategoryGroup) {
  return g.companyCount + g.children.reduce((s, c) => s + c.companyCount, 0)
}
</script>

<template>
  <div class="ac">
    <header class="ac__head">
      <div>
        <h1>{{ t('admin.navCategories') }}</h1>
        <p>{{ t('adminCat.lead') }}</p>
      </div>
      <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="openCreate()">
        {{ t('adminCat.addGroup') }}
      </v-btn>
    </header>

    <div v-if="admin.loadingCategories && !admin.categories.length" class="d-flex justify-center py-16">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else class="ac__tree">
      <section v-for="g in admin.categories" :key="g.id" class="grp" :class="{ 'grp--off': !g.isActive }">
        <div class="grp__head">
          <v-icon :icon="g.icon || 'mdi-folder-outline'" size="20" />
          <div class="grp__id">
            <strong>{{ nm(g) }}</strong>
            <code>{{ g.slug }}</code>
          </div>
          <v-chip size="x-small" variant="tonal">{{ t('adminCat.nBiz', { n: groupCompanyTotal(g) }) }}</v-chip>
          <v-chip v-if="!g.isActive" size="x-small" color="warning" variant="tonal">{{ t('adminCat.hidden') }}</v-chip>
          <v-spacer />
          <v-btn size="x-small" variant="text" icon="mdi-eye-off-outline" :color="g.isActive ? undefined : 'warning'" :loading="busy === g.id" :title="t('adminCat.toggleActive')" @click="toggleActive(g)" />
          <v-btn size="x-small" variant="text" icon="mdi-pencil-outline" @click="openEdit(g)" />
          <v-btn size="x-small" variant="text" icon="mdi-plus" :title="t('adminCat.addChild')" @click="openCreate(g.id)" />
          <v-btn
            size="x-small"
            variant="text"
            icon="mdi-trash-can-outline"
            color="error"
            :disabled="g.companyCount > 0 || g.children.length > 0"
            :loading="busy === g.id"
            @click="askDelete(g)"
          />
        </div>

        <ul v-if="g.children.length" class="kid">
          <li v-for="c in g.children" :key="c.id" :class="{ 'kid--off': !c.isActive }">
            <v-icon :icon="c.icon || 'mdi-tag-outline'" size="15" />
            <span class="kid__name">{{ nm(c) }}</span>
            <code>{{ c.slug }}</code>
            <v-chip size="x-small" variant="tonal">{{ t('adminCat.nBiz', { n: c.companyCount }) }}</v-chip>
            <v-chip v-if="!c.isActive" size="x-small" color="warning" variant="tonal">{{ t('adminCat.hidden') }}</v-chip>
            <v-spacer />
            <v-btn size="x-small" variant="text" icon="mdi-eye-off-outline" :color="c.isActive ? undefined : 'warning'" :loading="busy === c.id" @click="toggleActive(c)" />
            <v-btn size="x-small" variant="text" icon="mdi-pencil-outline" @click="openEdit(c)" />
            <v-btn
              size="x-small"
              variant="text"
              icon="mdi-trash-can-outline"
              color="error"
              :disabled="c.companyCount > 0"
              :loading="busy === c.id"
              @click="askDelete(c)"
            />
          </li>
        </ul>
        <p v-else class="kid__empty">{{ t('adminCat.noChildren') }}</p>
      </section>
    </div>

    <!-- Editor -->
    <v-dialog v-model="editor.show" max-width="520">
      <v-card rounded="lg">
        <v-card-title>
          {{ editor.mode === 'create' ? t('adminCat.newTitle') : t('adminCat.editTitle') }}
        </v-card-title>
        <v-card-text class="d-flex flex-column ga-1">
          <v-select
            v-model="editor.parentId"
            :items="parentOptions"
            :label="t('adminCat.parent')"
            density="comfortable"
          />
          <v-text-field
            v-model="editor.slug"
            :label="t('adminCat.slug')"
            :hint="t('adminCat.slugHint')"
            persistent-hint
            density="comfortable"
          />
          <v-text-field v-model="editor.name.ro" label="Nume (RO)" density="comfortable" />
          <v-text-field v-model="editor.name.en" label="Name (EN)" density="comfortable" />
          <v-text-field v-model="editor.name.de" label="Name (DE)" density="comfortable" />
          <v-text-field
            v-model="editor.icon"
            :label="t('adminCat.icon')"
            :hint="t('adminCat.iconHint')"
            persistent-hint
            density="comfortable"
          />
          <div class="d-flex ga-4 align-center mt-1">
            <v-text-field
              v-model.number="editor.position"
              type="number"
              :label="t('adminCat.position')"
              density="compact"
              hide-details
              style="max-width: 120px"
            />
            <v-switch v-model="editor.isActive" :label="t('adminCat.active')" color="primary" hide-details density="compact" />
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editor.show = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="busy === 'save'" :disabled="!canSave" @click="save">
            {{ t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="confirmState.show" max-width="400">
      <v-card rounded="lg">
        <v-card-title>{{ t('adminCat.deleteTitle') }}</v-card-title>
        <v-card-text>{{ t('adminCat.deleteConfirm', { name: confirmState.name }) }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmState.show = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="doDelete">{{ t('admin.confirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="toast.show" :color="toast.color" timeout="2600">{{ toast.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.ac__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.4rem;
}
.ac__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.4rem, 3.5vw, 1.9rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.ac__head p {
  margin: 0.3rem 0 0;
  font-size: 0.85rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.ac__tree {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
.grp {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 0.9rem 1.1rem;
}
.grp--off {
  opacity: 0.62;
}
.grp__head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.grp__id {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.grp__id strong {
  font-size: 0.95rem;
}
.grp__id code,
.kid code {
  font-size: 0.7rem;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.kid {
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0.5rem 0 0 1.6rem;
  border-top: 1px dashed var(--tvz-hairline);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.kid li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
  font-size: 0.85rem;
}
.kid--off {
  opacity: 0.6;
}
.kid__name {
  font-weight: 500;
}
.kid__empty {
  margin: 0.55rem 0 0 1.6rem;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.4);
}
</style>
