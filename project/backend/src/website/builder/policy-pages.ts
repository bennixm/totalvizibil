/**
 * Mandatory legal pages for every Advanced-builder site — privacy, terms and
 * cookies — with deterministic, editable boilerplate per locale. Placeholders
 * (`%NAME%`, `%CITY%`, `%EMAIL%`, `%DATE%`) are filled from the seed context.
 *
 * These pages are added by `normalizeDoc` (so ALL generation paths get them),
 * flagged `system` so the owner can edit the text but not delete the page, kept
 * out of the top nav, and linked from the footer's "Legal" column.
 */
import type { StudioLocale } from './section-catalog';

export type PolicyKind = 'privacy' | 'terms' | 'cookies';
export const POLICY_KINDS: PolicyKind[] = ['privacy', 'terms', 'cookies'];

export const POLICY_SLUG: Record<PolicyKind, string> = {
  privacy: 'confidentialitate',
  terms: 'termeni',
  cookies: 'cookies',
};

const TITLE: Record<PolicyKind, Record<StudioLocale, string>> = {
  privacy: {
    ro: 'Politica de confidențialitate',
    en: 'Privacy Policy',
    de: 'Datenschutzerklärung',
  },
  terms: {
    ro: 'Termeni și condiții',
    en: 'Terms & Conditions',
    de: 'Allgemeine Geschäftsbedingungen',
  },
  cookies: {
    ro: 'Politica de cookie-uri',
    en: 'Cookie Policy',
    de: 'Cookie-Richtlinie',
  },
};

