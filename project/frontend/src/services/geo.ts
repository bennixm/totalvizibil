import { apiFetch } from './api'

export interface GeoCity {
  name: string
  county: string
  lat: number
  lng: number
}

/** The closed set of județe (+ București) the location step picks from. */
export async function fetchCounties(): Promise<string[]> {
  const { data } = await apiFetch<{ data: string[] }>('/geo/counties')
  return data
}

/** Type-ahead city search — used only to help pin the map, not for matching. */
export async function searchCities(q: string): Promise<GeoCity[]> {
  const query = q.trim()
  const { data } = await apiFetch<{ data: GeoCity[] }>(
    `/geo/cities${query ? `?q=${encodeURIComponent(query)}` : ''}`,
  )
  return data
}

/** Closest known city to a map point — keeps the city input in sync when the
 *  location pin is moved manually on the map. */
export async function nearestCity(lat: number, lng: number): Promise<GeoCity> {
  return apiFetch<GeoCity>(`/geo/nearest?lat=${lat}&lng=${lng}`)
}

/** A representative city for a județ — re-centres the map when it's picked
 *  from the dropdown directly (no map click yet to anchor an exact point). */
export async function countyCenter(name: string): Promise<GeoCity> {
  return apiFetch<GeoCity>(`/geo/county-center?name=${encodeURIComponent(name)}`)
}
