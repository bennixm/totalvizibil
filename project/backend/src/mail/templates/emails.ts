/**
 * Emails sent directly through MailService rather than NotificationsService:
 * the ones whose recipient isn't (yet) a logged-in account holder, or isn't
 * the account's current address. Each builder returns the full message
 * (subject + plain-text part + HTML part) from plain data, so services only
 * decide WHEN and TO WHOM to send, never how it looks or reads.
 *
 * Every other email is a notification: its copy lives at the `notify()` call
 * site and renders through NotificationsService into the same layout.
 */
import {
  codeBlock,
  ctaButton,
  detailsTable,
  heroBand,
  noticeBox,
  plainTextEmail,
  promoCodeCard,
  quoteBlock,
  renderEmailLayout,
  statTiles,
  textToHtml,
} from './layout';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const greeting = (name?: string | null) => (name ? `Bună, ${name},` : 'Bună,');

// --- Account access --------------------------------------------------------

/** One-time code that confirms the account's email address. */
export function verificationCodeEmail(p: {
  name: string;
  code: string;
  ttlMinutes: number;
}): RenderedEmail {
  const message = `${greeting(p.name)}\n\nFolosește codul de mai jos ca să îți confirmi adresa de email în Totalvizibil.`;
  const validity = `Codul este valabil ${p.ttlMinutes} minute. Nu îl împărtăși cu nimeni.`;
  const footerNote =
    'Nu ai cerut acest cod? Poți ignora acest email, contul tău rămâne neschimbat.';
  return {
    // Code first, so it's readable straight from a lock-screen notification.
    subject: `${p.code} este codul tău de verificare Totalvizibil`,
    text: plainTextEmail([message, `Codul tău: ${p.code}`, validity], footerNote),
    html: renderEmailLayout({
      eyebrow: 'Verificare cont',
      heading: 'Confirmă-ți adresa de email',
      preheader: `Codul este valabil ${p.ttlMinutes} minute.`,
      bodyHtml: textToHtml(message) + codeBlock(p.code, validity),
      footerNote,
    }),
  };
}

/** "Forgot password" link. The URL carries the single-use reset token. */
export function passwordResetEmail(p: { url: string }): RenderedEmail {
  const message =
    'Am primit o cerere de resetare a parolei pentru contul Totalvizibil asociat acestei adrese. Folosește linkul de mai jos ca să alegi o parolă nouă.';
  const validity = 'Linkul este valabil o oră și poate fi folosit o singură dată.';
  const footerNote =
    'Nu ai cerut resetarea? Poți ignora acest email, parola ta rămâne neschimbată.';
  return {
    subject: 'Resetează-ți parola Totalvizibil',
    text: plainTextEmail([message, `Alege o parolă nouă:\n${p.url}`, validity], footerNote),
    html: renderEmailLayout({
      eyebrow: 'Securitate cont',
      heading: 'Resetează-ți parola',
      preheader: 'Linkul de resetare este valabil o oră.',
      bodyHtml:
        textToHtml(message) +
        ctaButton('Alege o parolă nouă', p.url, { showUrl: true }) +
        noticeBox(validity, 'neutral'),
      footerNote,
    }),
  };
}

/**
 * Welcome email for a new influencer. Not the password-reset email: the
 * person never had a password, so for a brand-new account the call to action
 * is "set your password" (`setPasswordUrl`, valid `ttlDays`); for an existing
 * account it is "open your panel".
 */