const BODY: Record<PolicyKind, Record<StudioLocale, string>> = {
  privacy: {
    ro: `Această politică explică modul în care %NAME% ("noi") colectează și prelucrează datele cu caracter personal ale vizitatorilor acestui site. Ultima actualizare: %DATE%.

Ce date colectăm. Prelucrăm doar datele pe care ni le transmiteți direct prin formularul de contact sau telefonic: nume, adresă de e-mail, număr de telefon și conținutul mesajului. Nu colectăm date sensibile.

Scopul prelucrării. Folosim aceste date exclusiv pentru a răspunde solicitărilor dumneavoastră, a întocmi oferte și a ne desfășura activitatea comercială. Temeiul legal este consimțământul dumneavoastră și interesul nostru legitim de a comunica cu potențialii clienți.

Stocare și divulgare. Păstrăm datele doar cât este necesar pentru scopul de mai sus, apoi le ștergem. Nu vindem și nu transferăm datele către terți în scopuri de marketing. Le putem divulga doar dacă legea ne obligă.

Drepturile dumneavoastră. Conform Regulamentului (UE) 2016/679 (GDPR), aveți dreptul de acces, rectificare, ștergere, restricționare, portabilitate și opoziție, precum și dreptul de a depune o plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal.

Contact. Pentru orice solicitare privind datele dumneavoastră, scrieți-ne la %EMAIL%.`,
    en: `This policy explains how %NAME% ("we") collects and processes the personal data of visitors to this website. Last updated: %DATE%.

Data we collect. We only process the data you send us directly through the contact form or by phone: name, email address, phone number and the content of your message. We do not collect sensitive data.

Purpose. We use this data solely to respond to your enquiries, prepare quotes and run our business. The legal basis is your consent and our legitimate interest in communicating with prospective clients.

Storage and disclosure. We keep the data only as long as needed for the purpose above, then delete it. We do not sell or transfer your data to third parties for marketing. We may disclose it only where required by law.

Your rights. Under Regulation (EU) 2016/679 (GDPR) you have the right of access, rectification, erasure, restriction, portability and objection, and the right to lodge a complaint with your data protection authority.

Contact. For any request regarding your data, write to us at %EMAIL%.`,
    de: `Diese Erklärung beschreibt, wie %NAME% ("wir") die personenbezogenen Daten der Besucher dieser Website erhebt und verarbeitet. Zuletzt aktualisiert: %DATE%.

Erhobene Daten. Wir verarbeiten nur Daten, die Sie uns direkt über das Kontaktformular oder telefonisch übermitteln: Name, E-Mail-Adresse, Telefonnummer und den Inhalt Ihrer Nachricht. Sensible Daten erheben wir nicht.

Zweck. Wir nutzen diese Daten ausschließlich, um Ihre Anfragen zu beantworten, Angebote zu erstellen und unser Geschäft zu betreiben. Rechtsgrundlage sind Ihre Einwilligung und unser berechtigtes Interesse an der Kommunikation mit Interessenten.

Speicherung und Weitergabe. Wir speichern die Daten nur so lange wie nötig und löschen sie danach. Wir verkaufen oder übermitteln Ihre Daten nicht zu Marketingzwecken an Dritte. Eine Weitergabe erfolgt nur, wenn das Gesetz es verlangt.

Ihre Rechte. Nach der Verordnung (EU) 2016/679 (DSGVO) haben Sie das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch sowie das Recht auf Beschwerde bei einer Aufsichtsbehörde.

Kontakt. Für Anliegen zu Ihren Daten schreiben Sie uns an %EMAIL%.`,
  },
  terms: {
    ro: `Prin utilizarea site-ului %NAME% și prin trimiterea unei solicitări sunteți de acord cu acești termeni. Ultima actualizare: %DATE%.

Serviciile noastre. Site-ul prezintă serviciile oferite de %NAME%%CITY%. Informațiile au caracter general și nu reprezintă o ofertă fermă; prețurile și disponibilitatea se confirmă în scris, la cerere.

Obligațiile utilizatorului. Vă angajați să folosiți site-ul cu bună-credință, să nu transmiteți informații false și să nu întreprindeți acțiuni care ar putea afecta funcționarea lui.

Proprietate intelectuală. Textele, imaginile, logo-ul și structura site-ului aparțin %NAME% sau partenerilor săi și nu pot fi reproduse fără acord scris.

Limitarea răspunderii. Depunem eforturi rezonabile pentru ca informațiile să fie corecte și actuale, dar nu garantăm lipsa erorilor. Nu răspundem pentru daune indirecte rezultate din utilizarea site-ului.

Modificări și lege aplicabilă. Putem actualiza acești termeni oricând, versiunea publicată aici fiind cea în vigoare. Contractele și eventualele litigii sunt guvernate de legea română, instanțele competente fiind cele de la sediul nostru.

Contact: %EMAIL%.`,
    en: `By using the %NAME% website and submitting an enquiry you agree to these terms. Last updated: %DATE%.

Our services. The site presents the services offered by %NAME%%CITY%. The information is general and does not constitute a binding offer; prices and availability are confirmed in writing on request.

User obligations. You agree to use the site in good faith, not to submit false information and not to take any action that could impair its operation.

Intellectual property. The text, images, logo and structure of the site belong to %NAME% or its partners and may not be reproduced without written consent.

Limitation of liability. We make reasonable efforts to keep the information accurate and current but do not guarantee it is error-free. We are not liable for indirect damages arising from use of the site.

Changes and governing law. We may update these terms at any time; the version published here is the one in force. Contracts and any disputes are governed by the applicable local law, with jurisdiction at our registered office.

Contact: %EMAIL%.`,
    de: `Mit der Nutzung der Website von %NAME% und dem Absenden einer Anfrage stimmen Sie diesen Bedingungen zu. Zuletzt aktualisiert: %DATE%.

Unsere Leistungen. Die Website stellt die von %NAME%%CITY% angebotenen Leistungen dar. Die Angaben sind allgemein und stellen kein verbindliches Angebot dar; Preise und Verfügbarkeit werden auf Anfrage schriftlich bestätigt.

Pflichten der Nutzer. Sie verpflichten sich, die Website nach Treu und Glauben zu nutzen, keine falschen Angaben zu machen und nichts zu unternehmen, was den Betrieb beeinträchtigen könnte.

Geistiges Eigentum. Texte, Bilder, Logo und Aufbau der Website gehören %NAME% oder seinen Partnern und dürfen ohne schriftliche Zustimmung nicht vervielfältigt werden.

Haftungsbeschränkung. Wir bemühen uns, die Informationen aktuell und korrekt zu halten, garantieren aber keine Fehlerfreiheit. Für indirekte Schäden aus der Nutzung der Website haften wir nicht.

Änderungen und anwendbares Recht. Wir können diese Bedingungen jederzeit anpassen; maßgeblich ist die hier veröffentlichte Fassung. Es gilt das jeweils anwendbare lokale Recht; Gerichtsstand ist unser Firmensitz.

Kontakt: %EMAIL%.`,
  },
  cookies: {
    ro: `Acest site, administrat de %NAME%, folosește cookie-uri pentru a funcționa corect și, cu acordul dumneavoastră, pentru statistici de trafic. Ultima actualizare: %DATE%.

Ce sunt cookie-urile. Sunt fișiere text mici salvate în browser care rețin preferințe (de exemplu limba) și ajută la analiza modului în care este folosit site-ul.

Ce cookie-uri folosim. Cookie-uri strict necesare pentru afișarea paginilor și reținerea alegerilor dumneavoastră; opțional, cookie-uri de analiză anonimă pentru a înțelege ce pagini sunt vizitate.

Gestionarea cookie-urilor. Puteți accepta sau refuza cookie-urile neesențiale și le puteți șterge oricând din setările browserului. Blocarea cookie-urilor necesare poate afecta funcționarea site-ului.

Contact: %EMAIL%.`,
    en: `This site, operated by %NAME%, uses cookies to work correctly and, with your consent, for traffic statistics. Last updated: %DATE%.

What cookies are. They are small text files stored in your browser that remember preferences (such as language) and help analyse how the site is used.

Cookies we use. Strictly necessary cookies to display pages and remember your choices; optionally, anonymous analytics cookies to understand which pages are visited.

Managing cookies. You can accept or refuse non-essential cookies and delete them at any time in your browser settings. Blocking necessary cookies may affect how the site works.

Contact: %EMAIL%.`,
    de: `Diese von %NAME% betriebene Website verwendet Cookies, um korrekt zu funktionieren und – mit Ihrer Einwilligung – für Zugriffsstatistiken. Zuletzt aktualisiert: %DATE%.

Was Cookies sind. Kleine Textdateien im Browser, die Einstellungen (z. B. die Sprache) speichern und helfen zu analysieren, wie die Website genutzt wird.

Welche Cookies wir verwenden. Unbedingt erforderliche Cookies zur Anzeige der Seiten und zum Speichern Ihrer Auswahl; optional anonyme Analyse-Cookies, um zu verstehen, welche Seiten besucht werden.

Cookies verwalten. Sie können nicht notwendige Cookies annehmen oder ablehnen und jederzeit in den Browsereinstellungen löschen. Das Blockieren notwendiger Cookies kann die Funktion der Website beeinträchtigen.

Kontakt: %EMAIL%.`,
  },
};

