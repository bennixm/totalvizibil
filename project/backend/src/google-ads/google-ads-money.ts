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
  return String(Math.round(amountInAccountCurrency * 1_000_000));
}
