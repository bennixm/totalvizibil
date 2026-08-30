import { CREDIT_MINOR, creditsToMinor, eurCentsToRonBani, minorToCredits, money } from './money';

describe('money helpers', () => {
  it('1 credit = 100 minor units = 1 EUR', () => {
    expect(CREDIT_MINOR).toBe(100);
    expect(creditsToMinor(1)).toBe(100);
    expect(creditsToMinor(50)).toBe(5000);
  });

  it('round-trips minor <-> credits', () => {
    expect(minorToCredits(7400)).toBe(74);
    expect(minorToCredits(150)).toBe(1.5);
    expect(creditsToMinor(minorToCredits(12345))).toBe(12345);
  });

  it('creditsToMinor rounds fractional credits to the nearest minor unit', () => {
    expect(creditsToMinor(0.005)).toBe(1);
    expect(creditsToMinor(0.004)).toBe(0);
  });

  it('converts EUR cents to RON bani at the given rate, rounded to the ban', () => {
    // 50 credits = €50 = 5000 cents; rate 5.10 -> 255.00 RON = 25500 bani
    expect(eurCentsToRonBani(5000, 5.1)).toBe(25500);
    // rate 5.0512 -> 5000 * 5.0512 = 25256 bani (rounded)
    expect(eurCentsToRonBani(5000, 5.0512)).toBe(25256);
  });

  it('money() exposes both minor and credit views', () => {
    expect(money(7400)).toEqual({ minor: 7400, credits: 74 });
  });
});
