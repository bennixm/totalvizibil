/**
 * Content of the optional "Devino vizibil" guide (components/guide/FlowGuide.vue).
 *
 * Every tip points at an element that ALREADY exists in the flow's views,
 * marked with an inert `data-guide="…"` attribute. A tip whose element is not
 * currently rendered (a v-if branch not taken, a mobile-only control on
 * desktop, …) is simply skipped, so the guide can only ever describe what the
 * user can actually see. Nothing here reads or writes app state.
 */
import type { RouteLocationNormalizedLoaded } from 'vue-router'

import type { FlowStep } from './flowSteps'

export interface GuideTip {
  /** Stable id, used to remember which contextual tips were already shown. */
  id: string
  /** CSS selector of the real element to highlight. */
  target: string
  /** i18n base key: `${key}.title` / `${key}.text`. */
  key: string
  icon: string
  only?: 'mobile' | 'desktop'
  /**
   * Contextual: pops up by itself (once) the first time its element appears,
   * e.g. the email-code form after submitting the account form.
   */
  contextual?: boolean
}

export interface GuideTour {
  /** Page key, used to remember that this page's tips were seen/dismissed. */
  page: string
  /** The flow step this page is, for the "Step X of N" chip. */
  step: FlowStep
  /** Fixed plan for pages that only exist in one plan; otherwise resolved live. */
  mode?: 'easy' | 'advanced'
  tips: GuideTip[]
  /** Controls the guide card must never sit on top of on this page. */
  avoid?: string[]
}

const g = (name: string): string => `[data-guide="${name}"]`

