import type { RouteLocationNormalizedLoaded } from 'vue-router'

/**
 * The separate areas of the signed-in app. Each product has its own panel:
 * sites (and their feed campaigns), Google Ads, and later the graphics
 * builders. A new product = one entry here, `meta.workspace` on its routes,
 * its sidebar groups in useUserNavGroups and, if it has a list of items to
 * switch between, a section in SidebarCampaignSwitch.
 *
 * Routes WITHOUT `meta.workspace` and outside `SITE_ROUTES` (wallet,
 * invoices, support, account...) belong to nobody: opening them keeps the
 * area the user was in.
 */
export type WorkspaceId = 'site' | 'ads'

export interface Workspace {
  id: WorkspaceId
  icon: string
  /** i18n keys under `nav.workspace`. */
  label: string
  hint: string
  home: { name: string }
}

export const WORKSPACES: readonly Workspace[] = [
  {
    id: 'site',
    icon: 'mdi-web',
    label: 'nav.workspace.site',
    hint: 'nav.workspace.siteHint',
    home: { name: 'dashboard' },
  },
  {
    id: 'ads',
    icon: 'mdi-google-ads',
    label: 'nav.workspace.ads',
    hint: 'nav.workspace.adsHint',
    home: { name: 'ads-home' },
  },
]

export function isWorkspaceId(v: unknown): v is WorkspaceId {
  return WORKSPACES.some((w) => w.id === v)
}

/** Pages of the site area (business panel and its builders). */
const SITE_ROUTES = new Set([
  'dashboard',
  'campaign',
  'campaign-budget',
  'campaign-optimize',
  'consumption',
  'location',
  'category',
  'leads',
  'appointments',
  'website-settings',
  'website-builder',
  'easy-site-editor',
])

/** The area a route belongs to, or null for shared pages. */
export function workspaceOfRoute(
  route: Pick<RouteLocationNormalizedLoaded, 'name' | 'meta'>,
): WorkspaceId | null {
  if (isWorkspaceId(route.meta.workspace)) return route.meta.workspace
  return SITE_ROUTES.has(String(route.name)) ? 'site' : null
}
