/**
 * Deterministic reader for structured e-invoices (EN 16931 syntaxes):
 *  - UBL 2.1 `Invoice` / `CreditNote` (also what RO e-Factura / RO_CIUS uses)
 *  - UN/CEFACT CII `CrossIndustryInvoice` (ZUGFeRD / Factur-X / XRechnung CII)
 *
 * Structured XML needs no AI: the values are read straight from the tags,
 * so the result is exact (confidence 1). The tiny XML parser below handles
 * elements, attributes, text, CDATA and the five predefined entities only.
 * It never resolves DTDs or external entities (no XXE by construction).
 */
import type { InvoiceLine, VatLine } from './external-invoice-model';

interface XNode {
  name: string; // local name, namespace prefix stripped
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e] ?? '';
  });
}

const localName = (n: string) => n.slice(n.indexOf(':') + 1);

/** Parses well-formed XML into a tree. Throws on obviously broken input. */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  let i = 0;
  const len = xml.length;
  while (i < len) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    if (lt > i) stack[stack.length - 1].text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += xml.slice(lt + 9, end === -1 ? len : end);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (xml.startsWith('<!DOCTYPE', lt)) {
      // Skipped whole (internal subset included), never resolved.
      const bracket = xml.indexOf('[', lt);
      const close = xml.indexOf('>', lt);
      const end = bracket !== -1 && bracket < close ? xml.indexOf(']>', bracket) : close - 1;
      i = end < 0 ? len : end + 2;
      continue;
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      // Prolog, processing instruction or DOCTYPE: skipped, never resolved.
      const end = xml.indexOf('>', lt);
      i = end === -1 ? len : end + 1;
      continue;
    }
    const gt = xml.indexOf('>', lt);
    if (gt === -1) throw new Error('xml_unterminated_tag');
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const m = /^([^\s/>]+)/.exec(body);
    if (!m) continue;
    const node: XNode = { name: localName(m[1]), attrs: {}, children: [], text: '' };
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(body.slice(m[1].length)))) {
      node.attrs[localName(a[1])] = decodeEntities(a[3] ?? a[4] ?? '');
    }
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  const top = root.children[0];
  if (!top) throw new Error('xml_empty');
  return top;
}

// --- tiny path helpers (local names, ignoring namespaces) -------------------

