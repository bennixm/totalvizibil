<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import AiAvatar from '@/components/studio/AiAvatar.vue'
import { useWebsiteDraftStore } from '@/stores/websiteDraft'
import type {
  DraftTurn,
  EasyFaq,
  EasyServiceCopy,
  EasyStep,
  EasyTemplate,
  EasyTestimonial,
} from '@/stores/websiteDraft'
import { pickServiceIcon } from '@/utils/serviceIcon'

const { t } = useI18n()
const store = useWebsiteDraftStore()
const { draft, sending, error } = storeToRefs(store)

const STEPS: EasyStep[] = [
  'template',
  'name',
  'field',
  'color',
  'landing',
  'services',
  'portfolio',
  'contact',
]
const TEMPLATES: EasyTemplate[] = ['classic', 'bold', 'minimal']
const PRESETS = ['#4f46e5', '#0ea5e9', '#059669', '#d97706', '#e11d48', '#7c3aed', '#0f172a']
const MAX_UPLOAD = 4.5 * 1024 * 1024
const MAX_PORTFOLIO = 10
const MAX_WHYUS = 6
const MAX_TESTI = 8
const MAX_FAQ = 10

const step = computed<EasyStep>(() => (draft.value?.step ?? 'name') as EasyStep)
const easy = computed(() => draft.value?.easy ?? null)
const stepIndex = computed(() => Math.max(0, STEPS.indexOf(step.value)))
const progressPct = computed(() =>
  step.value === 'done' ? '100%' : `${(stepIndex.value / STEPS.length) * 100}%`,
)
const transcript = computed(() => draft.value?.transcript ?? [])
const stepLabel = computed(() => t(`studio.step.${step.value}`))

const errorText = computed(() =>
  error.value === 'banned_content' ? t('studio.bannedContent') : t('studio.loadError'),
)

// --- template picker -------------------------------------------------
const template = computed<EasyTemplate>(() => easy.value?.template ?? 'classic')
function pickTemplate(k: EasyTemplate): void {
  void store.patchEasy({ template: k })
}

function turnText(turn: DraftTurn): string {
  if (turn.role === 'user') return turn.text ?? ''
  return turn.key ? t(`studio.msg.${turn.key}`) : ''
}
/** Show the avatar chip only on the first message of a consecutive agent run. */
function showAv(i: number): boolean {
  const turn = transcript.value[i]
  return turn?.role === 'assistant' && transcript.value[i - 1]?.role !== 'assistant'
}

// --- grammar proofreading -------------------------------------------------
const grammarOn = computed(() => easy.value?.autoGrammar === true)
const fixing = ref<string | null>(null)
const fixed = ref<string | null>(null)
async function proof(key: string, value: string): Promise<string> {
  if (!grammarOn.value || !value.trim()) return value
  fixing.value = key
  try {
    const out = await store.proofread(value)
    if (out.trim() && out !== value) {
      fixed.value = key
      window.setTimeout(() => {
        if (fixed.value === key) fixed.value = null
      }, 2200)
    }
    return out
  } finally {
    if (fixing.value === key) fixing.value = null
  }
}
function toggleGrammar(): void {
  void store.patchEasy({ autoGrammar: !grammarOn.value })
}

// --- chat input --------------------------------------------------------
const chatDraft = ref('')
const showChat = computed(() => step.value !== 'done')
const chatPlaceholder = computed(() => {
  const k = `studio.ph.${step.value}`
  const s = t(k)
  return s === k ? t('studio.inputPlaceholder') : s
})
function sendChat(): void {
  const text = chatDraft.value.trim()
  if (!text || sending.value) return
  void store.send(text)
  chatDraft.value = ''
}
function onChatKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendChat()
  }
}

// --- colour ----------------------------------------------------------
const color = ref(easy.value?.accentColor || PRESETS[0])
watch(
  () => easy.value?.accentColor,
  (v) => {
    if (v) color.value = v
  },
)
let colorTimer: ReturnType<typeof setTimeout> | undefined
function pickColor(hex: string): void {
  color.value = hex
  clearTimeout(colorTimer)
  colorTimer = setTimeout(() => void store.patchEasy({ accentColor: hex }), 110)
}

// --- image upload --------------------------------------------------
const uploading = ref(false)
const uploadErr = ref('')
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read'))
    r.readAsDataURL(file)
  })
}
async function onFile(e: Event, kind: 'landing' | 'portfolio'): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploadErr.value = ''
  if (!file.type.startsWith('image/')) return
  if (file.size > MAX_UPLOAD) {
    uploadErr.value = t('studio.uploadTooLarge')
    return
  }
  uploading.value = true
  try {
    const dataUri = await readFile(file)
    const url = await store.uploadAsset(kind, dataUri)
    if (!url) {
      uploadErr.value = t('studio.uploadFailed')
      return
    }
    if (kind === 'landing') await store.patchEasy({ landingImage: url })
    else {
      const next = [...(easy.value?.portfolio ?? []), url].slice(0, MAX_PORTFOLIO)
      await store.patchEasy({ portfolio: next })
    }
  } catch {
    uploadErr.value = t('studio.uploadFailed')
  } finally {
    uploading.value = false
  }
}
function removePortfolio(i: number): void {
  void store.patchEasy({ portfolio: (easy.value?.portfolio ?? []).filter((_, idx) => idx !== i) })
}
function clearLanding(): void {
  void store.patchEasy({ landingImage: '' })
}

// --- landing title -----------------------------------------------
const landingTitle = ref(easy.value?.landingTitle || '')
watch(
  () => easy.value?.landingTitle,
  (v) => {
    if (v !== undefined && document.activeElement?.getAttribute('data-f') !== 'landingTitle') {
      landingTitle.value = v
    }
  },
)
let titleTimer: ReturnType<typeof setTimeout> | undefined
function onTitleInput(): void {
  clearTimeout(titleTimer)
  titleTimer = setTimeout(() => void store.patchEasy({ landingTitle: landingTitle.value }), 250)
}
async function onTitleBlur(): Promise<void> {
  landingTitle.value = await proof('landingTitle', landingTitle.value)
  void store.patchEasy({ landingTitle: landingTitle.value })
}

