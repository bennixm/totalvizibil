import { parseXml, readEInvoice } from 'src/finance/external-invoices/einvoice-xml';
import {
  normalizeInvoiceNumber,
  validateInvoice,
} from 'src/finance/external-invoices/external-invoice-model';
import { decodeInvoiceFile } from 'src/finance/external-invoices/external-invoice-files';

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>TST 000123</cbc:ID>
  <cbc:IssueDate>2026-11-03</cbc:IssueDate>
  <cbc:DueDate>2026-11-17</cbc:DueDate>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  <cac:InvoicePeriod><cbc:StartDate>2026-10-01</cbc:StartDate><cbc:EndDate>2026-10-31</cbc:EndDate></cac:InvoicePeriod>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Exemplu Hosting</cbc:Name></cac:PartyName>
    <cac:PartyTaxScheme><cbc:CompanyID>RO12345678</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Exemplu Hosting &amp; Co SRL</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>RO87654321</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="RON">52.50</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="RON">250.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="RON">52.50</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="RON">40.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="RON">0.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>Z</cbc:ID><cbc:Percent>0</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">290.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="RON">290.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">342.50</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">342.50</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="H87">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="RON">250.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Server VPS</cbc:Name><cac:ClassifiedTaxCategory><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="RON">250.00</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
  <cac:InvoiceLine><cbc:ID>2</cbc:ID><cbc:InvoicedQuantity unitCode="H87">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="RON">40.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name><![CDATA[Domeniu .ro <scutit>]]></cbc:Name><cac:ClassifiedTaxCategory><cbc:Percent>0</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="RON">40.00</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
</Invoice>`;

const CII = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument><ram:ID>RE-2026-77</ram:ID><ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20261105</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:SpecifiedTradeProduct><ram:Name>Hosting</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>100.00</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">2</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:RateApplicablePercent>19</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>200.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty><ram:Name>Beispiel GmbH</ram:Name>
      <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">123/456</ram:ID></ram:SpecifiedTaxRegistration>
      <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE123456789</ram:ID></ram:SpecifiedTaxRegistration>
    </ram:SellerTradeParty></ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:ApplicableTradeTax><ram:CalculatedAmount>38.00</ram:CalculatedAmount><ram:BasisAmount>200.00</ram:BasisAmount><ram:RateApplicablePercent>19</ram:RateApplicablePercent></ram:ApplicableTradeTax>
      <ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">20261001</udt:DateTimeString></ram:StartDateTime><ram:EndDateTime><udt:DateTimeString format="102">20261031</udt:DateTimeString></ram:EndDateTime></ram:BillingSpecifiedPeriod>
      <ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">20261205</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>200.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">38.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>238.00</ram:GrandTotalAmount>
        <ram:DuePayableAmount>0.00</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

describe('e-invoice XML (UBL / CII)', () => {
  it('reads a RO_CIUS / UBL 2.1 invoice exactly', () => {
    const d = readEInvoice(Buffer.from(UBL));
    expect(d.syntax).toBe('ubl');
    expect(d.supplierName).toBe('Exemplu Hosting & Co SRL');
    expect(d.supplierVatId).toBe('RO12345678'); // seller, never the buyer
    expect(d.invoiceNumber).toBe('TST 000123');
    expect(d.issueDate).toBe('2026-11-03');
    expect(d.dueDate).toBe('2026-11-17');
    expect([d.periodStart, d.periodEnd]).toEqual(['2026-10-01', '2026-10-31']);
    expect(d.currency).toBe('RON');
    expect([d.subtotalMinor, d.taxMinor, d.totalMinor]).toEqual([29000, 5250, 34250]);
    expect(d.vatLines).toEqual([
      { rate: 21, netMinor: 25000, vatMinor: 5250 },
      { rate: 0, netMinor: 4000, vatMinor: 0 },
    ]);
    expect(d.lines).toHaveLength(2);
    expect(d.lines[1]).toEqual({
      description: 'Domeniu .ro <scutit>',
      quantity: 1,
      unitPriceMinor: 4000,
      netMinor: 4000,
      vatRate: 0,
    });
    expect(d.paymentStatus).toBe('unpaid');
  });

  it('reads a CII invoice (format 102 dates, VA tax registration)', () => {
    const d = readEInvoice(Buffer.from(CII));
    expect(d.syntax).toBe('cii');
    expect(d.supplierName).toBe('Beispiel GmbH');
    expect(d.supplierVatId).toBe('DE123456789');
    expect(d.issueDate).toBe('2026-11-05');
    expect(d.dueDate).toBe('2026-12-05');
    expect([d.subtotalMinor, d.taxMinor, d.totalMinor]).toEqual([20000, 3800, 23800]);
    expect(d.vatLines).toEqual([{ rate: 19, netMinor: 20000, vatMinor: 3800 }]);
    expect(d.lines[0]).toMatchObject({
      quantity: 2,
      unitPriceMinor: 10000,
      netMinor: 20000,
      vatRate: 19,
    });
    expect(d.paymentStatus).toBe('paid'); // DuePayableAmount 0
  });

  it('a well-formed sample passes every consistency check', () => {
    const d = readEInvoice(Buffer.from(UBL));
    const issues = validateInvoice({
      invoiceNumber: d.invoiceNumber,
      issueDate: new Date(`${d.issueDate}T00:00:00Z`),
      dueDate: new Date(`${d.dueDate}T00:00:00Z`),
      subtotalMinor: d.subtotalMinor,
      taxMinor: d.taxMinor,
      totalMinor: d.totalMinor ?? 0,
      vatLines: d.vatLines,
      lines: d.lines,
    });
    expect(issues).toEqual([]);
  });

  it('rejects XML that is not an invoice, and never resolves DTD entities', () => {
    expect(() =>
      readEInvoice(Buffer.from('<?xml version="1.0"?><Order><ID>1</ID></Order>')),
    ).toThrow('unsupported_xml_invoice');
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Invoice><ID>&e;</ID></Invoice>`;
    const d = readEInvoice(Buffer.from(xxe));
    // The entity is left as literal text: never expanded, file never read.
    expect(d.invoiceNumber).toBe('&e;');
    expect(parseXml('<a x="1"><b>t</b></a>').children[0].text).toBe('t');
  });
});

