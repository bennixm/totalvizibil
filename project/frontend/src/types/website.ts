// Website content model — mirrors backend src/website/website.types.ts.
// Used to render generated company websites on the public company page.

export type SectionType =
  | 'hero'
  | 'logos'
  | 'about'
  | 'stats'
  | 'services'
  | 'process'
  | 'features'
  | 'featureSplit'
  | 'gallery'
  | 'team'
  | 'testimonials'
  | 'pricing'
  | 'faq'
  | 'richText'
  | 'contact'
  | 'cta'
  | 'marquee'
  | 'bento'
  | 'timeline'
  | 'comparison'
  | 'banner'

export type SectionAnimation =
  | 'none'
  | 'fade'
  | 'rise'
  | 'slideLeft'
  | 'slideRight'
  | 'zoom'
  | 'blur'

export interface Section {
  id: string
  type: SectionType
  visible: boolean
  /** Design variant within the section type (Advanced builder catalog). */
  variant?: string
  /** Entrance animation; absent = inherit the theme's motion default. */
  animation?: string
  [key: string]: unknown
}

export interface WebsitePage {
  slug: string
  title: string
  isHome: boolean
  /** Show this page in the site's top nav (Advanced builder). Default true. */
  nav?: boolean
  sections: Section[]
}

export interface WebsiteContent {
  pages: WebsitePage[]
  seo: { title: string; description: string; schemaType: string }
}

export type ThemePalette =
  | 'indigo'
  | 'violet'
  | 'blue'
  | 'cyan'
  | 'teal'
  | 'emerald'
  | 'lime'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'fuchsia'
  | 'slate'
export type ThemeRadius = 'none' | 'subtle' | 'rounded' | 'large' | 'pill'
export type ThemeFont = 'grotesk' | 'inter' | 'fraunces' | 'jetbrains'

export interface WebsiteTheme {
  palette: ThemePalette
  fontPair: 'grotesk-inter' | 'serif-sans' | 'mono-sans'
  radius: ThemeRadius
  density: 'compact' | 'comfortable' | 'spacious'
  /** Custom brand colour (`#rrggbb`); overrides `palette`. */
  accent?: string
  /** Named style bundle chosen in the Advanced builder. */
  preset?: string
  background?: 'light' | 'tinted' | 'dark'
  headingFont?: ThemeFont
  bodyFont?: ThemeFont
  buttonStyle?: 'solid' | 'outline' | 'soft' | 'pill'
  shadow?: 'none' | 'soft' | 'bold'
  /** Scroll-animation intensity for the whole site (Advanced builder). */
  motion?: 'off' | 'subtle' | 'lively'
}
