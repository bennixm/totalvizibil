import { writeFileSync } from 'node:fs';
import { ctaButton, detailsTable, renderEmailLayout, textToHtml } from '../src/mail/templates/layout';

const html = renderEmailLayout({
  heading: 'Plata a fost realizată cu succes',
  preheader: 'Factura TVZ-2026-000041 este atașată acestui email.',
  bodyHtml:
    textToHtml(
      'Plata ta a fost procesată cu succes. Factura TVZ-2026-000041 este atașată acestui email și disponibilă oricând în cont.',
    ) +
    detailsTable([
      { label: 'Factură', value: 'TVZ-2026-000041' },
      { label: 'Data', value: '22.09.2026' },
      { label: 'Credite achiziționate', value: '30 credite' },
      { label: 'Sumă plătită', value: '151,50 RON' },
    ]) +
    ctaButton('Vezi factura', 'http://localhost:5173/account/invoices/af8541a4'),
});

writeFileSync('scratchpad/email-preview.html', html);
console.log('written, length:', html.length);
