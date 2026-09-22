import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { generateInvoicePdf } from '../src/billing/invoice-pdf';

const prisma = new PrismaClient();

async function main() {
  let invoice = await prisma.invoice.findFirst({ orderBy: { issuedAt: 'desc' } });
  if (!invoice) {
    console.log('No real invoice found — synthesizing one for the PDF check.');
    invoice = {
      id: 'fake',
      number: 'TVZ-2026-000001',
      userId: 'fake',
      walletTransactionId: 'fake',
      kind: 'topup' as never,
      issuedAt: new Date(),
      buyerKind: 'company' as never,
      buyerName: 'Test SRL',
      buyerTaxId: 'RO12345678',
      buyerRegCom: 'J40/1234/2020',
      buyerVatPayer: true,
      buyerAddress: 'Str. Exemplu nr. 1',
      buyerCity: 'București',
      buyerCounty: 'Sector 1',
      buyerPostalCode: '010101',
      buyerCountry: 'România',
      buyerEmail: 'test@example.com',
      issuerName: 'Totalvizibil',
      issuerTaxId: 'RO00000000',
      issuerRegCom: 'J40/0000/2020',
      issuerAddress: 'Str. Platformei nr. 1, București',
      issuerIban: 'RO00BTRL00000000000000',
      issuerBank: 'Banca Transilvania',
      currency: 'RON',
      description: '100 credite Totalvizibil',
      subtotalMinor: 42017,
      vatRatePct: 19,
      vatMinor: 7983,
      totalMinor: 50000,
      eurCents: 10000,
      fxRate: { toString: () => '5.0000' } as never,
      voidedAt: null,
      voidReason: null,
    };
  }
  const buf = await generateInvoicePdf(invoice);
  console.log('PDF bytes:', buf.length, 'starts with:', buf.subarray(0, 5).toString());
  writeFileSync('scratchpad/test-invoice.pdf', buf);
  console.log('Written to scratchpad/test-invoice.pdf');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
