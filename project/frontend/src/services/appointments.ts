import { apiFetch } from './api'

export interface AvailableSlot {
  startsAt: string
  endsAt: string
}

export interface AvailableSlotsResponse {
  enabled: boolean
  slots: AvailableSlot[]
}

/** Live-computed on every call, never cached client-side — the whole point
 *  is that a slot taken a second ago is already gone from the next fetch. */
export function getAvailableSlots(slug: string, dateISO: string): Promise<AvailableSlotsResponse> {
  return apiFetch<AvailableSlotsResponse>(
    `/public/companies/${slug}/appointments/slots?date=${encodeURIComponent(dateISO)}`,
  )
}

export interface BookAppointmentInput {
  startsAt: string
  name: string
  email?: string
  phone?: string
  notes?: string
}

export function bookAppointment(
  slug: string,
  input: BookAppointmentInput,
): Promise<{ ok: boolean; error?: string }> {
  return apiFetch<{ ok: boolean; error?: string }>(`/public/companies/${slug}/appointments`, {
    method: 'POST',
    body: input,
  })
}
