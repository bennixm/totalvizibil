import { onScopeDispose, toValue, watchEffect, type MaybeRefOrGetter } from 'vue'

const SITE_NAME = 'Totalvizibil'
const DEFAULT_TITLE = 'Totalvizibil — afaceri locale, găsite rapid'
const DEFAULT_DESCRIPTION =
  'Totalvizibil — descoperă afaceri locale pe categorii și zonă. Site web construit cu AI, listare în feed și campanii CPC.'

export interface SeoInput {
  /** Page title; the site name is appended unless it's already present. */
  title?: string
  description?: string
  /** Absolute path (e.g. `/c/instalatii/climatizare/acme`) → `<link rel="canonical">`. */
  canonicalPath?: string
  /** One or more schema.org objects → a single `<script type="application/ld+json">`. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
  /** Keep this route out of the index (thin/utility pages). */
  noindex?: boolean
}

function upsertMeta(selector: string, attrs: Record<string, string>): void {
  let el = document.head.querySelector<HTMLElement>(selector)
  if (!el) {
    el = document.createElement(selector.startsWith('link') ? 'link' : 'meta')
    document.head.appendChild(el)
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
}

function removeEl(selector: string): void {
  document.head.querySelector(selector)?.remove()
}

/**
 * Per-route SEO head management — title, description, canonical, robots and a
 * JSON-LD block. Dependency-free; reacts to the passed getter and cleans its
 * own tags up when the component unmounts.
 */
export function useSeo(input: MaybeRefOrGetter<SeoInput>): void {
  watchEffect(() => {
    const s = toValue(input)

    const title = s.title
      ? s.title.includes(SITE_NAME)
        ? s.title
        : `${s.title} · ${SITE_NAME}`
      : DEFAULT_TITLE
    document.title = title

    const description = s.description || DEFAULT_DESCRIPTION
    upsertMeta('meta[name="description"]', { name: 'description', content: description })
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title })
    upsertMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: description,
    })
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' })

    if (s.canonicalPath) {
      const href = new URL(s.canonicalPath, window.location.origin).href
      upsertMeta('link[rel="canonical"]', { rel: 'canonical', href })
      upsertMeta('meta[property="og:url"]', { property: 'og:url', content: href })
    } else {
      removeEl('link[rel="canonical"]')
    }

    upsertMeta('meta[name="robots"]', {
      name: 'robots',
      content: s.noindex ? 'noindex,follow' : 'index,follow',
    })

    removeEl('script[data-seo-jsonld]')
    if (s.jsonLd) {
      const script = document.createElement('script')
      script.type = 'application/ld+json'
      script.setAttribute('data-seo-jsonld', '')
      script.textContent = JSON.stringify(s.jsonLd)
      document.head.appendChild(script)
    }
  })

  onScopeDispose(() => {
    document.title = DEFAULT_TITLE
    removeEl('script[data-seo-jsonld]')
    upsertMeta('meta[name="robots"]', { name: 'robots', content: 'index,follow' })
    removeEl('link[rel="canonical"]')
  })
}