// --- services (reorder + inline description edit) -----------------
const services = ref<EasyServiceCopy[]>([])
watch(
  () => easy.value?.services,
  (v) => {
    if (!document.activeElement?.getAttribute('data-grp')) {
      services.value = (v ?? []).map((s) => ({ ...s }))
    }
  },
  { immediate: true, deep: true },
)
const dragIndex = ref<number | null>(null)
const editDesc = ref<number | null>(null)
function onDragStart(i: number): void {
  dragIndex.value = i
}
function onDrop(i: number): void {
  const from = dragIndex.value
  dragIndex.value = null
  if (from === null || from === i) return
  const list = [...services.value]
  const [moved] = list.splice(from, 1)
  list.splice(i, 0, moved)
  services.value = list
  void store.patchEasy({ services: list })
}
async function saveDesc(i: number): Promise<void> {
  editDesc.value = null
  const item = services.value[i]
  if (!item) return
  item.description = await proof(`svc${i}`, item.description)
  void store.patchEasy({ services: services.value })
}
function regenServices(): void {
  const names = (easy.value?.serviceNames ?? []).filter(Boolean)
  if (names.length) void store.regenerateServices(names)
}

// --- contact ---------------------------------------------------
const phone = ref(easy.value?.phone || '')
const email = ref(easy.value?.email || '')
watch(
  () => [easy.value?.phone, easy.value?.email] as const,
  ([p, e]) => {
    if (document.activeElement?.getAttribute('data-f') !== 'phone') phone.value = p || ''
    if (document.activeElement?.getAttribute('data-f') !== 'email') email.value = e || ''
  },
)
function saveContact(): void {
  void store.patchEasy({ phone: phone.value.trim(), email: email.value.trim() })
}
function saveContactAndAdvance(): void {
  saveContact()
  void store.advanceEasy()
}

// --- about ---------------------------------------------------
const aboutText = ref(easy.value?.about || '')
watch(
  () => easy.value?.about,
  (v) => {
    if (document.activeElement?.getAttribute('data-f') !== 'about') aboutText.value = v || ''
  },
)
async function saveAbout(): Promise<void> {
  aboutText.value = await proof('about', aboutText.value)
  void store.patchEasy({ about: aboutText.value })
}
function resetAbout(): void {
  aboutText.value = ''
  void store.patchEasy({ about: '' })
}

// --- why us ------------------------------------------------
const whyUs = ref<string[]>([])
watch(
  () => easy.value?.whyUs,
  (v) => {
    if (!document.activeElement?.getAttribute('data-grp')) whyUs.value = [...(v ?? [])]
  },
  { immediate: true },
)
function patchWhy(): void {
  void store.patchEasy({ whyUs: whyUs.value.map((s) => s.trim()).filter(Boolean) })
}
function addWhy(): void {
  if (whyUs.value.length < MAX_WHYUS) whyUs.value.push('')
}
function removeWhy(i: number): void {
  whyUs.value.splice(i, 1)
  patchWhy()
}
async function blurWhy(i: number): Promise<void> {
  whyUs.value[i] = await proof(`why${i}`, whyUs.value[i] ?? '')
  patchWhy()
}

// --- testimonials ----------------------------------------------
const testimonials = ref<EasyTestimonial[]>([])
watch(
  () => easy.value?.testimonials,
  (v) => {
    if (!document.activeElement?.getAttribute('data-grp')) {
      testimonials.value = (v ?? []).map((x) => ({ ...x }))
    }
  },
  { immediate: true, deep: true },
)
function patchTesti(): void {
  void store.patchEasy({
    testimonials: testimonials.value
      .map((x) => ({ quote: x.quote.trim(), author: (x.author ?? '').trim() }))
      .filter((x) => x.quote),
  })
}
function addTesti(): void {
  if (testimonials.value.length < MAX_TESTI) testimonials.value.push({ quote: '', author: '' })
}
function removeTesti(i: number): void {
  testimonials.value.splice(i, 1)
  patchTesti()
}
async function blurTestiQuote(i: number): Promise<void> {
  const it = testimonials.value[i]
  if (it) it.quote = await proof(`tq${i}`, it.quote)
  patchTesti()
}

// --- faq -----------------------------------------------------
const faq = ref<EasyFaq[]>([])
watch(
  () => easy.value?.faq,
  (v) => {
    if (!document.activeElement?.getAttribute('data-grp')) {
      faq.value = (v ?? []).map((x) => ({ ...x }))
    }
  },
  { immediate: true, deep: true },
)
function patchFaq(): void {
  void store.patchEasy({
    faq: faq.value.map((x) => ({ q: x.q.trim(), a: x.a.trim() })).filter((x) => x.q && x.a),
  })
}
function addFaq(): void {
  if (faq.value.length < MAX_FAQ) faq.value.push({ q: '', a: '' })
}
function removeFaq(i: number): void {
  faq.value.splice(i, 1)
  patchFaq()
}
async function blurFaqA(i: number): Promise<void> {
  const it = faq.value[i]
  if (it) it.a = await proof(`fa${i}`, it.a)
  patchFaq()
}

// --- cta -----------------------------------------------------
const cta = reactive({ headline: '', button: '' })
watch(
  () => [easy.value?.ctaHeadline, easy.value?.ctaButton] as const,
  ([h, b]) => {
    if (document.activeElement?.getAttribute('data-f') !== 'ctaH') cta.headline = h || ''
    if (document.activeElement?.getAttribute('data-f') !== 'ctaB') cta.button = b || ''
  },
  { immediate: true },
)
function saveCta(): void {
  void store.patchEasy({ ctaHeadline: cta.headline.trim(), ctaButton: cta.button.trim() })
}
async function blurCtaH(): Promise<void> {
  cta.headline = await proof('ctaH', cta.headline)
  saveCta()
}

