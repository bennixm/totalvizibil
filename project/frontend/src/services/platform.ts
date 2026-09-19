import { apiFetch } from './api'

export interface PlatformPricing {
  advancedBuilderPriceCredits: number
  additionalBusinessPriceCredits: number
  eurRonRate: number
  affiliateEnabled: boolean
  affiliateRewardCredits: number
  affiliateMinDepositCredits: number
  creditsDiscountEnabled: boolean
  creditsDiscountPct: number
}

export function fetchPricing(): Promise<PlatformPricing> {
  return apiFetch<PlatformPricing>('/platform/pricing')
}
