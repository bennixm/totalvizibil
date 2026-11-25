import { isUsableCustomer } from '../../src/google-ads-user/google-ads-user.service';

describe('isUsableCustomer', () => {
  it('accepts enabled accounts and test accounts (Google reports those as CLOSED)', () => {
    expect(isUsableCustomer('ENABLED', false)).toBe(true);
    expect(isUsableCustomer(undefined, false)).toBe(true);
    expect(isUsableCustomer('CLOSED', true)).toBe(true);
  });

  it('rejects closed, cancelled and suspended accounts', () => {
    expect(isUsableCustomer('CLOSED', false)).toBe(false);
    expect(isUsableCustomer('CANCELED', false)).toBe(false);
    expect(isUsableCustomer('CANCELED', true)).toBe(false);
    expect(isUsableCustomer('SUSPENDED', false)).toBe(false);
  });
});
