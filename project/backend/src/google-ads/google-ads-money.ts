/**
 * Google Ads requires every monetary `amountMicros`/`cpcBidMicros` value to
 * be a whole multiple of this "billable unit" (one cent, for every currency
 * this platform supports) — a value that isn't gets rejected outright with
 * `VALUE_NOT_MULTIPLE_OF_BILLABLE_UNIT`. A plain `credits * rate * 1e6` can
 * easily miss that (e.g. 1.1 credits at a 5.05 EUR→RON rate is 5.555 RON —
 * 3 decimal places, not 2), so every conversion rounds to the nearest
 * multiple of this unit rather than just the nearest whole micro.
 */
const BILLABLE_UNIT_MICROS = 10_000;

/**
 * Inverse of `GoogleAdsCpcSyncService.toCredits()` — converts a credits
 * amount (1 credit ≡ 1 EUR, same peg as the rest of the platform) into the
 * `amountMicros` string the Google Ads API expects, in the Google Ads
 * account's own currency. Only EUR/RON are wired up, matching the sync
 * service's conversion table exactly; any other currency throws rather than
 * silently writing a wrong budget/bid to a real campaign.
 */
export function creditsToAmountMicros(
  credits: number,
  accountCurrencyCode: string,
  eurRonRate: number,
): string {
  let amountInAccountCurrency: number;
  switch (accountCurrencyCode) {
    case 'EUR':
      amountInAccountCurrency = credits;
      break;
    case 'RON':
      amountInAccountCurrency = credits * eurRonRate;
      break;
    default:
      throw new Error(
        `creditsToAmountMicros: unsupported Google Ads account currency '${accountCurrencyCode}' ` +
          '(only EUR and RON are wired up — add a case here before using this account currency).',
      );
  }
  const rawMicros = amountInAccountCurrency * 1_000_000;
  return String(Math.round(rawMicros / BILLABLE_UNIT_MICROS) * BILLABLE_UNIT_MICROS);
}
