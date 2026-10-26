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
 *  from the dropdown directly (no map click yet to anchor an exact point).
 *  Județe are a fixed, closed set with stable centers, so the result is
 *  cached (by name) for the life of the page: the location pickers re-fetch
 *  every currently-selected county on every single selection tick, and
 *  without this cache that's an unbounded, ever-growing burst of identical
 *  requests re-racing each other as the user clicks through a long list. */
const countyCenterCache = new Map<string, Promise<GeoCity>>()
export function countyCenter(name: string): Promise<GeoCity> {
  let cached = countyCenterCache.get(name)
  if (!cached) {
    cached = apiFetch<GeoCity>(`/geo/county-center?name=${encodeURIComponent(name)}`)
    cached.catch(() => countyCenterCache.delete(name)) // don't cache a failed lookup
    countyCenterCache.set(name, cached)
  }
  return cached
}
