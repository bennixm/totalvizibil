import type { ExternalInvoiceSource } from '@prisma/client';
import type { NormalizedInvoice } from '../external-invoice-model';

export interface FetchedDocument {
  bytes: Buffer;
  mime: string;
  filename: string;
}

export interface FetchedInvoice {
  invoice: NormalizedInvoice;
  /** Downloads the original document (lazily: only when we don't have it). */
  fetchDocument?: () => Promise<FetchedDocument>;
}

export interface CollectResult {
  items: FetchedInvoice[];
  /** Calls made and the ones that failed (partial failures are normal). */
  attempts: number;
  errors: string[];
  /** Set when nothing could be collected at all (stable reason code). */
  fatal?: string;
}

/**
 * One independent collector per invoice source. Every adapter only FETCHES
 * and normalises; storage, validation, duplicate checks, history and
 * notifications all happen once, in ExternalInvoicesService.ingest(), so a
 * new source (Gmail inbox, Microsoft Graph, RO e-Factura, a Peppol access
 * point…) is a new file implementing this interface and nothing else.
 */
export interface InvoiceSourceAdapter {
  /** Registry key (external-invoice-providers.ts). */
  readonly provider: string;
  /** Collection method recorded on every invoice it delivers. */
  readonly source: ExternalInvoiceSource;
  readonly configured: boolean;
  /** Invoices issued in the last `months` months. */
  collect(opts: { months: number }): Promise<CollectResult>;
  /** Fresh download links for already-imported invoices whose original
   *  document is still missing (some providers' links are per-request). */
  refetchDocuments?(
    missing: { externalId: string; issueDate: Date; raw: unknown }[],
  ): Promise<Map<string, () => Promise<FetchedDocument>>>;
}