// section visibility toggles
function toggleSection(key: 'showAbout' | 'showWhyUs' | 'showCta'): void {
  const cur = easy.value?.[key] !== false
  void store.patchEasy({ [key]: !cur })
}

// --- log autoscroll -------------------------------------------------
const log = ref<HTMLElement | null>(null)
watch(
  () => [transcript.value.length, sending.value, step.value] as const,
  async () => {
    await nextTick()
    log.value?.scrollTo({ top: log.value.scrollHeight, behavior: 'smooth' })
  },
)

const servicesReady = computed(() => (easy.value?.services?.length ?? 0) > 0)
const portfolioCount = computed(() => easy.value?.portfolio?.length ?? 0)
</script>

<template>
  <div class="ag">
    <!-- LEFT: the agent, on a stage -->
    <aside class="ag__stage">
      <span class="ag__blob ag__blob--1" aria-hidden="true" />
      <span class="ag__blob ag__blob--2" aria-hidden="true" />
      <div class="ag__stageIn">
        <AiAvatar class="ag__avatar" :speaking="sending" :size="190" />
        <strong class="ag__name">{{ t('studio.agentPersona') }}</strong>
        <span class="ag__role">{{ t('studio.agentRole') }}</span>
        <span class="ag__chip">
          <template v-if="step !== 'done'">
            {{ t('studio.stepOf', { n: stepIndex + 1, total: STEPS.length }) }} · {{ stepLabel }}
          </template>
          <template v-else>{{ t('studio.doneTitle') }}</template>
        </span>
        <div class="ag__bar"><span :style="{ width: progressPct }" /></div>
        <span v-if="sending" class="ag__status">
          <v-icon icon="mdi-pencil-outline" size="13" /> {{ t('studio.thinking') }}
        </span>
      </div>
    </aside>

    <!-- RIGHT: the conversation -->
    <div class="ag__chat">
      <div ref="log" class="ag__scroll">
      <div class="ag__log">
        <div
          v-for="(turn, i) in transcript"
          :key="i"
          class="msg"
          :class="[
            turn.role === 'user' ? 'msg--u' : 'msg--a',
            i === transcript.length - 1 ? 'msg--new' : '',
          ]"
        >
          <span v-if="showAv(i)" class="msg__av">{{ t('studio.agentPersona').charAt(0) }}</span>
          <span v-else-if="turn.role === 'assistant'" class="msg__av msg__av--ghost" />
          <p>{{ turnText(turn) }}</p>
        </div>
        <div v-if="sending" class="msg msg--a msg--typing" aria-hidden="true">
          <span class="msg__av">{{ t('studio.agentPersona').charAt(0) }}</span>
          <p class="dots"><span /><span /><span /></p>
        </div>
      </div>

      <!-- STEP TOOLS -->
      <div class="ag__tool">
        <!-- template picker -->
        <template v-if="step === 'template'">
          <p class="tl">{{ t('studio.templateTitle') }}</p>
          <div class="tpls">
            <button
              v-for="k in TEMPLATES"
              :key="k"
              class="tpl"
              :class="{ 'is-on': template === k }"
              type="button"
              @click="pickTemplate(k)"
            >
              <span class="tpl__mock" :class="`tpl__mock--${k}`" aria-hidden="true">
                <i /><i /><i /><i />
              </span>
              <strong>{{ t(`studio.template.${k}`) }}</strong>
              <span class="tpl__d">{{ t(`studio.templateDesc.${k}`) }}</span>
            </button>
          </div>
          <button class="cont" type="button" @click="store.advanceEasy()">
            {{ t('studio.continue') }} <v-icon icon="mdi-arrow-right" size="16" />
          </button>
        </template>

        <!-- colour -->
        <template v-else-if="step === 'color'">
          <p class="tl">{{ t('studio.colorTitle') }}</p>
          <div class="sws">
            <button
              v-for="c in PRESETS"
              :key="c"
              class="sw"
              :class="{ 'is-on': color.toLowerCase() === c.toLowerCase() }"
              :style="{ '--sw': c }"
              type="button"
              :aria-label="c"
              @click="pickColor(c)"
            />
            <label class="sw sw--c" :style="{ '--sw': color }">
              <v-icon icon="mdi-eyedropper-variant" size="16" />
              <input type="color" :value="color" @input="pickColor(($event.target as HTMLInputElement).value)" />
            </label>
          </div>
          <code class="hex">{{ color }}</code>
          <button class="cont" type="button" @click="store.advanceEasy()">
            {{ t('studio.continue') }} <v-icon icon="mdi-arrow-right" size="16" />
          </button>
        </template>

        <!-- landing -->
        <template v-else-if="step === 'landing'">
          <p class="tl">{{ t('studio.landingImage') }}</p>
          <div v-if="easy?.landingImage" class="drop drop--f">
            <img :src="easy.landingImage" alt="" />
            <div class="drop__ov">
              <label class="mini">
                <v-icon icon="mdi-image-refresh-outline" size="15" /> {{ t('studio.landingImageChange') }}
                <input type="file" accept="image/*" @change="onFile($event, 'landing')" />
              </label>
              <button class="mini" type="button" @click="clearLanding">
                <v-icon icon="mdi-close" size="15" />
              </button>
            </div>
          </div>
          <label v-else class="drop" :class="{ 'is-busy': uploading }">
            <v-progress-circular v-if="uploading" indeterminate size="22" color="primary" />
            <template v-else>
              <v-icon icon="mdi-tray-arrow-up" size="22" />
              <span>{{ t('studio.landingImageAdd') }}</span>
            </template>
            <input type="file" accept="image/*" :disabled="uploading" @change="onFile($event, 'landing')" />
          </label>

          <p class="tl">
            {{ t('studio.landingTitleField') }}
            <span v-if="fixed === 'landingTitle'" class="fx">✓ {{ t('studio.grammarFixed') }}</span>
          </p>
          <input
            v-model="landingTitle"
            class="fld"
            type="text"
            data-f="landingTitle"
            :placeholder="easy?.companyName || t('studio.ph.landing')"
            maxlength="120"
            @input="onTitleInput"
            @blur="onTitleBlur"
          />
          <p v-if="uploadErr" class="uerr">{{ uploadErr }}</p>
          <button class="cont" type="button" @click="store.advanceEasy()">
            {{ t('studio.continue') }} <v-icon icon="mdi-arrow-right" size="16" />
          </button>
        </template>

        <!-- services -->
        <template v-else-if="step === 'services'">
          <template v-if="servicesReady">
            <p class="tl">{{ t('studio.servicesReorder') }}</p>
            <ul class="svc" data-grp="svc">
              <li
                v-for="(s, i) in services"
                :key="i"
                class="svc__row"
                :draggable="editDesc !== i"
                @dragstart="onDragStart(i)"
                @dragover.prevent
                @drop="onDrop(i)"
              >
                <v-icon icon="mdi-drag-vertical" size="16" class="svc__grip" />
                <span class="svc__ic"><v-icon :icon="s.icon || pickServiceIcon(s.name)" size="16" /></span>
                <div class="svc__txt">
                  <strong>{{ s.name }}</strong>
                  <textarea
                    v-if="editDesc === i"
                    v-model="s.description"
                    class="fld fld--mini"
                    rows="3"
                    data-grp="svc"
                    @blur="saveDesc(i)"
                  />
                  <span v-else class="svc__d" @click="editDesc = i">
                    {{ s.description }}
                    <v-icon icon="mdi-pencil-outline" size="12" />
                  </span>
                </div>
              </li>
            </ul>
            <div class="row2">
              <button class="ghost" type="button" :disabled="sending" @click="regenServices">
                <v-icon icon="mdi-refresh" size="15" /> {{ t('studio.servicesRegen') }}
              </button>
              <button class="cont" type="button" @click="store.advanceEasy()">
                {{ t('studio.continue') }} <v-icon icon="mdi-arrow-right" size="16" />
              </button>
            </div>
          </template>
          <p v-else class="hint">
            <v-icon icon="mdi-lightbulb-on-outline" size="15" /> {{ t('studio.servicesEmpty') }}
          </p>
        </template>

        <!-- portfolio -->
        <template v-else-if="step === 'portfolio'">
          <p class="tl">
            {{ t('studio.portfolioTool') }}
            <span class="cnt">{{ t('studio.portfolioCount', { n: portfolioCount }) }}</span>
          </p>
          <div class="pf">
            <figure v-for="(url, i) in easy?.portfolio ?? []" :key="i" class="pf__cell">
              <img :src="url" alt="" />
              <button class="pf__x" type="button" @click="removePortfolio(i)">
                <v-icon icon="mdi-close" size="13" />
              </button>
            </figure>
            <label v-if="portfolioCount < MAX_PORTFOLIO" class="pf__add" :class="{ 'is-busy': uploading }">
              <v-progress-circular v-if="uploading" indeterminate size="18" color="primary" />
              <v-icon v-else icon="mdi-plus" size="20" />
              <input type="file" accept="image/*" :disabled="uploading" @change="onFile($event, 'portfolio')" />
            </label>
          </div>
          <p v-if="uploadErr" class="uerr">{{ uploadErr }}</p>
          <button class="cont" type="button" @click="store.advanceEasy()">
            {{ t('studio.continue') }} <v-icon icon="mdi-arrow-right" size="16" />
          </button>
        </template>

        <!-- contact -->
        <template v-else-if="step === 'contact'">
          <p class="tl">{{ t('studio.contactTool') }}</p>
          <input v-model="phone" class="fld" type="tel" data-f="phone" :placeholder="t('studio.contactPhone')" @blur="saveContact" />
          <input v-model="email" class="fld" type="email" data-f="email" :placeholder="t('studio.contactEmail')" @blur="saveContact" />
          <button class="cont" type="button" @click="saveContactAndAdvance">
            {{ t('studio.continue') }} <v-icon icon="mdi-arrow-right" size="16" />
          </button>
        </template>

        <!-- done: full editor -->
        <template v-else-if="step === 'done'">
          <p class="tl">{{ t('studio.editTitle') }}</p>

          <div class="ed">
            <span class="ed__k">{{ t('studio.colorTitle') }}</span>
            <div class="sws sws--sm">
              <button
                v-for="c in PRESETS"
                :key="c"
                class="sw"
                :class="{ 'is-on': color.toLowerCase() === c.toLowerCase() }"
                :style="{ '--sw': c }"
                type="button"
                @click="pickColor(c)"
              />
              <label class="sw sw--c" :style="{ '--sw': color }">
                <v-icon icon="mdi-eyedropper-variant" size="14" />
                <input type="color" :value="color" @input="pickColor(($event.target as HTMLInputElement).value)" />
              </label>
            </div>
          </div>

          <div class="ed">
            <span class="ed__k">
              {{ t('studio.landingTitleField') }}
              <span v-if="fixed === 'landingTitle'" class="fx">✓</span>
            </span>
            <input v-model="landingTitle" class="fld" type="text" data-f="landingTitle" maxlength="120" @input="onTitleInput" @blur="onTitleBlur" />
          </div>

          <div class="ed">
            <span class="ed__k">{{ t('studio.landingImage') }}</span>
            <div v-if="easy?.landingImage" class="drop drop--f drop--sm">
              <img :src="easy.landingImage" alt="" />
              <div class="drop__ov">
                <label class="mini">
                  <v-icon icon="mdi-image-refresh-outline" size="14" />
                  <input type="file" accept="image/*" @change="onFile($event, 'landing')" />
                </label>
                <button class="mini" type="button" @click="clearLanding"><v-icon icon="mdi-close" size="14" /></button>
              </div>
            </div>
            <label v-else class="drop drop--sm">
              <v-icon icon="mdi-tray-arrow-up" size="18" />
              <input type="file" accept="image/*" @change="onFile($event, 'landing')" />
            </label>
          </div>

          <!-- About -->
          <div class="ed">
            <span class="ed__k">
              {{ t('studio.aboutTool') }}
              <button class="tog" type="button" :class="{ 'is-on': easy?.showAbout }" @click="toggleSection('showAbout')">
                {{ easy?.showAbout ? t('studio.on') : t('studio.off') }}
              </button>
              <span v-if="fixed === 'about'" class="fx">✓</span>
            </span>
            <textarea
              v-model="aboutText"
              class="fld"
              rows="4"
              data-f="about"
              maxlength="900"
              :placeholder="t('studio.aboutPlaceholder')"
              @blur="saveAbout"
            />
            <button class="ghost ghost--xs" type="button" @click="resetAbout">
              <v-icon icon="mdi-auto-fix" size="13" /> {{ t('studio.useSuggestion') }}
            </button>
          </div>

          <!-- Services -->
          <div v-if="servicesReady" class="ed">
            <span class="ed__k">{{ t('studio.servicesReorder') }}</span>
            <ul class="svc" data-grp="svc">
              <li
                v-for="(s, i) in services"
                :key="i"
                class="svc__row"
                :draggable="editDesc !== i"
                @dragstart="onDragStart(i)"
                @dragover.prevent
                @drop="onDrop(i)"
              >
                <v-icon icon="mdi-drag-vertical" size="15" class="svc__grip" />
                <span class="svc__ic"><v-icon :icon="s.icon || pickServiceIcon(s.name)" size="15" /></span>
                <div class="svc__txt">
                  <strong>{{ s.name }}</strong>
                  <textarea
                    v-if="editDesc === i"
                    v-model="s.description"
                    class="fld fld--mini"
                    rows="3"
                    data-grp="svc"
                    @blur="saveDesc(i)"
                  />
                  <span v-else class="svc__d" @click="editDesc = i">
                    {{ s.description }} <v-icon icon="mdi-pencil-outline" size="12" />
                  </span>
                </div>
              </li>
            </ul>
            <button class="ghost" type="button" :disabled="sending" @click="regenServices">
              <v-icon icon="mdi-refresh" size="14" /> {{ t('studio.servicesRegen') }}
            </button>
          </div>

          <!-- Why us -->
          <div class="ed" data-grp="why">
            <span class="ed__k">
              {{ t('studio.whyTool') }}
              <button class="tog" type="button" :class="{ 'is-on': easy?.showWhyUs }" @click="toggleSection('showWhyUs')">
                {{ easy?.showWhyUs ? t('studio.on') : t('studio.off') }}
              </button>
            </span>
            <div v-for="(_, i) in whyUs" :key="i" class="lrow">
              <input
                v-model="whyUs[i]"
                class="fld"
                type="text"
                data-grp="why"
                maxlength="90"
                :placeholder="t('studio.whyPlaceholder')"
                @blur="blurWhy(i)"
              />
              <button class="del" type="button" @click="removeWhy(i)"><v-icon icon="mdi-close" size="14" /></button>
            </div>
            <button v-if="whyUs.length < MAX_WHYUS" class="ghost ghost--xs" type="button" @click="addWhy">
              <v-icon icon="mdi-plus" size="13" /> {{ t('studio.addPoint') }}
            </button>
          </div>

          <!-- Portfolio -->
          <div class="ed">
            <span class="ed__k">
              {{ t('studio.portfolioTool') }}
              <span class="cnt">{{ t('studio.portfolioCount', { n: portfolioCount }) }}</span>
            </span>
            <div class="pf">
              <figure v-for="(url, i) in easy?.portfolio ?? []" :key="i" class="pf__cell">
                <img :src="url" alt="" />
                <button class="pf__x" type="button" @click="removePortfolio(i)"><v-icon icon="mdi-close" size="12" /></button>
              </figure>
              <label v-if="portfolioCount < MAX_PORTFOLIO" class="pf__add" :class="{ 'is-busy': uploading }">
                <v-progress-circular v-if="uploading" indeterminate size="16" color="primary" />
                <v-icon v-else icon="mdi-plus" size="18" />
                <input type="file" accept="image/*" :disabled="uploading" @change="onFile($event, 'portfolio')" />
              </label>
            </div>
          </div>

          <!-- Testimonials -->
          <div class="ed" data-grp="tes">
            <span class="ed__k">{{ t('studio.testiTool') }}</span>
            <div v-for="(_, i) in testimonials" :key="i" class="tcard">
              <textarea
                v-model="testimonials[i].quote"
                class="fld fld--mini"
                rows="2"
                data-grp="tes"
                :placeholder="t('studio.testiQuote')"
                @blur="blurTestiQuote(i)"
              />
              <div class="lrow">
                <input
                  v-model="testimonials[i].author"
                  class="fld"
                  type="text"
                  data-grp="tes"
                  maxlength="80"
                  :placeholder="t('studio.testiAuthor')"
                  @blur="patchTesti"
                />
                <button class="del" type="button" @click="removeTesti(i)"><v-icon icon="mdi-close" size="14" /></button>
              </div>
            </div>
            <button v-if="testimonials.length < MAX_TESTI" class="ghost ghost--xs" type="button" @click="addTesti">
              <v-icon icon="mdi-plus" size="13" /> {{ t('studio.addTesti') }}
            </button>
          </div>

          <!-- FAQ -->
          <div class="ed" data-grp="faq">
            <span class="ed__k">{{ t('studio.faqTool') }}</span>
            <div v-for="(_, i) in faq" :key="i" class="tcard">
              <input
                v-model="faq[i].q"
                class="fld"
                type="text"
                data-grp="faq"
                maxlength="160"
                :placeholder="t('studio.faqQ')"
                @blur="patchFaq"
              />
              <div class="lrow">
                <textarea
                  v-model="faq[i].a"
                  class="fld fld--mini"
                  rows="2"
                  data-grp="faq"
                  :placeholder="t('studio.faqA')"
                  @blur="blurFaqA(i)"
                />
                <button class="del" type="button" @click="removeFaq(i)"><v-icon icon="mdi-close" size="14" /></button>
              </div>
            </div>
            <button v-if="faq.length < MAX_FAQ" class="ghost ghost--xs" type="button" @click="addFaq">
              <v-icon icon="mdi-plus" size="13" /> {{ t('studio.addFaq') }}
            </button>
          </div>

          <!-- CTA -->
          <div class="ed">
            <span class="ed__k">
              {{ t('studio.ctaTool') }}
              <button class="tog" type="button" :class="{ 'is-on': easy?.showCta }" @click="toggleSection('showCta')">
                {{ easy?.showCta ? t('studio.on') : t('studio.off') }}
              </button>
              <span v-if="fixed === 'ctaH'" class="fx">✓</span>
            </span>
            <input v-model="cta.headline" class="fld" type="text" data-f="ctaH" maxlength="120" :placeholder="t('studio.ctaHeadline')" @blur="blurCtaH" />
            <input v-model="cta.button" class="fld" type="text" data-f="ctaB" maxlength="40" :placeholder="t('studio.ctaButton')" @blur="saveCta" />
          </div>

          <!-- Contact -->
          <div class="ed">
            <span class="ed__k">{{ t('studio.contactTool') }}</span>
            <input v-model="phone" class="fld" type="tel" data-f="phone" :placeholder="t('studio.contactPhone')" @blur="saveContact" />
            <input v-model="email" class="fld" type="email" data-f="email" :placeholder="t('studio.contactEmail')" @blur="saveContact" />
          </div>

          <p v-if="uploadErr" class="uerr">{{ uploadErr }}</p>
        </template>
      </div>
      </div>

      <!-- grammar toggle + input -->
      <div class="ag__foot">
        <button class="gram" type="button" :class="{ 'is-on': grammarOn }" @click="toggleGrammar">
          <v-icon :icon="grammarOn ? 'mdi-spellcheck' : 'mdi-format-letter-case'" size="15" />
          {{ t('studio.grammarToggle') }}
          <span class="gram__st">{{ grammarOn ? t('studio.on') : t('studio.off') }}</span>
          <v-progress-circular v-if="fixing" indeterminate size="12" width="2" />
        </button>

        <form v-if="showChat" class="inp" @submit.prevent="sendChat">
          <textarea v-model="chatDraft" rows="1" :placeholder="chatPlaceholder" :disabled="sending" @keydown="onChatKey" />
          <v-btn
            type="submit"
            icon="mdi-send"
            size="small"
            color="primary"
            :loading="sending"
            :disabled="sending || !chatDraft.trim()"
            :aria-label="t('studio.send')"
          />
        </form>

        <div v-if="step === 'done'" class="done">
          <v-btn color="primary" size="small" append-icon="mdi-arrow-right" :to="{ name: 'create-location' }">
            {{ t('studio.continueLocation') }}
          </v-btn>
          <button class="restart" type="button" @click="store.restart()">
            <v-icon icon="mdi-restart" size="14" /> {{ t('studio.restart') }}
          </button>
        </div>
      </div>

      <div v-if="error" class="err">
        <v-icon icon="mdi-alert-circle-outline" size="16" /> {{ errorText }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.ag {
  display: grid;
  /* Stage scales with the panel but stays in a sane band. */
  grid-template-columns: minmax(186px, min(38%, 320px)) minmax(0, 1fr);
  /* Lock the single row to the panel height so a long editor scrolls inside
     `.ag__scroll` instead of pushing the input off-screen. */
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--tvz-shadow-sm);
  overflow: hidden;
}

