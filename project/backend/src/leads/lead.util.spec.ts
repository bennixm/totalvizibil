import { cleanLeadInput, leadFingerprint, leadWindow } from './lead.util';

describe('leadWindow', () => {
  it('buckets a call per hour', () => {
    const a = leadWindow('call', new Date('2026-08-30T23:10:00.000Z'));
    const b = leadWindow('call', new Date('2026-08-30T23:55:00.000Z'));
    const c = leadWindow('call', new Date('2026-08-31T00:05:00.000Z'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('buckets a form per 2 minutes', () => {
    const a = leadWindow('form', new Date('2026-08-30T23:10:15.000Z'));
    const b = leadWindow('form', new Date('2026-08-30T23:11:59.000Z'));
    const c = leadWindow('form', new Date('2026-08-30T23:12:01.000Z'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('leadFingerprint', () => {
  it('is stable within the window and varies by channel / company / visitor', () => {
    const t = new Date('2026-08-30T23:10:00.000Z');
    const base = leadFingerprint('1.2.3.4', 'UA', 'co-1', 'form', t);
    expect(leadFingerprint('1.2.3.4', 'UA', 'co-1', 'form', t)).toBe(base);
    expect(leadFingerprint('1.2.3.4', 'UA', 'co-1', 'call', t)).not.toBe(base);
    expect(leadFingerprint('1.2.3.4', 'UA', 'co-2', 'form', t)).not.toBe(base);
    expect(leadFingerprint('9.9.9.9', 'UA', 'co-1', 'form', t)).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).not.toContain('1.2.3.4');
  });
});

describe('cleanLeadInput', () => {
  it('accepts a form with a message and an email', () => {
    const r = cleanLeadInput('form', { name: '  Ana  ', email: 'ana@x.ro', message: 'Salut' });
    expect(r).toEqual({
      ok: true,
      value: { name: 'Ana', email: 'ana@x.ro', phone: null, message: 'Salut' },
    });
  });

  it('rejects a form with no message', () => {
    expect(cleanLeadInput('form', { email: 'a@b.ro' })).toEqual({
      ok: false,
      error: 'message_required',
    });
  });

  it('rejects a form with a message but no way to reply', () => {
    expect(cleanLeadInput('form', { message: 'Salut' })).toEqual({
      ok: false,
      error: 'contact_required',
    });
  });

  it('rejects a malformed email', () => {
    expect(cleanLeadInput('form', { message: 'Salut', email: 'nope' })).toEqual({
      ok: false,
      error: 'invalid_email',
    });
  });

  it('accepts a phone-only form', () => {
    const r = cleanLeadInput('form', { message: 'Sună-mă', phone: '0712 345 678' });
    expect(r.ok).toBe(true);
  });

  it('ignores visitor fields for a call', () => {
    expect(cleanLeadInput('call', { name: 'x', message: 'y' })).toEqual({
      ok: true,
      value: { name: null, email: null, phone: null, message: null },
    });
  });
});
