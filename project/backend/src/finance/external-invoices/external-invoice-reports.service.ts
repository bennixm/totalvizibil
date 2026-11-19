import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../admin/audit-log.service';
import type { AuthPrincipal } from '../../auth/auth.types';
import { parseVatLines, startOfUtcToday, type VatLine } from './external-invoice-model';
import { resolveSupplier } from './supplier-registry';
import { BnrRatesService, type DisplayCurrency } from './bnr-rates.service';
import type {
  ConfirmVatDto,
  UpdateSupplierDto,
  VatReportQuery,
} from './external-invoice-reports.dto';

const DAY = 86_400_000;

function ym(d: Date): string {
  return d.toISOString().slice(0, 7);
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * The analysis side of supplier invoices: the supplier registry with its
 * statistics, recurring-invoice and anomaly insights, the due-date calendar
 * and the VAT report. Every tax figure computed here is an ESTIMATE from
 * stored invoices; what the accountant confirmed is stored and returned
 * separately (ExternalVatConfirmation), never merged into the estimate.
 */
@Injectable()
export class ExternalInvoiceReportsService implements OnModuleInit {
  private readonly logger = new Logger(ExternalInvoiceReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly fx: BnrRatesService,
  ) {}

  /** Links invoices stored before the registry existed (once, at boot). */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => {
      void this.backfillSuppliers().catch((e) =>
        this.logger.error(`Supplier backfill failed: ${e instanceof Error ? e.message : e}`),
      );
    }, 30_000);
  }

  async backfillSuppliers(): Promise<number> {
    const rows = await this.prisma.externalInvoice.findMany({
      where: { supplierId: null },
      select: {
        id: true,
        provider: true,
        providerName: true,
        supplierVatId: true,
        issueDate: true,
        currency: true,
        totalMinor: true,
      },
      take: 2000,
    });
    for (const r of rows) {
      const s = await resolveSupplier(this.prisma, {
        provider: r.provider,
        providerName: r.providerName,
        supplierVatId: r.supplierVatId,
        issueDate: r.issueDate,
        currency: r.currency,
        totalMinor: r.totalMinor,
      });
      await this.prisma.externalInvoice.update({ where: { id: r.id }, data: { supplierId: s.id } });
    }
    return rows.length;
  }

  // =========================================================================
  // Supplier registry
  // =========================================================================

  async suppliers(display: DisplayCurrency = 'EUR') {
    const [suppliers, rows] = await Promise.all([
      this.prisma.externalSupplier.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.externalInvoice.findMany({
        where: { supplierId: { not: null } },
        select: {
          supplierId: true,
          currency: true,
          issueDate: true,
          totalMinor: true,
          taxMinor: true,
          subtotalMinor: true,
          paymentStatus: true,
        },
      }),
    ]);
    await this.fx.ensure(rows.map((r) => r.issueDate.getUTCFullYear()));
    const recurring = await this.recurringBySupplier(display);
    return suppliers.map((s) => {
      const mine = rows.filter((r) => r.supplierId === s.id);
      let totalMinor = 0;
      let taxMinor = 0;
      for (const r of mine) {
        const c = this.fx.convert(r, r.currency, display, r.issueDate);
        totalMinor += c?.totalMinor ?? 0;
        taxMinor += c?.taxMinor ?? 0;
      }
      const last = mine.reduce<Date | null>(
        (m, r) => (!m || r.issueDate > m ? r.issueDate : m),
        null,
      );
      return {
        ...s,
        invoiceCount: mine.length,
        // Converted to the display currency (BNR rate of each issue date).
        totals: mine.length
          ? [{ currency: display, count: mine.length, totalMinor, taxMinor }]
          : [],
        unpaidCount: mine.filter((r) => r.paymentStatus === 'unpaid').length,
        lastIssueDate: last,
        recurring: recurring.get(s.id) ?? null,
      };
    });
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto, actor: AuthPrincipal) {
    const before = await this.prisma.externalSupplier.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('supplier_not_found');
    const data: Record<string, unknown> = {};
    for (const k of ['vatId', 'email', 'paymentTermsDays', 'defaultCurrency', 'notes'] as const) {
      const v = dto[k];
      if (v === undefined) continue;
      data[k] = typeof v === 'string' && !v.trim() ? null : v;
    }
    const after = await this.prisma.externalSupplier.update({ where: { id }, data });
    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.platformRoles,
      action: 'external_supplier.update',
      targetType: 'external_supplier',
      targetId: id,
      before: Object.fromEntries(
        Object.keys(data).map((k) => [k, (before as Record<string, unknown>)[k]]),
      ),
      after: data,
    });
    return after;
  }

  /** Only a supplier with no invoices can go (test entries, typos); one
   *  with invoices stays, because the invoices reference it. */
  async removeSupplier(id: string, actor: AuthPrincipal) {
    const s = await this.prisma.externalSupplier.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true } } },
    });
    if (!s) throw new NotFoundException('supplier_not_found');
    if (s._count.invoices > 0) throw new BadRequestException('supplier_has_invoices');
    await this.prisma.externalSupplier.delete({ where: { id } });
    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.platformRoles,
      action: 'external_supplier.delete',
      targetType: 'external_supplier',
      targetId: id,
      before: { name: s.name, provider: s.provider, vatId: s.vatId },
    });
    return { ok: true };
  }

  // =========================================================================
  // Insights: recurring invoices, missing ones, anomalies
  // =========================================================================

  /** Suppliers that bill monthly: invoices in at least 3 of the previous
   *  4 calendar months. Returns the usual issue day and average amount. */
  private async recurringBySupplier(display: DisplayCurrency) {
    const today = startOfUtcToday();
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 4, 1));
    const rows = await this.prisma.externalInvoice.findMany({
      where: { supplierId: { not: null }, issueDate: { gte: from } },
      select: { supplierId: true, issueDate: true, totalMinor: true, currency: true },
    });
    await this.fx.ensure(rows.map((r) => r.issueDate.getUTCFullYear()));
    const thisMonth = ym(today);
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.supplierId!, [...(by.get(r.supplierId!) ?? []), r]);
    const out = new Map<
      string,
      {
        usualDay: number;
        avgMinor: number;
        currency: string;
        months: number;
        missingThisMonth: boolean;
        expectedBy: string;
      }
    >();
    for (const [id, list] of by) {
      const prev = list.filter((r) => ym(r.issueDate) !== thisMonth);
      const months = new Set(prev.map((r) => ym(r.issueDate)));
      if (months.size < 3) continue;
      const usualDay = median(prev.map((r) => r.issueDate.getUTCDate()));
      const currency = display;
      const converted = prev
        .map((r) => this.fx.amount(r.totalMinor, r.currency, display, r.issueDate))
        .filter((v): v is number => v !== null);
      const avgMinor = converted.length
        ? Math.round(converted.reduce((s, v) => s + v, 0) / converted.length)
        : 0;
      const gotThisMonth = list.some((r) => ym(r.issueDate) === thisMonth);
      // A week of grace after the usual day before calling it missing.
      const expected = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), usualDay));
      const expectedBy = new Date(expected.getTime() + 7 * DAY);
      out.set(id, {
        usualDay,
        avgMinor,
        currency,
        months: months.size,
        missingThisMonth: !gotThisMonth && today.getTime() > expectedBy.getTime(),
        expectedBy: expectedBy.toISOString().slice(0, 10),
      });
    }
    return out;
  }

  async insights(display: DisplayCurrency = 'EUR') {
    const recurring = await this.recurringBySupplier(display);
    const suppliers = await this.prisma.externalSupplier.findMany({
      where: { id: { in: [...recurring.keys()] } },
      select: { id: true, name: true, provider: true },
    });
    const missing = suppliers
      .map((s) => ({ supplier: s, ...recurring.get(s.id)! }))
      .filter((x) => x.missingThisMonth);
    const flagged = await this.prisma.externalInvoice.findMany({
      where: {
        flags: { hasSome: ['amount_anomaly', 'vat_id_changed'] },
        processingStatus: 'needs_review',
      },
      orderBy: { issueDate: 'desc' },
      take: 20,
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        totalMinor: true,
        currency: true,
        flags: true,
        supplier: { select: { name: true } },
      },
    });
    await this.fx.ensure(flagged.map((f) => f.issueDate.getUTCFullYear()));
    return {
      recurringCount: recurring.size,
      missingRecurring: missing,
      anomalies: flagged.map((f) => {
        const conv = this.fx.amount(f.totalMinor, f.currency, display, f.issueDate);
        return {
          id: f.id,
          invoiceNumber: f.invoiceNumber,
          issueDate: f.issueDate,
          totalMinor: conv ?? f.totalMinor,
          currency: conv === null ? f.currency : display,
          flags: f.flags,
          supplierName: f.supplier?.name ?? null,
        };
      }),
    };
  }

  // =========================================================================
  // Due-date calendar
  // =========================================================================

  async calendar(month: string, display: DisplayCurrency = 'EUR') {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('bad_month');
    const [y, m] = month.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const rows = await this.prisma.externalInvoice.findMany({
      where: { dueDate: { gte: from, lt: to } },
      orderBy: [{ dueDate: 'asc' }, { totalMinor: 'desc' }],
      select: {
        id: true,
        provider: true,
        providerName: true,
        invoiceNumber: true,
        dueDate: true,
        issueDate: true,
        totalMinor: true,
        currency: true,
        paymentStatus: true,
        supplier: { select: { name: true } },
      },
    });
    await this.fx.ensure(rows.map((r) => r.issueDate.getUTCFullYear()));
    const today = startOfUtcToday().getTime();
    return {
      month,
      items: rows.map((r) => {
        const conv = this.fx.amount(r.totalMinor, r.currency, display, r.issueDate);
        return {
          id: r.id,
          supplierName: r.supplier?.name ?? r.providerName ?? r.provider,
          invoiceNumber: r.invoiceNumber,
          dueDate: r.dueDate!.toISOString().slice(0, 10),
          totalMinor: conv ?? r.totalMinor,
          currency: conv === null ? r.currency : display,
          paymentStatus: r.paymentStatus,
          overdue: r.paymentStatus === 'unpaid' && r.dueDate!.getTime() < today,
        };
      }),
    };
  }

  // =========================================================================
  // VAT report: estimated (calculated) vs confirmed (accountant)
  // =========================================================================

  async vatReport(q: VatReportQuery) {
    const display: DisplayCurrency = q.display ?? 'EUR';
    const year = q.year ?? startOfUtcToday().getUTCFullYear();
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const [rows, confirmations] = await Promise.all([
      this.prisma.externalInvoice.findMany({
        where: { issueDate: { gte: from, lt: to } },
        select: {
          issueDate: true,
          currency: true,
          subtotalMinor: true,
          taxMinor: true,
          totalMinor: true,
          vatLines: true,
          processingStatus: true,
        },
      }),
      this.prisma.externalVatConfirmation.findMany({
        where: { period: { startsWith: `${year}-` } },
        include: { confirmedBy: { select: { name: true } } },
      }),
    ]);
    await this.fx.ensure([year]);
    type Cell = {
      period: string;
      currency: string;
      invoices: number;
      unverified: number;
      netMinor: number;
      vatMinor: number;
      totalMinor: number;
      // How many invoices actually stated a net / VAT amount: a period where
      // none did reports "not stated" (null), never a misleading 0.
      netKnown: number;
      vatKnown: number;
      byRate: Map<string, { rate: number | null; netMinor: number; vatMinor: number }>;
    };
    const cells = new Map<string, Cell>();
    // One row per month in the display currency: every invoice converted at
    // the BNR rate of its issue date.
    let unconverted = 0;
    for (const r of rows) {
      const fx = this.fx.convert(r, r.currency, display, r.issueDate);
      if (!fx) {
        unconverted++;
        continue;
      }
      const period = ym(r.issueDate);
      const key = period;
      const c =
        cells.get(key) ??
        ({
          period,
          currency: display,
          invoices: 0,
          unverified: 0,
          netMinor: 0,
          vatMinor: 0,
          totalMinor: 0,
          netKnown: 0,
          vatKnown: 0,
          byRate: new Map(),
        } as Cell);
      c.invoices++;
      if (r.processingStatus !== 'verified') c.unverified++;
      c.netMinor += fx.subtotalMinor ?? 0;
      c.vatMinor += fx.taxMinor ?? 0;
      if (r.subtotalMinor !== null) c.netKnown++;
      if (r.taxMinor !== null) c.vatKnown++;
      c.totalMinor += fx.totalMinor;
      const lines: VatLine[] =
        parseVatLines(r.vatLines) ??
        (r.taxMinor !== null
          ? [{ rate: null, netMinor: r.subtotalMinor ?? 0, vatMinor: r.taxMinor }]
          : []);
      for (const l of lines) {
        const k = String(l.rate ?? 'x');
        const b = c.byRate.get(k) ?? { rate: l.rate, netMinor: 0, vatMinor: 0 };
        b.netMinor += Math.round(l.netMinor * fx.rate);
        b.vatMinor += Math.round(l.vatMinor * fx.rate);
        c.byRate.set(k, b);
      }
      cells.set(key, c);
    }
    // Confirmed periods with no invoice still show up (the accountant's
    // figure is the source of truth for that period).
    for (const cf of confirmations) {
      const key = cf.period;
      if (!cells.has(key)) {
        cells.set(key, {
          period: cf.period,
          currency: display,
          invoices: 0,
          unverified: 0,
          netMinor: 0,
          vatMinor: 0,
          totalMinor: 0,
          netKnown: 0,
          vatKnown: 0,
          byRate: new Map(),
        });
      }
    }
    const periods = [...cells.values()]
      .sort((a, b) => a.period.localeCompare(b.period) || a.currency.localeCompare(b.currency))
      .map((c) => {
        // The accountant figure as entered; shown in the other display
        // currency at the BNR rate of the last day of the period.
        const raw =
          confirmations.find((x) => x.period === c.period && x.currency === display) ??
          confirmations.find((x) => x.period === c.period);
        const periodEnd = new Date(
          Date.UTC(Number(c.period.slice(0, 4)), Number(c.period.slice(5, 7)), 0),
        );
        const confVat = raw
          ? raw.currency === display
            ? raw.confirmedVatMinor
            : this.fx.amount(raw.confirmedVatMinor, raw.currency, display, periodEnd)
          : null;
        const cf = raw && confVat !== null ? { ...raw, confirmedVatMinor: confVat } : null;
        return {
          period: c.period,
          currency: c.currency,
          invoices: c.invoices,
          unverified: c.unverified,
          estimated: {
            netMinor: c.netKnown ? c.netMinor : null,
            vatMinor: c.vatKnown ? c.vatMinor : null,
            totalMinor: c.totalMinor,
            byRate: [...c.byRate.values()].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1)),
          },
          confirmed: cf
            ? {
                vatMinor: cf.confirmedVatMinor,
                enteredMinor: raw!.confirmedVatMinor,
                enteredCurrency: raw!.currency,
                note: cf.note,
                by: cf.confirmedBy?.name ?? null,
                at: cf.updatedAt,
              }
            : null,
          differenceMinor: cf && c.vatKnown ? cf.confirmedVatMinor - c.vatMinor : null,
        };
      });
    const years = await this.prisma.$queryRaw<{ y: number }[]>`
      SELECT DISTINCT EXTRACT(YEAR FROM issue_date)::int AS y FROM external_invoices ORDER BY y DESC`;
    return { year, display, unconverted, years: years.map((r) => r.y), periods };
  }

  async confirmVat(dto: ConfirmVatDto, actor: AuthPrincipal) {
    const before = await this.prisma.externalVatConfirmation.findUnique({
      where: { period_currency: { period: dto.period, currency: dto.currency } },
    });
    const row = await this.prisma.externalVatConfirmation.upsert({
      where: { period_currency: { period: dto.period, currency: dto.currency } },
      create: {
        period: dto.period,
        currency: dto.currency,
        confirmedVatMinor: dto.confirmedVatMinor,
        note: dto.note || null,
        confirmedById: actor.id,
      },
      update: {
        confirmedVatMinor: dto.confirmedVatMinor,
        note: dto.note || null,
        confirmedById: actor.id,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.platformRoles,
      action: 'external_vat.confirm',
      targetType: 'external_vat_confirmation',
      targetId: row.id,
      before: before ? { confirmedVatMinor: before.confirmedVatMinor, note: before.note } : null,
      after: {
        period: dto.period,
        currency: dto.currency,
        confirmedVatMinor: dto.confirmedVatMinor,
        note: dto.note ?? null,
      },
    });
    return { ok: true };
  }

  async removeVatConfirmation(period: string, currency: string, actor: AuthPrincipal) {
    const row = await this.prisma.externalVatConfirmation.findUnique({
      where: { period_currency: { period, currency } },
    });
    if (!row) throw new NotFoundException('confirmation_not_found');
    await this.prisma.externalVatConfirmation.delete({ where: { id: row.id } });
    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.platformRoles,
      action: 'external_vat.unconfirm',
      targetType: 'external_vat_confirmation',
      targetId: row.id,
      before: { period, currency, confirmedVatMinor: row.confirmedVatMinor, note: row.note },
    });
    return { ok: true };
  }
}
