import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseXml } from './einvoice-xml';

/** Official BNR feeds (https://www.bnr.ro/23988-cursurile-pietei-valutare-in-format-xml):
 *  the yearly file holds every banking day of that year. */
const YEAR_URL = (y: number) => `https://curs.bnr.ro/files/xml/years/nbrfxrates${y}.xml`;
/** Re-check the current year at most this often (BNR publishes once a
 *  banking day, shortly after 13:00). */
const REFRESH_MS = 3 * 60 * 60 * 1000;
const FIRST_YEAR = 2005;

export type DisplayCurrency = 'EUR' | 'RON';

export interface Converted {
  currency: DisplayCurrency;
  subtotalMinor: number | null;
  taxMinor: number | null;
  totalMinor: number;
  /** Units of the display currency per 1 unit of the document currency. */
  rate: number;
  /** BNR publication date the rate comes from. */
  rateDate: string | null;
}

/**
 * BNR reference rates, stored locally (BNR recommends it, and conversions
 * keep working when curs.bnr.ro is down). A document amount is converted at
 * the rate published on, or last before, its issue date: the usual rule for
 * booking foreign-currency invoices in RON.
 */
@Injectable()
export class BnrRatesService {
  private readonly logger = new Logger(BnrRatesService.name);
  /** currency → ascending [dateMs, ronPerUnit] */
  private table = new Map<string, [number, number][]>();
  private loadedYears = new Set<number>();
  private lastRefresh = 0;
  private inflight: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Makes sure rates for every year in `years` are in memory (fetching
   *  missing years from BNR into the database first). */
  async ensure(years: number[]): Promise<void> {
    const now = Date.now();
    const current = new Date().getUTCFullYear();
    const want = [...new Set(years.filter((y) => y >= FIRST_YEAR && y <= current))];
    if (!want.includes(current)) want.push(current);
    const stale = now - this.lastRefresh > REFRESH_MS;
    if (want.every((y) => this.loadedYears.has(y)) && !stale) return;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        for (const y of want) {
          const count = await this.prisma.fxRate.count({
            where: {
              date: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) },
            },
          });
          if (count === 0 || (y === current && stale)) await this.fetchYear(y);
        }
        this.lastRefresh = Date.now();
        await this.loadFromDb();
        want.forEach((y) => this.loadedYears.add(y));
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  private async fetchYear(year: number): Promise<void> {
    try {
      const res = await fetch(YEAR_URL(year), { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = parseXml(await res.text());
      const body = doc.children.find((c) => c.name === 'Body');
      const rows: { date: Date; currency: string; ronPerUnit: number }[] = [];
      for (const cube of body?.children.filter((c) => c.name === 'Cube') ?? []) {
        const date = new Date(`${cube.attrs.date}T00:00:00Z`);
        if (Number.isNaN(date.getTime())) continue;
        for (const r of cube.children.filter((c) => c.name === 'Rate')) {
          const v = Number(r.text.trim());
          const mult = Number(r.attrs.multiplier ?? 1) || 1;
          if (r.attrs.currency && Number.isFinite(v) && v > 0) {
            rows.push({ date, currency: r.attrs.currency, ronPerUnit: v / mult });
          }
        }
      }
      if (!rows.length) throw new Error('no rates in file');
      await this.prisma.fxRate.createMany({ data: rows, skipDuplicates: true });
      this.logger.log(`BNR ${year}: ${rows.length} rates stored`);
    } catch (e) {
      // Not fatal: whatever is already stored keeps being used.
      this.logger.warn(`BNR rates ${year} unavailable: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async loadFromDb(): Promise<void> {
    const rows = await this.prisma.fxRate.findMany({ orderBy: { date: 'asc' } });
    const t = new Map<string, [number, number][]>();
    for (const r of rows) {
      const list = t.get(r.currency) ?? [];
      list.push([r.date.getTime(), Number(r.ronPerUnit)]);
      t.set(r.currency, list);
    }
    this.table = t;
  }

  /** RON per 1 unit of `currency` on (or last before) `date`; for a date
   *  before any stored rate, the earliest one. Null when BNR doesn't
   *  publish that currency. */
  ronPerUnit(currency: string, date: Date): { rate: number; date: string | null } | null {
    if (currency === 'RON') return { rate: 1, date: null };
    const list = this.table.get(currency);
    if (!list?.length) return null;
    const t = date.getTime();
    let lo = 0;
    let hi = list.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][0] <= t) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const [d, rate] = list[best === -1 ? 0 : best];
    return { rate, date: new Date(d).toISOString().slice(0, 10) };
  }

  /** Converts a document's amounts to the display currency at the BNR rate
   *  of `date`. Null when a rate is missing. */
  convert(
    amounts: { subtotalMinor: number | null; taxMinor: number | null; totalMinor: number },
    from: string,
    to: DisplayCurrency,
    date: Date,
  ): Converted | null {
    if (from === to) {
      return { currency: to, ...amounts, rate: 1, rateDate: null };
    }
    const src = this.ronPerUnit(from, date);
    const dst = this.ronPerUnit(to, date);
    if (!src || !dst) return null;
    const rate = src.rate / dst.rate;
    const conv = (m: number | null) => (m === null ? null : Math.round(m * rate));
    return {
      currency: to,
      subtotalMinor: conv(amounts.subtotalMinor),
      taxMinor: conv(amounts.taxMinor),
      totalMinor: Math.round(amounts.totalMinor * rate),
      rate: Math.round(rate * 1e6) / 1e6,
      rateDate: (from !== 'RON' ? src.date : dst.date) ?? null,
    };
  }

  /** One amount, convenience for aggregates. */
  amount(minor: number, from: string, to: DisplayCurrency, date: Date): number | null {
    const c = this.convert(
      { subtotalMinor: null, taxMinor: null, totalMinor: minor },
      from,
      to,
      date,
    );
    return c ? c.totalMinor : null;
  }
}
