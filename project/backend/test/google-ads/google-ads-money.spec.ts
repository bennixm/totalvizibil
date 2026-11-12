import { creditsToAmountMicros } from 'src/google-ads/google-ads-money';

describe('creditsToAmountMicros', () => {
  it('converts EUR 1:1 (1 credit = 1 EUR)', () => {
    expect(creditsToAmountMicros(5, 'EUR', 5)).toBe('5000000');
  });

  it('converts RON through the live EUR/RON rate', () => {
    // 10 credits = 10 EUR = 50 RON at a 5 EUR->RON rate.
    expect(creditsToAmountMicros(10, 'RON', 5)).toBe('50000000');
  });

  it('rounds to the nearest billable unit (10_000 micros = 1 cent), not just the nearest micro', () => {
    // 1234567.89 raw micros would round to 1234568 if rounded to the nearest
    // integer micro, but that isn't a multiple of 10_000 and Google Ads
    // would reject it outright.
    expect(creditsToAmountMicros(1.23456789, 'EUR', 5)).toBe('1230000');
  });

  it('never produces a value Google Ads would reject as VALUE_NOT_MULTIPLE_OF_BILLABLE_UNIT', () => {
    // Real bug: 1.1 credits at a 5.05 EUR->RON rate is 5.555 RON (3 decimal
    // places) -> 5555000 micros, which Google Ads rejected outright since
    // it isn't a multiple of the 10_000-micros billable unit.
    const micros = creditsToAmountMicros(1.1, 'RON', 5.05);
    expect(Number(micros) % 10_000).toBe(0);
    expect(micros).toBe('5560000'); // 5.555 rounds to the nearest cent, 5.56 RON
  });

  it('throws on an unsupported currency instead of writing a wrong amount', () => {
    expect(() => creditsToAmountMicros(5, 'USD', 5)).toThrow(/unsupported/i);
  });
});
