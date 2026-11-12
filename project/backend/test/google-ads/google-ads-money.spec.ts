import { creditsToAmountMicros } from 'src/google-ads/google-ads-money';

describe('creditsToAmountMicros', () => {
  it('converts EUR 1:1 (1 credit = 1 EUR)', () => {
    expect(creditsToAmountMicros(5, 'EUR', 5)).toBe('5000000');
  });

  it('converts RON through the live EUR/RON rate', () => {
    // 10 credits = 10 EUR = 50 RON at a 5 EUR->RON rate.
    expect(creditsToAmountMicros(10, 'RON', 5)).toBe('50000000');
  });

  it('rounds fractional micros to the nearest integer', () => {
    expect(creditsToAmountMicros(1.23456789, 'EUR', 5)).toBe('1234568');
  });

  it('throws on an unsupported currency instead of writing a wrong amount', () => {
    expect(() => creditsToAmountMicros(5, 'USD', 5)).toThrow(/unsupported/i);
  });
});
