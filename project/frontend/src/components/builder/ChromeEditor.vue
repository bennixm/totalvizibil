<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useBuilderStore } from '@/stores/builder'
import type { NavConfig, FooterConfig } from '@/stores/builder'

const props = defineProps<{ companyId: string }>()
const { t } = useI18n()
const store = useBuilderStore()
const { view, selectedId, working } = storeToRefs(store)

const mode = computed<'nav' | 'footer'>(() =>
  selectedId.value === '__footer__' ? 'footer' : 'nav',
)

const NAV_DEFAULT: NavConfig = {
  logo: 'show',
  sticky: true,
  linkStyle: 'text',
  showPages: true,
  cta: null,
}
const FOOT_DEFAULT: FooterConfig = {
  tagline: '',
  showLegal: true,
  showContact: true,
  socials: [],
}

/** Composed content always carries a fully-resolved nav/footer. */
const nav = computed<NavConfig>(() => ({
  ...NAV_DEFAULT,
  ...(view.value?.content?.nav as Partial<NavConfig> | undefined),
}))
const footer = computed<FooterConfig>(() => ({
  ...FOOT_DEFAULT,
  ...(view.value?.content?.footer as Partial<FooterConfig> | undefined),
  socials: (view.value?.content?.footer?.socials as FooterConfig['socials']) ?? [],
}))

const logoUrl = computed(() => view.value?.theme?.logoUrl ?? '')

function patchNav(p: Partial<NavConfig>): void {
  void store.patchChrome(props.companyId, { nav: { ...nav.value, ...p } })
}
function patchFooter(p: Partial<FooterConfig>): void {
  void store.patchChrome(props.companyId, { footer: { ...footer.value, ...p } })
}

// --- logo upload (same flow as ThemeBar) ---
const logoBusy = ref(false)
const logoErr = ref('')
async function onLogo(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  logoErr.value = ''
  if (file.size > 3_000_000) {
    logoErr.value = t('builder.logoTooLarge')
    return
  }
  logoBusy.value = true
  try {
    const dataUri = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = () => rej(new Error('read'))
      r.readAsDataURL(file)
    })
    const url = await store.uploadAsset(props.companyId, 'logo', dataUri)
    if (!url) {
      logoErr.value = t('builder.logoFailed')
      return
    }
    await store.patchTheme(props.companyId, { logoUrl: url, preset: undefined })
  } catch {
    logoErr.value = t('builder.logoFailed')
  } finally {
    logoBusy.value = false
  }
}
function removeLogo(): void {
  void store.patchTheme(props.companyId, { logoUrl: '', preset: undefined })
}

// --- nav CTA (debounced text) ---
let ctaTimer: ReturnType<typeof setTimeout> | undefined
const ctaLabel = ref(nav.value.cta?.label ?? '')
const ctaTarget = ref(nav.value.cta?.target ?? 'contact')
function toggleCta(on: boolean): void {
  if (on) {
    ctaLabel.value = ctaLabel.value || t('builder.chrome.ctaDefault')
    ctaTarget.value = ctaTarget.value || 'contact'
    patchNav({ cta: { label: ctaLabel.value, target: ctaTarget.value } })
  } else {
    patchNav({ cta: null })
  }
}
function onCtaInput(): void {
  clearTimeout(ctaTimer)
  ctaTimer = setTimeout(() => {
    const label = ctaLabel.value.trim()
    if (!label) return
    patchNav({ cta: { label, target: ctaTarget.value.trim() || 'contact' } })
  }, 340)
}

// --- footer tagline (debounced) ---
let tagTimer: ReturnType<typeof setTimeout> | undefined
const tagline = ref(footer.value.tagline)
function onTagInput(): void {
  clearTimeout(tagTimer)
  tagTimer = setTimeout(() => patchFooter({ tagline: tagline.value.trim() }), 340)
}

