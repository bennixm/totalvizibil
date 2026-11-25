/**
 * The platform's legal documents. The TEXT must come from the owner (or their
 * lawyer): nothing here is written by the developers. Each section lists what
 * it has to cover so the text can be dropped in; `body` is plain text,
 * paragraphs separated by a blank line.
 *
 * While `ready` is false the page says the document is being prepared, is
 * kept out of search engines and is not linked from the footer. Set `ready`
 * and `updatedAt` once every section has its text.
 *
 * Google requires a public privacy policy before it verifies the OAuth app
 * customers connect their Google Ads account through (scope `adwords`).
 */
export interface LegalSection {
  title: string
  /** What the section has to cover (shown only while it has no text). */
  covers: string
  body: string
}
export interface LegalDocument {
  ready: boolean
  /** `YYYY-MM-DD` of the version in force. */
  updatedAt: string
  sections: LegalSection[]
}

export const PRIVACY: LegalDocument = {
  ready: false,
  updatedAt: '',
  sections: [
    { title: 'Cine suntem', covers: 'Operatorul datelor: denumire, CUI, adresă, date de contact.', body: '' },
    {
      title: 'Ce date prelucrăm',
      covers:
        'Cont (nume, email, parolă criptată), facturare, afaceri și site-uri, campanii, cereri de la clienți, plăți, tichete de suport, date tehnice (sesiuni, IP).',
      body: '',
    },
    {
      title: 'Google Ads',
      covers:
        'Ce date citim din contul Google Ads conectat, ce modificări face agentul și când (doar cu acordul clientului), cum se păstrează accesul (token criptat), cum se retrage accesul. Respectarea Google API Services User Data Policy, inclusiv Limited Use.',
      body: '',
    },
    {
      title: 'De ce și pe ce temei',
      covers: 'Scopurile prelucrării și temeiul legal pentru fiecare (contract, obligație legală, interes legitim, consimțământ).',
      body: '',
    },
    {
      title: 'Cu cine împărțim datele',
      covers: 'Furnizori: găzduire, plăți (Stripe), email, inteligență artificială (Anthropic), Google; transferuri în afara SEE.',
      body: '',
    },
    { title: 'Cât timp păstrăm datele', covers: 'Durata pentru fiecare categorie de date, inclusiv evidențele financiare.', body: '' },
    { title: 'Drepturile tale', covers: 'Acces, rectificare, ștergere, portabilitate, opoziție, plângere la ANSPDCP; cum se exercită.', body: '' },
    { title: 'Cookie-uri', covers: 'Cookie-urile folosite (sesiune, preferințe, atribuire reclame) și scopul lor.', body: '' },
    { title: 'Contact', covers: 'Adresa la care se trimit cererile privind datele personale.', body: '' },
  ],
}

export const TERMS: LegalDocument = {
  ready: false,
  updatedAt: '',
  sections: [
    { title: 'Despre platformă', covers: 'Cine oferă serviciul și ce cuprinde.', body: '' },
    { title: 'Contul', covers: 'Crearea contului, securitate, suspendare.', body: '' },
    { title: 'Credite și plăți', covers: 'Cumpărarea creditelor, prețuri, TVA, facturi, rambursări și taxa de procesare.', body: '' },
    { title: 'Site-uri și campanii', covers: 'Builderele, campaniile din feed, costul pe click, conținutul publicat.', body: '' },
    {
      title: 'Agentul Google Ads',
      covers:
        'Ce face agentul în contul clientului, aprobări, cum se taxează (cicluri și chat), returnarea creditelor, răspunderea pentru bugetul din Google Ads.',
      body: '',
    },
    { title: 'Program de afiliere', covers: 'Condițiile recompensei.', body: '' },
    { title: 'Răspundere și reclamații', covers: 'Limitarea răspunderii, suport, soluționarea disputelor, legea aplicabilă.', body: '' },
    { title: 'Modificări', covers: 'Cum sunt anunțate modificările termenilor.', body: '' },
  ],
}
