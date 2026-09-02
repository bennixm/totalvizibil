// Website content model — mirrors backend src/website/website.types.ts.
// Used to render generated company websites on the public company page.

export type SectionType =
  | 'hero'
  | 'about'
  | 'services'
  | 'features'
  | 'gallery'
  | 'testimonials'
  | 'faq'
  | 'contact'
  | 'cta'

export interface Section {
  id: string
  type: SectionType
  visible: boolean
  [key: string]: unknown
}

export interface WebsitePage {
  slug: string
  title: string
  isHome: boolean
  sections: Section[]
}

export interface WebsiteContent {
  pages: WebsitePage[]
  seo: { title: string; description: string; schemaType: string }
}

export interface WebsiteTheme {
  palette: 'indigo' | 'emerald' | 'amber' | 'slate' | 'rose'
  fontPair: 'grotesk-inter' | 'serif-sans' | 'mono-sans'
  radius: 'sharp' | 'soft' | 'round'
  density: 'compact' | 'comfortable' | 'spacious'
  /** Custom brand colour (`#rrggbb`) from the Simple-site builder; overrides `palette`. */
  accent?: string
}
