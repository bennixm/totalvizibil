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

/** Closest known city to a map point — keeps the city input in sync when the
 *  location pin is moved manually on the map. */
export async function nearestCity(lat: number, lng: number): Promise<GeoCity> {
  return apiFetch<GeoCity>(`/geo/nearest?lat=${lat}&lng=${lng}`)
}
