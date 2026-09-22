import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { Invoice } from '@prisma/client';

const BRAND = '#0f52ba';
const INK = '#17181c';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const TOTAL_BG = '#f0f4fc';

/**
 * pdfkit's built-in "Helvetica" is a standard PDF font restricted to WinAnsi
 * encoding — it silently renders Romanian diacritics (ă â î ș ț) as garbage
 * glyphs instead of failing loudly, which is exactly the kind of thing that
 * would ship broken on a real fiscal document. Inter (OFL-licensed, bundled
 * as a file here — see nest-cli.json's `assets` copying it into dist/) has
 * full Latin Extended-A coverage, so it's registered once and used for every
 * weight instead. It's the variable-font build (Google Fonts stopped
 * publishing static per-weight TTFs), so pdfkit renders its single default
 * instance for everything — no distinct bold face, hierarchy comes from
 * size/color instead, same trade every plain-text-first design in this app
 * already makes elsewhere.
 */
const FONT = join(__dirname, 'fonts', 'Inter.ttf');

function ron(minor: number): string {
  return `${(minor / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`;
}

function buyerAddressLine(inv: Invoice): string {
  return [
    inv.buyerAddress,
    [inv.buyerCounty, inv.buyerCity].filter(Boolean).join(', '),
    inv.buyerPostalCode,
    inv.buyerCountry,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Server-side mirror of the frontend's InvoiceDocument.vue — same sections,
 * same Romanian fiscal-document wording, same field selection — rendered to
 * a PDF Buffer instead of the browser's print dialog, so it can be attached
 * directly to the payment-confirmation email. Built from the `Invoice` row
 * alone (already a full snapshot of issuer/buyer/amounts at issue time), no
 * extra queries needed.
 */
export function generateInvoicePdf(invoice: Invoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const isReward = invoice.kind === 'affiliate_reward';
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // --- header ---------------------------------------------------------
    doc.fillColor(INK).font(FONT).fontSize(16).text(invoice.issuerName, left, 50);
    doc
      .fillColor(MUTED)
      .font(FONT)
      .fontSize(8)
      .text(
        (isReward
          ? 'DOCUMENT DE RECOMPENSĂ — PROGRAM DE AFILIERE'
          : 'FACTURĂ FISCALĂ'
        ).toUpperCase(),
        left,
        70,
      );

    doc
      .fillColor(INK)
      .font(FONT)
      .fontSize(11)
      .text(invoice.number, left, 50, { width: pageWidth, align: 'right' });
    doc
      .fillColor(MUTED)
      .font(FONT)
      .fontSize(9)
      .text(`Emisă la ${invoice.issuedAt.toLocaleDateString('ro-RO')}`, left, 66, {
        width: pageWidth,
        align: 'right',
      });

    doc
      .moveTo(left, 95)
      .lineTo(left + pageWidth, 95)
      .lineWidth(1.5)
      .strokeColor(BRAND)
      .stroke();

    // --- issuer / buyer columns ------------------------------------------
    const colWidth = pageWidth / 2 - 10;
    let y = 112;

    function partyBlock(x: number, label: string, lines: string[]): void {
      doc.fillColor(MUTED).font(FONT).fontSize(8).text(label.toUpperCase(), x, y);
      let ly = y + 14;
      lines.forEach((line, i) => {
        doc
          .fillColor(INK)
          .font(FONT)
          .fontSize(i === 0 ? 10 : 9)
          .text(line, x, ly, { width: colWidth });
        ly += i === 0 ? 15 : 13;
      });
    }

    partyBlock(
      left,
      'Furnizor',
      [
        invoice.issuerName,
        ...(invoice.issuerTaxId ? [`CUI/CIF: ${invoice.issuerTaxId}`] : []),
        ...(invoice.issuerRegCom ? [`Reg. Com.: ${invoice.issuerRegCom}`] : []),
        invoice.issuerAddress,
        ...(invoice.issuerIban
          ? [`IBAN: ${invoice.issuerIban}${invoice.issuerBank ? ` · ${invoice.issuerBank}` : ''}`]
          : []),
      ].filter(Boolean),
    );

    partyBlock(
      left + colWidth + 20,
      'Client',
      [
        invoice.buyerName,
        invoice.buyerKind === 'company' ? 'Persoană juridică' : 'Persoană fizică',
        ...(invoice.buyerTaxId ? [`CUI/CIF: ${invoice.buyerTaxId}`] : []),
        ...(invoice.buyerRegCom ? [`Reg. Com.: ${invoice.buyerRegCom}`] : []),
        buyerAddressLine(invoice),
        ...(invoice.buyerEmail ? [invoice.buyerEmail] : []),
      ].filter(Boolean),
    );

    // --- line item table --------------------------------------------------
    y = 215;
    const cols = [
      { label: 'Descriere', width: pageWidth * 0.4 },
      { label: 'Cant.', width: pageWidth * 0.1 },
      { label: 'Preț unitar', width: pageWidth * 0.17 },
      { label: 'TVA', width: pageWidth * 0.1 },
      { label: 'Total', width: pageWidth * 0.23 },
    ];

    let cx = left;
    doc.font(FONT).fontSize(8).fillColor(MUTED);
    cols.forEach((c) => {
      doc.text(c.label.toUpperCase(), cx, y, {
        width: c.width,
        align: c.label === 'Descriere' ? 'left' : 'right',
      });
      cx += c.width;
    });
    doc
      .moveTo(left, y + 14)
      .lineTo(left + pageWidth, y + 14)
      .lineWidth(1.5)
      .strokeColor(INK)
      .stroke();

    y += 22;
    const rowValues = [
      invoice.description,
      '1',
      ron(invoice.subtotalMinor),
      `${invoice.vatRatePct}%`,
      ron(invoice.totalMinor),
    ];
    cx = left;
    doc.font(FONT).fontSize(9.5).fillColor(INK);
    cols.forEach((c, i) => {
      doc.text(rowValues[i], cx, y, { width: c.width, align: i === 0 ? 'left' : 'right' });
      cx += c.width;
    });
    doc
      .moveTo(left, y + 20)
      .lineTo(left + pageWidth, y + 20)
      .lineWidth(1)
      .strokeColor(BORDER)
      .stroke();

    // --- totals ------------------------------------------------------------
    const totalsWidth = 220;
    const totalsX = left + pageWidth - totalsWidth;
    y += 34;

    function totalLine(label: string, value: string, bold = false): void {
      doc
        .font(FONT)
        .fontSize(bold ? 11 : 9.5)
        .fillColor(bold ? INK : MUTED)
        .text(label, totalsX, y, { width: totalsWidth * 0.55 });
      doc
        .font(FONT)
        .fontSize(bold ? 11 : 9.5)
        .fillColor(INK)
        .text(value, totalsX + totalsWidth * 0.55, y, {
          width: totalsWidth * 0.45,
          align: 'right',
        });
      y += bold ? 22 : 16;
    }

    totalLine('Subtotal', ron(invoice.subtotalMinor));
    totalLine(
      `TVA (${invoice.vatRatePct}%)`,
      invoice.vatRatePct > 0 ? ron(invoice.vatMinor) : 'neplătitor',
    );

    doc.rect(totalsX - 8, y - 4, totalsWidth + 8, 26).fill(TOTAL_BG);
    doc.fillColor(INK);
    totalLine('Total de plată', ron(invoice.totalMinor), true);

    // --- footer --------------------------------------------------------
    const footY = doc.page.height - doc.page.margins.bottom - 50;
    doc
      .moveTo(left, footY)
      .lineTo(left + pageWidth, footY)
      .lineWidth(0.5)
      .strokeColor(BORDER)
      .stroke();
    doc.font(FONT).fontSize(8).fillColor(MUTED);
    let fy = footY + 10;
    if (isReward) {
      doc.text(
        'Recompensă acordată în credite platformă pentru programul de afiliere. Fără plată, scutit de TVA.',
        left,
        fy,
        { width: pageWidth },
      );
      fy += 12;
    } else if (invoice.eurCents != null && invoice.fxRate != null) {
      doc.text(
        `Plătit din portofel Totalvizibil — ${(invoice.eurCents / 100).toFixed(2)} EUR convertiți la cursul ${invoice.fxRate.toString()} RON/EUR.`,
        left,
        fy,
        { width: pageWidth },
      );
      fy += 12;
    }
    doc.text('Document generat electronic de Totalvizibil.', left, fy, { width: pageWidth });

    doc.end();
  });
}
