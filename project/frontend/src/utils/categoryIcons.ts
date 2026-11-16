/**
 * Curated MDI icon set for the admin category editor's icon picker — the
 * same icons this app already relies on elsewhere (the seeded taxonomy in
 * `prisma/seed.ts`, the auto-pick rules in `serviceIcon.ts`), so a category
 * icon always matches the visual language the rest of the app already uses.
 * `@mdi/font` ships thousands of icons with no curated subset of its own,
 * so this list is what the picker searches instead of a free-text field.
 */
export interface CategoryIconOption {
  icon: string
  /** Lowercase RO + EN keywords the picker's search matches against. */
  keywords: string
}

export const CATEGORY_ICONS: CategoryIconOption[] = [
  { icon: 'mdi-hammer', keywords: 'constructii construction building santier' },
  { icon: 'mdi-hammer-wrench', keywords: 'amenajari renovari renovation fit-out' },
  { icon: 'mdi-wall', keywords: 'zidarie structuri masonry structures beton' },
  { icon: 'mdi-home-roof', keywords: 'acoperisuri roofing tigla jgheaburi' },
  { icon: 'mdi-pipe-wrench', keywords: 'instalatii sanitare plumbing tevi apa' },
  { icon: 'mdi-flash', keywords: 'instalatii electrice electrical curent' },
  { icon: 'mdi-radiator', keywords: 'incalzire centrala termica heating boiler' },
  { icon: 'mdi-air-conditioner', keywords: 'climatizare hvac aer conditionat' },
  { icon: 'mdi-format-paint', keywords: 'zugraveli vopsitorie painting finisaje' },
  { icon: 'mdi-table-furniture', keywords: 'mobila tamplarie furniture woodwork' },
  { icon: 'mdi-grid', keywords: 'gresie faianta placari tiling flooring' },
  { icon: 'mdi-window-closed-variant', keywords: 'geamuri termopane windows glass' },
  { icon: 'mdi-anvil', keywords: 'fierarie sudura metalic metalwork welding' },
  { icon: 'mdi-screwdriver', keywords: 'montaj asamblare installation assembly' },
  { icon: 'mdi-wrench', keywords: 'reparatii service mentenanta repair maintenance' },
  { icon: 'mdi-key-outline', keywords: 'lacatus locksmith chei yale' },

  { icon: 'mdi-car-wrench', keywords: 'auto service masini automotive cars' },
  { icon: 'mdi-truck-fast', keywords: 'transport mutari curierat delivery logistics' },
  { icon: 'mdi-forklift', keywords: 'logistica depozit warehouse logistics' },
  { icon: 'mdi-airplane', keywords: 'turism calatorii travel tours' },
  { icon: 'mdi-anchor', keywords: 'naval marina ambarcatiuni boats' },
  { icon: 'mdi-tractor-variant', keywords: 'agricultura agriculture ferma farm' },

  { icon: 'mdi-broom', keywords: 'curatenie cleaning menaj igienizare' },
  { icon: 'mdi-recycle', keywords: 'deseuri reciclare waste recycling' },
  { icon: 'mdi-sprout', keywords: 'gradinarit peisagistica landscaping garden' },
  { icon: 'mdi-tree-outline', keywords: 'amenajari exterioare outdoor copaci trees' },
  { icon: 'mdi-leaf', keywords: 'eco bio organic natural' },

  { icon: 'mdi-content-cut', keywords: 'coafor frizerie hairdresser barber' },
  { icon: 'mdi-face-woman-shimmer', keywords: 'cosmetica make-up machiaj beauty' },
  { icon: 'mdi-hand-back-right', keywords: 'manichiura pedichiura nails' },
  { icon: 'mdi-spa', keywords: 'masaj spa relaxare wellness' },
  { icon: 'mdi-tshirt-crew-outline', keywords: 'imbracaminte haine clothing fashion' },
  { icon: 'mdi-shoe-formal', keywords: 'incaltaminte footwear shoes' },

  { icon: 'mdi-silverware-fork-knife', keywords: 'restaurante gastronomie food horeca' },
  { icon: 'mdi-cake-variant-outline', keywords: 'patiserie cofetarie bakery cake' },
  { icon: 'mdi-glass-cocktail', keywords: 'bar pub bauturi drinks' },
  { icon: 'mdi-party-popper', keywords: 'evenimente nunti catering events parties' },
  { icon: 'mdi-music-note', keywords: 'muzica entertainment divertisment dj' },
  { icon: 'mdi-ticket-outline', keywords: 'bilete evenimente tickets events' },

  { icon: 'mdi-monitor', keywords: 'digital servicii it digital services' },
  { icon: 'mdi-laptop', keywords: 'web design dezvoltare software it' },
  { icon: 'mdi-palette', keywords: 'design grafic branding logo' },
  { icon: 'mdi-camera', keywords: 'foto video photography filmmaking' },
  { icon: 'mdi-bullhorn', keywords: 'marketing publicitate seo advertising' },
  { icon: 'mdi-translate', keywords: 'traduceri translation' },

  { icon: 'mdi-hospital-box-outline', keywords: 'sanatate health clinici medical' },
  { icon: 'mdi-medical-bag', keywords: 'medic clinica doctor sanatate' },
  { icon: 'mdi-tooth', keywords: 'stomatologie dentist dinti' },
  { icon: 'mdi-bottle-tonic-outline', keywords: 'farmacie pharmacy medicamente' },
  { icon: 'mdi-dumbbell', keywords: 'fitness sala sport gym' },
  { icon: 'mdi-paw', keywords: 'veterinar animale pets vet' },

  { icon: 'mdi-school-outline', keywords: 'educatie scoala education school' },
  { icon: 'mdi-book-open-page-variant-outline', keywords: 'carti librarie books stationery' },

  { icon: 'mdi-calculator', keywords: 'contabilitate fiscal accounting' },
  { icon: 'mdi-scale-balance', keywords: 'juridic avocat legal notar' },
  { icon: 'mdi-bank-outline', keywords: 'finante banking servicii financiare' },
  { icon: 'mdi-handshake-outline', keywords: 'consultanta consulting business' },
  { icon: 'mdi-account-group-outline', keywords: 'resurse umane hr recrutare staffing' },
  { icon: 'mdi-office-building-outline', keywords: 'birouri coworking business services' },
  { icon: 'mdi-lightbulb-on', keywords: 'consultanta strategie idei audit' },

  { icon: 'mdi-home-city-outline', keywords: 'imobiliare real estate apartamente' },
  { icon: 'mdi-bed-outline', keywords: 'cazare hotel accommodation' },
  { icon: 'mdi-store', keywords: 'magazin retail shop comert' },
  { icon: 'mdi-cart', keywords: 'vanzari comert shopping retail' },
  { icon: 'mdi-shield-check', keywords: 'paza securitate security alarme' },

  { icon: 'mdi-tag-outline', keywords: 'general etichete tag' },
  { icon: 'mdi-shape-outline', keywords: 'altele other general' },
  { icon: 'mdi-folder-outline', keywords: 'general folder categorie' },
  { icon: 'mdi-star-four-points', keywords: 'general implicit default' },
]
