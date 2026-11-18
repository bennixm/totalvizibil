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
  /** Pre-formatted cell text, one array per row, same length/order as
   *  `columns`. The object form marks a section/total row as bold. */
  rows: (string[] | { cells: string[]; bold?: boolean })[];
  emptyText: string;
  /** Wide tables (e.g. the transaction register) print in landscape. */
  landscape?: boolean;
  /** Small print under the table (notes, missing-information list). */
  footnotes?: string[];
  /** Body font size (default 9.5); smaller for dense tables. */
  fontSize?: number;
  /** Further tables, each starting on a new page with its own title. */
  appendix?: {
    title: string;
    columns: TablePdfColumn[];
    rows: (string[] | { cells: string[]; bold?: boolean })[];
    emptyText?: string;
  }[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      layout: opts.landscape ? 'landscape' : 'portrait',
    });
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

    // --- tables -----------------------------------------------------------
    const fs = opts.fontSize ?? 9.5;
    let y = 118;

    function drawTable(
      columns: TablePdfColumn[],
      rows: (string[] | { cells: string[]; bold?: boolean })[],
      emptyText: string,
    ): void {
      const cols = columns.map((c) => ({ ...c, width: c.width * pageWidth }));
      function header(): void {
        let cx = left;
        doc.font(FONT).fontSize(Math.min(8, fs)).fillColor(MUTED);
        const h = Math.max(
          10,
          ...cols.map((c) => doc.heightOfString(c.label.toUpperCase(), { width: c.width - 4 })),
        );
        cols.forEach((c) => {
          doc.text(c.label.toUpperCase(), cx, y, { width: c.width - 4, align: c.align ?? 'left' });
          cx += c.width;
        });
        doc
          .moveTo(left, y + h + 4)
          .lineTo(left + pageWidth, y + h + 4)
          .lineWidth(1)
          .strokeColor(INK)
          .stroke();
        y += h + 12;
      }
      header();

      doc.font(FONT).fontSize(fs);
      for (const raw of rows) {
        const row = Array.isArray(raw) ? raw : raw.cells;
        const bold = !Array.isArray(raw) && !!raw.bold;
        // Long text wraps instead of bleeding into the next row.
        const rowH = Math.max(
          fs + 4,
          ...row.map((v, i) =>
            doc
              .font(FONT)
              .fontSize(fs)
              .heightOfString(v, { width: cols[i].width - 4 }),
          ),
        );
        if (y + rowH > doc.page.height - doc.page.margins.bottom - 16) {
          doc.addPage();
          y = 50;
          header();
          doc.font(FONT).fontSize(fs);
        }
        let cx = left;
        if (bold) {
          doc
            .rect(left, y - 3, pageWidth, rowH + 5)
            .fillColor('#eef2fa')
            .fill();
        }
        doc.fillColor(INK);
        row.forEach((v, i) => {
          const o = { width: cols[i].width - 4, align: cols[i].align ?? 'left' } as const;
          doc.text(v, cx, y, o);
          // Faux bold: the bundled font has a single weight.
          if (bold) doc.text(v, cx + 0.25, y, o);
          cx += cols[i].width;
        });
        doc
          .moveTo(left, y + rowH + 2)
          .lineTo(left + pageWidth, y + rowH + 2)
          .lineWidth(0.5)
          .strokeColor(BORDER)
          .stroke();
        y += rowH + 6;
      }

      if (rows.length === 0) {
        doc.fillColor(MUTED).font(FONT).fontSize(fs).text(emptyText, left, y);
        y += 20;
      }
    }

    drawTable(opts.columns, opts.rows, opts.emptyText);

    if (opts.footnotes?.length) {
      y += 10;
      doc.font(FONT).fontSize(8).fillColor(MUTED);
      for (const note of opts.footnotes) {
        const h = doc.heightOfString(note, { width: pageWidth });
        if (y + h > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = 50;
        }
        doc.text(note, left, y, { width: pageWidth });
        y += h + 4;
      }
    }

    for (const extra of opts.appendix ?? []) {
      doc.addPage();
      doc.fillColor(INK).font(FONT).fontSize(12).text(extra.title, left, 50, { width: pageWidth });
      y = 80;
      drawTable(extra.columns, extra.rows, extra.emptyText ?? '');
    }

    doc.end();
  });
}
