import { join } from 'node:path';
import PDFDocument from 'pdfkit';

const BRAND = '#0f52ba';
const INK = '#17181c';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

/** Same bundled font `payments-pdf.ts`/`invoice-pdf.ts` use, for the same
 *  reason (Romanian diacritics) — reused from its existing location rather
 *  than duplicating the asset or the nest-cli.json copy rule. */
const FONT = join(__dirname, '..', 'billing', 'fonts', 'Inter.ttf');

export interface TablePdfColumn {
  /** Shown uppercased in the header row. */
  label: string;
  /** Fraction of the usable page width (all columns should sum to ~1). */
  width: number;
  align?: 'left' | 'right';
}

/**
 * A generic "export this table as a PDF" renderer — one page layout (brand
 * header + title + owner/period line + a column-ruled table) shared by
 * every panel table that needs a download, so the title is always the one
 * concrete thing that actually tells the two apart (e.g. "PLĂȚI" vs
 * "CONSUM") instead of a generic "export" label with no context once it's
 * saved to disk.
 */
export function generateTablePdf(opts: {
  /** Shown top-left, under the brand name — e.g. "PLĂȚI", "CONSUM AFACERE". */
  title: string;
  /** Shown top-right, first line (e.g. the owner's name, or a business name). */
  ownerName: string;
  /** Shown top-right, second line (e.g. a date range or filter summary). */
  subtitle?: string;
  columns: TablePdfColumn[];
  /** Pre-formatted cell text, one array per row, same length/order as `columns`. */
  rows: string[][];
  emptyText: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // --- header ---------------------------------------------------------
    doc.fillColor(INK).font(FONT).fontSize(16).text('Totalvizibil', left, 50);
    doc.fillColor(MUTED).font(FONT).fontSize(8).text(opts.title.toUpperCase(), left, 70);
    doc
      .fillColor(INK)
      .font(FONT)
      .fontSize(11)
      .text(opts.ownerName, left, 50, { width: pageWidth, align: 'right' });
    if (opts.subtitle) {
      doc
        .fillColor(MUTED)
        .font(FONT)
        .fontSize(9)
        .text(opts.subtitle, left, 66, { width: pageWidth, align: 'right' });
    }

    doc
      .moveTo(left, 95)
      .lineTo(left + pageWidth, 95)
      .lineWidth(1.5)
      .strokeColor(BRAND)
      .stroke();

    // --- table ------------------------------------------------------------
    const cols = opts.columns.map((c) => ({ ...c, width: c.width * pageWidth }));
    let y = 118;

    function header(): void {
      let cx = left;
      doc.font(FONT).fontSize(8).fillColor(MUTED);
      cols.forEach((c) => {
        doc.text(c.label.toUpperCase(), cx, y, { width: c.width, align: c.align ?? 'left' });
        cx += c.width;
      });
      doc
        .moveTo(left, y + 14)
        .lineTo(left + pageWidth, y + 14)
        .lineWidth(1)
        .strokeColor(INK)
        .stroke();
      y += 22;
    }
    header();

    doc.font(FONT).fontSize(9.5);
    for (const row of opts.rows) {
      if (y > doc.page.height - doc.page.margins.bottom - 30) {
        doc.addPage();
        y = 50;
        header();
        doc.font(FONT).fontSize(9.5);
      }
      let cx = left;
      doc.fillColor(INK);
      row.forEach((v, i) => {
        doc.text(v, cx, y, { width: cols[i].width, align: cols[i].align ?? 'left' });
        cx += cols[i].width;
      });
      doc
        .moveTo(left, y + 16)
        .lineTo(left + pageWidth, y + 16)
        .lineWidth(0.5)
        .strokeColor(BORDER)
        .stroke();
      y += 20;
    }

    if (opts.rows.length === 0) {
      doc.fillColor(MUTED).font(FONT).fontSize(9.5).text(opts.emptyText, left, y);
    }

    doc.end();
  });
}
