import { inject, type InjectionKey } from 'vue'

import { googleAdsUserApi } from '@/services/googleAdsUser'

/** The calls the campaign sections make. The owner's pages use their own
 *  API; the admin panel provides the staff one for the same components. */
export type AdsApi = Pick<
  typeof googleAdsUserApi,
  | 'detail'
  | 'sync'
  | 'quote'
  | 'startCycle'
  | 'actions'
  | 'activity'
  | 'saveSettings'
  | 'pause'
  | 'resume'
  | 'approve'
  | 'reject'
>

export const ADS_API: InjectionKey<AdsApi> = Symbol('ads-api')

export function useAdsApi(): { api: AdsApi; staff: boolean } {
  const staffApi = inject(ADS_API, null)
  return { api: staffApi ?? googleAdsUserApi, staff: !!staffApi }
}