export function influencerWelcomeEmail(p: {
  name: string;
  code: string;
  discountPct: number;
  commissionPct: number;
  shareUrl: string;
  panelUrl: string;
  setPasswordUrl?: string;
  ttlDays?: number;
}): RenderedEmail {
  // The hero band already greets by name, so the body goes straight to the point.
  const intro =
    'Îți mulțumim că ni te alături ca influencer Totalvizibil. Ți-am pregătit un cod de reducere personal: fiecare om care se înscrie cu el primește reducere la prima depunere, iar tu primești comision.';
  const howTitle = 'Cum funcționează';
  // A block of only numbered lines renders as a real numbered list.
  const howSteps = [
    `1. Distribui codul ${p.code} sau linkul tău personal.`,
    `2. Clientul primește ${p.discountPct}% reducere la prima depunere în portofel.`,
    `3. Tu primești ${p.commissionPct}% din suma plătită la acea depunere, în credite, direct în portofel.`,
    '4. Urmărești în panoul tău cine a folosit codul, depunerile și comisioanele.',
  ].join('\n');
  const how = `${howTitle}:\n${howSteps}`;
  const setup = p.setPasswordUrl
    ? `Contul tău este gata. Mai ai un singur pas: alege-ți parola și intri în panoul de influencer.`
    : 'Panoul tău de influencer este deja disponibil în contul tău Totalvizibil.';
  const validity = p.setPasswordUrl
    ? `Linkul pentru setarea parolei este valabil ${p.ttlDays ?? 7} zile și poate fi folosit o singură dată.`
    : '';
  const ctaLabel = p.setPasswordUrl ? 'Setează-ți parola' : 'Deschide panoul de influencer';
  const ctaUrl = p.setPasswordUrl ?? p.panelUrl;
  const footerNote =
    'Ai primit acest email pentru că un administrator Totalvizibil ți-a creat un profil de influencer. Codul și procentele sunt stabilite de administrator.';

  return {
    subject: `Bun venit, ${p.name}! Codul tău de influencer: ${p.code}`,
    text: plainTextEmail(
      [
        `${greeting(p.name)}\n\n${intro}`,
        `Codul tău: ${p.code}
Linkul tău: ${p.shareUrl}`,
        how,
        setup,
        `${ctaLabel}:
${ctaUrl}`,
        validity,
      ],
      footerNote,
    ),
    html: renderEmailLayout({
      eyebrow: 'Program influenceri',
      heading: 'Contul tău de influencer este gata',
      preheader: `Codul tău ${p.code}: ${p.discountPct}% reducere pentru clienți, ${p.commissionPct}% comision pentru tine.`,
      bodyHtml:
        heroBand(
          'Influencer nou',
          `Bun venit, ${p.name}!`,
          'De azi, fiecare client adus de tine îți aduce comision.',
        ) +
        textToHtml(intro) +
        promoCodeCard('Codul tău de reducere', p.code, `Link de distribuit: ${p.shareUrl}`) +
        statTiles([
          { value: `${p.discountPct}%`, label: 'reducere pentru clienți' },
          { value: `${p.commissionPct}%`, label: 'comisionul tău' },
        ]) +
        `<p class="tvz-ink" style="margin:0 0 10px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:16px;font-weight:700;color:#101828;">${howTitle}</p>` +
        textToHtml(howSteps) +
        textToHtml(setup) +
        ctaButton(ctaLabel, ctaUrl, { showUrl: true }) +
        (validity ? noticeBox(validity, 'neutral') : ''),
      footerNote,
    }),
  };
}

/**
 * Security notice to the account's PREVIOUS address after an email change,
 * so the rightful owner hears about it even if someone else made the change.
 * `byAdmin` = changed by a platform administrator, not the user.
 */
export function emailChangedOldAddressEmail(p: {
  name?: string | null;
  oldEmail: string;
  newEmail: string;
  byAdmin: boolean;
  supportUrl: string;
}): RenderedEmail {
  const who = p.byAdmin
    ? 'Un administrator Totalvizibil a schimbat adresa de email a contului tău.'
    : 'Adresa de email a contului tău Totalvizibil a fost schimbată.';
  const message = `${greeting(p.name)}\n\n${who} De acum, notificările și linkurile de resetare a parolei ajung la noua adresă.`;
  const details = [
    { label: 'Adresa veche', value: p.oldEmail },
    { label: 'Adresa nouă', value: p.newEmail },
  ];
  const noticeTitle = p.byAdmin
    ? 'Nu te așteptai la această schimbare?'
    : 'Nu ai făcut tu această schimbare?';
  const noticeText =
    'Contactează imediat echipa de suport. Este posibil ca altcineva să aibă acces la contul tău.';
  const footerNote =
    'Îți trimitem acest mesaj la adresa veche a contului, ca să afli de schimbare chiar dacă nu ai făcut-o tu.';
  return {
    subject: 'Adresa de email a contului tău a fost schimbată',
    text: plainTextEmail(
      [
        message,
        details.map((d) => `${d.label}: ${d.value}`).join('\n'),
        `${noticeTitle}\n${noticeText}`,
        `Contactează suportul: ${p.supportUrl}`,
      ],
      footerNote,
    ),
    html: renderEmailLayout({
      eyebrow: 'Securitate cont',
      tone: 'warning',
      heading: 'Adresa de email a contului a fost schimbată',
      preheader: `Noua adresă a contului este ${p.newEmail}.`,
      bodyHtml:
        textToHtml(message) +
        detailsTable(details) +
        noticeBox(noticeText, 'danger', noticeTitle) +
        ctaButton('Contactează suportul', p.supportUrl),
      footerNote,
    }),
  };
}

