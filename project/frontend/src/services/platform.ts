import { apiFetch } from './api'

export interface PlatformPricing {
  advancedBuilderPriceCredits: number
  additionalBusinessPriceCredits: number
  eurRonRate: number
}

export function fetchPricing(): Promise<PlatformPricing> {
  return apiFetch<PlatformPricing>('/platform/pricing')
}
