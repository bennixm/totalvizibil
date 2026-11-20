/**
 * The ordered steps of the "Devino vizibil" (create a business) flow, per plan.
 * Shared by the progress strip (OnboardingSteps.vue) and the optional guide
 * overlay (components/guide/FlowGuide.vue) so both always describe the same,
 * real sequence. Pure data: nothing here drives navigation.
 */
export const EASY_STEPS = ['plan', 'build', 'location', 'account', 'budget', 'launch'] as const
export const ADVANCED_STEPS = [
  'plan',
  'pitch',
  'location',
  'account',
  'unlock',
  'build',
  'budget',
  'launch',
] as const

/** "Optimize an existing Google Ads campaign" builder (/google-ads). */
export const ADS_STEPS = ['connect', 'campaign', 'account', 'dashboard'] as const

export type FlowMode = 'easy' | 'advanced' | 'ads'
export type FlowStep = (typeof ADVANCED_STEPS)[number] | (typeof ADS_STEPS)[number]

export function stepsFor(mode: FlowMode): readonly FlowStep[] {
  if (mode === 'ads') return ADS_STEPS
  return mode === 'advanced' ? ADVANCED_STEPS : EASY_STEPS
}
