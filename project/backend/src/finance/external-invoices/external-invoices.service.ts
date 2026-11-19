import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import archiver from 'archiver';
import { ExternalInvoiceSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../admin/audit-log.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AiService, estimateClaudeCostMinor } from '../../ai/ai.service';
import type { AuthPrincipal } from '../../auth/auth.types';
import { type Sheet, toCsv, toXlsx } from '../../common/spreadsheet';
import { EXTERNAL_INVOICE_PROVIDERS, providerInfo } from './external-invoice-providers';
import {
  addDays,
  type InvoiceLine,
  type NormalizedInvoice,
  normalizeInvoiceNumber,
  parseLines,
  parseVatLines,
  startOfUtcToday,
  validateInvoice,
  type VatLine,
} from './external-invoice-model';
import { decodeInvoiceFile } from './external-invoice-files';
import { resolveSupplier, supplierSignals } from './supplier-registry';
import { type EInvoiceDraft, readEInvoice } from './einvoice-xml';
import { GoogleAdsInvoiceSource } from './sources/google-ads.source';
import { BnrRatesService, type DisplayCurrency } from './bnr-rates.service';
import type { FetchedDocument, InvoiceSourceAdapter } from './sources/invoice-source';
import type {
  BulkExternalInvoicesDto,
  ExportExternalInvoicesQuery,
  ExternalInvoiceFileDto,
  ExternalInvoiceFilterQuery,
  ExternalInvoicesZipDto,
  ListExternalInvoicesQuery,
  SyncExternalInvoicesDto,
  UpdateExternalInvoiceDto,
  UploadExternalInvoiceDto,
} from './external-invoices.dto';

const AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_SYNC_FIRST_DELAY_MS = 2 * 60 * 1000;
const REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REMINDER_FIRST_DELAY_MS = 3 * 60 * 1000;
const ZIP_MAX_DOCUMENTS = 2000;
const EXPORT_MAX_ROWS = 10_000;
/** "Due soon" window for the dashboard/filter, and the reminder lead time. */
const DUE_SOON_DAYS = 7;
const REMIND_BEFORE_DAYS = 3;
/** Near-duplicate window: same supplier + currency + total within ±N days. */
const DUPLICATE_WINDOW_DAYS = 3;
/** Below this overall extraction confidence a field set is flagged. */
const LOW_CONFIDENCE = 0.8;

/** Fields a person can correct; a correction is never overwritten by a
 *  later automatic re-import of the same invoice. */
const EDITABLE_FIELDS = [
  'providerName',
  'invoiceNumber',
  'supplierVatId',
  'issueDate',
  'dueDate',
  'periodStart',
  'periodEnd',
  'currency',
  'subtotalMinor',
  'taxMinor',
  'totalMinor',
  'vatLines',
  'lines',
  'paymentStatus',
  'paidAt',
  'processingStatus',
  'note',
] as const;
const DATE_FIELDS = new Set(['issueDate', 'dueDate', 'periodStart', 'periodEnd', 'paidAt']);

export interface SyncResult {
  provider: string;
  ok: boolean;
  message: string | null;
  imported: number;
  updated: number;
  documents: number;
}

interface IngestOptions {
  source: ExternalInvoiceSource;
  document?: FetchedDocument | null;
  fetchDocument?: () => Promise<FetchedDocument>;
  actor?: AuthPrincipal | null;
  extraction?: Record<string, unknown> | null;
  /** A person confirmed the data (manual entry, or AI draft checked). */
  reviewed?: boolean;
}

interface IngestResult {
  id: string;
  outcome: 'created' | 'updated' | 'linked';
  documentStored: boolean;
  possibleDuplicateOfId: string | null;
}

