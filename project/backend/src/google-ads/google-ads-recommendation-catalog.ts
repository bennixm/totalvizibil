/**
 * Human-readable catalog for Google's `recommendation.type` enum (Google
 * Ads API v25/v26 — fetched from the live API reference; 59 members as of
 * research). Exists so an admin never has to see or type a raw enum string
 * like `RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH` — the admin UI renders
 * Romanian labels/explanations from here and stores the raw type string
 * behind the scenes (`PlatformSettingsService.googleAdsAgentAutoApplyRecommendationTypes`
 * still persists the wire-format strings; only the UI layer changes).
 *
 * `category` groups entries for the admin UI:
 * - `ad_quality`: asset/text additions — the only group genuinely safe to
 *   let an admin toggle on for auto-apply (no budget/targeting/keyword
 *   decision involved).
 * - `budget_bidding` / `targeting_reach` / `keywords`: real business
 *   decisions (or decisions that would undo this agent's own geo/keyword-
 *   cannibalization controls — see `GoogleAdsAgentRecommendationsService`'s
 *   doc comment) — `neverAutoApply: true` on every entry, never rendered
 *   as a toggle, always queued for manual approval regardless of any
 *   setting.
 * - `not_applicable`: recommendation types for campaign kinds this
 *   platform never creates (Shopping, Performance Max, Display/App,
 *   legacy text ads, customer-match audiences) — `neverAutoApply: true`
 *   defensively; the admin UI collapses this whole group into one
 *   explanatory line instead of 20 dead rows.
 *
 * `UNKNOWN`/`UNSPECIFIED` (API-internal placeholders, never a real
 * recommendation) are deliberately excluded — see
 * `getGoogleAdsRecommendationCatalogEntry()`'s fallback for any type this
 * catalog doesn't (yet) list.
 */
export type GoogleAdsRecommendationCategory =
  'ad_quality' | 'budget_bidding' | 'targeting_reach' | 'keywords' | 'not_applicable';

export interface GoogleAdsRecommendationCatalogEntry {
  /** The raw Google Ads `recommendation.type` enum value — wire format
   *  only, never shown in the admin UI. */
  type: string;
  labelRo: string;
  descriptionRo: string;
  category: GoogleAdsRecommendationCategory;
  /** True = the agent never auto-applies this type, no matter the admin's
   *  setting — not rendered as a toggle at all. It's still queued as a
   *  normal `pending_approval` action UNLESS `silentlyIgnore` is also set. */
  neverAutoApply: boolean;
  /** True for the handful of pure "expand your reach" opt-in suggestions
   *  (Display/Search-partners/broad-match expansion) Google surfaces that
   *  carry no real decision for a directory-site campaign to make — these
   *  are dropped entirely, never even reaching the "Propuneri" queue.
   *  Every other `neverAutoApply` type (budget/bid/keyword/audience/lead-
   *  form) still reaches the queue for manual review; it just can never be
   *  auto-applied. Defaults to `false`. */
  silentlyIgnore?: boolean;
  /** Suggested default toggle state — only meaningful when `!neverAutoApply`. */
  recommendedDefault: boolean;
}