export const TOURS: Record<string, GuideTour> = {
  plan: {
    page: 'plan',
    step: 'plan',
    tips: [
      { id: 'plan-easy', target: g('plan-easy'), key: 'guide.tip.planEasy', icon: 'mdi-flash-outline' },
      { id: 'plan-adv', target: g('plan-advanced'), key: 'guide.tip.planAdvanced', icon: 'mdi-tune-vertical' },
      { id: 'plan-later', target: g('plan-foot'), key: 'guide.tip.planLater', icon: 'mdi-account-clock-outline' },
    ],
  },
  'build-easy': {
    page: 'build-easy',
    step: 'build',
    mode: 'easy',
    avoid: [g('studio-composer')],
    tips: [
      { id: 'se-chat', target: g('studio-composer'), key: 'guide.tip.studioChat', icon: 'mdi-message-text-outline' },
      { id: 'se-progress', target: g('studio-progress'), key: 'guide.tip.studioProgress', icon: 'mdi-progress-check' },
      { id: 'se-tabs', target: g('studio-tabs'), key: 'guide.tip.studioTabs', icon: 'mdi-monitor-cellphone', only: 'mobile' },
      { id: 'se-preview', target: g('studio-preview'), key: 'guide.tip.studioPreview', icon: 'mdi-monitor', only: 'desktop' },
      { id: 'se-photos', target: g('studio-photos'), key: 'guide.tip.studioPhotos', icon: 'mdi-image-multiple-outline', contextual: true },
      { id: 'se-custom', target: g('studio-customize'), key: 'guide.tip.studioCustomize', icon: 'mdi-palette-outline', contextual: true },
      { id: 'se-next', target: g('studio-continue'), key: 'guide.tip.studioContinue', icon: 'mdi-arrow-right-circle-outline', contextual: true },
    ],
  },
  pitch: {
    page: 'pitch',
    step: 'pitch',
    mode: 'advanced',
    tips: [
      { id: 'pi-name', target: `${g('pitch-name')} .v-field`, key: 'guide.tip.pitchName', icon: 'mdi-domain' },
      { id: 'pi-cta', target: g('pitch-cta'), key: 'guide.tip.pitchCta', icon: 'mdi-arrow-right-circle-outline' },
    ],
  },
  location: {
    page: 'location',
    step: 'location',
    tips: [
      { id: 'lo-cat', target: g('loc-category'), key: 'guide.tip.locCategory', icon: 'mdi-shape-outline' },
      { id: 'lo-area', target: `${g('loc-area')} .v-field`, key: 'guide.tip.locArea', icon: 'mdi-map-marker-outline' },
      { id: 'lo-map', target: g('loc-map'), key: 'guide.tip.locMap', icon: 'mdi-map-marker-radius-outline', contextual: true },
      { id: 'lo-next', target: g('loc-continue'), key: 'guide.tip.locContinue', icon: 'mdi-arrow-right-circle-outline' },
    ],
  },
  account: {
    page: 'account',
    step: 'account',
    tips: [
      { id: 'ac-new', target: g('acc-new'), key: 'guide.tip.accNew', icon: 'mdi-account-plus-outline' },
      { id: 'ac-signed', target: g('acc-signed'), key: 'guide.tip.accSigned', icon: 'mdi-account-check-outline' },
      { id: 'ac-verify', target: g('acc-verify'), key: 'guide.tip.accVerify', icon: 'mdi-email-check-outline', contextual: true },
    ],
  },
  unlock: {
    page: 'unlock',
    step: 'unlock',
    mode: 'advanced',
    tips: [
      { id: 'un-price', target: g('unl-price'), key: 'guide.tip.unlPrice', icon: 'mdi-lock-open-variant-outline' },
      { id: 'un-short', target: g('unl-short'), key: 'guide.tip.unlShort', icon: 'mdi-wallet-plus-outline', contextual: true },
      { id: 'un-pay', target: g('unl-pay'), key: 'guide.tip.unlPay', icon: 'mdi-arrow-right-circle-outline' },
    ],
  },
  'build-advanced': {
    page: 'build-advanced',
    step: 'build',
    mode: 'advanced',
    avoid: [g('v2-composer'), g('v2-actions')],
    tips: [
      { id: 'v2-chat', target: g('v2-composer'), key: 'guide.tip.v2Chat', icon: 'mdi-chat-outline' },
      { id: 'v2-tabs', target: g('v2-tabs'), key: 'guide.tip.v2Tabs', icon: 'mdi-monitor-cellphone', only: 'mobile' },
      { id: 'v2-preview', target: g('v2-preview'), key: 'guide.tip.v2Preview', icon: 'mdi-monitor', only: 'desktop' },
      { id: 'v2-publish', target: g('v2-publish'), key: 'guide.tip.v2Publish', icon: 'mdi-cloud-upload-outline' },
      { id: 'v2-next', target: g('v2-continue'), key: 'guide.tip.v2Continue', icon: 'mdi-arrow-right-circle-outline' },
    ],
  },
  budget: {
    page: 'budget',
    step: 'budget',
    avoid: [g('budget-actions')],
    tips: [
      { id: 'bu-auto', target: g('budget-auto'), key: 'guide.tip.budgetAuto', icon: 'mdi-robot-outline' },
      { id: 'bu-tiers', target: g('budget-tiers'), key: 'guide.tip.budgetTiers', icon: 'mdi-podium' },
      { id: 'bu-fields', target: g('budget-fields'), key: 'guide.tip.budgetFields', icon: 'mdi-cash-multiple' },
      { id: 'bu-short', target: `${g('budget-funding')}.is-short`, key: 'guide.tip.budgetShort', icon: 'mdi-wallet-plus-outline', contextual: true },
      { id: 'bu-save', target: g('budget-actions'), key: 'guide.tip.budgetSave', icon: 'mdi-content-save-outline' },
    ],
  },
  launch: {
    page: 'launch',
    step: 'launch',
    avoid: [g('launch-finish')],
    tips: [
      { id: 'la-activate', target: g('launch-control'), key: 'guide.tip.launchActivate', icon: 'mdi-broadcast' },
      { id: 'la-links', target: g('launch-links'), key: 'guide.tip.launchLinks', icon: 'mdi-tune-variant' },
      { id: 'la-finish', target: g('launch-finish'), key: 'guide.tip.launchFinish', icon: 'mdi-flag-checkered' },
    ],
  },
}

/**
 * Which guide (if any) belongs to the current route. Mirrors exactly when each
 * view shows its own progress strip: the panel pages (budget, launch, builder)
 * only count as part of the flow while `?flow=onboarding` is present.
 */
export function tourForRoute(route: RouteLocationNormalizedLoaded): GuideTour | null {
  const inFlow = route.query.flow === 'onboarding'
  switch (route.name) {
    case 'create':
      return TOURS.plan
    case 'create-easy':
      return TOURS['build-easy']
    case 'create-advanced':
      return TOURS.pitch
    case 'create-location':
      return TOURS.location
    case 'create-account':
      return TOURS.account
    case 'create-unlock':
      return route.query.flow === 'upgrade' ? null : TOURS.unlock
    case 'website-builder':
      return inFlow ? TOURS['build-advanced'] : null
    case 'campaign-budget':
      return inFlow ? TOURS.budget : null
    case 'campaign':
      return inFlow ? TOURS.launch : null
    default:
      return null
  }
}
