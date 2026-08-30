import { apiFetch } from './api'

export interface GeoCity {
  name: string
  county: string
  lat: number
  lng: number
}

/** Type-ahead city search for the location step. */
export async function searchCities(q: string): Promise<GeoCity[]> {
  const query = q.trim()
  const { data } = await apiFetch<{ data: GeoCity[] }>(
    `/geo/cities${query ? `?q=${encodeURIComponent(query)}` : ''}`,
  )
  return data
}
