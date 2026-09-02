/**
 * Pick an mdi icon for a service from its name (Simple-site builder). Keyword
 * match on a diacritic-stripped lowercase form; first hit wins. Mirrored on the
 * frontend in `src/utils/serviceIcon.ts` — keep the two in sync.
 */
const DEFAULT_ICON = 'mdi-star-four-points';

const RULES: [RegExp, string][] = [
  [/instal|sanitar|\btev|apa\b|canaliz|scurger|robinet|\bbaie/, 'mdi-pipe-wrench'],
  [/electr|curent|tablou|\bpriz|iluminat|\bled\b/, 'mdi-flash'],
  [/centr|termic|incalz|calorifer|boiler/, 'mdi-radiator'],
  [/climatiz|aer cond|\bclima\b|\bac\b/, 'mdi-air-conditioner'],
  [/acoperi|\broof|tigla|jgheab|mansard/, 'mdi-home-roof'],
  [/zugrav|vops|varuit|finisaj|\bglet|tapet/, 'mdi-format-paint'],
  [/construc|zidari|zidar|beton|fundati|structur|caramid/, 'mdi-wall'],
  [/amenaj|renov|compartiment|gips|rigips|mansardare/, 'mdi-hammer-wrench'],
  [/mobil|tamplar|\blemn|dulap|bucatar|\bpal\b/, 'mdi-table-furniture'],
  [/parchet|gresi|faian|pardose|placare|\bplac/, 'mdi-grid'],
  [/curat|clean|menaj|igieniz|deratiz|dezinfec/, 'mdi-broom'],
  [/gradin|peisaj|garden|gazon|iarba|\bplant|copac|toaletare/, 'mdi-sprout'],
  [/\bauto|masin|anvelop|vulcaniz|tinichig|caroser|\bitp\b/, 'mdi-car-wrench'],
  [/transport|mutari|\bmarfa|curier|livrare|delivery/, 'mdi-truck-fast'],
  [/\bfoto|photo|\bvideo|filmare|\bdrone/, 'mdi-camera'],
  [/\bweb|\bsite|magazin online|software|aplicati|\bit\b|\bseo\b|hosting/, 'mdi-laptop'],
  [/\bdesign|grafic|\blogo|branding|\bprint|tipar/, 'mdi-palette'],
  [/market|reclam|publicit|social media|campani/, 'mdi-bullhorn'],
  [/contab|fiscal|salariz|\bconta\b/, 'mdi-calculator'],
  [/juridic|avocat|notar|\blegal|consultan.*juridic/, 'mdi-scale-balance'],
  [/frizer|coafor|\btuns|barber/, 'mdi-content-cut'],
  [/machiaj|\bmake|cosmetic|facial|sprancene|\bgene\b/, 'mdi-face-woman-shimmer'],
  [/\bunghi|manichi|pedichi/, 'mdi-hand-back-right'],
  [/masaj|\bspa\b|relaxare|terapie|kineto/, 'mdi-spa'],
  [/dentar|\bdinti|stomatolog|ortodon/, 'mdi-tooth'],
  [/\bmedic|clinic|\banaliz|sanatate/, 'mdi-medical-bag'],
  [/veterinar|\banimal/, 'mdi-paw'],
  [/\bcurs|training|medit|\bscoal|lecti|educati/, 'mdi-school'],
  [/traducer|translat/, 'mdi-translate'],
  [/eveniment|\bnunt|petrecer|catering|\bdj\b/, 'mdi-party-popper'],
  [/\bpaza|securit|\balarm|supraveg|\bcctv\b/, 'mdi-shield-check'],
  [/\bgeam|\bsticl|termopan|ferestr/, 'mdi-window-closed-variant'],
  [/\bfier|\bsudur|sudor|metalic|balustrad|\bpoart/, 'mdi-anvil'],
  [/montaj|asambl|instalare/, 'mdi-screwdriver'],
  [/reparati|\brepar\b|\bservice\b|mentenant|intretin/, 'mdi-wrench'],
  [/consultan|\baudit|strateg/, 'mdi-lightbulb-on'],
  [/\blivr|\bshop|\bvanz|comert/, 'mdi-cart'],
];

function deburr(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function pickServiceIcon(name: string): string {
  const n = deburr(name);
  for (const [re, icon] of RULES) if (re.test(n)) return icon;
  return DEFAULT_ICON;
}

/** Icon for a "why choose us" bullet, from its wording. */
const FEATURE_RULES: [RegExp, string][] = [
  [/rapid|prompt|urgent|imediat|repede|acelasi zi|24|non-stop|nonstop/, 'mdi-lightning-bolt'],
  [/pret|tarif|cost|accesibil|corect|transparent|fara costuri|gratuit|oferta/, 'mdi-tag-outline'],
  [/garanti|garantam/, 'mdi-shield-check-outline'],
  [/experient|ani |echipa|profesionist|specialist|calific|autoriz/, 'mdi-medal-outline'],
  [/calitate|materiale|premium|durabil/, 'mdi-diamond-stone'],
  [/curat|ordine|fara mizerie|dupa noi/, 'mdi-broom'],
  [/comunicare|raspundem|contact|disponibil|suport|program/, 'mdi-message-text-outline'],
  [/local|zona|aproape|acoperim/, 'mdi-map-marker-radius-outline'],
  [/termen|la timp|punctual|programare/, 'mdi-calendar-check-outline'],
  [/clienti|recenzi|recomand|multumit/, 'mdi-account-heart-outline'],
  [/consultan|evaluare|deviz|estimare/, 'mdi-clipboard-text-outline'],
];
const FEATURE_DEFAULT = 'mdi-check-decagram-outline';

export function pickFeatureIcon(title: string): string {
  const n = deburr(title);
  for (const [re, icon] of FEATURE_RULES) if (re.test(n)) return icon;
  return FEATURE_DEFAULT;
}
