/**
 * The common shape every supplier invoice is normalised into, whatever its
 * source (provider API, uploaded original, and later e-mail / RO e-Factura /
 * Peppol), plus the checks run on it at ingestion and on every edit.
 *
 * The checks only flag inconsistencies for a human to look at; they never
 * correct data and never stand in for the accountant's validation.
 */

export interface VatLine {
  /** Percentage, e.g. 21 or 19 or 0; null = not stated. */
  rate: number | null;
  netMinor: number;
  vatMinor: number;
}

export interface InvoiceLine {
  description: string;
  quantity: number | null;
  unitPriceMinor: number | null;
  netMinor: number | null;
  vatRate: number | null;
}

/** Everything an ingestion adapter can say about one invoice. */
export interface NormalizedInvoice {
  provider: string;
  providerName?: string | null;
  externalId?: string | null;
  invoiceNumber?: string | null;
  docType?: string | null;
  supplierVatId?: string | null;
  issueDate: Date;
  dueDate?: Date | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  currency: string;
  subtotalMinor?: number | null;
  taxMinor?: number | null;
  totalMinor: number;
  vatLines?: VatLine[] | null;
  lines?: InvoiceLine[] | null;
  paymentStatus?: 'paid' | 'unpaid' | null;
  paidAt?: Date | null;
  note?: string | null;
  raw?: unknown;
}

export type ValidationIssue =
  | 'total_mismatch'
  | 'vat_lines_mismatch'
  | 'lines_mismatch'
  | 'due_before_issue'
  | 'period_inverted'
  | 'issue_in_future'
  | 'paid_without_date'
  | 'missing_invoice_number';

/** Rounding tolerance: one cent per VAT line / invoice line, min 1. */
function tol(n: number): number {
  return Math.max(1, n);
}

/** Consistency checks on the stored numbers and dates. */
export function validateInvoice(i: {
  invoiceNumber?: string | null;
  issueDate: Date;
  dueDate?: Date | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  subtotalMinor?: number | null;
  taxMinor?: number | null;
  totalMinor: number;
  vatLines?: VatLine[] | null;
  lines?: InvoiceLine[] | null;
  paymentStatus?: string | null;
  paidAt?: Date | null;
}): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!i.invoiceNumber?.trim()) out.push('missing_invoice_number');
  if (
    i.subtotalMinor !== null &&
    i.subtotalMinor !== undefined &&
    i.taxMinor !== null &&
    i.taxMinor !== undefined &&
    Math.abs(i.subtotalMinor + i.taxMinor - i.totalMinor) > 1
  ) {
    out.push('total_mismatch');
  }
  const vl = i.vatLines ?? [];
  if (vl.length) {
    const vat = vl.reduce((s, l) => s + (l.vatMinor || 0), 0);
    const net = vl.reduce((s, l) => s + (l.netMinor || 0), 0);
    const vatOff =
      i.taxMinor !== null &&
      i.taxMinor !== undefined &&
      Math.abs(vat - i.taxMinor) > tol(vl.length);
    const netOff =
      i.subtotalMinor !== null &&
      i.subtotalMinor !== undefined &&
      Math.abs(net - i.subtotalMinor) > tol(vl.length);
    if (vatOff || netOff) out.push('vat_lines_mismatch');
  }
  const ln = (i.lines ?? []).filter((l) => l.netMinor !== null && l.netMinor !== undefined);
  if (ln.length && i.subtotalMinor !== null && i.subtotalMinor !== undefined) {
    const net = ln.reduce((s, l) => s + (l.netMinor as number), 0);
    if (Math.abs(net - i.subtotalMinor) > tol(ln.length)) out.push('lines_mismatch');
  }
  if (i.dueDate && i.dueDate.getTime() < i.issueDate.getTime()) out.push('due_before_issue');
  if (i.periodStart && i.periodEnd && i.periodStart.getTime() > i.periodEnd.getTime()) {
    out.push('period_inverted');
  }
  const tomorrow = Date.now() + 24 * 3600 * 1000;
  if (i.issueDate.getTime() > tomorrow) out.push('issue_in_future');
  if (i.paymentStatus === 'paid' && !i.paidAt) out.push('paid_without_date');
  return out;
}

/** Invoice numbers compared loosely: "FV-0042", "fv 0042" and "FV0042"
 *  are the same document. */
export function normalizeInvoiceNumber(n: string | null | undefined): string {
  return (n ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function parseVatLines(v: unknown): VatLine[] | null {
  if (!Array.isArray(v)) return null;
  const out = v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      rate: typeof x.rate === 'number' ? x.rate : null,
      netMinor: Math.round(Number(x.netMinor) || 0),
      vatMinor: Math.round(Number(x.vatMinor) || 0),
    }));
  return out.length ? out : null;
}

export function parseLines(v: unknown): InvoiceLine[] | null {
  if (!Array.isArray(v)) return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const out = v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      description: String(x.description ?? '').slice(0, 500),
      quantity: num(x.quantity),
      unitPriceMinor:
        num(x.unitPriceMinor) === null ? null : Math.round(x.unitPriceMinor as number),
      netMinor: num(x.netMinor) === null ? null : Math.round(x.netMinor as number),
      vatRate: num(x.vatRate),
    }));
  return out.length ? out : null;
}

export function startOfUtcToday(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 3600 * 1000);
}
