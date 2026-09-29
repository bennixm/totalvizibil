import { join } from 'node:path';
import PDFDocument from 'pdfkit';

const BRAND = '#0f52ba';
const INK = '#17181c';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

/** Same bundled font invoice-pdf.ts uses, for the same reason (Romanian
 *  diacritics) — reused as-is from its existing location rather than
 *  duplicating the asset or the nest-cli.json copy rule. */
const FONT = join(__dirname, '..', 'billing', 'fonts', 'Inter.ttf');

export interface PaymentPdfRow {
  id: string;
  status: string;
  amountMinor: number;
  createdAt: Date;
}

const STATUS_RO: Record<string, string> = {
  pending: 'În așteptare',
  completed: 'Finalizată',
  failed: 'Eșuată',
  canceled: 'Anulată',
};

function eur(minor: number): string {
  return `${(Math.abs(minor) / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}

/**
 * A plain statement of the owner's own payments or refunds over a date
 * range — not a fiscal document (those are the per-purchase invoices
 * already covered by generateInvoicePdf), just an exportable list matching
 * what the Wallet page's own Payments/Refunds table shows.
 */
export function generatePaymentsPdf(opts: {
  kind: 'purchase' | 'refund';
  ownerName: string;
  from: string | null;
  to: string | null;
  rows: PaymentPdfRow[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const title = opts.kind === 'purchase' ? 'ISTORIC PLĂȚI' : 'ISTORIC RAMBURSĂRI';
    const range =
      opts.from && opts.to
        ? `${opts.from} - ${opts.to}`
        : opts.from
          ? `de la ${opts.from}`
          : opts.to
            ? `până la ${opts.to}`
            : 'toate datele';

    // --- header ---------------------------------------------------------
    doc.fillColor(INK).font(FONT).fontSize(16).text('Totalvizibil', left, 50);
    doc.fillColor(MUTED).font(FONT).fontSize(8).text(title, left, 70);
    doc
      .fillColor(INK)
      .font(FONT)
      .fontSize(11)
      .text(opts.ownerName, left, 50, { width: pageWidth, align: 'right' });
    doc
      .fillColor(MUTED)
      .font(FONT)
      .fontSize(9)
      .text(`Perioadă: ${range}`, left, 66, { width: pageWidth, align: 'right' });

    doc
      .moveTo(left, 95)
      .lineTo(left + pageWidth, 95)
      .lineWidth(1.5)
      .strokeColor(BRAND)
      .stroke();

    // --- table ------------------------------------------------------------
    const cols = [
      { label: 'ID', width: pageWidth * 0.22 },
      { label: 'Dată', width: pageWidth * 0.28 },
      { label: 'Sumă', width: pageWidth * 0.25 },
      { label: 'Stare', width: pageWidth * 0.25 },
    ];
    let y = 118;

    function header(): void {
      let cx = left;
      doc.font(FONT).fontSize(8).fillColor(MUTED);
      cols.forEach((c) => {
        doc.text(c.label.toUpperCase(), cx, y, {
          width: c.width,
          align: c === cols[0] ? 'left' : 'right',
        });
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
      const values = [
        `#${row.id.slice(0, 8)}`,
        row.createdAt.toLocaleString('ro-RO'),
        eur(row.amountMinor),
        STATUS_RO[row.status] ?? row.status,
      ];
      let cx = left;
      doc.fillColor(INK);
      values.forEach((v, i) => {
        doc.text(v, cx, y, { width: cols[i].width, align: i === 0 ? 'left' : 'right' });
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
      doc
        .fillColor(MUTED)
        .font(FONT)
        .fontSize(9.5)
        .text('Nicio înregistrare în perioada selectată.', left, y);
    }

    doc.end();
  });
}
