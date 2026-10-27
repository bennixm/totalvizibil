import { decomposeVat, isProfileComplete } from 'src/billing/billing.service';
import { canViewAnyInvoice } from 'src/billing/billing.controller';
import { AuthPrincipal } from 'src/auth/auth.types';
import { PlatformRole } from '@prisma/client';

describe('isProfileComplete', () => {
  const base = {
    kind: 'individual' as const,
    name: 'Ana Pop',
    address: 'Str. Exemplu 1',
    city: 'Cluj-Napoca',
    country: 'RO',
    taxId: null,
    regCom: null,
  };

  it('null profile is never complete', () => {
    expect(isProfileComplete(null)).toBe(false);
  });

  it('individual: complete with just name/address/city/country', () => {
    expect(isProfileComplete(base)).toBe(true);
  });

  it('individual: incomplete when any shared field is blank', () => {
    expect(isProfileComplete({ ...base, name: '' })).toBe(false);
    expect(isProfileComplete({ ...base, address: '   ' })).toBe(false);
    expect(isProfileComplete({ ...base, city: '' })).toBe(false);
    expect(isProfileComplete({ ...base, country: '' })).toBe(false);
  });

  it('company: incomplete without taxId + regCom even if shared fields are set', () => {
    expect(isProfileComplete({ ...base, kind: 'company', name: 'Acme SRL' })).toBe(false);
    expect(isProfileComplete({ ...base, kind: 'company', name: 'Acme SRL', taxId: 'RO123' })).toBe(
      false,
    );
  });

  it('company: complete once taxId + regCom are both set', () => {
    expect(
      isProfileComplete({
        ...base,
        kind: 'company',
        name: 'Acme SRL',
        taxId: 'RO123456',
        regCom: 'J40/123/2020',
      }),
    ).toBe(true);
  });
});

describe('decomposeVat', () => {
  it('0% (neplătitor de TVA): the whole amount is the subtotal, no VAT', () => {
    expect(decomposeVat(10000, 0)).toEqual({ subtotal: 10000, vat: 0 });
  });

  it('19%: decomposes a VAT-inclusive total back to a whole-ban subtotal', () => {
    // 119 RON paid at 19% VAT -> 100.00 subtotal + 19.00 VAT
    expect(decomposeVat(11900, 19)).toEqual({ subtotal: 10000, vat: 1900 });
  });

  it('subtotal + vat always reconstructs the exact total (rounding safe)', () => {
    for (const total of [101, 4999, 123456, 7]) {
      const { subtotal, vat } = decomposeVat(total, 19);
      expect(subtotal + vat).toBe(total);
    }
  });
});

describe('canViewAnyInvoice', () => {
  const principal = (platformRoles: PlatformRole[]): AuthPrincipal => ({
    id: 'u1',
    email: 'a@b.com',
    name: 'A',
    platformRoles,
    sessionId: 's1',
    emailVerifiedAt: new Date(),
  });

  it('admin and finance may open any user invoice (and the staff PDF download)', () => {
    expect(canViewAnyInvoice(principal(['admin']))).toBe(true);
    expect(canViewAnyInvoice(principal(['finance']))).toBe(true);
    expect(canViewAnyInvoice(principal(['moderator', 'finance']))).toBe(true);
  });

  it('every other principal stays scoped to their own invoices', () => {
    expect(canViewAnyInvoice(principal([]))).toBe(false);
    expect(canViewAnyInvoice(principal(['support']))).toBe(false);
    expect(canViewAnyInvoice(principal(['moderator']))).toBe(false);
  });
});
