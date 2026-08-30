import { apiFetch } from './api'

export interface LeadFormInput {
  name?: string
  email?: string
  phone?: string
  message: string
}

/** Send a contact-form request from a company's public site. */
export function submitLead(slug: string, input: LeadFormInput): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/public/companies/${slug}/lead`, {
    method: 'POST',
    body: { channel: 'form', ...input },
  })
}

/**
 * Record a tap on the "call" button. Fire-and-forget — `keepalive` lets it
 * finish while the phone app opens; failures are swallowed.
 */
export function trackCall(slug: string): void {
  void apiFetch(`/public/companies/${slug}/lead`, {
    method: 'POST',
    body: { channel: 'call' },
    keepalive: true,
    timeoutMs: 4000,
  }).catch(() => {})
}