/* ---- stage ---- */
.ag__stage {
  position: relative;
  overflow: hidden;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 1.9rem 1rem 1.25rem;
  color: #fff;
  background:
    radial-gradient(120% 80% at 30% 0%, #3b3ec9, transparent 60%),
    linear-gradient(180deg, #241f6b, #14123a);
  border-right: 1px solid var(--tvz-hairline);
}
.ag__blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(24px);
  opacity: 0.55;
  pointer-events: none;
}
.ag__blob--1 {
  width: 180px;
  height: 180px;
  top: -40px;
  left: -50px;
  background: #6d5cff;
  animation: blob 14s ease-in-out infinite alternate;
}
.ag__blob--2 {
  width: 150px;
  height: 150px;
  bottom: -40px;
  right: -40px;
  background: #22d3ee;
  animation: blob 18s ease-in-out infinite alternate-reverse;
}
@keyframes blob {
  to {
    transform: translate3d(18px, -14px, 0) scale(1.15);
  }
}
.ag__stageIn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.35rem;
  width: 100%;
  align-self: flex-start;
}
.ag__avatar {
  filter: drop-shadow(0 12px 26px rgba(0, 0, 0, 0.4));
}
.ag__name {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.15rem;
  margin-top: 0.3rem;
}
.ag__role {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.6);
}
.ag__chip {
  margin-top: 0.5rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.16);
  line-height: 1.3;
}
.ag__bar {
  margin-top: 0.7rem;
  width: 100%;
  max-width: 180px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  overflow: hidden;
}
.ag__bar span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #7cf9ff, #a97bff);
  transition: width 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.ag__status {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.5rem;
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.75);
}