interface PolicyCtx {
  businessName: string;
  city: string;
  email?: string;
  locale: StudioLocale;
}

/** Title + filled body for one policy page. */
export function policyPageText(kind: PolicyKind, ctx: PolicyCtx): { title: string; body: string } {
  const loc = (['ro', 'en', 'de'] as const).includes(ctx.locale) ? ctx.locale : 'ro';
  const name =
    (ctx.businessName || '').trim() ||
    (loc === 'de' ? 'unser Unternehmen' : loc === 'en' ? 'our company' : 'firma noastră');
  const cityBit = ctx.city
    ? loc === 'de'
      ? ` aus ${ctx.city}`
      : loc === 'en'
        ? ` in ${ctx.city}`
        : ` din ${ctx.city}`
    : '';
  const email =
    (ctx.email || '').trim() ||
    (loc === 'de'
      ? 'die auf dieser Website angegebene E-Mail-Adresse'
      : loc === 'en'
        ? 'the email address shown on this site'
        : 'adresa de e-mail afișată pe site');
  const date = new Date().toISOString().slice(0, 10);
  const body = BODY[kind][loc]
    .replace(/%NAME%/g, name)
    .replace(/%CITY%/g, cityBit)
    .replace(/%EMAIL%/g, email)
    .replace(/%DATE%/g, date);
  return { title: TITLE[kind][loc], body };
}
