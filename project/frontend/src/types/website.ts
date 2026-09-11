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
  | 'custom'
  | 'bigStatement'
  | 'highlightsRow'
  | 'ratingBand'
  | 'video'
  | 'showcase'
  | 'beforeAfter'
  | 'tabs'
  | 'hours'
  | 'caseStudy'
  | 'splitCta'
  | 'newsletter'
  | 'quoteBig'

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
  /** Owner colour overrides for this section. */
  style?: { bg?: string; text?: string; heading?: string; accent?: string }
  [key: string]: unknown
}

export interface WebsitePage {
  slug: string
  title: string
  isHome: boolean
  /** Show this page in the site's top nav (Advanced builder). Default true. */
  nav?: boolean
  /** Reserved legal page — editable text, not deletable/reorderable. */
  system?: 'privacy' | 'terms' | 'cookies'
  sections: Section[]
}

export interface SiteNavConfig {
  logo?: 'show' | 'hide'
  sticky?: boolean
  linkStyle?: 'text' | 'pill'
  showPages?: boolean
  cta?: { label: string; target: string } | null
}
export interface SiteFooterConfig {
  tagline?: string
  showLegal?: boolean
  showContact?: boolean
  socials?: { label: string; url: string }[]
}

export interface WebsiteContent {
  pages: WebsitePage[]
  seo: { title: string; description: string; schemaType: string }
  nav?: SiteNavConfig
  footer?: SiteFooterConfig
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
  /** Brand logo shown in the site nav + footer (both builders). */
  logoUrl?: string

  // --- typographic character (Advanced generator's Design DNA) ----------
  headingScale?: 'tight' | 'normal' | 'display'
  headingWeight?: 'regular' | 'medium' | 'semibold' | 'bold'
  headingAlign?: 'left' | 'center'
  bodyScale?: 'small' | 'normal' | 'large'
  lineHeight?: 'tight' | 'normal' | 'relaxed'
  letterSpacing?: 'tight' | 'normal' | 'wide'
  textWidth?: 'narrow' | 'normal' | 'wide'
}