/* ---- chat column ---- */
.ag__chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.ag__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.ag__log {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.msg {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  max-width: 90%;
}
.msg--a {
  align-self: flex-start;
}
.msg--u {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.msg p {
  margin: 0;
  padding: 0.6rem 0.85rem;
  border-radius: 15px;
  font-size: 0.9rem;
  line-height: 1.5;
  white-space: pre-wrap;
}
.msg--a p {
  background: rgb(var(--v-theme-on-surface) / 0.06);
  border-bottom-left-radius: 5px;
}
.msg--u p {
  background: rgb(var(--v-theme-primary) / 0.16);
  border-bottom-right-radius: 5px;
}
.msg--new p {
  animation: pop 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
.msg__av {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 50%;
  font-size: 0.72rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #6d5cff, #22d3ee);
}
.msg__av--ghost {
  background: none;
}
.msg--typing .dots {
  display: flex;
  gap: 4px;
}
.msg--typing .dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-on-surface) / 0.4);
  animation: dot 1s ease-in-out infinite;
}
.msg--typing .dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.msg--typing .dots span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes dot {
  50% {
    transform: translateY(-4px);
    opacity: 0.5;
  }
}

/* ---- tool zone (flows under the messages, inside the scroll) ---- */
.ag__tool:not(:empty) {
  margin-top: 0.5rem;
  border-top: 1px solid var(--tvz-hairline);
  padding: 0.9rem 1rem 1.1rem;
  background: rgb(var(--v-theme-background) / 0.45);
}
.tl {
  margin: 0 0 0.5rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.cnt {
  font-weight: 600;
  letter-spacing: 0;
  color: rgb(var(--v-theme-primary));
}
.fx {
  color: rgb(var(--v-theme-success));
  font-weight: 700;
  letter-spacing: 0;
  text-transform: none;
}
.hint {
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.65);
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.sws {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.sw {
  --sw: #4f46e5;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--sw);
  border: 2px solid rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-on-surface) / 0.15);
  cursor: pointer;
  display: grid;
  place-items: center;
  color: #fff;
  transition: transform 0.12s ease;
}
.sw:hover {
  transform: translateY(-1px);
}
.sw.is-on {
  box-shadow:
    0 0 0 2px rgb(var(--v-theme-surface)),
    0 0 0 4px var(--sw);
}
.sws--sm .sw {
  width: 24px;
  height: 24px;
  border-radius: 7px;
}
.sw--c {
  position: relative;
  overflow: hidden;
}
.sw--c input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.hex {
  display: block;
  margin: 0.55rem 0 0;
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  font-family: var(--tvz-mono, monospace);
}

