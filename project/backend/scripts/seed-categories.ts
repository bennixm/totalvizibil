/**
 * Complete category taxonomy seed for the public directory/marketplace.
 *
 * ADDITIVE AND IDEMPOTENT ONLY: every row is an `upsert` keyed by `slug`, and
 * the first 9 groups (with their existing leaves) below are copied VERBATIM
 * from the live `GET /api/v1/categories` response — same slugs, same
 * RO/EN/DE names, same icons, same order — so running this against an
 * environment that already has them is a no-op for those rows. New groups
 * and new leaves are appended after the existing ones in each group (so
 * on-site ordering of what already exists never shifts), and 7 entirely new
 * groups are appended after the existing 9.
 *
 * Never renames, deletes, or reparents anything — safe to run repeatedly,
 * including directly against a production database that already has
 * companies tagged to the existing categories.
 *
 * Run from `project/backend` (reads `DATABASE_URL` from the `.env` in that
 * directory, same as every other script here):
 *   npx ts-node --transpile-only scripts/seed-categories.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Leaf {
  slug: string;
  ro: string;
  en: string;
  de: string;
  icon: string;
}
interface Group {
  slug: string;
  ro: string;
  en: string;
  de: string;
  icon: string;
  children: Leaf[];
}

const GROUPS: Group[] = [
  // ---------------------------------------------------------------------
  // Existing groups (verbatim from the live site) — extended with new leaves
  // ---------------------------------------------------------------------
  {
    slug: 'constructii',
    ro: 'Construcții',
    en: 'Construction',
    de: 'Bau',
    icon: 'mdi-hammer',
    children: [
      { slug: 'acoperisuri', ro: 'Acoperișuri', en: 'Roofing', de: 'Dachdecker', icon: 'mdi-hammer' },
      {
        slug: 'amenajari-interioare',
        ro: 'Amenajări interioare',
        en: 'Interior fit-out',
        de: 'Innenausbau',
        icon: 'mdi-hammer',
      },
      {
        slug: 'zidarie',
        ro: 'Zidărie & structuri',
        en: 'Masonry & structures',
        de: 'Mauerwerk',
        icon: 'mdi-hammer',
      },
      {
        slug: 'izolatii',
        ro: 'Izolații termice',
        en: 'Thermal insulation',
        de: 'Wärmedämmung',
        icon: 'mdi-hammer',
      },
      // --- new ---
      {
        slug: 'zugraveli-vopsitorii',
        ro: 'Zugrăveli & vopsitorii',
        en: 'Painting & decorating',
        de: 'Malerarbeiten',
        icon: 'mdi-format-paint',
      },
      {
        slug: 'gresie-faianta-parchet',
        ro: 'Gresie, faianță & parchet',
        en: 'Tiling & flooring',
        de: 'Fliesen & Bodenbeläge',
        icon: 'mdi-view-grid-outline',
      },
      {
        slug: 'tamplarie-pvc-aluminiu',
        ro: 'Tâmplărie PVC & aluminiu',
        en: 'PVC & aluminium joinery',
        de: 'PVC- & Aluminiumfenster',
        icon: 'mdi-window-maximize',
      },
      {
        slug: 'demolari-excavatii',
        ro: 'Demolări & excavații',
        en: 'Demolition & excavation',
        de: 'Abriss & Erdarbeiten',
        icon: 'mdi-excavator',
      },
    ],
  },
  {
    slug: 'instalatii',
    ro: 'Instalații',
    en: 'Installations',
    de: 'Installationen',
    icon: 'mdi-pipe-wrench',
    children: [
      {
        slug: 'instalatii-sanitare',
        ro: 'Instalații sanitare',
        en: 'Plumbing',
        de: 'Sanitärinstallation',
        icon: 'mdi-pipe-wrench',
      },
      {
        slug: 'instalatii-electrice',
        ro: 'Instalații electrice',
        en: 'Electrical',
        de: 'Elektroinstallation',
        icon: 'mdi-pipe-wrench',
      },
      {
        slug: 'climatizare',
        ro: 'Climatizare & HVAC',
        en: 'HVAC',
        de: 'Klimatechnik',
        icon: 'mdi-pipe-wrench',
      },
      // --- new ---
      {
        slug: 'panouri-fotovoltaice',
        ro: 'Panouri fotovoltaice',
        en: 'Solar panels',
        de: 'Solaranlagen',
        icon: 'mdi-solar-power',
      },
      {
        slug: 'sisteme-securitate',
        ro: 'Sisteme de securitate & supraveghere',
        en: 'Security & CCTV systems',
        de: 'Sicherheits- & Videoüberwachung',
        icon: 'mdi-cctv',
      },
      {
        slug: 'automatizari-interfonie',
        ro: 'Automatizări porți & interfonie',
        en: 'Gate automation & intercoms',
        de: 'Torautomatisierung & Gegensprechanlagen',
        icon: 'mdi-gate',
      },
    ],
  },
  {
    slug: 'auto',
    ro: 'Auto & transport',
    en: 'Automotive',
    de: 'Auto',
    icon: 'mdi-car-wrench',
    children: [
      {
        slug: 'service-auto',
        ro: 'Service auto',
        en: 'Car service',
        de: 'Autowerkstatt',
        icon: 'mdi-car-wrench',
      },
      {
        slug: 'tinichigerie',
        ro: 'Tinichigerie & vopsitorie',
        en: 'Body & paint',
        de: 'Karosserie & Lack',
        icon: 'mdi-car-wrench',
      },
      {
        slug: 'vulcanizare',
        ro: 'Vulcanizare & anvelope',
        en: 'Tyres',
        de: 'Reifenservice',
        icon: 'mdi-car-wrench',
      },
      // --- new ---
      {
        slug: 'spalatorie-detailing-auto',
        ro: 'Spălătorie & detailing auto',
        en: 'Car wash & detailing',
        de: 'Autowäsche & Detailing',
        icon: 'mdi-car-wash',
      },
      {
        slug: 'tractari-asistenta-rutiera',
        ro: 'Tractări & asistență rutieră',
        en: 'Towing & roadside assistance',
        de: 'Abschleppdienst & Pannenhilfe',
        icon: 'mdi-tow-truck',
      },
      {
        slug: 'inchirieri-auto',
        ro: 'Închirieri auto',
        en: 'Car rental',
        de: 'Autovermietung',
        icon: 'mdi-car-key',
      },
      {
        slug: 'transport-marfa-curierat',
        ro: 'Transport marfă & curierat',
        en: 'Freight & courier services',
        de: 'Fracht & Kurierdienst',
        icon: 'mdi-truck-fast',
      },
      {
        slug: 'mutari-relocari',
        ro: 'Mutări & relocări',
        en: 'Removals & relocation',
        de: 'Umzüge',
        icon: 'mdi-package-variant-closed',
      },
      {
        slug: 'piese-accesorii-auto',
        ro: 'Piese & accesorii auto',
        en: 'Auto parts & accessories',
        de: 'Autoteile & Zubehör',
        icon: 'mdi-cog-outline',
      },
    ],
  },
  {
    slug: 'curatenie',
    ro: 'Curățenie',
    en: 'Cleaning',
    de: 'Reinigung',
    icon: 'mdi-broom',
    children: [
      {
        slug: 'curatenie-rezidentiala',
        ro: 'Curățenie rezidențială',
        en: 'Home cleaning',
        de: 'Wohnungsreinigung',
        icon: 'mdi-broom',
      },
      {
        slug: 'curatenie-birouri',
        ro: 'Curățenie birouri',
        en: 'Office cleaning',
        de: 'Büroreinigung',
        icon: 'mdi-broom',
      },
      {
        slug: 'curatenie-post-constructor',
        ro: 'Curățenie după constructor',
        en: 'Post-construction cleaning',
        de: 'Bauendreinigung',
        icon: 'mdi-broom',
      },
      // --- new ---
      {
        slug: 'dezinsectie-deratizare',
        ro: 'Dezinsecție & deratizare',
        en: 'Pest control',
        de: 'Schädlingsbekämpfung',
        icon: 'mdi-bug',
      },
      {
        slug: 'curatenie-tapiterie-covoare',
        ro: 'Curățare tapițerii & covoare',
        en: 'Upholstery & carpet cleaning',
        de: 'Polster- & Teppichreinigung',
        icon: 'mdi-sofa',
      },
      {
        slug: 'spalare-geamuri-fatade',
        ro: 'Spălare geamuri & fațade',
        en: 'Window & façade cleaning',
        de: 'Fenster- & Fassadenreinigung',
        icon: 'mdi-window-closed',
      },
    ],
  },
  {
    slug: 'frumusete',
    ro: 'Frumusețe & îngrijire',
    en: 'Beauty & care',
    de: 'Schönheit & Pflege',
    icon: 'mdi-content-cut',
    children: [
      {
        slug: 'coafor',
        ro: 'Coafor & frizerie',
        en: 'Hairdressers',
        de: 'Friseure',
        icon: 'mdi-content-cut',
      },
      {
        slug: 'cosmetica',
        ro: 'Cosmetică & make-up',
        en: 'Cosmetics & make-up',
        de: 'Kosmetik & Make-up',
        icon: 'mdi-content-cut',
      },
      {
        slug: 'manichiura',
        ro: 'Manichiură & pedichiură',
        en: 'Nail salons',
        de: 'Nagelstudios',
        icon: 'mdi-content-cut',
      },
      // --- new ---
      { slug: 'barbershop', ro: 'Barbershop', en: 'Barbershop', de: 'Barbershop', icon: 'mdi-face-man' },
      {
        slug: 'masaj-spa',
        ro: 'Masaj & spa',
        en: 'Massage & spa',
        de: 'Massage & Spa',
        icon: 'mdi-spa-outline',
      },
      {
        slug: 'tatuaje-piercing',
        ro: 'Tatuaje & piercing',
        en: 'Tattoo & piercing',
        de: 'Tattoo & Piercing',
        icon: 'mdi-needle',
      },
      {
        slug: 'epilare-definitiva',
        ro: 'Epilare definitivă',
        en: 'Laser hair removal',
        de: 'Dauerhafte Haarentfernung',
        icon: 'mdi-content-cut',
      },
      {
        slug: 'solar-bronzat',
        ro: 'Solar & bronzare',
        en: 'Tanning studio',
        de: 'Sonnenstudio',
        icon: 'mdi-white-balance-sunny',
      },
    ],
  },
  {
    slug: 'horeca',
    ro: 'Restaurante & catering',
    en: 'Food & catering',
    de: 'Gastronomie',
    icon: 'mdi-silverware-fork-knife',
    children: [
      {
        slug: 'restaurante',
        ro: 'Restaurante',
        en: 'Restaurants',
        de: 'Restaurants',
        icon: 'mdi-silverware-fork-knife',
      },
      {
        slug: 'cafenele',
        ro: 'Cafenele & patiserii',
        en: 'Cafés & bakeries',
        de: 'Cafés & Bäckereien',
        icon: 'mdi-silverware-fork-knife',
      },
      {
        slug: 'catering',
        ro: 'Catering & evenimente',
        en: 'Catering & events',
        de: 'Catering & Events',
        icon: 'mdi-silverware-fork-knife',
      },
      // --- new ---
      {
        slug: 'fast-food-street-food',
        ro: 'Fast-food & street food',
        en: 'Fast food & street food',
        de: 'Fast Food & Street Food',
        icon: 'mdi-hamburger',
      },
      {
        slug: 'baruri-pub-uri',
        ro: 'Baruri & pub-uri',
        en: 'Bars & pubs',
        de: 'Bars & Pubs',
        icon: 'mdi-glass-mug-variant',
      },
      {
        slug: 'cofetarii',
        ro: 'Cofetării & torturi la comandă',
        en: 'Pastry shops & custom cakes',
        de: 'Konditoreien & Tortenbäckerei',
        icon: 'mdi-cake-variant',
      },
      {
        slug: 'berarii-crame',
        ro: 'Berării & crame',
        en: 'Breweries & wineries',
        de: 'Brauereien & Weingüter',
        icon: 'mdi-beer',
      },
    ],
  },
  {
    slug: 'digital',
    ro: 'Servicii digitale',
    en: 'Digital services',
    de: 'Digitale Dienste',
    icon: 'mdi-monitor',
    children: [
      {
        slug: 'web-design',
        ro: 'Web design & dezvoltare',
        en: 'Web design & development',
        de: 'Webdesign & Entwicklung',
        icon: 'mdi-monitor',
      },
      {
        slug: 'marketing-seo',
        ro: 'Marketing & SEO',
        en: 'Marketing & SEO',
        de: 'Marketing & SEO',
        icon: 'mdi-monitor',
      },
      {
        slug: 'foto-video',
        ro: 'Fotografie & video',
        en: 'Photography & video',
        de: 'Foto & Video',
        icon: 'mdi-monitor',
      },
      // --- new ---
      {
        slug: 'dezvoltare-software-it',
        ro: 'Dezvoltare software & IT',
        en: 'Software & IT development',
        de: 'Softwareentwicklung & IT',
        icon: 'mdi-code-tags',
      },
      {
        slug: 'design-grafic-branding',
        ro: 'Design grafic & branding',
        en: 'Graphic design & branding',
        de: 'Grafikdesign & Branding',
        icon: 'mdi-format-paint',
      },
      {
        slug: 'social-media-content',
        ro: 'Social media & content creation',
        en: 'Social media & content creation',
        de: 'Social Media & Content Creation',
        icon: 'mdi-share-variant',
      },
    ],
  },
  {
    slug: 'sanatate',
    ro: 'Sănătate',
    en: 'Health',
    de: 'Gesundheit',
    icon: 'mdi-hospital-box-outline',
    children: [
      {
        slug: 'stomatologie',
        ro: 'Cabinete stomatologice',
        en: 'Dental clinics',
        de: 'Zahnarztpraxen',
        icon: 'mdi-hospital-box-outline',
      },
      {
        slug: 'kinetoterapie',
        ro: 'Kinetoterapie & recuperare',
        en: 'Physiotherapy',
        de: 'Physiotherapie',
        icon: 'mdi-hospital-box-outline',
      },
      // --- new ---
      {
        slug: 'clinici-medicale',
        ro: 'Clinici & cabinete medicale',
        en: 'Medical clinics & specialists',
        de: 'Arztpraxen & Fachärzte',
        icon: 'mdi-doctor',
      },
      { slug: 'farmacii', ro: 'Farmacii', en: 'Pharmacies', de: 'Apotheken', icon: 'mdi-pill' },
      {
        slug: 'optica-medicala',
        ro: 'Optică medicală',
        en: 'Optical clinics',
        de: 'Optiker',
        icon: 'mdi-eye-outline',
      },
      {
        slug: 'psihologie-psihoterapie',
        ro: 'Psihologie & psihoterapie',
        en: 'Psychology & psychotherapy',
        de: 'Psychologie & Psychotherapie',
        icon: 'mdi-brain',
      },
      {
        slug: 'nutritie-dietetica',
        ro: 'Nutriție & dietetică',
        en: 'Nutrition & dietetics',
        de: 'Ernährungsberatung',
        icon: 'mdi-food-apple-outline',
      },
      {
        slug: 'laboratoare-analize',
        ro: 'Laboratoare de analize',
        en: 'Medical testing labs',
        de: 'Medizinische Labore',
        icon: 'mdi-test-tube',
      },
    ],
  },
  {
    slug: 'educatie',
    ro: 'Educație',
    en: 'Education',
    de: 'Bildung',
    icon: 'mdi-school-outline',
    children: [
      {
        slug: 'scoli-soferi',
        ro: 'Școli de șoferi',
        en: 'Driving schools',
        de: 'Fahrschulen',
        icon: 'mdi-school-outline',
      },
      {
        slug: 'meditatii',
        ro: 'Meditații & cursuri',
        en: 'Tutoring & courses',
        de: 'Nachhilfe & Kurse',
        icon: 'mdi-school-outline',
      },
      // --- new ---
      {
        slug: 'limbi-straine',
        ro: 'Școli de limbi străine',
        en: 'Language schools',
        de: 'Sprachschulen',
        icon: 'mdi-translate',
      },
      {
        slug: 'cursuri-muzica-arta',
        ro: 'Cursuri de muzică & arte',
        en: 'Music & art lessons',
        de: 'Musik- & Kunstunterricht',
        icon: 'mdi-music-note',
      },
      {
        slug: 'gradinite-after-school',
        ro: 'Grădinițe & after-school',
        en: 'Kindergartens & after-school',
        de: 'Kindergärten & Nachmittagsbetreuung',
        icon: 'mdi-baby-carriage',
      },
      {
        slug: 'cursuri-it-digital',
        ro: 'Cursuri IT & digital',
        en: 'IT & digital courses',
        de: 'IT- & Digitalkurse',
        icon: 'mdi-laptop',
      },
    ],
  },

  // ---------------------------------------------------------------------
  // New groups
  // ---------------------------------------------------------------------
  {
    slug: 'animale',
    ro: 'Animale de companie',
    en: 'Pet services',
    de: 'Haustierdienste',
    icon: 'mdi-paw',
    children: [
      {
        slug: 'veterinar',
        ro: 'Clinici veterinare',
        en: 'Veterinary clinics',
        de: 'Tierarztpraxen',
        icon: 'mdi-medical-bag',
      },
      {
        slug: 'grooming-canin',
        ro: 'Grooming & frizerie canină',
        en: 'Pet grooming',
        de: 'Hundefriseur',
        icon: 'mdi-dog',
      },
      {
        slug: 'pet-shop',
        ro: 'Pet shop & hrană animale',
        en: 'Pet shops & supplies',
        de: 'Zoofachgeschäfte',
        icon: 'mdi-bone',
      },
      {
        slug: 'pensiune-animale',
        ro: 'Pensiune pentru animale',
        en: 'Pet boarding',
        de: 'Tierpension',
        icon: 'mdi-home-heart',
      },
      {
        slug: 'dresaj-canin',
        ro: 'Dresaj canin',
        en: 'Dog training',
        de: 'Hundetraining',
        icon: 'mdi-dog-side',
      },
    ],
  },
  {
    slug: 'evenimente',
    ro: 'Evenimente & divertisment',
    en: 'Events & entertainment',
    de: 'Veranstaltungen & Unterhaltung',
    icon: 'mdi-party-popper',
    children: [
      {
        slug: 'organizare-evenimente',
        ro: 'Organizare evenimente & nunți',
        en: 'Event & wedding planning',
        de: 'Veranstaltungs- & Hochzeitsplanung',
        icon: 'mdi-party-popper',
      },
      {
        slug: 'dj-formatii-muzica-live',
        ro: 'DJ, formații & muzică live',
        en: 'DJs, bands & live music',
        de: 'DJs, Bands & Live-Musik',
        icon: 'mdi-speaker',
      },
      {
        slug: 'inchirieri-spatii-evenimente',
        ro: 'Închirieri spații pentru evenimente',
        en: 'Event venue rental',
        de: 'Eventlocation-Vermietung',
        icon: 'mdi-warehouse',
      },
      {
        slug: 'decoratiuni-evenimente',
        ro: 'Decorațiuni & flori evenimente',
        en: 'Event decor & flowers',
        de: 'Eventdekoration & Blumen',
        icon: 'mdi-flower',
      },
      {
        slug: 'animatori-petreceri-copii',
        ro: 'Animatori pentru petreceri copii',
        en: "Kids' party entertainers",
        de: 'Kinderanimation',
        icon: 'mdi-emoticon-happy-outline',
      },
    ],
  },
  {
    slug: 'sport-fitness',
    ro: 'Sport & fitness',
    en: 'Sport & fitness',
    de: 'Sport & Fitness',
    icon: 'mdi-dumbbell',
    children: [
      {
        slug: 'sala-fitness-gym',
        ro: 'Săli de fitness & gym',
        en: 'Gyms & fitness studios',
        de: 'Fitnessstudios',
        icon: 'mdi-dumbbell',
      },
      { slug: 'yoga-pilates', ro: 'Yoga & pilates', en: 'Yoga & pilates', de: 'Yoga & Pilates', icon: 'mdi-yoga' },
      {
        slug: 'arte-martiale',
        ro: 'Arte marțiale & box',
        en: 'Martial arts & boxing',
        de: 'Kampfsport & Boxen',
        icon: 'mdi-karate',
      },
      {
        slug: 'antrenori-personali',
        ro: 'Antrenori personali',
        en: 'Personal trainers',
        de: 'Personal Trainer',
        icon: 'mdi-run',
      },
      {
        slug: 'terenuri-sportive-inchiriere',
        ro: 'Închiriere terenuri sportive',
        en: 'Sports field rental',
        de: 'Sportplatzvermietung',
        icon: 'mdi-soccer-field',
      },
      {
        slug: 'piscine-stranduri',
        ro: 'Piscine & ștranduri',
        en: 'Pools & swimming facilities',
        de: 'Schwimmbäder',
        icon: 'mdi-pool',
      },
    ],
  },
  {
    slug: 'imobiliare',
    ro: 'Imobiliare',
    en: 'Real estate',
    de: 'Immobilien',
    icon: 'mdi-home-city-outline',
    children: [
      {
        slug: 'agentii-imobiliare',
        ro: 'Agenții imobiliare',
        en: 'Real estate agencies',
        de: 'Immobilienagenturen',
        icon: 'mdi-office-building-outline',
      },
      {
        slug: 'administrare-cladiri',
        ro: 'Administrare clădiri & asociații',
        en: 'Building & HOA management',
        de: 'Hausverwaltung',
        icon: 'mdi-domain',
      },
      {
        slug: 'evaluari-imobiliare',
        ro: 'Evaluări imobiliare',
        en: 'Property valuation',
        de: 'Immobilienbewertung',
        icon: 'mdi-home-search-outline',
      },
    ],
  },
  {
    slug: 'juridic-financiar',
    ro: 'Servicii juridice & financiare',
    en: 'Legal & financial services',
    de: 'Rechts- & Finanzdienstleistungen',
    icon: 'mdi-briefcase-outline',
    children: [
      { slug: 'avocatura', ro: 'Cabinete de avocatură', en: 'Law firms', de: 'Anwaltskanzleien', icon: 'mdi-gavel' },
      {
        slug: 'contabilitate',
        ro: 'Contabilitate & expertiză contabilă',
        en: 'Accounting & bookkeeping',
        de: 'Buchhaltung',
        icon: 'mdi-calculator-variant',
      },
      {
        slug: 'notariat',
        ro: 'Birouri notariale',
        en: 'Notary offices',
        de: 'Notariate',
        icon: 'mdi-certificate-outline',
      },
      {
        slug: 'consultanta-business',
        ro: 'Consultanță business',
        en: 'Business consulting',
        de: 'Unternehmensberatung',
        icon: 'mdi-chart-line',
      },
      {
        slug: 'brokeraj-asigurari',
        ro: 'Brokeraj & asigurări',
        en: 'Insurance brokerage',
        de: 'Versicherungsmakler',
        icon: 'mdi-shield-check-outline',
      },
      {
        slug: 'recrutare-resurse-umane',
        ro: 'Recrutare & resurse umane',
        en: 'Recruitment & HR',
        de: 'Personalvermittlung & HR',
        icon: 'mdi-account-tie-outline',
      },
    ],
  },
  {
    slug: 'comert-retail',
    ro: 'Comerț & retail local',
    en: 'Local retail & shops',
    de: 'Lokaler Einzelhandel',
    icon: 'mdi-storefront-outline',
    children: [
      { slug: 'florarii', ro: 'Florării', en: 'Florists', de: 'Blumenläden', icon: 'mdi-flower-outline' },
      {
        slug: 'magazine-haine-boutique',
        ro: 'Magazine de haine & boutique-uri',
        en: 'Clothing stores & boutiques',
        de: 'Modegeschäfte & Boutiquen',
        icon: 'mdi-hanger',
      },
      {
        slug: 'electronice-electrocasnice',
        ro: 'Electronice & electrocasnice',
        en: 'Electronics & appliances',
        de: 'Elektronik & Haushaltsgeräte',
        icon: 'mdi-television',
      },
      {
        slug: 'librarii-papetarii',
        ro: 'Librării & papetării',
        en: 'Bookshops & stationery',
        de: 'Buchhandlungen & Schreibwaren',
        icon: 'mdi-book-open-variant',
      },
      {
        slug: 'magazine-bio-alimentare',
        ro: 'Magazine alimentare & produse bio',
        en: 'Grocery & organic stores',
        de: 'Lebensmittel- & Bioläden',
        icon: 'mdi-leaf',
      },
    ],
  },
  {
    slug: 'turism-cazare',
    ro: 'Turism & cazare',
    en: 'Travel & accommodation',
    de: 'Reisen & Unterkunft',
    icon: 'mdi-bed-outline',
    children: [
      {
        slug: 'hoteluri-pensiuni',
        ro: 'Hoteluri & pensiuni',
        en: 'Hotels & guesthouses',
        de: 'Hotels & Pensionen',
        icon: 'mdi-bed-outline',
      },
      {
        slug: 'agentii-turism',
        ro: 'Agenții de turism',
        en: 'Travel agencies',
        de: 'Reisebüros',
        icon: 'mdi-airplane',
      },
      {
        slug: 'cazare-vacanta',
        ro: 'Cazare de vacanță',
        en: 'Vacation rentals',
        de: 'Ferienunterkünfte',
        icon: 'mdi-home-city',
      },
    ],
  },
];

async function main(): Promise<void> {
  let groupsWritten = 0;
  let leavesWritten = 0;

  for (let gi = 0; gi < GROUPS.length; gi++) {
    const g = GROUPS[gi];
    const nameI18n = { ro: g.ro, en: g.en, de: g.de };
    const parent = await prisma.category.upsert({
      where: { slug: g.slug },
      update: { nameI18n, icon: g.icon, isActive: true, position: gi },
      create: { slug: g.slug, nameI18n, icon: g.icon, isActive: true, position: gi },
    });
    groupsWritten++;

    for (let ci = 0; ci < g.children.length; ci++) {
      const c = g.children[ci];
      const childNameI18n = { ro: c.ro, en: c.en, de: c.de };
      await prisma.category.upsert({
        where: { slug: c.slug },
        update: {
          nameI18n: childNameI18n,
          icon: c.icon,
          isActive: true,
          position: ci,
          parentId: parent.id,
        },
        create: {
          slug: c.slug,
          nameI18n: childNameI18n,
          icon: c.icon,
          isActive: true,
          position: ci,
          parentId: parent.id,
        },
      });
      leavesWritten++;
    }
  }

  const totalGroups = await prisma.category.count({ where: { parentId: null } });
  const totalLeaves = await prisma.category.count({ where: { parentId: { not: null } } });

  console.log(`Upserted ${groupsWritten} groups and ${leavesWritten} leaves.`);
  console.log(`Categories table now has ${totalGroups} groups and ${totalLeaves} leaves total.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
