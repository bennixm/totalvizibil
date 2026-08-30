import { createHash } from 'node:crypto';

export type LeadChannelName = 'form' | 'call';

export interface RawLeadInput {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
}

export interface CleanLead {
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimTo(v: string | undefined, max: number): string | null {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Dedupe / spam window. A `call` tap is de-duplicated per hour (someone
 * mashing the button counts once); a `form` submit per 2-minute bucket (kills
 * accidental double-submits without blocking a genuine follow-up message).
 */
export function leadWindow(channel: LeadChannelName, now: Date = new Date()): string {
  const iso = now.toISOString(); // 2026-08-30T23:56:24.000Z
  if (channel === 'call') return iso.slice(0, 13); // yyyy-mm-ddTHH
  const mins = now.getUTCMinutes();
  return `${iso.slice(0, 13)}:${String(Math.floor(mins / 2) * 2).padStart(2, '0')}`;
}

/** Privacy-safe visitor id — only the hash is ever stored. */
export function leadFingerprint(
  ip: string | undefined | null,
  userAgent: string | undefined | null,
  companyId: string,
  channel: LeadChannelName,
  now: Date = new Date(),
): string {
  const parts = [
    (ip ?? '').trim(),
    (userAgent ?? '').trim().slice(0, 400),
    companyId,
    channel,
    leadWindow(channel, now),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Validate + normalise a public lead submission. A `form` needs a message and
 * at least one way to reply; a `call` carries no visitor data.
 */
export function cleanLeadInput(
  channel: LeadChannelName,
  input: RawLeadInput,
): { ok: true; value: CleanLead } | { ok: false; error: string } {
  if (channel === 'call') {
    return { ok: true, value: { name: null, email: null, phone: null, message: null } };
  }

  const name = trimTo(input.name, 120);
  const email = trimTo(input.email, 200);
  const phone = trimTo(input.phone, 40);
  const message = trimTo(input.message, 4000);

  if (!message || message.length < 2) return { ok: false, error: 'message_required' };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'invalid_email' };
  if (!email && !phone) return { ok: false, error: 'contact_required' };

  return { ok: true, value: { name, email, phone, message } };
}