.drop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  width: 100%;
  min-height: 96px;
  border: 1.5px dashed rgb(var(--v-theme-on-surface) / 0.22);
  border-radius: 12px;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  font-size: 0.82rem;
  cursor: pointer;
  margin-bottom: 0.75rem;
}
.drop:hover {
  border-color: rgb(var(--v-theme-primary) / 0.5);
}
.drop input[type='file'] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.drop--f {
  border-style: solid;
  border-color: transparent;
  padding: 0;
  overflow: hidden;
  min-height: 0;
}
.drop--f img {
  width: 100%;
  max-height: 150px;
  object-fit: cover;
  display: block;
}
.drop--sm.drop--f img {
  max-height: 90px;
}
.drop__ov {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  gap: 0.4rem;
  justify-content: flex-end;
  padding: 0.4rem;
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.5));
}
.mini {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.92);
  color: #111;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}
.mini input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.drop.is-busy,
.pf__add.is-busy {
  pointer-events: none;
}

.fld {
  width: 100%;
  padding: 0.55rem 0.7rem;
  border-radius: 9px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font: inherit;
  font-size: 0.86rem;
  margin-bottom: 0.5rem;
}
.fld:focus {
  outline: 2px solid rgb(var(--v-theme-primary) / 0.4);
  outline-offset: 1px;
}
textarea.fld {
  resize: vertical;
  line-height: 1.45;
}
.fld--mini {
  font-size: 0.8rem;
  margin: 0.25rem 0 0;
}