export const GOOGLE_ADS_RECOMMENDATION_CATALOG: GoogleAdsRecommendationCatalogEntry[] = [
  // --- ad_quality — safe to toggle: asset/text additions only ---------
  {
    type: 'CALLOUT_ASSET',
    labelRo: 'Adaugă fraze scurte de încredere (callout-uri)',
    descriptionRo:
      'Google sugerează fraze scurte suplimentare de încredere/beneficiu pentru reclamă. Nu ' +
      'afectează bugetul, licitarea sau targetarea.',
    category: 'ad_quality',
    neverAutoApply: false,
    recommendedDefault: true,
  },
  {
    type: 'CALL_ASSET',
    labelRo: 'Adaugă un buton de apel telefonic',
    descriptionRo:
      'Google sugerează un buton de sunat direct din reclamă, dar nu oferă și un număr de ' +
      'telefon — doar admin-ul poate alege unul potrivit. Nu poate fi aplicată din acest panou; ' +
      'se configurează manual direct în Google Ads.',
    category: 'ad_quality',
    neverAutoApply: false,
    recommendedDefault: false,
  },
  {
    type: 'DYNAMIC_IMAGE_EXTENSION_OPT_IN',
    labelRo: 'Permite imagini generate automat de Google',
    descriptionRo:
      'Activează la nivel de cont completarea automată a reclamelor cu imagini alese de Google ' +
      'de pe pagina de destinație. Schimbare la nivel de cont, nu doar de campanie.',
    category: 'ad_quality',
    neverAutoApply: false,
    recommendedDefault: false,
  },
  {
    type: 'OPTIMIZE_AD_ROTATION',
    labelRo: 'Lasă Google să aleagă automat cea mai bună reclamă',
    descriptionRo:
      'Setează rotația reclamelor pe "Optimizare" — Google arată mai des varianta cu rezultate ' +
      'mai bune, în loc să le rotească egal. Recomandarea standard a Google.',
    category: 'ad_quality',
    neverAutoApply: false,
    recommendedDefault: true,
  },
  {
    type: 'RESPONSIVE_SEARCH_AD',
    labelRo: 'Adaugă o a doua reclamă în grup',
    descriptionRo:
      'Google sugerează o reclamă suplimentară (complet nouă) în același grup. Nu poate fi ' +
      'aplicată din acest panou — se configurează manual direct în Google Ads.',
    category: 'ad_quality',
    neverAutoApply: false,
    recommendedDefault: false,
  },
  {
    type: 'RESPONSIVE_SEARCH_AD_ASSET',
    labelRo: 'Completează reclama cu titluri/descrieri suplimentare',
    descriptionRo:
      'Google sugerează titluri sau descrieri suplimentare pentru reclama existentă — exact ce ' +
      'crește scorul "Ad Strength". Nu afectează bugetul sau targetarea.',
    category: 'ad_quality',
    neverAutoApply: false,
    recommendedDefault: true,
  },
  {
    type: 'RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH',
    labelRo: 'Îmbunătățește puterea reclamei (Ad Strength)',
    descriptionRo:
      'Google sugerează text suplimentar/mai variat pentru reclamă, direct pentru a ridica ' +
      'scorul "Ad Strength" către Excelent. Nu afectează bugetul sau targetarea.',
    category: 'ad_quality',
    neverAutoApply: false,
    recommendedDefault: true,
  },
  {
    type: 'SITELINK_ASSET',
    labelRo: 'Adaugă linkuri suplimentare sub reclamă (sitelink-uri)',
    descriptionRo:
      'Google sugerează linkuri suplimentare de navigare sub reclamă — un alt factor care ' +
      'crește scorul "Ad Strength". Nu afectează bugetul sau targetarea.',
    category: 'ad_quality',
    neverAutoApply: false,
    recommendedDefault: true,
  },

  // --- budget_bidding — always manual: real spend/bidding decisions ----
  {
    type: 'CAMPAIGN_BUDGET',
    labelRo: 'Crește bugetul zilnic',
    descriptionRo:
      'Decizie de cheltuială — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'FORECASTING_CAMPAIGN_BUDGET',
    labelRo: 'Crește bugetul (campanie predispusă să se blocheze)',
    descriptionRo:
      'Decizie de cheltuială — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'FORECASTING_SET_TARGET_CPA',
    labelRo: 'Setează cost-țintă pe conversie, înaintea unui vârf sezonier',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'FORECASTING_SET_TARGET_ROAS',
    labelRo: 'Crește bugetul și schimbă strategia, înaintea unui vârf sezonier',
    descriptionRo:
      'Decizie de buget/licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'ENHANCED_CPC_OPT_IN',
    labelRo: 'Activează licitarea automată "Enhanced CPC"',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'LOWER_TARGET_ROAS',
    labelRo: 'Scade ROAS-țintă',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'LOWER_TARGET_ROAS_PERFORMANCE_BID_TOO_LOW',
    labelRo: 'Scade ROAS-țintă (licitare prea conservatoare)',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'MARGINAL_ROI_CAMPAIGN_BUDGET',
    labelRo: 'Schimbă bugetul (randament marginal estimat)',
    descriptionRo: 'Decizie de buget — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'MAXIMIZE_CLICKS_OPT_IN',
    labelRo: 'Schimbă strategia de licitare pe "Maximizare clicuri"',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'MAXIMIZE_CONVERSIONS_OPT_IN',
    labelRo: 'Schimbă strategia de licitare pe "Maximizare conversii"',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'MAXIMIZE_CONVERSION_VALUE_OPT_IN',
    labelRo: 'Schimbă strategia de licitare pe "Maximizare valoare conversii"',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'MOVE_UNUSED_BUDGET',
    labelRo: 'Mută bugetul nefolosit către altă campanie',
    descriptionRo: 'Decizie de buget — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'RAISE_TARGET_CPA',
    labelRo: 'Crește cost-țintă pe conversie',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'RAISE_TARGET_CPA_BID_TOO_LOW',
    labelRo: 'Crește cost-țintă pe conversie (licitare prea mică)',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'RAISE_TARGET_CPA_PERFORMANCE_BID_TOO_LOW',
    labelRo: 'Crește cost-țintă pe conversie (căutare)',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'SET_TARGET_CPA',
    labelRo: 'Setează un cost-țintă pe conversie',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'SET_TARGET_ROAS',
    labelRo: 'Setează un ROAS-țintă',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'TARGET_CPA_OPT_IN',
    labelRo: 'Schimbă strategia de licitare pe "Cost-țintă pe conversie"',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'TARGET_ROAS_OPT_IN',
    labelRo: 'Schimbă strategia de licitare pe "ROAS-țintă"',
    descriptionRo:
      'Decizie de licitare — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'budget_bidding',
    neverAutoApply: true,
    recommendedDefault: false,
  },

  // --- targeting_reach — always manual: who sees the ad ----------------
  {
    type: 'CUSTOM_AUDIENCE_OPT_IN',
    labelRo: 'Activează targetarea pe o audiență personalizată',
    descriptionRo:
      'Schimbă cine vede reclama — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'targeting_reach',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'DISPLAY_EXPANSION_OPT_IN',
    labelRo: 'Extinde reclamele și pe rețeaua Display',
    descriptionRo:
      'Schimbă unde apare reclama (nu doar în căutare) — ignorată automat, nu ajunge nici la ' +
      '"Propuneri" (fără relevanță pentru o platformă de tip director local).',
    category: 'targeting_reach',
    neverAutoApply: true,
    silentlyIgnore: true,
    recommendedDefault: false,
  },
  {
    type: 'SEARCH_PARTNERS_OPT_IN',
    labelRo: 'Extinde reclamele și pe siturile partenere Google',
    descriptionRo:
      'Schimbă unde apare reclama — ignorată automat, nu ajunge nici la "Propuneri" (fără ' +
      'relevanță pentru o platformă de tip director local).',
    category: 'targeting_reach',
    neverAutoApply: true,
    silentlyIgnore: true,
    recommendedDefault: false,
  },
  {
    type: 'LEAD_FORM_ASSET',
    labelRo: 'Adaugă un formular de contact direct în reclamă',
    descriptionRo:
      'Ar schimba modul în care vizitatorii ajung la noi — formularul e găzduit de Google, nu ' +
      'trimite clicul pe site — apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'targeting_reach',
    neverAutoApply: true,
    recommendedDefault: false,
  },

  // --- keywords — always manual: risks the negative-keyword/anti-
  //     cannibalization system the structural pass itself enforces -------
  {
    type: 'KEYWORD',
    labelRo: 'Adaugă un cuvânt cheie nou',
    descriptionRo:
      'Ar putea intra în conflict cu sistemul de cuvinte cheie negative dintre subcategorii — ' +
      'apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'keywords',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'KEYWORD_MATCH_TYPE',
    labelRo: 'Lărgește tipul de potrivire al unui cuvânt cheie',
    descriptionRo:
      'Ar putea intra în conflict cu sistemul de cuvinte cheie negative dintre subcategorii — ' +
      'apare mereu la tab-ul "Propuneri" pentru aprobare manuală.',
    category: 'keywords',
    neverAutoApply: true,
    recommendedDefault: false,
  },
  {
    type: 'USE_BROAD_MATCH_KEYWORD',
    labelRo: 'Folosește potrivire largă + licitare automată pe conversii',
    descriptionRo:
      'Schimbare mare de targetare + licitare — ignorată automat, nu ajunge nici la "Propuneri" ' +
      '(ar intra direct în conflict cu targetarea pe județ a agentului).',
    category: 'keywords',
    neverAutoApply: true,
    silentlyIgnore: true,
    recommendedDefault: false,
  },

  // --- not_applicable — campaign types this platform never creates -----
  // (Shopping, Performance Max, Display/App, legacy text ads, customer-
  // match audiences, Google Tag deployment across company sites). Shown
  // collapsed as one line in the admin UI, not as individual rows.
  ...(
    [
      ['CAMPAIGN_SPECIFIC_APP_GOAL', 'Obiectiv de conversie pentru campanie de aplicație'],
      ['IMPROVE_DEMAND_GEN_AD_STRENGTH', 'Îmbunătățește reclame Demand Gen'],
      ['IMPROVE_GOOGLE_TAG_COVERAGE', 'Extinde acoperirea Google Tag pe site'],
      ['IMPROVE_PERFORMANCE_MAX_AD_STRENGTH', 'Îmbunătățește reclame Performance Max'],
      ['MIGRATE_DYNAMIC_SEARCH_ADS_CAMPAIGN_TO_PERFORMANCE_MAX', 'Migrează spre Performance Max'],
      ['PERFORMANCE_MAX_FINAL_URL_OPT_IN', 'Extindere URL pentru Performance Max'],
      ['PERFORMANCE_MAX_OPT_IN', 'Comută campania pe Performance Max'],
      ['REFRESH_CUSTOMER_MATCH_LIST', 'Reîmprospătează o listă de clienți'],
      ['SHOPPING_ADD_AGE_GROUP', 'Adaugă grupă de vârstă la produse (Shopping)'],
      ['SHOPPING_ADD_COLOR', 'Adaugă culoare la produse (Shopping)'],
      ['SHOPPING_ADD_GENDER', 'Adaugă gen la produse (Shopping)'],
      ['SHOPPING_ADD_GTIN', 'Adaugă cod GTIN la produse (Shopping)'],
      ['SHOPPING_ADD_MORE_IDENTIFIERS', 'Adaugă identificatori la produse (Shopping)'],
      ['SHOPPING_ADD_PRODUCTS_TO_CAMPAIGN', 'Adaugă produse în campanie (Shopping)'],
      ['SHOPPING_ADD_SIZE', 'Adaugă mărime la produse (Shopping)'],
      ['SHOPPING_FIX_DISAPPROVED_PRODUCTS', 'Repară produse respinse (Shopping)'],
      [
        'SHOPPING_FIX_MERCHANT_CENTER_ACCOUNT_SUSPENSION_WARNING',
        'Avertisment suspendare Merchant Center',
      ],
      ['SHOPPING_FIX_SUSPENDED_MERCHANT_CENTER_ACCOUNT', 'Cont Merchant Center suspendat'],
      [
        'SHOPPING_MIGRATE_REGULAR_SHOPPING_CAMPAIGN_OFFERS_TO_PERFORMANCE_MAX',
        'Migrează oferte Shopping spre Performance Max',
      ],
      ['SHOPPING_TARGET_ALL_OFFERS', 'Creează campanie Shopping pentru toate ofertele'],
      ['TEXT_AD', 'Adaugă o reclamă text clasică (tip vechi)'],
      [
        'UPGRADE_LOCAL_CAMPAIGN_TO_PERFORMANCE_MAX',
        'Migrează campanie locală spre Performance Max',
      ],
      [
        'UPGRADE_SMART_SHOPPING_CAMPAIGN_TO_PERFORMANCE_MAX',
        'Migrează Smart Shopping spre Performance Max',
      ],
    ] as const
  ).map(([type, labelRo]) => ({
    type,
    labelRo,
    descriptionRo: 'Nu se aplică campaniilor Search create de acest agent.',
    category: 'not_applicable' as const,
    neverAutoApply: true,
    recommendedDefault: false,
  })),
];

