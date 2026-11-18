import archiver from 'archiver';

/**
 * Minimal, dependency-free CSV and XLSX writers for the finance exports.
 *
 * Money goes out as real NUMBERS (EUR, two decimals), not pre-formatted
 * text, so an accountant can sum, filter and pivot the file directly in
 * Excel / LibreOffice. The XLSX is a plain Office Open XML workbook
 * (several sheets, bold header row, frozen header, a "#,##0.00" money
 * format), zipped with `archiver`, which the backend already ships.
 */

export type SheetCell = string | number | null | undefined;

export interface SheetColumn {
  label: string;
  /** Approximate column width in characters. */
  width?: number;
  /** Render numbers with two decimals and thousands separators. */
  money?: boolean;
}

export interface SheetRow {
  cells: SheetCell[];
  /** Section / total rows. */
  bold?: boolean;
}

export interface Sheet {
  /** Max 31 chars, no []:*?/\ (Excel's own rules). */
  name: string;
  /** Lines printed above the table (report title, period, notes). */
  title?: string[];
  columns: SheetColumn[];
  rows: (SheetRow | SheetCell[])[];
}

function normRow(r: SheetRow | SheetCell[]): SheetRow {
  return Array.isArray(r) ? { cells: r } : r;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);

function csvCell(v: SheetCell, money: boolean): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return money ? v.toFixed(2) : String(v);
  // Neutralise spreadsheet formula injection ("=", "+", "-", "@" first).
  const s = /^[=+\-@]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One sheet as CSV. UTF-8 BOM + `;` separator: what Excel in a Romanian
 *  locale opens correctly (diacritics, and `,` being the decimal mark),
 *  with a dot decimal point that every tool also parses. */
export function toCsv(sheet: Sheet): Buffer {
  const lines: string[] = [];
  for (const t of sheet.title ?? []) lines.push(csvCell(t, false));
  if (sheet.title?.length) lines.push('');
  lines.push(sheet.columns.map((c) => csvCell(c.label, false)).join(';'));
  for (const raw of sheet.rows) {
    const r = normRow(raw);
    lines.push(sheet.columns.map((c, i) => csvCell(r.cells[i], !!c.money)).join(';'));
  }
  return Buffer.from(BOM + lines.join(CRLF) + CRLF, 'utf8');
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return (
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Control chars are not allowed in XML 1.0.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  );
}

function colName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Style ids in styles.xml below. */
const S = { text: 0, bold: 1, money: 2, moneyBold: 3, header: 4, title: 5 } as const;

function cellXml(ref: string, v: SheetCell, style: number): string {
  if (v === null || v === undefined || v === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const out: string[] = [];
  let r = 0;
  for (const t of sheet.title ?? []) {
    r++;
    out.push(`<row r="${r}">${cellXml(`A${r}`, t, r === 1 ? S.title : S.text)}</row>`);
  }
  if (sheet.title?.length) r++;
  const headerRow = r + 1;
  r++;
  out.push(
    `<row r="${r}">${sheet.columns.map((c, i) => cellXml(`${colName(i)}${r}`, c.label, S.header)).join('')}</row>`,
  );
  for (const raw of sheet.rows) {
    const row = normRow(raw);
    r++;
    const cells = sheet.columns
      .map((c, i) => {
        const v = row.cells[i];
        const isNum = typeof v === 'number';
        const style =
          isNum && c.money ? (row.bold ? S.moneyBold : S.money) : row.bold ? S.bold : S.text;
        return cellXml(`${colName(i)}${r}`, v, style);
      })
      .join('');
    out.push(`<row r="${r}">${cells}</row>`);
  }
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`)
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${out.join('')}</sheetData></worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
  `<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF9"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="6">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs></styleSheet>`;

function safeSheetName(name: string, used: Set<string>): string {
  let base =
    name
      .replace(/[[\]:*?/\\]/g, ' ')
      .slice(0, 31)
      .trim() || 'Sheet';
  let n = 2;
  while (used.has(base.toLowerCase())) base = `${base.slice(0, 28)} ${n++}`;
  used.add(base.toLowerCase());
  return base;
}

export function toXlsx(sheets: Sheet[]): Promise<Buffer> {
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  const files: { name: string; data: string }[] = [
    {
      name: '[Content_Types].xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        `</Types>`,
    },
    {
      name: '_rels/.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        `</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];

  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    for (const f of files) archive.append(f.data, { name: f.name });
    void archive.finalize();
  });
}