.svc {
  list-style: none;
  margin: 0 0 0.6rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.svc__row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.55rem 0.6rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
}
.svc__grip {
  color: rgb(var(--v-theme-on-surface) / 0.35);
  margin-top: 0.1rem;
  flex: none;
  cursor: grab;
}
.svc__ic {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 8px;
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.12);
}
.svc__txt {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}
.svc__txt strong {
  font-size: 0.85rem;
}
.svc__d {
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  line-height: 1.4;
  cursor: text;
}
.svc__d .v-icon {
  opacity: 0;
  margin-left: 0.2rem;
}
.svc__row:hover .svc__d .v-icon {
  opacity: 0.5;
}

.pf {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
  gap: 0.45rem;
  margin-bottom: 0.6rem;
}
.pf__cell {
  position: relative;
  margin: 0;
  aspect-ratio: 1;
  border-radius: 9px;
  overflow: hidden;
  border: 1px solid var(--tvz-glass-border);
}
.pf__cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pf__x {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
}
.pf__add {
  position: relative;
  aspect-ratio: 1;
  border: 1.5px dashed rgb(var(--v-theme-on-surface) / 0.25);
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  cursor: pointer;
}
.pf__add:hover {
  border-color: rgb(var(--v-theme-primary) / 0.5);
}
.pf__add input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.lrow {
  display: flex;
  gap: 0.4rem;
  align-items: flex-start;
}
.lrow .fld {
  flex: 1;
}
.del {
  flex: none;
  width: 30px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  background: rgb(var(--v-theme-on-surface) / 0.06);
  cursor: pointer;
}
.del:hover {
  color: rgb(var(--v-theme-error));
}
.tcard {
  padding: 0.6rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 10px;
  margin-bottom: 0.5rem;
}
.tcard .lrow {
  margin-top: 0.4rem;
}