const CATALOG_BY_TYPE = new Map(
  GOOGLE_ADS_RECOMMENDATION_CATALOG.map((entry) => [entry.type, entry]),
);

/** A type Google returns that isn't (yet) in this catalog — always
 *  `neverAutoApply`, so a future Google addition fails safe (manual
 *  approval) rather than silently becoming auto-apply-eligible. */
export function getGoogleAdsRecommendationCatalogEntry(
  type: string,
): GoogleAdsRecommendationCatalogEntry {
  return (
    CATALOG_BY_TYPE.get(type) ?? {
      type,
      labelRo: type,
      descriptionRo: 'Tip de recomandare necunoscut — necesită aprobare manuală.',
      category: 'not_applicable',
      neverAutoApply: true,
      recommendedDefault: false,
    }
  );
}

/** Every type the agent must never auto-apply, regardless of the admin's
 *  setting — derived from the catalog so there is exactly one place this
 *  list is maintained (it used to be a hand-kept `Set` with a typo'd,
 *  non-existent enum value that silently did nothing, AND that didn't
 *  cover budget/bid/keyword types at all — those could previously have
 *  been auto-applied if an admin's old free-text allowlist happened to
 *  include one, contradicting this exact guarantee). */
export const NEVER_AUTO_APPLY_RECOMMENDATION_TYPES = new Set(
  GOOGLE_ADS_RECOMMENDATION_CATALOG.filter((e) => e.neverAutoApply).map((e) => e.type),
);

/** The small subset of `NEVER_AUTO_APPLY_RECOMMENDATION_TYPES` that's
 *  dropped entirely — never even reaching the "Propuneri" manual-approval
 *  queue. Everything else never-auto-apply still reaches that queue. */
export const SILENTLY_IGNORED_RECOMMENDATION_TYPES = new Set(
  GOOGLE_ADS_RECOMMENDATION_CATALOG.filter((e) => e.silentlyIgnore).map((e) => e.type),
);
