/**
 * Everyday words people use for each sub-category, keyed by slug. The local
 * embedding matcher (FeedEmbeddingService) embeds "names + these phrases" per
 * leaf, so a visitor's "mi s-a spart o țeavă" lands on plumbing even though
 * no category name contains "țeavă".
 *
 * Mostly Romanian (that's the audience), with the common English/German
 * words. A leaf missing here still works, matched by its ro/en/de names only;
 * add a line when a new category is created so the matcher knows how people
 * describe it.
 */
export const CATEGORY_KEYWORDS: Record<string, string> = {
  // --- constructii
  acoperisuri:
    'acoperiș, acoperis, țiglă, tablă, învelitoare, mansardă, jgheaburi, burlane, dulgher, acoperișul curge, roof, roofer, roof repair, Dach',
  'amenajari-interioare':
    'renovare apartament, amenajări interioare, rigips, gips-carton, finisaje, reamenajare casă, renovare baie, renovare bucătărie, home renovation, Renovierung',
  zidarie:
    'zidar, zidărie, cărămidă, BCA, fundație, structură, beton, turnat placă, construcție casă la roșu, constructor, mason, bricklayer, Maurer',
  izolatii:
    'izolație termică, anvelopare, polistiren, vată minerală, termoizolație, izolare fațadă, izolație mansardă, insulation, Dämmung',
  'zugraveli-vopsitorii':
    'zugrav, zugrăveli, vopsit pereți, lavabilă, glet, tencuială decorativă, vopsitor, painter, Maler',
  'gresie-faianta-parchet':
    'gresie, faianță, parchet, montaj parchet, plăci ceramice, pardoseală, mozaic, șapă, tiler, flooring, Fliesenleger',
  'tamplarie-pvc-aluminiu':
    'termopane, ferestre, geamuri termopan, uși PVC, tâmplărie aluminiu, plase insecte, rulouri, jaluzele, windows, Fenster',
  'demolari-excavatii':
    'demolare, excavații, săpături, buldoexcavator, nivelare teren, debarasare moloz, demolition, Abriss, Bagger',
  // --- instalatii
  'instalatii-sanitare':
    'instalator, țeavă spartă, țevi, teava sparta, scurgere înfundată, desfundare canalizare, robinet, baterie, wc, chiuvetă, boiler, centrală termică, calorifere, apă, inundație baie, plumber, leak, Klempner, Rohr',
  'instalatii-electrice':
    'electrician, curent, priză, prize, siguranțe, tablou electric, scurtcircuit, cabluri, iluminat, împământare, electrician de urgență, electrician, Elektriker, Strom',
  climatizare:
    'aer condiționat, AC, montaj aer condiționat, igienizare aer condiționat, pompă de căldură, ventilație, HVAC, air conditioning, Klimaanlage',
  'panouri-fotovoltaice':
    'panouri solare, fotovoltaice, sistem fotovoltaic, prosumator, invertor, baterii solare, solar panels, Photovoltaik',
  'sisteme-securitate':
    'camere de supraveghere, CCTV, alarmă, sistem de alarmă, video supraveghere, control acces, security cameras, Alarmanlage',
  'automatizari-interfonie':
    'poartă automată, automatizare poartă, interfon, videointerfon, motor poartă, ușă garaj, barieră, gate opener, Torantrieb',
  // --- auto
  'service-auto':
    'mecanic, service auto, reparații mașină, schimb ulei, revizie, ITP, diagnoză, frâne, distribuție, ambreiaj, mașina nu pornește, car mechanic, garage, Autowerkstatt',
  tinichigerie:
    'tinichigiu, tinichigerie, vopsitorie auto, caroserie, lovitură mașină, zgârietură, îndreptat tablă, body shop, Karosserie',
  vulcanizare:
    'vulcanizare, anvelope, cauciucuri, pană, roată, echilibrare, schimb anvelope iarnă vară, tyres, tires, Reifen',
  'spalatorie-detailing-auto':
    'spălătorie auto, spălat mașina, detailing, polish, curățare interior mașină, ceramică auto, car wash, Autowäsche',
  'tractari-asistenta-rutiera':
    'tractare, platformă auto, mașină stricată pe drum, asistență rutieră, tractări non-stop, tow truck, Abschleppen',
  'inchirieri-auto':
    'închiriere mașină, rent a car, mașină de închiriat, închirieri auto, închiriere dubă, car rental, Mietwagen',
  'transport-marfa-curierat':
    'transport marfă, curier, curierat, livrare colete, transport persoane, camion, dubă transport, freight, courier, Kurier',
  'mutari-relocari':
    'mutare, mutări, relocare, transport mobilă, hamali, mutare apartament, moving company, Umzug',
  'piese-accesorii-auto':
    'piese auto, piese mașină, accesorii auto, dezmembrări, acumulator mașină, car parts, Autoteile',
  // --- curatenie
  'curatenie-rezidentiala':
    'curățenie casă, curățenie apartament, menajeră, femeie de serviciu, curățenie generală, house cleaning, Putzfrau',
  'curatenie-birouri':
    'curățenie birouri, curățenie firmă, curățenie spații comerciale, office cleaning, Büroreinigung',
  'curatenie-post-constructor':
    'curățenie după renovare, curățenie după constructor, curățenie după șantier, post-construction cleaning',
  'dezinsectie-deratizare':
    'gândaci, ploșnițe, șobolani, șoareci, dezinsecție, deratizare, dezinfecție, viespi, furnici, pest control, Kammerjäger',
  'curatenie-tapiterie-covoare':
    'spălat covoare, curățare canapea, tapițerie, saltele, spălătorie covoare, carpet cleaning, Teppichreinigung',
  'spalare-geamuri-fatade':
    'spălat geamuri, curățare fațadă, alpinism utilitar, window cleaning, Fensterputzer',
  // --- frumusete
  coafor:
    'coafor, coafeză, tuns, tunsoare, vopsit păr, coafură, frizer, frizerie, hairdresser, haircut, Friseur',
  cosmetica:
    'cosmetică, cosmeticiană, tratament facial, machiaj, make-up, gene, sprâncene, makeup artist, Kosmetik',
  manichiura:
    'manichiură, pedichiură, unghii, gel, oja semipermanentă, nail art, nails, Nagelstudio',
  barbershop: 'barbershop, barber, tuns bărbați, barbă, aranjat barba, frizer bărbați',
  'masaj-spa': 'masaj, masaj relaxare, masaj terapeutic, spa, saună, wellness, massage, Massage',
  'tatuaje-piercing': 'tatuaj, tatuaje, tattoo, piercing, salon tatuaje',
  'epilare-definitiva':
    'epilare definitivă, epilare laser, epilare, ceară, IPL, laser hair removal, Haarentfernung',
  'solar-bronzat': 'solar, bronzat, bronzare, tanning, Solarium',
  // --- horeca
  restaurante:
    'restaurant, unde mănânc, cină, prânz, mâncare, meniul zilei, pizzerie, pizza, restaurant, essen',
  cafenele: 'cafenea, cafea, patiserie, brutărie, covrigi, croissant, coffee shop, café, Bäckerei',
  catering:
    'catering, mâncare pentru eveniment, catering nuntă, meniu petrecere, platouri, food delivery events',
  'fast-food-street-food':
    'fast food, shaorma, burger, kebab, hot dog, street food, livrare mâncare, Imbiss',
  'baruri-pub-uri': 'bar, pub, cocktail, bere, ieșit în oraș, club, terasă, bar, Kneipe',
  cofetarii:
    'cofetărie, tort, tort la comandă, prăjituri, dulciuri, tort aniversar, tort nuntă, cake, Torte',
  'berarii-crame':
    'berărie, bere artizanală, cramă, degustare vin, vinărie, brewery, winery, Weingut',
  // --- digital
  'web-design':
    'site, site web, website, creare site, magazin online, web design, programator site, Webseite',
  'marketing-seo':
    'marketing, SEO, reclame Google, Google Ads, Facebook Ads, promovare online, agenție marketing, Werbung',
  'foto-video':
    'fotograf, fotografie, videograf, filmare nuntă, ședință foto, dronă, photographer, Fotograf',
  'dezvoltare-software-it':
    'programator, aplicație, aplicație mobilă, software, IT, reparații calculatoare, rețea, service laptop, developer, Software',
  'design-grafic-branding':
    'logo, design grafic, branding, identitate vizuală, grafician, flyer, Logo',
  'social-media-content':
    'social media, administrare pagină Facebook, Instagram, TikTok, content creator, influencer, postări',
  // --- sanatate
  stomatologie:
    'dentist, stomatolog, dinți, durere de dinte, carie, implant dentar, aparat dentar, albire dinți, ortodont, Zahnarzt',
  kinetoterapie:
    'kinetoterapeut, kinetoterapie, recuperare medicală, fizioterapie, durere de spate, coloană, physiotherapist, Physiotherapie',
  'clinici-medicale':
    'doctor, medic, clinică, cabinet medical, consultație, medic specialist, ginecolog, dermatolog, pediatru, cardiolog, Arzt',
  farmacii: 'farmacie, medicamente, pastile, farmacie non-stop, pharmacy, Apotheke',
  'optica-medicala':
    'ochelari, lentile de contact, optică, control ochi, optometrist, oftalmolog, glasses, Brille',
  'psihologie-psihoterapie':
    'psiholog, psihoterapeut, terapie, anxietate, depresie, consiliere, therapist, Psychologe',
  'nutritie-dietetica':
    'nutriționist, dietă, slăbit, nutriție, dietetician, plan alimentar, nutritionist, Diät',
  'laboratoare-analize':
    'analize, analize de sânge, laborator, test, recoltare, analize medicale, blood test, Labor',
  // --- educatie
  'scoli-soferi':
    'școală de șoferi, permis auto, permis de conducere, instructor auto, carnet, driving school, Fahrschule',
  meditatii:
    'meditații, meditator, profesor, pregătire bacalaureat, evaluare națională, matematică, cursuri, tutoring, Nachhilfe',
  'limbi-straine':
    'cursuri engleză, germană, limbi străine, profesor de engleză, curs de limbă, language course, Sprachkurs',
  'cursuri-muzica-arta':
    'lecții de pian, chitară, canto, curs de desen, pictură, dans, școală de muzică, music lessons, Musikunterricht',
  'gradinite-after-school':
    'grădiniță, after-school, after school, creșă, bonă, îngrijire copii, kindergarten, Kita',
  'cursuri-it-digital':
    'curs programare, curs IT, curs calculator, curs marketing digital, coding bootcamp, Programmierkurs',
  // --- animale
  veterinar:
    'veterinar, medic veterinar, clinică veterinară, câine bolnav, pisică bolnavă, vaccin câine, vet, Tierarzt',
  'grooming-canin':
    'tuns câine, toaletaj canin, frizerie canină, grooming, spălat câine, tuns pisică, dog grooming, Hundefriseur',
  'pet-shop':
    'pet shop, hrană câini, hrană pisici, accesorii animale, mâncare animale, Zoohandlung',
  'pensiune-animale':
    'pensiune câini, cazare câine, pet sitter, îngrijire animale în concediu, pet hotel, Tierpension',
  'dresaj-canin': 'dresaj, dresor câini, educare câine, dog trainer, Hundeschule',
  // --- evenimente
  'organizare-evenimente':
    'organizare nuntă, wedding planner, organizare eveniment, botez, petrecere, aniversare, eveniment corporate, Hochzeitsplaner',
  'dj-formatii-muzica-live':
    'DJ, formație, trupă, lăutari, muzică live, solist, band, muzică nuntă, Hochzeits-DJ',
  'inchirieri-spatii-evenimente':
    'sală de evenimente, salon nunți, restaurant nuntă, spațiu petrecere, sală botez, venue, Festsaal',
  'decoratiuni-evenimente':
    'decorațiuni nuntă, aranjamente florale, baloane, decor eveniment, flori nuntă, Dekoration',
  'animatori-petreceri-copii':
    'animatori, petrecere copii, ziua copilului, clovn, mascote, aniversare copii, Kinderparty',
  // --- sport-fitness
  'sala-fitness-gym': 'sală de fitness, sală de forță, gym, abonament sală, fitness, Fitnessstudio',
  'yoga-pilates': 'yoga, pilates, meditație, stretching, yoga studio',
  'arte-martiale': 'box, karate, judo, kickbox, MMA, arte marțiale, autoapărare, Kampfsport',
  'antrenori-personali': 'antrenor personal, personal trainer, antrenament personalizat, Trainer',
  'terenuri-sportive-inchiriere':
    'teren de fotbal, închiriere teren, tenis, padel, baschet, minifotbal, sports field, Tennisplatz',
  'piscine-stranduri': 'piscină, ștrand, înot, curs de înot, aquapark, swimming pool, Schwimmbad',
  // --- imobiliare
  'agentii-imobiliare':
    'agent imobiliar, agenție imobiliară, cumpăr apartament, vând casă, chirie, închiriez apartament, teren de vânzare, real estate, Makler',
  'administrare-cladiri':
    'administrator bloc, asociație de proprietari, administrare imobil, facility management, Hausverwaltung',
  'evaluari-imobiliare':
    'evaluator, evaluare imobiliară, evaluare casă, evaluare pentru credit, Gutachter',
  // --- juridic-financiar
  avocatura:
    'avocat, avocată, divorț, proces, consultanță juridică, succesiune, partaj, lawyer, Anwalt',
  contabilitate:
    'contabil, contabilitate, expert contabil, declarații fiscale, salarizare, înființare firmă, PFA, SRL, accountant, Steuerberater',
  notariat:
    'notar, birou notarial, legalizare, procură, contract vânzare-cumpărare, moștenire, Notar',
  'consultanta-business':
    'consultant, consultanță, fonduri europene, plan de afaceri, consultanță afaceri, business consultant, Berater',
  'brokeraj-asigurari':
    'asigurare, RCA, CASCO, asigurare locuință, asigurare de viață, broker asigurări, insurance, Versicherung',
  'recrutare-resurse-umane':
    'recrutare, angajări, resurse umane, HR, agenție de recrutare, personal, recruitment, Personalvermittlung',
  // --- comert-retail
  florarii:
    'florărie, flori, buchet, buchet de flori, livrare flori, aranjamente florale, florist, Blumen',
  'magazine-haine-boutique':
    'haine, îmbrăcăminte, boutique, rochii, magazin de haine, încălțăminte, Kleidung',
  'electronice-electrocasnice':
    'electronice, electrocasnice, televizor, telefon, frigider, mașină de spălat, laptop, reparații electrocasnice, Elektronik',
  'librarii-papetarii': 'librărie, cărți, papetărie, rechizite, birotică, bookshop, Buchhandlung',
  'magazine-bio-alimentare':
    'magazin alimentar, produse bio, alimente, băcănie, produse naturale, organic, Bioladen',
  // --- turism-cazare
  'hoteluri-pensiuni': 'hotel, pensiune, cazare, motel, unde dorm, cameră de hotel, Unterkunft',
  'agentii-turism':
    'agenție de turism, vacanță, sejur, bilete de avion, excursie, circuit, travel agency, Reisebüro',
  'cazare-vacanta':
    'cabană, casă de vacanță, apartament în regim hotelier, cazare la munte, cazare la mare, Ferienwohnung',
};