.cont {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.85rem;
  padding: 0.5rem 0.95rem;
  border-radius: 9px;
  font-size: 0.83rem;
  font-weight: 600;
  color: #fff;
  background: rgb(var(--v-theme-primary));
  cursor: pointer;
}
.cont:hover {
  filter: brightness(1.05);
}
.row2 {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
}
.row2 .cont {
  margin-top: 0;
}
.ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.45rem 0.8rem;
  border-radius: 9px;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  border: 1px solid rgb(var(--v-theme-primary) / 0.3);
  cursor: pointer;
}
.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ghost--xs {
  padding: 0.3rem 0.55rem;
  font-size: 0.74rem;
}
.uerr {
  margin: 0 0 0.5rem;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-error));
}
.tog {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  background: rgb(var(--v-theme-on-surface) / 0.08);
  cursor: pointer;
}
.tog.is-on {
  color: #fff;
  background: rgb(var(--v-theme-primary));
}

.ed {
  padding: 0.7rem 0;
  border-top: 1px solid var(--tvz-hairline);
}
.ed:first-of-type {
  border-top: 0;
}
.ed__k {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}

/* ---- footer: grammar toggle + input ---- */
.ag__foot {
  flex: none;
  border-top: 1px solid var(--tvz-hairline);
}
.gram {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.5rem 1rem;
  font-size: 0.76rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  border-bottom: 1px solid var(--tvz-hairline);
  cursor: pointer;
}
.gram.is-on {
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.06);
}
.gram__st {
  margin-left: auto;
  font-size: 0.64rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
}
.gram.is-on .gram__st {
  background: rgb(var(--v-theme-primary) / 0.16);
}

.inp {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.7rem;
}
.inp textarea {
  flex: 1;
  resize: none;
  max-height: 120px;
  padding: 0.6rem 0.8rem;
  border-radius: 14px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-background));
  color: inherit;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1.4;
}
.inp textarea:focus {
  outline: 2px solid rgb(var(--v-theme-primary) / 0.4);
  outline-offset: 1px;
}

.err {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 1rem;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-error));
  background: rgb(var(--v-theme-error) / 0.1);
}
.done {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.8rem 1rem;
}

/* ---- template picker ---- */
.tpls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.tpl {
  display: grid;
  grid-template-columns: 54px 1fr;
  grid-template-rows: auto auto;
  column-gap: 0.75rem;
  align-items: center;
  text-align: left;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background 0.14s ease;
}
.tpl:hover {
  border-color: rgb(var(--v-theme-primary) / 0.4);
}
.tpl.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.06);
}
.tpl strong {
  grid-column: 2;
  font-size: 0.9rem;
}
.tpl__d {
  grid-column: 2;
  font-size: 0.74rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  line-height: 1.35;
}
.tpl__mock {
  grid-row: 1 / span 2;
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 54px;
  height: 46px;
  padding: 5px;
  border-radius: 7px;
  background: rgb(var(--v-theme-on-surface) / 0.1);
  border: 1px solid rgb(var(--v-theme-on-surface) / 0.12);
  overflow: hidden;
}
.tpl__mock i {
  display: block;
  border-radius: 2px;
  background: rgb(var(--v-theme-on-surface) / 0.5);
}
.tpl.is-on .tpl__mock {
  background: rgb(var(--v-theme-primary) / 0.12);
  border-color: rgb(var(--v-theme-primary) / 0.3);
}
.tpl.is-on .tpl__mock i {
  background: rgb(var(--v-theme-primary));
}
/* classic: header bar + grid of cards */
.tpl__mock--classic i:nth-child(1) {
  height: 8px;
  width: 60%;
  margin-inline: auto;
}
.tpl__mock--classic i:nth-child(n + 2) {
  height: 9px;
  width: 46%;
}
.tpl__mock--classic {
  flex-flow: row wrap;
  align-content: flex-start;
  gap: 4px 8%;
}
/* bold: big left header + stacked rows */
.tpl__mock--bold i:nth-child(1) {
  height: 12px;
  width: 55%;
}
.tpl__mock--bold i:nth-child(n + 2) {
  height: 6px;
  width: 100%;
}
/* minimal: centered thin bars, airy */
.tpl__mock--minimal {
  justify-content: center;
  gap: 6px;
}
.tpl__mock--minimal i {
  height: 4px;
  width: 70%;
  margin-inline: auto;
}
.tpl__mock--minimal i:nth-child(1) {
  width: 40%;
}
.restart {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  cursor: pointer;
}
.restart:hover {
  color: rgb(var(--v-theme-on-surface) / 0.8);
}

/* ---- stacked (phone / narrow) ---- */
@media (max-width: 760px) {
  .ag {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .ag__stage {
    border-right: 0;
    border-bottom: 1px solid var(--tvz-hairline);
    padding: 0.65rem 0.9rem;
    background: linear-gradient(110deg, #241f6b, #14123a);
  }
  .ag__blob {
    display: none;
  }
  .ag__stageIn {
    flex-direction: row;
    flex-wrap: wrap;
    text-align: left;
    align-items: center;
    gap: 0.1rem 0.7rem;
  }
  .ag__avatar {
    width: 52px !important;
    height: 52px !important;
  }
  .ag__name {
    margin: 0;
    font-size: 0.98rem;
  }
  .ag__role {
    display: none;
  }
  .ag__chip {
    margin: 0;
    order: 2;
    font-size: 0.68rem;
    padding: 0.2rem 0.55rem;
  }
  .ag__bar {
    order: 9;
    flex-basis: 100%;
    max-width: none;
    margin-top: 0.4rem;
  }
  .ag__status {
    order: 10;
    flex-basis: 100%;
    margin-top: 0.25rem;
  }
  .ag__log {
    padding: 0.85rem;
  }
  .msg {
    max-width: 94%;
  }
  .ag__tool:not(:empty) {
    padding: 0.85rem 0.9rem 1rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ag__bar span,
  .msg--new p,
  .msg--typing .dots span,
  .ag__blob {
    transition: none;
    animation: none;
  }
}
</style>
