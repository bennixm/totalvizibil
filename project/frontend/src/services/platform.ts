import { apiFetch } from './api'

export interface PlatformPricing {
  advancedBuilderPriceCredits: number
  additionalBusinessPriceCredits: number
  eurRonRate: number
  affiliateEnabled: boolean
  affiliateRewardCredits: number
  affiliateMinDepositCredits: number
}

export function fetchPricing(): Promise<PlatformPricing> {
  return apiFetch<PlatformPricing>('/platform/pricing')
}
