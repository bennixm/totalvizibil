/**
 * Money helpers for the credit ledger.
 *
 * Credits are EUR-denominated: 1 Credit = 1 EUR. Everything is stored as integer
 * MINOR units — hundredths of a credit, i.e. euro cents — so the ledger never
 * accumulates floating-point error.
 */

/** Minor units in one credit (and in one euro). */
export const CREDIT_MINOR = 100;

/** Whole/decimal credits -> minor units. */
export function creditsToMinor(credits: number): number {
  return Math.round(credits * CREDIT_MINOR);
}

/** Minor units -> credits (may be fractional). */
export function minorToCredits(minor: number): number {
  return minor / CREDIT_MINOR;
}

/**
 * Convert a EUR amount (in cents) to RON (in bani) at the given rate.
 * `rate` is EUR->RON (e.g. 5.0500). Rounds to the nearest ban.
 */
export function eurCentsToRonBani(eurCents: number, rate: number): number {
  return Math.round(eurCents * rate);
}

/** Shape returned to clients for any minor-unit amount. */
export function money(minor: number) {
  return { minor, credits: minorToCredits(minor) };
}