function child(n: XNode | undefined, name: string): XNode | undefined {
  return n?.children.find((c) => c.name === name);
}
function children(n: XNode | undefined, name: string): XNode[] {
  return n ? n.children.filter((c) => c.name === name) : [];
}
function path(n: XNode | undefined, ...names: string[]): XNode | undefined {
  let cur = n;
  for (const nm of names) cur = child(cur, nm);
  return cur;
}
function text(n: XNode | undefined): string | null {
  const t = n?.text.trim();
  return t ? t : null;
}
function num(n: XNode | undefined): number | null {
  const t = text(n);
  if (t === null) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
const minor = (v: number | null) => (v === null ? null : Math.round(v * 100));

/** UBL dates are YYYY-MM-DD; CII format 102 is YYYYMMDD. */
function isoDate(t: string | null): string | null {
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return null;
}

export interface EInvoiceDraft {
  syntax: 'ubl' | 'cii';
  supplierName: string | null;
  supplierVatId: string | null;
  invoiceNumber: string | null;
  documentType: 'invoice' | 'credit_note';
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string | null;
  subtotalMinor: number | null;
  taxMinor: number | null;
  totalMinor: number | null;
  paymentStatus: 'paid' | 'unpaid' | null;
  vatLines: VatLine[];
  lines: InvoiceLine[];
}

// --- UBL 2.1 -----------------------------------------------------------------

function fromUbl(doc: XNode): EInvoiceDraft {
  const credit = doc.name === 'CreditNote';
  const party = path(doc, 'AccountingSupplierParty', 'Party');
  const currency = text(child(doc, 'DocumentCurrencyCode'));
  const totals = child(doc, 'LegalMonetaryTotal');
  // A document may carry a second TaxTotal in the accounting currency; the
  // one with subtotals (or in the document currency) is the invoice's own.
  const taxTotals = children(doc, 'TaxTotal');
  const taxTotal =
    taxTotals.find((t) => children(t, 'TaxSubtotal').length) ??
    taxTotals.find((t) => child(t, 'TaxAmount')?.attrs.currencyID === currency) ??
    taxTotals[0];
  const vatLines: VatLine[] = children(taxTotal, 'TaxSubtotal').map((st) => ({
    rate: num(path(st, 'TaxCategory', 'Percent')),
    netMinor: minor(num(child(st, 'TaxableAmount'))) ?? 0,
    vatMinor: minor(num(child(st, 'TaxAmount'))) ?? 0,
  }));
  const lineName = credit ? 'CreditNoteLine' : 'InvoiceLine';
  const lines: InvoiceLine[] = children(doc, lineName).map((l) => ({
    description: (
      text(path(l, 'Item', 'Name')) ??
      text(path(l, 'Item', 'Description')) ??
      ''
    ).slice(0, 500),
    quantity: num(child(l, credit ? 'CreditedQuantity' : 'InvoicedQuantity')),
    unitPriceMinor: minor(num(path(l, 'Price', 'PriceAmount'))),
    netMinor: minor(num(child(l, 'LineExtensionAmount'))),
    vatRate: num(path(l, 'Item', 'ClassifiedTaxCategory', 'Percent')),
  }));
  const vatIds = children(party, 'PartyTaxScheme').map((p) => text(child(p, 'CompanyID')));
  const due =
    text(child(doc, 'DueDate')) ??
    children(doc, 'PaymentMeans')
      .map((p) => text(child(p, 'PaymentDueDate')))
      .find(Boolean) ??
    null;
  const payable = num(child(totals, 'PayableAmount'));
  return {
    syntax: 'ubl',
    supplierName:
      text(path(party, 'PartyLegalEntity', 'RegistrationName')) ??
      text(path(party, 'PartyName', 'Name')),
    supplierVatId: vatIds.find(Boolean) ?? text(path(party, 'PartyLegalEntity', 'CompanyID')),
    invoiceNumber: text(child(doc, 'ID')),
    documentType: credit ? 'credit_note' : 'invoice',
    issueDate: isoDate(text(child(doc, 'IssueDate'))),
    dueDate: isoDate(due),
    periodStart: isoDate(text(path(doc, 'InvoicePeriod', 'StartDate'))),
    periodEnd: isoDate(text(path(doc, 'InvoicePeriod', 'EndDate'))),
    currency,
    subtotalMinor: minor(num(child(totals, 'TaxExclusiveAmount'))),
    taxMinor: minor(num(child(taxTotal, 'TaxAmount'))),
    totalMinor: minor(num(child(totals, 'TaxInclusiveAmount'))),
    // Only an explicit zero payable amount means "already paid".
    paymentStatus: payable === 0 ? 'paid' : payable !== null ? 'unpaid' : null,
    vatLines,
    lines,
  };
}

// --- UN/CEFACT CII -------------------------------------------------------------

function fromCii(doc: XNode): EInvoiceDraft {
  const exchanged = child(doc, 'ExchangedDocument');
  const trade = child(doc, 'SupplyChainTradeTransaction');
  const agreement = child(trade, 'ApplicableHeaderTradeAgreement');
  const settlement = child(trade, 'ApplicableHeaderTradeSettlement');
  const seller = child(agreement, 'SellerTradeParty');
  const sum = child(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const currency = text(child(settlement, 'InvoiceCurrencyCode'));
  const taxTotals = children(sum, 'TaxTotalAmount');
  const taxTotal = taxTotals.find((t) => t.attrs.currencyID === currency) ?? taxTotals[0];
  const regs = children(seller, 'SpecifiedTaxRegistration').map((r) => child(r, 'ID'));
  const vatReg = regs.find((r) => r?.attrs.schemeID === 'VA') ?? regs[0];
  const typeCode = text(child(exchanged, 'TypeCode'));
  const due = path(settlement, 'SpecifiedTradePaymentTerms', 'DueDateDateTime', 'DateTimeString');
  const period = child(settlement, 'BillingSpecifiedPeriod');
  const payable = num(child(sum, 'DuePayableAmount'));
  return {
    syntax: 'cii',
    supplierName: text(child(seller, 'Name')),
    supplierVatId: text(vatReg),
    invoiceNumber: text(child(exchanged, 'ID')),
    documentType: typeCode === '381' ? 'credit_note' : 'invoice',
    issueDate: isoDate(text(path(exchanged, 'IssueDateTime', 'DateTimeString'))),
    dueDate: isoDate(text(due)),
    periodStart: isoDate(text(path(period, 'StartDateTime', 'DateTimeString'))),
    periodEnd: isoDate(text(path(period, 'EndDateTime', 'DateTimeString'))),
    currency,
    subtotalMinor: minor(num(child(sum, 'TaxBasisTotalAmount'))),
    taxMinor: minor(num(taxTotal)),
    totalMinor: minor(num(child(sum, 'GrandTotalAmount'))),
    paymentStatus: payable === 0 ? 'paid' : payable !== null ? 'unpaid' : null,
    vatLines: children(settlement, 'ApplicableTradeTax').map((t) => ({
      rate: num(child(t, 'RateApplicablePercent')),
      netMinor: minor(num(child(t, 'BasisAmount'))) ?? 0,
      vatMinor: minor(num(child(t, 'CalculatedAmount'))) ?? 0,
    })),
    lines: children(trade, 'IncludedSupplyChainTradeLineItem').map((l) => ({
      description: (text(path(l, 'SpecifiedTradeProduct', 'Name')) ?? '').slice(0, 500),
      quantity: num(path(l, 'SpecifiedLineTradeDelivery', 'BilledQuantity')),
      unitPriceMinor: minor(
        num(path(l, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'ChargeAmount')),
      ),
      netMinor: minor(
        num(
          path(
            l,
            'SpecifiedLineTradeSettlement',
            'SpecifiedTradeSettlementLineMonetarySummation',
            'LineTotalAmount',
          ),
        ),
      ),
      vatRate: num(
        path(l, 'SpecifiedLineTradeSettlement', 'ApplicableTradeTax', 'RateApplicablePercent'),
      ),
    })),
  };
}

/** Reads a UBL or CII e-invoice. Throws `unsupported_xml_invoice` for any
 *  other XML. */
export function readEInvoice(bytes: Buffer): EInvoiceDraft {
  let xml = bytes.toString('utf8');
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  const doc = parseXml(xml);
  if (doc.name === 'Invoice' || doc.name === 'CreditNote') return fromUbl(doc);
  if (doc.name === 'CrossIndustryInvoice') return fromCii(doc);
  throw new Error('unsupported_xml_invoice');
}
