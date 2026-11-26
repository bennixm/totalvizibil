/**
 * The platform's builders, as presented on the information pages
 * (`/ghid/*`). `route` is the REAL entry point of each builder, opened
 * unchanged by every CTA; `infoRoute` is its information page.
 */
export type BuilderKind = 'easy' | 'advanced' | 'ads'

export interface BuilderMeta {
  route: string
  infoRoute: string
  slug: string
  icon: string
  /** The page shows a live price line (`binfo.<kind>.price`). */
  priced: boolean
  createIcons: string[]
  capIcons: string[]
}

export const BUILDERS: Record<BuilderKind, BuilderMeta> = {
  easy: {
    route: 'create-easy',
    infoRoute: 'builder-info-easy',
    slug: 'site-simplu',
    icon: 'mdi-flash-outline',
    priced: false,
    createIcons: ['mdi-page-layout-body', 'mdi-text-box-edit-outline', 'mdi-email-fast-outline'],
    capIcons: ['mdi-palette-swatch-outline', 'mdi-format-color-fill', 'mdi-chat-processing-outline', 'mdi-pencil-outline'],
  },
  advanced: {
    route: 'create-advanced',
    infoRoute: 'builder-info-advanced',
    slug: 'builder-avansat',
    icon: 'mdi-code-tags',
    priced: true,
    createIcons: ['mdi-code-braces', 'mdi-file-multiple-outline', 'mdi-calendar-check-outline'],
    capIcons: ['mdi-file-code-outline', 'mdi-monitor-eye', 'mdi-image-plus-outline', 'mdi-rocket-launch-outline'],
  },
  ads: {
    route: 'ads-connect',
    infoRoute: 'builder-info-ads',
    slug: 'optimizare-google-ads',
    icon: 'mdi-google-ads',
    priced: true,
    createIcons: ['mdi-text-box-check-outline', 'mdi-gauge', 'mdi-view-dashboard-outline'],
    capIcons: [
      'mdi-tune-variant',
      'mdi-calendar-sync-outline',
      'mdi-cash-check',
      'mdi-bell-ring-outline',
      'mdi-link-variant-off',
    ],
  },
}

export const BUILDER_ORDER: BuilderKind[] = ['easy', 'advanced', 'ads']