describe('supplier invoice checks', () => {
  const base = {
    invoiceNumber: 'A-1',
    issueDate: new Date('2026-10-01T00:00:00Z'),
    totalMinor: 12100,
  };

  it('flags totals, VAT breakdown, lines and date problems', () => {
    expect(validateInvoice({ ...base, subtotalMinor: 10000, taxMinor: 2000 })).toContain(
      'total_mismatch',
    );
    expect(
      validateInvoice({
        ...base,
        subtotalMinor: 10000,
        taxMinor: 2100,
        vatLines: [{ rate: 21, netMinor: 9000, vatMinor: 2100 }],
      }),
    ).toContain('vat_lines_mismatch');
    expect(
      validateInvoice({
        ...base,
        subtotalMinor: 10000,
        taxMinor: 2100,
        lines: [
          { description: 'x', quantity: 1, unitPriceMinor: 5000, netMinor: 5000, vatRate: 21 },
        ],
      }),
    ).toContain('lines_mismatch');
    expect(validateInvoice({ ...base, dueDate: new Date('2026-09-01T00:00:00Z') })).toContain(
      'due_before_issue',
    );
    expect(validateInvoice({ ...base, invoiceNumber: ' ' })).toContain('missing_invoice_number');
    expect(validateInvoice({ ...base, paymentStatus: 'paid' })).toContain('paid_without_date');
  });

  it('tolerates one cent of rounding', () => {
    expect(validateInvoice({ ...base, subtotalMinor: 10000, taxMinor: 2101 })).toEqual([]);
  });

  it('compares invoice numbers loosely', () => {
    expect(normalizeInvoiceNumber('FV-0042')).toBe(normalizeInvoiceNumber('fv 0042'));
    expect(normalizeInvoiceNumber('FV-0042')).not.toBe(normalizeInvoiceNumber('FV-0043'));
  });

  it('accepts PDF and XML originals, rejects anything else', () => {
    const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
    expect(decodeInvoiceFile(pdf, 'a.pdf').mime).toBe('application/pdf');
    const xml =
      'data:text/xml;base64,' + Buffer.from('﻿<?xml version="1.0"?><Invoice/>').toString('base64');
    expect(decodeInvoiceFile(xml, 'efactura').filename).toBe('efactura.xml');
    const exe =
      'data:application/pdf;base64,' +
      Buffer.from('MZ this is not a pdf at all, really').toString('base64');
    expect(() => decodeInvoiceFile(exe, 'x.pdf')).toThrow('unsupported_attachment_type');
  });
});
