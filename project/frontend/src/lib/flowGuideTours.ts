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
  mode?: 'easy' | 'advanced' | 'ads'
  tips: GuideTip[]
  /** Controls the guide card must never sit on top of on this page. */
  avoid?: string[]
}

const g = (name: string): string => `[data-guide="${name}"]`

export const TOURS: Record<string, GuideTour> = {
  // Navbar entry: build from scratch or optimize a Google Ads campaign.
  start: {
    page: 'start',
    step: 'plan',
    tips: [
      { id: 'st-scratch', target: g('start-scratch'), key: 'guide.tip.startScratch', icon: 'mdi-rocket-launch-outline' },
      { id: 'st-optimize', target: g('start-optimize'), key: 'guide.tip.startOptimize', icon: 'mdi-google-ads' },
    ],
  },
  // --- Google Ads optimization builder ---
  'ads-connect': {
    page: 'ads-connect',
    step: 'connect',
    mode: 'ads',
    tips: [
      { id: 'ad-connect', target: g('ads-connect'), key: 'guide.tip.adsConnect', icon: 'mdi-google' },
      { id: 'ad-free', target: g('ads-free'), key: 'guide.tip.adsFree', icon: 'mdi-gift-outline' },
    ],
  },
  'ads-campaigns': {
    page: 'ads-campaigns',
    step: 'campaign',
    mode: 'ads',
    tips: [
      { id: 'ad-accounts', target: g('ads-accounts'), key: 'guide.tip.adsAccounts', icon: 'mdi-briefcase-outline' },
      { id: 'ad-list', target: g('ads-campaign-list'), key: 'guide.tip.adsCampaignList', icon: 'mdi-format-list-checks' },
      { id: 'ad-next', target: g('ads-campaign-continue'), key: 'guide.tip.adsCampaignContinue', icon: 'mdi-arrow-right-circle-outline' },
    ],
  },
  'ads-account': {
    page: 'ads-account',
    step: 'account',
    mode: 'ads',
    tips: [
      { id: 'ad-signed', target: g('ads-account-signed'), key: 'guide.tip.adsAccountSigned', icon: 'mdi-account-check-outline' },
      { id: 'ad-new', target: g('ads-account-new'), key: 'guide.tip.adsAccountNew', icon: 'mdi-account-plus-outline' },
      { id: 'ad-login', target: g('ads-account-login'), key: 'guide.tip.adsAccountLogin', icon: 'mdi-login-variant' },
      { id: 'ad-verify', target: g('ads-account-verify'), key: 'guide.tip.adsAccountVerify', icon: 'mdi-email-check-outline', contextual: true },
    ],
  },
  'ads-dashboard': {
    page: 'ads-dashboard',
    step: 'dashboard',
    mode: 'ads',
    tips: [
      { id: 'ad-tabs', target: g('ads-tabs'), key: 'guide.tip.adsTabs', icon: 'mdi-tab' },
      { id: 'ad-quote', target: g('ads-quote'), key: 'guide.tip.adsQuote', icon: 'mdi-magnify-scan', contextual: true },
      { id: 'ad-price', target: g('ads-price'), key: 'guide.tip.adsPrice', icon: 'mdi-cash-check', contextual: true },
      { id: 'ad-start', target: g('ads-start'), key: 'guide.tip.adsStart', icon: 'mdi-play-circle-outline', contextual: true },
      { id: 'ad-props', target: g('ads-proposals'), key: 'guide.tip.adsProposals', icon: 'mdi-account-check-outline', contextual: true },
      { id: 'ad-settings', target: g('ads-settings'), key: 'guide.tip.adsSettings', icon: 'mdi-tune-variant', contextual: true },
    ],
  },
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
      { id: 'un-add', target: g('unl-add-credits'), key: 'guide.tip.unlAddCredits', icon: 'mdi-plus-circle-outline' },
      { id: 'un-pay', target: g('unl-pay'), key: 'guide.tip.unlPay', icon: 'mdi-arrow-right-circle-outline' },
    ],
  },
  // Detour from the unlock step when credits are short: top up, then go back.
  'wallet-unlock': {
    page: 'wallet-unlock',
    step: 'unlock',
    mode: 'advanced',
    tips: [
      { id: 'wu-why', target: g('wallet-unlock-banner'), key: 'guide.tip.walletUnlock', icon: 'mdi-lock-open-variant-outline' },
      { id: 'wu-topup', target: g('wallet-topup'), key: 'guide.tip.walletTopup', icon: 'mdi-wallet-plus-outline' },
      { id: 'wu-back', target: g('wallet-unlock-return'), key: 'guide.tip.walletBack', icon: 'mdi-arrow-left-circle-outline' },
      { id: 'wu-ready', target: `${g('wallet-unlock-return')}.is-ready`, key: 'guide.tip.walletReady', icon: 'mdi-lock-open-check-outline', contextual: true },
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
    case 'start':
      return TOURS.start
    case 'ads-connect':
      return TOURS['ads-connect']
    case 'ads-campaigns':
      return TOURS['ads-campaigns']
    case 'ads-account':
      return TOURS['ads-account']
    case 'ads-dashboard':
      return TOURS['ads-dashboard']
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
    case 'wallet':
      // Only while the "add credits, then back to unlock" detour is active.
      return route.query.from === 'unlock' && route.query.flow !== 'upgrade'
        ? TOURS['wallet-unlock']
        : null
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
