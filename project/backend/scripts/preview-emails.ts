/**
 * Renders sample emails into static HTML files through the real rendering
 * code: the direct-email builders (src/mail/templates/emails.ts) and
 * NotificationsService with a capturing fake MailService. Nothing is sent
 * and nothing touches the database.
 *
 *   npx ts-node --transpile-only scripts/preview-emails.ts [outDir]
 *
 * Then open <outDir>/index.html to browse every sample (the .txt next to
 * each .html is its plain-text part). The notification samples cover each
 * content shape the layout supports; their copy lives at the real call
 * sites, so treat the wording here as illustrative.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NotificationsService, NotifyInput } from '../src/notifications/notifications.service';
import {
  appointmentClientEmail,
  emailChangedOldAddressEmail,
  leadReplyEmail,
  passwordResetEmail,
  verificationCodeEmail,
} from '../src/mail/templates/emails';

const ORIGIN = 'https://totalvizibil.ro';
const outDir = resolve(process.argv[2] ?? join(tmpdir(), 'totalvizibil-email-previews'));
mkdirSync(outDir, { recursive: true });

type Captured = { name: string; subject: string; text: string; html: string };
const captured: Captured[] = [];
let currentName = '';

const fakeMail = {
  appOrigin: ORIGIN,
  configured: true,
  send: async (m: { subject: string; text: string; html?: string }) => {
    captured.push({ name: currentName, subject: m.subject, text: m.text, html: m.html ?? '' });
    return { dispatched: false };
  },
};
const fakePrisma = {
  notification: {
    create: async () => ({ id: 'n1', createdAt: new Date() }),
    createMany: async () => ({}),
    update: async () => ({}),
  },
  user: {
    findUnique: async () => ({ email: 'ana@example.com', name: 'Ana Popescu' }),
    findMany: async () => [{ id: 'u1', email: 'ana@example.com' }],
  },
};
const notifications = new NotificationsService(
  fakePrisma as never,
  fakeMail as never,
  { pushToUser: () => undefined } as never,
);

const direct = (name: string, m: { subject: string; text: string; html: string }) =>
  captured.push({ name, ...m });

const NOTIFICATIONS: { name: string; broadcast?: boolean; input: NotifyInput }[] = [
  {
    name: 'new-session',
    input: {
      userId: 'u1',
      type: 'new_session',
      title: 'Conectare nouă pe contul tău',
      body: 'Contul tău a fost accesat de pe un dispozitiv nou.',
      channels: { email: true },
      email: {
        greet: true,
        text: 'Contul tău Totalvizibil a fost accesat de pe un dispozitiv nou. Dacă tu te-ai conectat, nu trebuie să faci nimic.',
        details: [
          { label: 'Dispozitiv', value: 'Chrome pe Windows' },
          { label: 'Data și ora', value: '19 nov. 2026, 14:32' },
        ],
        notice: {
          title: 'Nu ai fost tu?',
          text: 'Schimbă-ți parola acum și activează autentificarea în doi pași. Este posibil ca altcineva să aibă datele tale de acces.',
          tone: 'danger',
        },
        cta: { label: 'Vezi sesiunile active', url: '/account?tab=sessions' },
      },
    },
  },
  {
    name: 'payment-succeeded',
    input: {
      userId: 'u1',
      type: 'payment_succeeded',
      title: 'Plata a fost realizată cu succes',
      body: '',
      channels: { email: true },
      email: {
        greet: true,
        preheader: '500 credite au fost adăugate în portofel.',
        text: 'Plata ta a fost procesată cu succes, iar cele 500 credite sunt deja în portofel și le poți folosi imediat. Factura TVZ-2026-0142 este atașată acestui email și o găsești oricând în cont.',
        details: [
          { label: 'Factură', value: 'TVZ-2026-0142' },
          { label: 'Data', value: '19.11.2026' },
          { label: 'Credite achiziționate', value: '500 credite' },
          { label: 'Sumă plătită', value: '250,00 RON' },
        ],
        cta: { label: 'Vezi factura', url: '/account/invoices/demo' },
      },
    },
  },
  {
    name: 'lead-received',
    input: {
      userId: 'u1',
      type: 'lead_received',
      title: 'Cerere nouă pentru Instalații Pop, de la Mihai Ionescu',
      body: '',
      channels: { email: true },
      email: {
        greet: true,
        text: 'Ai primit o cerere nouă prin formularul de contact al site-ului „Instalații Pop”. Poți răspunde direct la acest email sau din panou.',
        quote: {
          text: 'Bună ziua, aș avea nevoie de o ofertă pentru înlocuirea centralei termice într-un apartament de 3 camere. Mulțumesc!',
          label: 'Mesajul clientului',
        },
        details: [
          { label: 'De la', value: 'Mihai Ionescu' },
          { label: 'Email', value: 'mihai.ionescu@example.com' },
          { label: 'Telefon', value: '0722 123 456' },
        ],
        cta: { label: 'Deschide în panou', url: '/leads' },
      },
    },
  },
  {
    name: 'business-created',
    input: {
      userId: 'u1',
      type: 'business_created',
      title: '„Instalații Pop” este gata de configurat',
      body: '',
      channels: { email: true },
      email: {
        greet: true,
        preheader: 'Următorii pași: site-ul și primul buget.',
        text:
          'Afacerea „Instalații Pop” a fost creată pe Totalvizibil. Mai ai doi pași până să apari în fața clienților:\n\n' +
          '1. Construiește site-ul. Îl generăm pe baza datelor afacerii tale și îl poți edita oricând.\n' +
          '2. Setează un buget zilnic. Plătești doar pentru clicurile reale pe anunțul tău și poți schimba sau opri bugetul oricând.\n\n' +
          'Toți pașii următori se fac din panoul tău.',
        cta: { label: 'Continuă configurarea', url: '/dashboard' },
      },
    },
  },
  {
    name: 'deletion-reminder',
    input: {
      userId: 'u1',
      type: 'business_deletion_reminder',
      title: 'Ultima șansă: „Instalații Pop” se șterge pe 22.11.2026',
      body: '',
      channels: { email: true },
      email: {
        greet: true,
        text:
          'Ștergerea afacerii „Instalații Pop” este programată pentru 22.11.2026. La această dată se șterg definitiv:\n\n' +
          '- site-ul\n- cererile primite de la clienți\n- programările\n- istoricul campaniei\n\n' +
          'Dacă vrei să păstrezi afacerea, anulează ștergerea din panou și va redeveni activă imediat.',
        notice: { text: 'După această dată, ștergerea nu mai poate fi anulată.', tone: 'danger' },
        cta: { label: 'Anulează ștergerea', url: '/dashboard' },
        footerNote: 'Dacă ștergerea este intenționată, nu trebuie să faci nimic.',
      },
    },
  },
  {
    name: 'campaign-depleted',
    input: {
      userId: 'u1',
      type: 'campaign_depleted',
      title: 'Bugetul zilnic pentru „Instalații Pop” s-a epuizat',
      body: 'Bugetul zilnic al campaniei „Instalații Pop” a fost consumat integral, așa că anunțul nu mai apare în feed până mâine.',
      channels: { email: true },
      email: { greet: true, cta: { label: 'Vezi bugetul campaniei', url: '/campaign/budget' } },
    },
  },
  {
    name: 'support-reply',
    input: {
      userId: 'u1',
      type: 'support_ticket_update',
      title: '[#128] Nu pot publica site-ul',
      body: '',
      channels: { email: true },
      email: {
        greet: true,
        text: 'Un agent de suport a răspuns la ticketul tău. Poți răspunde direct din ticket, unde păstrăm tot istoricul conversației.',
        quote: {
          text: 'Am verificat contul tău și am rezolvat problema de publicare. Te rog să încerci din nou și să ne spui dacă mai apare eroarea.',
          label: 'Răspunsul echipei',
        },
        details: [
          { label: 'Ticket', value: '#128' },
          { label: 'Subiect', value: 'Nu pot publica site-ul' },
        ],
        cta: { label: 'Deschide ticketul', url: '/support/demo' },
      },
    },
  },
  {
    name: 'business-deleted',
    input: {
      userId: 'u1',
      type: 'business_deleted',
      title: 'Afacerea „Instalații Pop” a fost ștearsă definitiv',
      body: 'Așa cum a fost programat, datele afacerii „Instalații Pop” au fost șterse definitiv. Această acțiune nu poate fi anulată.',
      channels: { email: true },
      email: { greet: true },
    },
  },
  {
    name: 'discount-broadcast',
    broadcast: true,
    input: {
      userId: '',
      type: 'discount_updated',
      title: 'Reducere de 20% la achiziția de credite',
      body: '',
      channels: { email: true },
      email: {
        preheader: 'Reducerea se aplică automat în coș.',
        text: 'Reducerea de 20% se aplică automat la orice achiziție de credite, fără cod. Creditele nu expiră, așa că poți cumpăra acum și le folosești când ai nevoie.',
        cta: { label: 'Cumpără credite', url: '/wallet' },
      },
    },
  },
];

async function main() {
  direct(
    'verification-code',
    verificationCodeEmail({ name: 'Ana Popescu', code: '482913', ttlMinutes: 10 }),
  );
  direct(
    'password-reset',
    passwordResetEmail({ url: `${ORIGIN}/reset-password?token=demo-token-abc123` }),
  );
  direct(
    'email-changed-old-address',
    emailChangedOldAddressEmail({
      name: 'Ana Popescu',
      oldEmail: 'ana@example.com',
      newEmail: 'ana.popescu@example.com',
      byAdmin: false,
      supportUrl: `${ORIGIN}/support`,
    }),
  );
  for (const status of ['pending', 'confirmed', 'canceled'] as const) {
    direct(
      `appointment-${status}`,
      appointmentClientEmail({
        status,
        visitorName: 'Mihai Ionescu',
        companyName: 'Salon Bella',
        when: '24 nov. 2026, 10:30',
        durationMinutes: 45,
      }),
    );
  }
  direct(
    'lead-reply',
    leadReplyEmail({
      leadName: 'Mihai Ionescu',
      companyName: 'Instalații Pop',
      message:
        'Mulțumim pentru mesaj! Putem veni joi dimineață pentru o evaluare gratuită. Vă convine ora 9?',
      originalMessage: 'Aș avea nevoie de o ofertă pentru înlocuirea centralei termice.',
    }),
  );

  for (const n of NOTIFICATIONS) {
    currentName = n.name;
    if (n.broadcast) {
      const { userId: _ignored, ...rest } = n.input;
      await notifications.notifyAll(rest);
    } else {
      await notifications.notify(n.input);
    }
  }
  // notifyAll() sends in the background.
  await new Promise((r) => setTimeout(r, 50));

  const items = captured.map((m, i) => ({
    ...m,
    file: `${String(i + 1).padStart(2, '0')}-${m.name}`,
  }));
  for (const m of items) {
    writeFileSync(join(outDir, `${m.file}.html`), m.html);
    writeFileSync(join(outDir, `${m.file}.txt`), `Subject: ${m.subject}\n\n${m.text}`);
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  writeFileSync(
    join(outDir, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Email previews</title>
<style>body{margin:0;display:flex;font-family:system-ui;height:100vh}nav{width:340px;overflow:auto;padding:12px 16px;font-size:13px;border-right:1px solid #ddd}
nav a{display:block;margin:8px 0;color:#0f52ba}nav small{display:block;color:#777}iframe{flex:1;border:0}</style>
<nav>${items.map((m) => `<a href="${m.file}.html" target="f">${esc(m.name)}<small>${esc(m.subject)}</small></a>`).join('')}</nav>
<iframe name="f" src="${items[0].file}.html"></iframe>`,
  );
  console.log(`${items.length} emails rendered to ${outDir}`);
}

void main();