function dateOnly(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymd(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Filesystem-safe path segment for ZIP entries. */
function seg(s: string): string {
  return (
    s
      .replace(/[^\w.\-() ]+/g, '_')
      .trim()
      .slice(0, 80) || 'x'
  );
}

function extFor(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/xml') return 'xml';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

function minorFromMajor(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : null;
}

/** Comparable form of a field value for the change history. */
function cmpVal(field: string, v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return ymd(v);
  if (DATE_FIELDS.has(field) && typeof v === 'string') return v.slice(0, 10);
  return v ?? null;
}

/**
 * Supplier invoices: the original documents our providers bill us with.
 *
 * Every invoice, whatever its source, goes through `ingest()`:
 *   source adapter / upload → validation → duplicate check → storage
 *   (structured data and the original document kept separately) → history
 *   → notifications.
 * AI extraction only ever produces a draft for a person to confirm.
 */
@Injectable()
export class ExternalInvoicesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExternalInvoicesService.name);
  private syncing = new Set<string>();
  private timers: NodeJS.Timeout[] = [];
  private readonly adapters: InvoiceSourceAdapter[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
    private readonly ai: AiService,
    googleAds: GoogleAdsInvoiceSource,
    private readonly fx: BnrRatesService,
  ) {
    this.adapters = [googleAds];
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    // Daily automatic import, first one shortly after boot (never during it,
    // so a slow provider can't delay startup); due/overdue reminders a few
    // times a day (each invoice is reminded once per stage).
    const sync = () =>
      void this.syncAll().catch((e) =>
        this.logger.error(`Auto invoice sync failed: ${errText(e)}`),
      );
    const remind = () =>
      void this.sendDueReminders().catch((e) =>
        this.logger.error(`Invoice reminders failed: ${errText(e)}`),
      );
    this.timers.push(setTimeout(sync, AUTO_SYNC_FIRST_DELAY_MS));
    this.timers.push(setInterval(sync, AUTO_SYNC_INTERVAL_MS));
    this.timers.push(setTimeout(remind, REMINDER_FIRST_DELAY_MS));
    this.timers.push(setInterval(remind, REMINDER_INTERVAL_MS));
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  private adapter(provider: string): InvoiceSourceAdapter | undefined {
    return this.adapters.find((a) => a.provider === provider);
  }

  // =========================================================================
  // Providers overview
  // =========================================================================

  async providers() {
    const [syncs, counts, docCounts] = await Promise.all([
      this.prisma.externalInvoiceSync.findMany(),
      this.prisma.externalInvoice.groupBy({ by: ['provider'], _count: { _all: true } }),
      this.prisma.externalInvoice.groupBy({
        by: ['provider'],
        where: { document: { isNot: null } },
        _count: { _all: true },
      }),
    ]);
    return EXTERNAL_INVOICE_PROVIDERS.map((p) => {
      const s = syncs.find((x) => x.provider === p.key);
      return {
        ...p,
        configured: p.automated ? (this.adapter(p.key)?.configured ?? false) : null,
        invoiceCount: counts.find((c) => c.provider === p.key)?._count._all ?? 0,
        documentCount: docCounts.find((c) => c.provider === p.key)?._count._all ?? 0,
        lastSync: s
          ? {
              at: s.lastRunAt,
              ok: s.ok,
              message: s.message,
              imported: s.imported,
              updated: s.updated,
              documents: s.documents,
            }
          : null,
      };
    });
  }

  // =========================================================================
  // Dashboard summary (all values computed from stored invoices)
  // =========================================================================

  /** Rows' issue years → BNR rates loaded for each. */
  private async fxFor(rows: { issueDate: Date }[]): Promise<void> {
    await this.fx.ensure(rows.map((r) => r.issueDate.getUTCFullYear()));
  }

  async summary(display: DisplayCurrency = 'EUR') {
    const today = startOfUtcToday();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    const sel = {
      currency: true,
      issueDate: true,
      dueDate: true,
      subtotalMinor: true,
      taxMinor: true,
      totalMinor: true,
      vatLines: true,
      source: true,
    } as const;

    const [monthRows, unpaidRows, unknownPayment, needsReview, bySourceAll] = await Promise.all([
      this.prisma.externalInvoice.findMany({
        where: { issueDate: { gte: monthStart, lt: nextMonth } },
        select: sel,
      }),
      this.prisma.externalInvoice.findMany({ where: { paymentStatus: 'unpaid' }, select: sel }),
      this.prisma.externalInvoice.count({ where: { paymentStatus: null } }),
      this.prisma.externalInvoice.count({ where: { processingStatus: 'needs_review' } }),
      this.prisma.externalInvoice.groupBy({ by: ['source'], _count: { _all: true } }),
    ]);
    await this.fxFor([...monthRows, ...unpaidRows]);

    // Every amount in the display currency, at the BNR rate of the
    // invoice's issue date; a row without a rate is counted apart.
    let unconverted = 0;
    const conv = (r: (typeof monthRows)[number]) => {
      const c = this.fx.convert(r, r.currency, display, r.issueDate);
      if (!c) unconverted++;
      return c;
    };
    const sum = (rows: typeof monthRows) => {
      let totalMinor = 0;
      for (const r of rows) totalMinor += conv(r)?.totalMinor ?? 0;
      return rows.length ? [{ currency: display, count: rows.length, totalMinor }] : [];
    };

    let mTotal = 0;
    let mTax = 0;
    let mNet = 0;
    const byRate = new Map<
      string,
      { currency: string; rate: number | null; netMinor: number; vatMinor: number }
    >();
    for (const r of monthRows) {
      const c = conv(r);
      if (!c) continue;
      mTotal += c.totalMinor;
      mTax += c.taxMinor ?? 0;
      mNet += c.subtotalMinor ?? 0;
      // VAT by rate: the per-rate breakdown when the invoice has one,
      // otherwise its whole VAT under "rate unknown".
      const lines: VatLine[] =
        parseVatLines(r.vatLines) ??
        (r.taxMinor !== null
          ? [{ rate: null, netMinor: r.subtotalMinor ?? 0, vatMinor: r.taxMinor }]
          : []);
      for (const l of lines) {
        const key = String(l.rate ?? 'x');
        const cur = byRate.get(key) ?? {
          currency: display,
          rate: l.rate,
          netMinor: 0,
          vatMinor: 0,
        };
        cur.netMinor += Math.round(l.netMinor * c.rate);
        cur.vatMinor += Math.round(l.vatMinor * c.rate);
        byRate.set(key, cur);
      }
    }

    const dueSoonRows = unpaidRows.filter(
      (r) => r.dueDate && r.dueDate >= today && r.dueDate <= addDays(today, DUE_SOON_DAYS),
    );
    const overdueRows = unpaidRows.filter((r) => r.dueDate && r.dueDate < today);
    const sources = (rows: { source: ExternalInvoiceSource; n: number }[]) => ({
      automated: rows.filter((r) => r.source !== 'manual').reduce((s, r) => s + r.n, 0),
      manual: rows.find((r) => r.source === 'manual')?.n ?? 0,
    });
    const monthBySource = new Map<ExternalInvoiceSource, number>();
    for (const r of monthRows) monthBySource.set(r.source, (monthBySource.get(r.source) ?? 0) + 1);

    return {
      display,
      rateSource: 'BNR',
      unconverted,
      month: {
        from: ymd(monthStart),
        to: ymd(addDays(nextMonth, -1)),
        count: monthRows.length,
        totals: monthRows.length
          ? [
              {
                currency: display,
                count: monthRows.length,
                totalMinor: mTotal,
                taxMinor: mTax,
                subtotalMinor: mNet,
              },
            ]
          : [],
        vatByRate: [...byRate.values()].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1)),
        sources: sources([...monthBySource.entries()].map(([source, n]) => ({ source, n }))),
      },
      unpaid: { count: unpaidRows.length, totals: sum(unpaidRows), unknownPayment },
      dueSoon: { count: dueSoonRows.length, totals: sum(dueSoonRows), days: DUE_SOON_DAYS },
      overdue: { count: overdueRows.length, totals: sum(overdueRows) },
      needsReview,
      sources: sources(bySourceAll.map((r) => ({ source: r.source, n: r._count._all }))),
    };
  }

  // =========================================================================
  // List / filter / export
  // =========================================================================

  private where(f: ExternalInvoiceFilterQuery): Prisma.ExternalInvoiceWhereInput {
    const and: Prisma.ExternalInvoiceWhereInput[] = [];
    if (f.provider) and.push({ provider: f.provider });
    if (f.supplierId) and.push({ supplierId: f.supplierId });
    const from = dateOnly(f.from);
    const to = dateOnly(f.to);
    if (from || to) {
      and.push({ issueDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
    }
    if (f.payment === 'paid') and.push({ paymentStatus: 'paid' });
    if (f.payment === 'unpaid') and.push({ paymentStatus: 'unpaid' });
    if (f.payment === 'unknown') and.push({ paymentStatus: null });
    if (f.processing) and.push({ processingStatus: f.processing });
    if (f.currency) and.push({ currency: f.currency });
    if (f.source) and.push({ source: f.source });
    const today = startOfUtcToday();
    if (f.due === 'overdue') and.push({ paymentStatus: 'unpaid', dueDate: { lt: today } });
    if (f.due === 'due_soon') {
      and.push({
        paymentStatus: 'unpaid',
        dueDate: { gte: today, lte: addDays(today, DUE_SOON_DAYS) },
      });
    }
    if (f.hasDocument === 'yes') and.push({ document: { isNot: null } });
    if (f.hasDocument === 'no') and.push({ document: { is: null } });
    const q = f.q?.trim();
    if (q) {
      and.push({
        OR: [
          { invoiceNumber: { contains: q, mode: 'insensitive' } },
          { providerName: { contains: q, mode: 'insensitive' } },
          { provider: { contains: q.toLowerCase().replace(/\s+/g, '_') } },
          { supplierVatId: { contains: q, mode: 'insensitive' } },
          { externalId: { contains: q, mode: 'insensitive' } },
          { note: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    return and.length ? { AND: and } : {};
  }

  private orderBy(sort?: string): Prisma.ExternalInvoiceOrderByWithRelationInput[] {
    const [field, dir] = (sort ?? 'issueDate:desc').split(':') as [string, 'asc' | 'desc'];
    const d = dir === 'asc' ? 'asc' : 'desc';
    switch (field) {
      case 'dueDate':
        return [{ dueDate: { sort: d, nulls: 'last' } }, { issueDate: 'desc' }];
      case 'totalMinor':
        return [{ totalMinor: d }, { issueDate: 'desc' }];
      case 'provider':
        return [{ provider: d }, { providerName: d }, { issueDate: 'desc' }];
      case 'invoiceNumber':
        return [{ invoiceNumber: { sort: d, nulls: 'last' } }];
      default:
        return [{ issueDate: d }, { createdAt: d }];
    }
  }

  private dueState(r: {
    paymentStatus: string | null;
    dueDate: Date | null;
  }): 'overdue' | 'due_soon' | null {
    if (r.paymentStatus !== 'unpaid' || !r.dueDate) return null;
    const today = startOfUtcToday();
    if (r.dueDate.getTime() < today.getTime()) return 'overdue';
    if (r.dueDate.getTime() <= addDays(today, DUE_SOON_DAYS).getTime()) return 'due_soon';
    return null;
  }

  private listItem(
    r: Prisma.ExternalInvoiceGetPayload<{
      include: {
        document: { select: { filename: true; mime: true; size: true } };
        _count: { select: { attachments: true } };
      };
    }>,
  ) {
    const issues = validateInvoice({
      ...r,
      vatLines: parseVatLines(r.vatLines),
      lines: parseLines(r.lines),
    });
    return {
      id: r.id,
      provider: r.provider,
      providerName: r.providerName ?? providerInfo(r.provider)?.name ?? r.provider,
      source: r.source,
      externalId: r.externalId,
      invoiceNumber: r.invoiceNumber,
      docType: r.docType,
      supplierVatId: r.supplierVatId,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      currency: r.currency,
      subtotalMinor: r.subtotalMinor,
      taxMinor: r.taxMinor,
      totalMinor: r.totalMinor,
      paymentStatus: r.paymentStatus,
      paidAt: r.paidAt,
      processingStatus: r.processingStatus,
      possibleDuplicateOfId: r.possibleDuplicateOfId,
      supplierId: r.supplierId,
      flags: r.flags,
      dueState: this.dueState(r),
      // Both display currencies, at the BNR rate of the issue date, so the
      // page follows the top-nav currency toggle without refetching. Null
      // when BNR has no rate for the document currency.
      fx: {
        EUR: this.fx.convert(r, r.currency, 'EUR', r.issueDate),
        RON: this.fx.convert(r, r.currency, 'RON', r.issueDate),
      },
      issues,
      note: r.note,
      document: r.document,
      documentError: r.documentError,
      attachmentCount: r._count.attachments,
      createdAt: r.createdAt,
    };
  }

  async list(q: ListExternalInvoicesQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where = this.where(q);
    const display: DisplayCurrency = q.display ?? 'EUR';
    const [rows, total, amounts, years, currencies] = await Promise.all([
      this.prisma.externalInvoice.findMany({
        where,
        orderBy: this.orderBy(q.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          document: { select: { filename: true, mime: true, size: true } },
          _count: { select: { attachments: true } },
        },
      }),
      this.prisma.externalInvoice.count({ where }),
      this.prisma.externalInvoice.findMany({
        where,
        select: {
          currency: true,
          issueDate: true,
          subtotalMinor: true,
          taxMinor: true,
          totalMinor: true,
        },
      }),
      this.prisma.$queryRaw<{ y: number }[]>`
        SELECT DISTINCT EXTRACT(YEAR FROM issue_date)::int AS y
        FROM external_invoices ORDER BY y DESC`,
      this.prisma.externalInvoice.groupBy({ by: ['currency'], _count: { _all: true } }),
    ]);
    await this.fxFor([...rows, ...amounts]);
    let totalMinor = 0;
    let taxMinor = 0;
    let unconverted = 0;
    for (const a of amounts) {
      const c = this.fx.convert(a, a.currency, display, a.issueDate);
      if (!c) {
        unconverted++;
        continue;
      }
      totalMinor += c.totalMinor;
      taxMinor += c.taxMinor ?? 0;
    }
    return {
      items: rows.map((r) => this.listItem(r)),
      total,
      page,
      pageSize,
      display,
      unconverted,
      // All matching invoices converted to the display currency (BNR rate
      // of each issue date). One entry, kept as a list for the page.
      totalsByCurrency: amounts.length
        ? [{ currency: display, count: amounts.length, totalMinor, taxMinor }]
        : [],
      years: years.map((y) => y.y),
      currencies: currencies.map((c) => c.currency).sort(),
    };
  }

  async exportFile(
    q: ExportExternalInvoicesQuery,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const where = this.where(q);
    const count = await this.prisma.externalInvoice.count({ where });
    if (count > EXPORT_MAX_ROWS) throw new BadRequestException('export_too_large');
    const rows = await this.prisma.externalInvoice.findMany({
      where,
      orderBy: this.orderBy(q.sort),
      include: { document: { select: { filename: true } } },
    });
    const display: DisplayCurrency = q.display ?? 'EUR';
    await this.fxFor(rows);
    const major = (m: number | null) => (m === null ? null : m / 100);
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
    const sheet: Sheet = {
      name: 'Facturi furnizori',
      title: [
        `Facturi furnizori, exportat ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        `Sume convertite în ${display} la cursul BNR din data emiterii fiecărei facturi; valorile din document sunt păstrate alături.`,
      ],
      columns: [
        { label: 'Furnizor', width: 26 },
        { label: 'CIF/VAT furnizor', width: 16 },
        { label: 'Număr factură', width: 20 },
        { label: 'Tip', width: 10 },
        { label: 'Data emiterii', width: 12 },
        { label: 'Scadența', width: 12 },
        { label: 'Perioadă de la', width: 12 },
        { label: 'Perioadă până la', width: 12 },
        { label: `Fără TVA (${display})`, width: 14, money: true },
        { label: `TVA (${display})`, width: 12, money: true },
        { label: `Total (${display})`, width: 14, money: true },
        { label: 'Curs BNR', width: 10 },
        { label: 'Data cursului', width: 12 },
        { label: 'Fără TVA (document)', width: 14, money: true },
        { label: 'TVA (document)', width: 12, money: true },
        { label: 'Total (document)', width: 14, money: true },
        { label: 'Moneda documentului', width: 10 },
        { label: 'Status plată', width: 12 },
        { label: 'Plătită la', width: 12 },
        { label: 'Status procesare', width: 14 },
        { label: 'Sursă', width: 10 },
        { label: 'Document', width: 28 },
        { label: 'Notă', width: 30 },
      ],
      rows: rows.map((r) => {
        const c = this.fx.convert(r, r.currency, display, r.issueDate);
        return [
          r.providerName ?? providerInfo(r.provider)?.name ?? r.provider,
          r.supplierVatId,
          r.invoiceNumber,
          r.docType,
          day(r.issueDate),
          day(r.dueDate),
          day(r.periodStart),
          day(r.periodEnd),
          c ? major(c.subtotalMinor) : null,
          c ? major(c.taxMinor) : null,
          c ? major(c.totalMinor) : null,
          c ? c.rate : null,
          c?.rateDate ?? '',
          major(r.subtotalMinor),
          major(r.taxMinor),
          major(r.totalMinor),
          r.currency,
          r.paymentStatus === 'paid'
            ? 'plătită'
            : r.paymentStatus === 'unpaid'
              ? 'neplătită'
              : 'necunoscut',
          day(r.paidAt),
          r.processingStatus === 'verified' ? 'verificată' : 'de verificat',
          r.source,
          r.document?.filename ?? '',
          r.note,
        ];
      }),
    };
    const stem = `facturi-furnizori-${new Date().toISOString().slice(0, 10)}`;
    if (q.format === 'xlsx') {
      return {
        buffer: await toXlsx([sheet]),
        filename: `${stem}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
    return {
      buffer: toCsv(sheet),
      filename: `${stem}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  // =========================================================================
  // Detail
  // =========================================================================

  async detail(id: string) {
    const r = await this.prisma.externalInvoice.findUnique({
      where: { id },
      include: {
        document: { select: { filename: true, mime: true, size: true, createdAt: true } },
        _count: { select: { attachments: true } },
        attachments: {
          select: {
            id: true,
            filename: true,
            mime: true,
            size: true,
            createdAt: true,
            uploadedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: { actor: { select: { name: true } } },
        },
        createdBy: { select: { name: true } },
      },
    });
    if (!r) throw new NotFoundException('invoice_not_found');
    await this.fxFor([r]);
    const dup = r.possibleDuplicateOfId
      ? await this.prisma.externalInvoice.findUnique({
          where: { id: r.possibleDuplicateOfId },
          select: {
            id: true,
            invoiceNumber: true,
            issueDate: true,
            totalMinor: true,
            currency: true,
          },
        })
      : null;
    const corrected = this.correctedFields(r.events);
    return {
      ...this.listItem(r),
      vatLines: parseVatLines(r.vatLines) ?? [],
      lines: parseLines(r.lines) ?? [],
      extraction: r.extraction,
      createdByName: r.createdBy?.name ?? null,
      updatedAt: r.updatedAt,
      possibleDuplicateOf: dup,
      correctedFields: [...corrected],
      attachments: r.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mime: a.mime,
        size: a.size,
        createdAt: a.createdAt,
        uploadedByName: a.uploadedBy?.name ?? null,
      })),
      events: r.events.map((e) => ({
        id: e.id,
        kind: e.kind,
        message: e.message,
        changes: e.changes,
        actorName: e.actor?.name ?? null,
        createdAt: e.createdAt,
      })),
    };
  }

  private correctedFields(events: { kind: string; changes: Prisma.JsonValue }[]): Set<string> {
    const out = new Set<string>();
    for (const e of events) {
      if (e.kind !== 'updated' || !e.changes || typeof e.changes !== 'object') continue;
      for (const k of Object.keys(e.changes as Record<string, unknown>)) out.add(k);
    }
    return out;
  }

  // =========================================================================
  // Documents & attachments
  // =========================================================================

  async document(id: string): Promise<{ bytes: Buffer; mime: string; filename: string }> {
    const doc = await this.prisma.externalInvoiceDocument.findUnique({ where: { invoiceId: id } });
    if (!doc) throw new NotFoundException('document_not_found');
    return { bytes: Buffer.from(doc.bytes), mime: doc.mime, filename: doc.filename };
  }

  async attachment(id: string, attachmentId: string) {
    const a = await this.prisma.externalInvoiceAttachment.findFirst({
      where: { id: attachmentId, invoiceId: id },
    });
    if (!a) throw new NotFoundException('attachment_not_found');
    return { bytes: Buffer.from(a.bytes), mime: a.mime, filename: a.filename };
  }

  async addAttachment(id: string, dto: ExternalInvoiceFileDto, actor: AuthPrincipal) {
    await this.mustExist(id);
    const count = await this.prisma.externalInvoiceAttachment.count({ where: { invoiceId: id } });
    if (count >= 20) throw new BadRequestException('too_many_attachments');
    const file = decodeInvoiceFile(dto.dataUri, dto.filename);
    const a = await this.prisma.externalInvoiceAttachment.create({
      data: {
        invoiceId: id,
        filename: file.filename,
        mime: file.mime,
        size: file.bytes.length,
        bytes: file.bytes,
        uploadedById: actor.id,
      },
    });
    await this.event(id, 'attachment_added', actor.id, file.filename);
    return { id: a.id };
  }

  async removeAttachment(id: string, attachmentId: string, actor: AuthPrincipal) {
    const a = await this.prisma.externalInvoiceAttachment.findFirst({
      where: { id: attachmentId, invoiceId: id },
      select: { id: true, filename: true },
    });
    if (!a) throw new NotFoundException('attachment_not_found');
    await this.prisma.externalInvoiceAttachment.delete({ where: { id: a.id } });
    await this.event(id, 'attachment_removed', actor.id, a.filename);
  }

  /** ZIP of original documents, organised `provider/year/month/file`. */
  async zip(dto: ExternalInvoicesZipDto): Promise<{ buffer: Buffer; filename: string }> {
    let where: Prisma.ExternalInvoiceWhereInput;
    let label: string;
    const { ids, all, ...filters } = dto;
    const hasFilter = Object.values(filters).some((v) => v !== undefined && v !== '');
    if (ids?.length) {
      where = { id: { in: ids } };
      label = 'selectie';
    } else if (all || hasFilter) {
      where = this.where(filters);
      const from = filters.from?.slice(0, 7);
      const to = filters.to?.slice(0, 7);
      label =
        [filters.provider, from && to && from === to ? from : [from, to].filter(Boolean).join('_')]
          .filter(Boolean)
          .join('-') || (hasFilter ? 'filtru' : 'toate');
    } else {
      throw new BadRequestException('zip_scope_required');
    }
    where = { AND: [where, { document: { isNot: null } }] };

    const count = await this.prisma.externalInvoice.count({ where });
    if (count === 0) throw new NotFoundException('no_documents');
    if (count > ZIP_MAX_DOCUMENTS) throw new BadRequestException('zip_too_large');

    const rows = await this.prisma.externalInvoice.findMany({
      where,
      orderBy: { issueDate: 'asc' },
      include: { document: true },
    });

    const used = new Set<string>();
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 6 } });
      const chunks: Buffer[] = [];
      archive.on('data', (c: Buffer) => chunks.push(c));
      archive.on('error', reject);
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      for (const r of rows) {
        if (!r.document) continue;
        const d = r.issueDate.toISOString().slice(0, 10);
        const prov = seg(r.providerName ?? providerInfo(r.provider)?.name ?? r.provider);
        const base = `${prov}/${d.slice(0, 4)}/${d.slice(5, 7)}/${d}_${seg(r.invoiceNumber ?? r.externalId ?? r.id)}`;
        let name = `${base}.${extFor(r.document.mime)}`;
        for (let i = 2; used.has(name); i++) name = `${base}_${i}.${extFor(r.document.mime)}`;
        used.add(name);
        archive.append(Buffer.from(r.document.bytes), { name, date: r.issueDate });
      }
      void archive.finalize();
    });
    return { buffer, filename: `facturi-furnizori-${seg(label)}.zip` };
  }

  // =========================================================================
  // AI extraction (draft only)
  // =========================================================================

  /** UBL / CII e-invoice: fields read straight from the XML (no AI, no
   *  cost, confidence 1). Same response shape as the AI draft. */
  private extractXml(bytes: Buffer) {
    let x: EInvoiceDraft;
    try {
      x = readEInvoice(bytes);
    } catch (e) {
      const msg = errText(e);
      throw new BadRequestException(msg === 'unsupported_xml_invoice' ? msg : 'xml_unreadable');
    }
    const issueDate = dateOnly(x.issueDate);
    const issues = issueDate
      ? validateInvoice({
          invoiceNumber: x.invoiceNumber,
          issueDate,
          dueDate: dateOnly(x.dueDate),
          periodStart: dateOnly(x.periodStart),
          periodEnd: dateOnly(x.periodEnd),
          subtotalMinor: x.subtotalMinor,
          taxMinor: x.taxMinor,
          totalMinor: x.totalMinor ?? 0,
          vatLines: x.vatLines,
          lines: x.lines,
        }).filter((i) => i !== 'paid_without_date')
      : [];
    const { syntax, ...draft } = x;
    return {
      draft,
      issues,
      extraction: {
        engine: 'xml',
        model: syntax === 'ubl' ? 'UBL 2.1' : 'UN/CEFACT CII',
        confidence: 1,
        fieldConfidence: {},
        estimatedCostUsd: 0,
        lowConfidence: false,
      },
    };
  }

  /**
   * Reads an uploaded document with Claude and returns a DRAFT of its fields
   * for the upload form, with per-field confidence, the validation issues
   * the draft would have, and possible duplicates. Nothing is stored.
   */
  async extract(dto: ExternalInvoiceFileDto) {
    const file = decodeInvoiceFile(dto.dataUri, dto.filename);
    if (file.mime === 'application/xml') return this.extractXml(file.bytes);
    if (!this.ai.configured) throw new BadRequestException('ai_not_configured');
    const res = await this.ai.extractInvoiceDocument({
      base64: file.bytes.toString('base64'),
      mime: file.mime as
        'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
    });
    if ('error' in res) throw new BadRequestException(res.error);
    const d = res.data;
    if (d.is_invoice === false) throw new BadRequestException('not_an_invoice');

    const conf = (d.confidence ?? {}) as Record<string, number>;
    const confValues = Object.values(conf).filter((v) => typeof v === 'number');
    const confidence = confValues.length ? Math.min(...confValues) : 0;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const isoDay = (v: unknown) => {
      const x = str(v);
      return x && /^\d{4}-\d{2}-\d{2}$/.test(x) && dateOnly(x) ? x : null;
    };
    const vatLines: VatLine[] = Array.isArray(d.vat_breakdown)
      ? (d.vat_breakdown as Record<string, unknown>[])
          .map((v) => ({
            rate: typeof v.rate === 'number' ? v.rate : null,
            netMinor: minorFromMajor(v.net) ?? 0,
            vatMinor: minorFromMajor(v.vat) ?? 0,
          }))
          .filter((v) => v.netMinor || v.vatMinor)
      : [];
    const lines: InvoiceLine[] = Array.isArray(d.lines)
      ? (d.lines as Record<string, unknown>[]).slice(0, 300).map((l) => ({
          description: String(l.description ?? '').slice(0, 500),
          quantity: typeof l.quantity === 'number' ? l.quantity : null,
          unitPriceMinor: minorFromMajor(l.unit_price),
          netMinor: minorFromMajor(l.net),
          vatRate: typeof l.vat_rate === 'number' ? l.vat_rate : null,
        }))
      : [];
    const currency = str(d.currency)?.toUpperCase() ?? null;
    const draft = {
      supplierName: str(d.supplier_name),
      supplierVatId: str(d.supplier_vat_id),
      invoiceNumber: str(d.invoice_number),
      documentType: str(d.document_type),
      issueDate: isoDay(d.issue_date),
      dueDate: isoDay(d.due_date),
      periodStart: isoDay(d.period_start),
      periodEnd: isoDay(d.period_end),
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
      subtotalMinor: minorFromMajor(d.net_amount),
      taxMinor: minorFromMajor(d.vat_amount),
      totalMinor: minorFromMajor(d.total_amount),
      paymentStatus:
        d.paid === 'paid' || d.paid === true
          ? 'paid'
          : d.paid === 'unpaid' || d.paid === false
            ? 'unpaid'
            : null,
      vatLines,
      lines,
    };
    const issueDate = dateOnly(draft.issueDate);
    const issues = issueDate
      ? validateInvoice({
          invoiceNumber: draft.invoiceNumber,
          issueDate,
          dueDate: dateOnly(draft.dueDate),
          periodStart: dateOnly(draft.periodStart),
          periodEnd: dateOnly(draft.periodEnd),
          subtotalMinor: draft.subtotalMinor,
          taxMinor: draft.taxMinor,
          totalMinor: draft.totalMinor ?? 0,
          vatLines,
          lines,
        }).filter((i) => i !== 'paid_without_date')
      : [];
    const estimatedCostUsd = estimateClaudeCostMinor(res.usage) / 100;
    return {
      draft,
      issues,
      extraction: {
        engine: 'claude',
        model: res.model,
        confidence,
        fieldConfidence: conf,
        estimatedCostUsd,
        lowConfidence: confidence < LOW_CONFIDENCE,
      },
    };
  }

  // =========================================================================
  // Ingestion pipeline (every source goes through here)
  // =========================================================================

  private async findExisting(n: NormalizedInvoice) {
    if (n.externalId) {
      const byExt = await this.prisma.externalInvoice.findUnique({
        where: { provider_externalId: { provider: n.provider, externalId: n.externalId } },
        select: { id: true, source: true, document: { select: { invoiceId: true } } },
      });
      if (byExt) return { row: byExt, how: 'external' as const };
    }
    const num = normalizeInvoiceNumber(n.invoiceNumber);
    if (!num) return null;
    const candidates = await this.prisma.externalInvoice.findMany({
      where: {
        provider: n.provider,
        invoiceNumber: { not: null },
        ...(n.provider === 'other' && n.providerName
          ? { providerName: { equals: n.providerName, mode: 'insensitive' } }
          : {}),
      },
      select: {
        id: true,
        source: true,
        externalId: true,
        invoiceNumber: true,
        document: { select: { invoiceId: true } },
      },
    });
    const hit = candidates.find((c) => normalizeInvoiceNumber(c.invoiceNumber) === num);
    return hit ? { row: hit, how: 'number' as const } : null;
  }

  /** Same supplier + currency + total, issued within a few days: likely the
   *  same invoice entered twice (or a re-sent copy with another number). */
  private async findNearDuplicate(
    n: NormalizedInvoice,
    excludeId?: string,
  ): Promise<string | null> {
    const hit = await this.prisma.externalInvoice.findFirst({
      where: {
        provider: n.provider,
        ...(n.provider === 'other' && n.providerName
          ? { providerName: { equals: n.providerName, mode: 'insensitive' } }
          : {}),
        currency: n.currency,
        totalMinor: n.totalMinor,
        issueDate: {
          gte: addDays(n.issueDate, -DUPLICATE_WINDOW_DAYS),
          lte: addDays(n.issueDate, DUPLICATE_WINDOW_DAYS),
        },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return hit?.id ?? null;
  }

  private dataFor(n: NormalizedInvoice) {
    return {
      providerName: n.provider === 'other' ? (n.providerName ?? null) : null,
      invoiceNumber: n.invoiceNumber ?? null,
      docType: n.docType ?? null,
      supplierVatId: n.supplierVatId ?? null,
      issueDate: n.issueDate,
      dueDate: n.dueDate ?? null,
      periodStart: n.periodStart ?? null,
      periodEnd: n.periodEnd ?? null,
      currency: n.currency,
      subtotalMinor: n.subtotalMinor ?? null,
      taxMinor: n.taxMinor ?? null,
      totalMinor: n.totalMinor,
      vatLines: n.vatLines?.length
        ? (n.vatLines as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      lines: n.lines?.length ? (n.lines as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      paymentStatus: n.paymentStatus ?? null,
      paidAt: n.paymentStatus === 'paid' ? (n.paidAt ?? null) : null,
      note: n.note ?? null,
      raw: n.raw === undefined ? undefined : (n.raw as Prisma.InputJsonValue),
    };
  }

  async ingest(n: NormalizedInvoice, opts: IngestOptions): Promise<IngestResult> {
    const existing = await this.findExisting(n);

    // --- Already known -------------------------------------------------------
    if (existing) {
      if (opts.source === 'manual') {
        // A person uploading the same supplier + number again: refuse
        // instead of double-counting the expense.
        throw new BadRequestException('duplicate_invoice');
      }
      // Automated re-import: refresh the provider's data, but never
      // overwrite a field a person corrected (their edit is in the history).
      const events = await this.prisma.externalInvoiceEvent.findMany({
        where: { invoiceId: existing.row.id, kind: 'updated' },
        select: { kind: true, changes: true },
      });
      const corrected = this.correctedFields(events);
      const data = this.dataFor(n) as Record<string, unknown>;
      for (const k of Object.keys(data)) if (corrected.has(k)) delete data[k];
      delete data.note;
      delete data.paymentStatus;
      delete data.paidAt;
      await this.prisma.externalInvoice.update({
        where: { id: existing.row.id },
        data: {
          ...(data as Prisma.ExternalInvoiceUpdateInput),
          externalId: n.externalId ?? undefined,
        },
      });
      if (existing.how === 'number' && existing.row.source === 'manual') {
        await this.event(existing.row.id, 'imported', null, `linked:${opts.source}`);
      }
      let documentStored = false;
      if (!existing.row.document && opts.fetchDocument) {
        documentStored = await this.storeFetchedDocument(existing.row.id, opts.fetchDocument);
      }
      return {
        id: existing.row.id,
        outcome: existing.how === 'number' ? 'linked' : 'updated',
        documentStored,
        possibleDuplicateOfId: null,
      };
    }

    // --- New invoice ------------------------------------------------------
    const supplier = await resolveSupplier(this.prisma, n);
    const signals = await supplierSignals(this.prisma, supplier, n);
    if (signals.dueDate && !n.dueDate) n = { ...n, dueDate: signals.dueDate };
    const issues = validateInvoice(n);
    const nearDup = await this.findNearDuplicate(n);
    const extractionConfidence =
      opts.extraction && typeof opts.extraction.confidence === 'number'
        ? opts.extraction.confidence
        : null;
    // Structured XML is read exactly; only AI/OCR drafts need a person's
    // confirmation before they count as verified.
    const aiDraft = !!opts.extraction && opts.extraction.engine !== 'xml';
    const needsReview =
      issues.length > 0 ||
      !!nearDup ||
      signals.flags.some((f) => f === 'amount_anomaly' || f === 'vat_id_changed') ||
      (opts.source === 'manual' && aiDraft && !opts.reviewed) ||
      (extractionConfidence !== null && extractionConfidence < LOW_CONFIDENCE && !opts.reviewed);

    const created = await this.prisma.externalInvoice.create({
      data: {
        ...(this.dataFor(n) as Omit<
          Prisma.ExternalInvoiceUncheckedCreateInput,
          'provider' | 'source'
        >),
        provider: n.provider,
        source: opts.source,
        externalId: n.externalId ?? null,
        processingStatus: needsReview ? 'needs_review' : 'verified',
        possibleDuplicateOfId: nearDup,
        supplierId: supplier.id,
        flags: signals.flags,
        extraction: opts.extraction
          ? ({ ...opts.extraction, at: new Date().toISOString() } as Prisma.InputJsonValue)
          : undefined,
        createdById: opts.actor?.id ?? null,
        document: opts.document
          ? {
              create: {
                filename: opts.document.filename,
                mime: opts.document.mime,
                size: opts.document.bytes.length,
                bytes: opts.document.bytes,
              },
            }
          : undefined,
      },
    });
    await this.event(
      created.id,
      opts.source === 'manual' ? 'created' : 'imported',
      opts.actor?.id ?? null,
      opts.source === 'manual' ? (opts.extraction ? 'ai_prefilled' : 'manual') : opts.source,
      issues.length ? { issues } : undefined,
    );
    if (nearDup) await this.event(created.id, 'duplicate_flag', null, nearDup);
    for (const f of signals.flags) await this.event(created.id, 'flag', null, f);

    let documentStored = !!opts.document;
    if (!opts.document && opts.fetchDocument) {
      documentStored = await this.storeFetchedDocument(created.id, opts.fetchDocument);
    }
    return { id: created.id, outcome: 'created', documentStored, possibleDuplicateOfId: nearDup };
  }

  private async storeFetchedDocument(
    id: string,
    fetch: () => Promise<FetchedDocument>,
  ): Promise<boolean> {
    try {
      const doc = await fetch();
      await this.prisma.$transaction([
        this.prisma.externalInvoiceDocument.create({
          data: {
            invoiceId: id,
            filename: doc.filename,
            mime: doc.mime,
            size: doc.bytes.length,
            bytes: doc.bytes,
          },
        }),
        this.prisma.externalInvoice.update({ where: { id }, data: { documentError: null } }),
      ]);
      return true;
    } catch (e) {
      await this.prisma.externalInvoice.update({
        where: { id },
        data: { documentError: errText(e) },
      });
      return false;
    }
  }

  // =========================================================================
  // Manual originals
  // =========================================================================

  async upload(dto: UploadExternalInvoiceDto, actor: AuthPrincipal) {
    const info = providerInfo(dto.provider);
    if (!info) throw new BadRequestException('unknown_provider');
    if (dto.provider === 'other' && !dto.providerName) {
      throw new BadRequestException('provider_name_required');
    }
    const file = decodeInvoiceFile(dto.dataUri, dto.filename);
    const issueDate = dateOnly(dto.issueDate);
    if (!issueDate) throw new BadRequestException('bad_issue_date');

    const result = await this.ingest(
      {
        provider: dto.provider,
        providerName: dto.providerName ?? null,
        invoiceNumber: dto.invoiceNumber,
        supplierVatId: dto.supplierVatId || null,
        issueDate,
        dueDate: dateOnly(dto.dueDate),
        periodStart: dateOnly(dto.periodStart),
        periodEnd: dateOnly(dto.periodEnd),
        currency: dto.currency,
        subtotalMinor: dto.subtotalMinor ?? null,
        taxMinor: dto.taxMinor ?? null,
        totalMinor: dto.totalMinor,
        vatLines: dto.vatLines ?? null,
        lines: dto.lines ?? null,
        paymentStatus: dto.paymentStatus ?? null,
        paidAt: dto.paymentStatus === 'paid' ? (dateOnly(dto.paidAt) ?? startOfUtcToday()) : null,
        note: dto.note || null,
      },
      {
        source: 'manual',
        document: file,
        actor,
        extraction: dto.extraction ? { ...dto.extraction } : null,
        reviewed: dto.reviewed ?? !dto.extraction,
      },
    );
    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.platformRoles,
      action: 'external_invoice.upload',
      targetType: 'external_invoice',
      targetId: result.id,
      after: {
        provider: dto.provider,
        providerName: dto.providerName ?? null,
        invoiceNumber: dto.invoiceNumber,
        totalMinor: dto.totalMinor,
        currency: dto.currency,
      },
    });
    return { id: result.id, possibleDuplicateOfId: result.possibleDuplicateOfId };
  }

  // =========================================================================
  // Manual corrections, bulk actions, notes
  // =========================================================================

  private async mustExist(id: string) {
    const r = await this.prisma.externalInvoice.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('invoice_not_found');
    return r;
  }

  private async event(
    invoiceId: string,
    kind: string,
    actorId: string | null,
    message?: string | null,
    changes?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.externalInvoiceEvent.create({
      data: {
        invoiceId,
        kind,
        actorId,
        message: message ?? null,
        changes: changes ? (changes as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  async update(id: string, dto: UpdateExternalInvoiceDto, actor: AuthPrincipal) {
    const before = await this.mustExist(id);
    if (dto.providerName !== undefined && before.provider !== 'other') delete dto.providerName;

    const data: Record<string, unknown> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of EDITABLE_FIELDS) {
      const v = (dto as Record<string, unknown>)[f];
      if (v === undefined) continue;
      let next: unknown = v;
      if (DATE_FIELDS.has(f)) next = v === null ? null : dateOnly(v as string);
      if (f === 'vatLines' || f === 'lines') {
        const parsed = v === null ? null : f === 'vatLines' ? parseVatLines(v) : parseLines(v);
        next = parsed;
      }
      if (f === 'note' && typeof v === 'string' && !v.trim()) next = null;
      const prev = (before as Record<string, unknown>)[f];
      const a = JSON.stringify(cmpVal(f, prev));
      const b = JSON.stringify(cmpVal(f, next));
      if (a === b) continue;
      changes[f] = { from: cmpVal(f, prev), to: cmpVal(f, next) };
      data[f] =
        (f === 'vatLines' || f === 'lines') && next === null
          ? Prisma.DbNull
          : (next as Prisma.InputJsonValue | Date | string | number | null);
    }
    // Paying sets a payment date (today unless given); un-paying clears it.
    if (changes.paymentStatus) {
      if (dto.paymentStatus === 'paid' && !data.paidAt && !before.paidAt)
        data.paidAt = startOfUtcToday();
      if (dto.paymentStatus !== 'paid') data.paidAt = null;
    }
    if (!Object.keys(changes).length) return this.detail(id);

    if (data.issueDate === null) throw new BadRequestException('bad_issue_date');
    await this.prisma.externalInvoice.update({
      where: { id },
      data: data as Prisma.ExternalInvoiceUpdateInput,
    });

    const { processingStatus, paymentStatus, paidAt, ...fieldChanges } = changes;
    if (Object.keys(fieldChanges).length)
      await this.event(id, 'updated', actor.id, null, fieldChanges);
    if (paymentStatus || paidAt) {
      await this.event(
        id,
        'payment',
        actor.id,
        (dto.paymentStatus ?? before.paymentStatus) || 'unknown',
        {
          ...(paymentStatus ? { paymentStatus } : {}),
          ...(paidAt ? { paidAt } : {}),
        },
      );
    }
    if (processingStatus) await this.event(id, 'review', actor.id, String(processingStatus.to));

    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.platformRoles,
      action: 'external_invoice.update',
      targetType: 'external_invoice',
      targetId: id,
      before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.from])),
      after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
    });
    return this.detail(id);
  }

  async bulk(dto: BulkExternalInvoicesDto, actor: AuthPrincipal) {
    const rows = await this.prisma.externalInvoice.findMany({
      where: { id: { in: dto.ids } },
      select: { id: true, paymentStatus: true, paidAt: true, processingStatus: true },
    });
    const paidAt = dateOnly(dto.paidAt) ?? startOfUtcToday();
    let changed = 0;
    for (const r of rows) {
      if (dto.action === 'mark_paid' && r.paymentStatus !== 'paid') {
        await this.prisma.externalInvoice.update({
          where: { id: r.id },
          data: { paymentStatus: 'paid', paidAt },
        });
        await this.event(r.id, 'payment', actor.id, 'paid', {
          paymentStatus: { from: r.paymentStatus, to: 'paid' },
          paidAt: { from: ymd(r.paidAt), to: ymd(paidAt) },
        });
        changed++;
      } else if (dto.action === 'mark_unpaid' && r.paymentStatus !== 'unpaid') {
        await this.prisma.externalInvoice.update({
          where: { id: r.id },
          data: { paymentStatus: 'unpaid', paidAt: null },
        });
        await this.event(r.id, 'payment', actor.id, 'unpaid', {
          paymentStatus: { from: r.paymentStatus, to: 'unpaid' },
        });
        changed++;
      } else if (
        (dto.action === 'mark_verified' && r.processingStatus !== 'verified') ||
        (dto.action === 'mark_needs_review' && r.processingStatus !== 'needs_review')
      ) {
        const to = dto.action === 'mark_verified' ? 'verified' : 'needs_review';
        await this.prisma.externalInvoice.update({
          where: { id: r.id },
          data: { processingStatus: to },
        });
        await this.event(r.id, 'review', actor.id, to);
        changed++;
      }
    }
    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.platformRoles,
      action: `external_invoice.bulk_${dto.action}`,
      targetType: 'external_invoice',
      targetId: null,
      after: { ids: rows.map((r) => r.id), changed },
    });
    return { matched: rows.length, changed };
  }

  async addNote(id: string, text: string, actor: AuthPrincipal) {
    await this.mustExist(id);
    await this.event(id, 'note', actor.id, text);
    return { ok: true };
  }

  /** Only uploaded originals can be removed: an API import would simply
   *  come back on the next sync. */
  async remove(id: string, actor: AuthPrincipal): Promise<void> {
    const existing = await this.mustExist(id);
    if (existing.source !== 'manual') throw new BadRequestException('api_invoice_not_deletable');
    await this.prisma.externalInvoice.delete({ where: { id } });
    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.platformRoles,
      action: 'external_invoice.delete',
      targetType: 'external_invoice',
      targetId: id,
      before: {
        provider: existing.provider,
        providerName: existing.providerName,
        invoiceNumber: existing.invoiceNumber,
        totalMinor: existing.totalMinor,
        currency: existing.currency,
      },
    });
  }

  // =========================================================================
  // Automated import
  // =========================================================================

  async sync(dto: SyncExternalInvoicesDto, actor: AuthPrincipal): Promise<SyncResult> {
    const result = await this.syncSource(dto.provider, dto.months);
    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.platformRoles,
      action: 'external_invoice.sync',
      targetType: 'external_invoice_provider',
      targetId: dto.provider,
      after: result,
    });
    return result;
  }

  async syncAll(): Promise<SyncResult[]> {
    const out: SyncResult[] = [];
    for (const a of this.adapters) out.push(await this.syncSource(a.provider));
    return out;
  }

  /** Kept for callers/tests written against the first version. */
  async syncGoogleAds(months?: number): Promise<SyncResult> {
    return this.syncSource('google_ads', months);
  }

  private async recordSync(r: SyncResult): Promise<SyncResult> {
    const fields = {
      ok: r.ok,
      message: r.message,
      imported: r.imported,
      updated: r.updated,
      documents: r.documents,
    };
    await this.prisma.externalInvoiceSync.upsert({
      where: { provider: r.provider },
      create: { provider: r.provider, lastRunAt: new Date(), ...fields },
      update: { lastRunAt: new Date(), ...fields },
    });
    return r;
  }

  async syncSource(provider: string, months?: number): Promise<SyncResult> {
    const r: SyncResult = {
      provider,
      ok: false,
      message: null,
      imported: 0,
      updated: 0,
      documents: 0,
    };
    const adapter = this.adapter(provider);
    if (!adapter) {
      r.message = 'no_adapter';
      return r;
    }
    if (!adapter.configured) {
      r.message = 'not_configured';
      return this.recordSync(r);
    }
    if (this.syncing.has(provider)) {
      r.message = 'sync_in_progress';
      return r;
    }
    this.syncing.add(provider);
    const newIds: string[] = [];
    try {
      const existing = await this.prisma.externalInvoice.count({ where: { provider } });
      const span = months ?? (existing === 0 ? 24 : 3);
      const collected = await adapter.collect({ months: span });
      if (collected.fatal) {
        r.message = collected.fatal;
        return this.recordSync(r);
      }
      for (const item of collected.items) {
        try {
          const res = await this.ingest(item.invoice, {
            source: adapter.source,
            fetchDocument: item.fetchDocument,
          });
          if (res.outcome === 'created') {
            r.imported++;
            newIds.push(res.id);
          } else r.updated++;
          if (res.documentStored) r.documents++;
        } catch (e) {
          collected.errors.push(errText(e));
        }
      }
      r.documents += await this.retryMissingDocuments(adapter);
      r.ok = true;
      r.message = collected.errors.length
        ? `${collected.errors.length}/${collected.attempts}: ${collected.errors[0]}`
        : null;
      return this.recordSync(r);
    } catch (e) {
      r.message = errText(e);
      return this.recordSync(r);
    } finally {
      this.syncing.delete(provider);
      if (newIds.length) void this.notifyNewInvoices(provider, newIds);
    }
  }

  private async retryMissingDocuments(adapter: InvoiceSourceAdapter): Promise<number> {
    if (!adapter.refetchDocuments) return 0;
    const missing = await this.prisma.externalInvoice.findMany({
      where: { provider: adapter.provider, document: { is: null }, externalId: { not: null } },
      select: { id: true, externalId: true, issueDate: true, raw: true },
      take: 50,
    });
    if (!missing.length) return 0;
    const links = await adapter.refetchDocuments(
      missing.map((m) => ({ externalId: m.externalId!, issueDate: m.issueDate, raw: m.raw })),
    );
    let stored = 0;
    for (const m of missing) {
      const fetch = links.get(m.externalId!);
      if (!fetch) continue;
      const has = await this.prisma.externalInvoiceDocument.findUnique({
        where: { invoiceId: m.id },
        select: { invoiceId: true },
      });
      if (!has && (await this.storeFetchedDocument(m.id, fetch))) stored++;
    }
    return stored;
  }

  // =========================================================================
  // Notifications (new invoices, due / overdue reminders)
  // =========================================================================

  private async financeStaff(): Promise<string[]> {
    const rows = await this.prisma.platformRoleAssignment.findMany({
      where: { role: { in: ['admin', 'finance'] } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((r) => r.userId);
  }

  private async notifyNewInvoices(provider: string, ids: string[]): Promise<void> {
    try {
      const name = providerInfo(provider)?.name ?? provider;
      for (const userId of await this.financeStaff()) {
        await this.notifications.notify({
          userId,
          type: 'supplier_invoices_new',
          title: `Facturi furnizori noi: ${ids.length}`,
          body: `${ids.length} facturi noi importate automat de la ${name}.`,
          channels: { panel: true },
          data: { provider, externalInvoiceId: ids.length === 1 ? ids[0] : undefined },
        });
      }
    } catch (e) {
      this.logger.error(`New supplier invoice notification failed: ${errText(e)}`);
    }
  }

  /** Unpaid invoices due within REMIND_BEFORE_DAYS, and overdue ones: one
   *  summary notification per stage to every admin/finance user; each
   *  invoice is reminded once per stage (recorded in its history). */
  async sendDueReminders(): Promise<{ dueSoon: number; overdue: number }> {
    const today = startOfUtcToday();
    const [dueSoon, overdue] = await Promise.all([
      this.prisma.externalInvoice.findMany({
        where: {
          paymentStatus: 'unpaid',
          dueDate: { gte: today, lte: addDays(today, REMIND_BEFORE_DAYS) },
          events: { none: { kind: 'reminder_due' } },
        },
        select: { id: true },
      }),
      this.prisma.externalInvoice.findMany({
        where: {
          paymentStatus: 'unpaid',
          dueDate: { lt: today },
          events: { none: { kind: 'reminder_overdue' } },
        },
        select: { id: true },
      }),
    ]);
    if (!dueSoon.length && !overdue.length) return { dueSoon: 0, overdue: 0 };
    const staff = await this.financeStaff();
    for (const [rows, kind, title, body] of [
      [
        dueSoon,
        'reminder_due',
        'Facturi furnizori scadente',
        'facturi neplătite ajung la scadență în următoarele zile.',
      ],
      [
        overdue,
        'reminder_overdue',
        'Facturi furnizori restante',
        'facturi neplătite au depășit scadența.',
      ],
    ] as const) {
      if (!rows.length) continue;
      for (const userId of staff) {
        await this.notifications
          .notify({
            userId,
            type: kind === 'reminder_due' ? 'supplier_invoices_due' : 'supplier_invoices_overdue',
            title: `${title}: ${rows.length}`,
            body: `${rows.length} ${body}`,
            channels: { panel: true },
            data: { due: kind === 'reminder_due' ? 'due_soon' : 'overdue' },
          })
          .catch((e) => this.logger.error(`Reminder notify failed: ${errText(e)}`));
      }
      await this.prisma.externalInvoiceEvent.createMany({
        data: rows.map((r) => ({ invoiceId: r.id, kind, actorId: null })),
      });
    }
    return { dueSoon: dueSoon.length, overdue: overdue.length };
  }
}