// --- Visitors of a business (no platform account) --------------------------

export type AppointmentClientStatus = 'pending' | 'confirmed' | 'canceled';

/** Booking status update to the visitor who booked on a business's site. */
export function appointmentClientEmail(p: {
  status: AppointmentClientStatus;
  visitorName?: string | null;
  companyName: string;
  when: string;
  durationMinutes: number;
}): RenderedEmail {
  const COPY: Record<
    AppointmentClientStatus,
    { subject: string; heading: string; lead: string; tone: 'brand' | 'success' | 'neutral' }
  > = {
    pending: {
      subject: `Am primit cererea ta de programare la ${p.companyName}`,
      heading: 'Cererea ta de programare a fost primită',
      lead: `${p.companyName} a primit cererea ta de programare. Îți trimitem un email imediat ce este confirmată.`,
      tone: 'brand',
    },
    confirmed: {
      subject: `Programarea ta la ${p.companyName} este confirmată`,
      heading: 'Programarea ta este confirmată',
      lead: `Programarea ta la ${p.companyName} a fost confirmată. Te așteptăm la data și ora de mai jos.`,
      tone: 'success',
    },
    canceled: {
      subject: `Programarea ta la ${p.companyName} a fost anulată`,
      heading: 'Programarea ta a fost anulată',
      lead: `Programarea ta la ${p.companyName} a fost anulată. Dacă vrei să alegi altă dată, poți face o nouă programare pe site-ul afacerii.`,
      tone: 'neutral',
    },
  };
  const c = COPY[p.status];
  const message = `${greeting(p.visitorName)}\n\n${c.lead}`;
  const details = [
    { label: 'Afacere', value: p.companyName },
    { label: 'Data și ora', value: p.when },
    { label: 'Durată', value: `${p.durationMinutes} min` },
  ];
  const footerNote = `Primești acest email pentru că ai făcut o programare la ${p.companyName}. Mesaj trimis prin Totalvizibil.`;
  return {
    subject: c.subject,
    text: plainTextEmail(
      [message, details.map((d) => `${d.label}: ${d.value}`).join('\n')],
      footerNote,
      p.companyName,
    ),
    html: renderEmailLayout({
      eyebrow: 'Programare',
      tone: c.tone,
      heading: c.heading,
      preheader: `${p.when}, ${p.companyName}`,
      bodyHtml: textToHtml(message) + detailsTable(details),
      footerNote,
      signoff: p.companyName,
    }),
  };
}

/** A business owner's quick reply to a contact-form lead. `message` is the
 *  owner's own text and is sent verbatim; replies go to the owner
 *  (reply-to is set by the caller). */
export function leadReplyEmail(p: {
  leadName?: string | null;
  companyName: string;
  message: string;
  originalMessage?: string | null;
}): RenderedEmail {
  // Signed by the business itself, before the quoted original message.
  const body = `${greeting(p.leadName)}\n\n${p.message}\n\n${p.companyName}`;
  const footerNote = `Primești acest email pentru că ai trimis un mesaj către ${p.companyName} prin formularul de contact. Poți răspunde direct la acest email.`;
  return {
    subject: `Răspuns de la ${p.companyName}`,
    text: plainTextEmail(
      [body, p.originalMessage ? `Mesajul tău:\n"${p.originalMessage}"` : null],
      footerNote,
      null,
    ),
    html: renderEmailLayout({
      eyebrow: 'Răspuns la mesajul tău',
      heading: `Răspuns de la ${p.companyName}`,
      preheader: p.message.slice(0, 140),
      bodyHtml:
        textToHtml(body) + (p.originalMessage ? quoteBlock(p.originalMessage, 'Mesajul tău') : ''),
      footerNote,
      signoff: null,
    }),
  };
}
