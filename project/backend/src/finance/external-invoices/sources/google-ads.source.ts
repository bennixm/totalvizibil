import { Injectable } from '@nestjs/common';
import {
  GoogleAdsApiClient,
  type GoogleAdsInvoice,
} from '../../../google-ads/google-ads-api-client.service';
import type { NormalizedInvoice } from '../external-invoice-model';
import type {
  CollectResult,
  FetchedDocument,
  FetchedInvoice,
  InvoiceSourceAdapter,
} from './invoice-source';

const MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
] as const;

/** Google can't serve invoices issued before this (its own documented floor). */
const FLOOR_YEAR = 2019;

function microsToMinor(micros: string | undefined): number | null {
  if (micros === undefined || micros === null || micros === '') return null;
  const n = Number(micros);
  return Number.isFinite(n) ? Math.round(n / 10_000) : null;
}

export function dateOnly(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

function safeName(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'invoice';
}

/**
 * Google Ads InvoiceService (ListInvoices + authenticated `pdf_url`), on the
 * platform's existing service-account client. Google only serves it to
 * accounts on monthly invoicing with API access approved for billing.
 */
@Injectable()
export class GoogleAdsInvoiceSource implements InvoiceSourceAdapter {
  readonly provider = 'google_ads';
  readonly source = 'api' as const;

  constructor(private readonly ads: GoogleAdsApiClient) {}

  get configured(): boolean {
    return this.ads.configured;
  }

  private toFetched(inv: GoogleAdsInvoice): FetchedInvoice | null {
    const externalId = inv.id ?? inv.resourceName;
    const issueDate = dateOnly(inv.issueDate);
    if (!externalId || !issueDate) return null;
    // `pdfUrl` is a per-request download link, not part of the invoice.
    const { pdfUrl, ...raw } = inv;
    const invoice: NormalizedInvoice = {
      provider: this.provider,
      externalId,
      invoiceNumber: inv.id ?? null,
      docType: inv.type ?? null,
      issueDate,
      dueDate: dateOnly(inv.dueDate),
      periodStart: dateOnly(inv.serviceDateRange?.startDate),
      periodEnd: dateOnly(inv.serviceDateRange?.endDate),
      currency: inv.currencyCode ?? 'EUR',
      subtotalMinor: microsToMinor(inv.subtotalAmountMicros),
      taxMinor: microsToMinor(inv.taxAmountMicros),
      totalMinor: microsToMinor(inv.totalAmountMicros) ?? 0,
      raw,
    };
    return {
      invoice,
      fetchDocument: pdfUrl ? () => this.download(externalId, pdfUrl) : undefined,
    };
  }

  private async download(externalId: string, pdfUrl: string): Promise<FetchedDocument> {
    const bytes = await this.ads.downloadInvoicePdf(pdfUrl);
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('not_a_pdf');
    return { bytes, mime: 'application/pdf', filename: `google-ads-${safeName(externalId)}.pdf` };
  }

  async collect({ months }: { months: number }): Promise<CollectResult> {
    const result: CollectResult = { items: [], attempts: 0, errors: [] };
    if (!this.ads.configured) {
      result.fatal = 'not_configured';
      return result;
    }
    const setupRows = await this.ads.search(
      'SELECT billing_setup.resource_name, billing_setup.status FROM billing_setup',
    );
    // A pending or rejected setup has never billed anything; approved and
    // cancelled ones can carry (historical) invoices.
    const setups = setupRows
      .map((row) => row.billingSetup as { resourceName?: string; status?: string } | undefined)
      .filter((b) => !!b?.resourceName && b.status !== 'PENDING' && b.status !== 'REJECTED')
      .map((b) => b!.resourceName!);
    if (!setups.length) {
      result.fatal = 'no_billing_setup';
      return result;
    }
    const now = new Date();
    for (const setup of setups) {
      for (let i = 0; i < months; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        if (d.getUTCFullYear() < FLOOR_YEAR) break;
        result.attempts++;
        try {
          const invoices = await this.ads.listInvoices(
            setup,
            d.getUTCFullYear(),
            MONTHS[d.getUTCMonth()],
          );
          for (const inv of invoices) {
            const f = this.toFetched(inv);
            if (f) result.items.push(f);
          }
        } catch (e) {
          result.errors.push(errText(e));
        }
      }
    }
    if (result.attempts > 0 && result.errors.length === result.attempts) {
      result.fatal = result.errors[0];
    }
    return result;
  }

  async refetchDocuments(
    missing: { externalId: string; issueDate: Date; raw: unknown }[],
  ): Promise<Map<string, () => Promise<FetchedDocument>>> {
    const out = new Map<string, () => Promise<FetchedDocument>>();
    if (!this.ads.configured) return out;
    const months = new Map<string, { setup: string; year: number; month: number }>();
    for (const m of missing) {
      const setup = (m.raw as { billingSetup?: string } | null)?.billingSetup;
      if (!setup) continue;
      const year = m.issueDate.getUTCFullYear();
      const month = m.issueDate.getUTCMonth() + 1;
      months.set(`${setup}|${year}|${month}`, { setup, year, month });
    }
    const wanted = new Set(missing.map((m) => m.externalId));
    for (const { setup, year, month } of months.values()) {
      let invoices: GoogleAdsInvoice[];
      try {
        invoices = await this.ads.listInvoices(setup, year, MONTHS[month - 1]);
      } catch {
        continue;
      }
      for (const inv of invoices) {
        const id = inv.id ?? inv.resourceName;
        if (id && wanted.has(id) && inv.pdfUrl) {
          const url = inv.pdfUrl;
          out.set(id, () => this.download(id, url));
        }
      }
    }
    return out;
  }
}