// --- footer socials ---
const socials = ref<{ label: string; url: string }[]>(
  footer.value.socials.map((s) => ({ ...s })),
)
let socTimer: ReturnType<typeof setTimeout> | undefined
function commitSocials(): void {
  clearTimeout(socTimer)
  socTimer = setTimeout(() => {
    patchFooter({
      socials: socials.value
        .map((s) => ({ label: s.label.trim(), url: s.url.trim() }))
        .filter((s) => s.label && /^https?:\/\//i.test(s.url)),
    })
  }, 380)
}
function addSocial(): void {
  if (socials.value.length >= 6) return
  socials.value.push({ label: '', url: '' })
}
function removeSocial(i: number): void {
  socials.value.splice(i, 1)
  commitSocials()
}
</script>

<template>
  <div class="ce">
    <header class="ce__head">
      <v-icon :icon="mode === 'nav' ? 'mdi-dock-top' : 'mdi-dock-bottom'" size="18" />
      <strong>{{ mode === 'nav' ? t('builder.navbar') : t('builder.footer') }}</strong>
    </header>

    <!-- ============ NAVBAR ============ -->
    <template v-if="mode === 'nav'">
      <div class="ce__block ce__block--logo">
        <span class="ce__k">{{ t('builder.logoLabel') }}</span>
        <div class="ce__logoRow">
          <img v-if="logoUrl" :src="logoUrl" alt="" class="ce__logo" />
          <span v-else class="ce__logoNone">{{ t('builder.chrome.noLogo') }}</span>
          <label class="ce__btn" :class="{ 'is-busy': logoBusy }">
            <v-progress-circular v-if="logoBusy" indeterminate size="14" width="2" />
            <template v-else>
              <v-icon icon="mdi-tray-arrow-up" size="14" />
              {{ logoUrl ? t('builder.logoReplace') : t('builder.logoUpload') }}
            </template>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              :disabled="logoBusy"
              @change="onLogo"
            />
          </label>
          <button v-if="logoUrl" type="button" class="ce__clear" @click="removeLogo">
            <v-icon icon="mdi-close" size="13" />
          </button>
        </div>
        <span v-if="logoErr" class="ce__err">{{ logoErr }}</span>
      </div>

      <div class="ce__block">
        <span class="ce__k">{{ t('builder.chrome.logoShow') }}</span>
        <div class="ce__seg">
          <button
            type="button"
            :class="{ 'is-on': nav.logo === 'show' }"
            @click="patchNav({ logo: 'show' })"
          >
            {{ t('builder.chrome.show') }}
          </button>
          <button
            type="button"
            :class="{ 'is-on': nav.logo === 'hide' }"
            @click="patchNav({ logo: 'hide' })"
          >
            {{ t('builder.chrome.hide') }}
          </button>
        </div>
      </div>

      <div class="ce__block">
        <span class="ce__k">{{ t('builder.chrome.linkStyle') }}</span>
        <div class="ce__seg">
          <button
            type="button"
            :class="{ 'is-on': nav.linkStyle === 'text' }"
            @click="patchNav({ linkStyle: 'text' })"
          >
            {{ t('builder.chrome.linkText') }}
          </button>
          <button
            type="button"
            :class="{ 'is-on': nav.linkStyle === 'pill' }"
            @click="patchNav({ linkStyle: 'pill' })"
          >
            {{ t('builder.chrome.linkPill') }}
          </button>
        </div>
      </div>

      <label class="ce__toggle">
        <input
          type="checkbox"
          :checked="nav.showPages"
          @change="patchNav({ showPages: ($event.target as HTMLInputElement).checked })"
        />
        <span>{{ t('builder.chrome.showPages') }}</span>
      </label>

      <label class="ce__toggle">
        <input
          type="checkbox"
          :checked="nav.sticky"
          @change="patchNav({ sticky: ($event.target as HTMLInputElement).checked })"
        />
        <span>{{ t('builder.chrome.sticky') }}</span>
      </label>

      <div class="ce__block">
        <label class="ce__toggle">
          <input type="checkbox" :checked="!!nav.cta" @change="toggleCta(($event.target as HTMLInputElement).checked)" />
          <span>{{ t('builder.chrome.ctaOn') }}</span>
        </label>
        <div v-if="nav.cta" class="ce__cta">
          <input
            v-model="ctaLabel"
            type="text"
            maxlength="40"
            :placeholder="t('builder.chrome.ctaLabel')"
            @input="onCtaInput"
          />
          <input
            v-model="ctaTarget"
            type="text"
            maxlength="60"
            :placeholder="t('builder.chrome.ctaTarget')"
            @input="onCtaInput"
          />
          <p class="ce__hint">{{ t('builder.chrome.ctaHint') }}</p>
        </div>
      </div>
    </template>

    <!-- ============ FOOTER ============ -->
    <template v-else>
      <div class="ce__block">
        <span class="ce__k">{{ t('builder.chrome.tagline') }}</span>
        <textarea
          v-model="tagline"
          rows="2"
          maxlength="200"
          :placeholder="t('builder.chrome.taglinePh')"
          @input="onTagInput"
        />
      </div>

      <label class="ce__toggle">
        <input
          type="checkbox"
          :checked="footer.showLegal"
          @change="patchFooter({ showLegal: ($event.target as HTMLInputElement).checked })"
        />
        <span>{{ t('builder.chrome.showLegal') }}</span>
      </label>

      <label class="ce__toggle">
        <input
          type="checkbox"
          :checked="footer.showContact"
          @change="patchFooter({ showContact: ($event.target as HTMLInputElement).checked })"
        />
        <span>{{ t('builder.chrome.showContact') }}</span>
      </label>

      <div class="ce__block">
        <span class="ce__k">{{ t('builder.chrome.socials') }}</span>
        <div v-for="(s, i) in socials" :key="i" class="ce__soc">
          <input
            v-model="s.label"
            type="text"
            maxlength="24"
            :placeholder="t('builder.chrome.socLabel')"
            @input="commitSocials"
          />
          <input
            v-model="s.url"
            type="url"
            maxlength="200"
            placeholder="https://…"
            @input="commitSocials"
          />
          <button type="button" class="ce__clear" @click="removeSocial(i)">
            <v-icon icon="mdi-close" size="13" />
          </button>
        </div>
        <button
          v-if="socials.length < 6"
          type="button"
          class="ce__add"
          @click="addSocial"
        >
          <v-icon icon="mdi-plus" size="14" /> {{ t('builder.chrome.socAdd') }}
        </button>
      </div>
    </template>

    <p v-if="working" class="ce__saving">
      <v-progress-circular indeterminate size="12" width="2" /> {{ t('builder.chrome.saving') }}
    </p>
  </div>
</template>

<style scoped>
.ce {
  height: 100%;
  overflow-y: auto;
  padding: 0.9rem;
}
.ce__head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding-bottom: 0.7rem;
  margin-bottom: 0.9rem;
  border-bottom: 1px solid var(--tvz-hairline);
  font-family: 'Space Grotesk Variable', sans-serif;
}
.ce__block {
  margin-bottom: 1rem;
}
.ce__k {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ce__logoRow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.ce__logo {
  height: 26px;
  width: auto;
  max-width: 130px;
  object-fit: contain;
  border-radius: 4px;
}
.ce__logoNone {
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ce__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.65rem;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  border: 1px solid var(--tvz-glass-border);
  cursor: pointer;
}
.ce__btn.is-busy {
  opacity: 0.6;
  pointer-events: none;
}
.ce__btn input {
  display: none;
}
.ce__err {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.72rem;
  color: rgb(var(--v-theme-error));
}
.ce__seg {
  display: inline-flex;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 8px;
  overflow: hidden;
}
.ce__seg button {
  padding: 0.32rem 0.7rem;
  font-size: 0.76rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  background: rgb(var(--v-theme-surface));
}
.ce__seg button + button {
  border-left: 1px solid var(--tvz-glass-border);
}
.ce__seg button.is-on {
  color: #fff;
  background: rgb(var(--v-theme-primary));
}
.ce__toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.7rem;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.8);
  cursor: pointer;
}
.ce__toggle input {
  width: 16px;
  height: 16px;
  accent-color: rgb(var(--v-theme-primary));
}
.ce__cta,
.ce__soc {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.5rem;
}
.ce__soc {
  flex-direction: row;
  align-items: center;
  margin-top: 0.4rem;
}
.ce__soc input:first-child {
  flex: 0 0 34%;
}
.ce__soc input:nth-child(2) {
  flex: 1;
  min-width: 0;
}
.ce input[type='text'],
.ce input[type='url'],
.ce textarea {
  width: 100%;
  padding: 0.5rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font: inherit;
  font-size: 0.82rem;
}
.ce__hint {
  margin: 0.1rem 0 0;
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ce__add {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.5rem;
  padding: 0.35rem 0.7rem;
  border-radius: 8px;
  font-size: 0.76rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  border: 1px dashed rgba(var(--v-theme-primary), 0.4);
}
.ce__clear {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ce__saving {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.6rem 0 0;
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
</style>
