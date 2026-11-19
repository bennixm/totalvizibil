/**
 * The paid services this platform is integrated with, and how each one makes
 * its ORIGINAL invoices available. Result of auditing the codebase's
 * integrations (env config + every outbound API host) against each
 * provider's official billing documentation:
 *
 *  - Google Ads: InvoiceService.ListInvoices + an authenticated `pdf_url`
 *    download, reusing the platform's existing service-account client.
 *    Automated, but Google only serves it for accounts on MONTHLY INVOICING;
 *    a card-paid ("automatic payments") account gets an API error and its
 *    monthly statements stay in the Google Ads UI (Billing > Documents).
 *  - Anthropic (Claude API): the Admin API exposes usage and cost reports
 *    only; there is no invoice or receipt endpoint. Original invoices are in
 *    the Claude Console (Settings > Billing).
 *  - DeepSeek: the API exposes the account balance only; invoices are in the
 *    DeepSeek platform's billing page.
 *  - Stripe: the API exposes per-payment fees (already captured as expenses)
 *    but not Stripe's own fee invoices; those are in the Stripe Dashboard
 *    (Settings > Documents).
 *  - Pexels: free API, no invoices.
 *  - Hosting (VPS), outgoing e-mail (SMTP), domains: the provider isn't part
 *    of the codebase (only a host/credential), so there's nothing to call;
 *    their invoices are uploaded as originals under "Other".
 *
 * For every non-automated provider the page accepts the original document
 * downloaded from the provider's portal (PDF/image, sniffed by magic bytes),
 * never a generated one.
 */
export type ExternalInvoiceProviderKey =
  'google_ads' | 'anthropic' | 'deepseek' | 'stripe' | 'other';

export interface ExternalInvoiceProviderInfo {
  key: ExternalInvoiceProviderKey;
  name: string;
  /** True when an official API lets this platform import the invoices. */
  automated: boolean;
  /** Where the originals are downloaded by hand (official portal). */
  portalUrl: string | null;
}

export const EXTERNAL_INVOICE_PROVIDERS: ExternalInvoiceProviderInfo[] = [
  {
    key: 'google_ads',
    name: 'Google Ads',
    automated: true,
    portalUrl: 'https://ads.google.com/aw/billing/summary',
  },
  {
    key: 'anthropic',
    name: 'Anthropic (Claude API)',
    automated: false,
    portalUrl: 'https://platform.claude.com/settings/billing',
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    automated: false,
    portalUrl: 'https://platform.deepseek.com/',
  },
  {
    key: 'stripe',
    name: 'Stripe',
    automated: false,
    portalUrl: 'https://dashboard.stripe.com/settings/documents',
  },
  { key: 'other', name: 'Other', automated: false, portalUrl: null },
];

export const EXTERNAL_INVOICE_PROVIDER_KEYS = EXTERNAL_INVOICE_PROVIDERS.map((p) => p.key);

export function providerInfo(key: string): ExternalInvoiceProviderInfo | undefined {
  return EXTERNAL_INVOICE_PROVIDERS.find((p) => p.key === key);
}
