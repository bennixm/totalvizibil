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

export type FlowMode = 'easy' | 'advanced'
export type FlowStep = (typeof ADVANCED_STEPS)[number]

export function stepsFor(mode: FlowMode): readonly FlowStep[] {
  return mode === 'advanced' ? ADVANCED_STEPS : EASY_STEPS
}
