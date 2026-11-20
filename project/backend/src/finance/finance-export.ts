import type { BalanceSnapshot, FinancialStatement, MissingInfo } from './finance-statement.service';

/**
 * Labels and line layout shared by every financial export (PDF / CSV /
 * XLSX), so the three formats always list the same lines, in the same order,
 * with the same figures as the dashboard's statement.
 */

export const EXPENSE_CATEGORY_RO: Record<string, string> = {
  hosting: 'Hosting / servere',
  call_center: 'Call center',
  cloud_storage: 'Stocare cloud',
  domains: 'Domenii',
  google_ads: 'Google Ads (cost real)',
  stripe_fees: 'Comisioane Stripe',
  other: 'Alte cheltuieli',
};

export const EXPENSE_SOURCE_RO: Record<string, string> = {
  manual: 'Manual',
  stripe_api: 'Automat (Stripe)',
  google_ads_api: 'Automat (Google Ads)',
};

export const TXN_TYPE_RO: Record<string, string> = {
  purchase: 'Încărcare',
  refund: 'Rambursare',
  adjustment: 'Ajustare',
  spend: 'Consum',
};

export const TXN_STATUS_RO: Record<string, string> = {
  pending: 'În așteptare',
  processing: 'În procesare',
  completed: 'Finalizată',
  failed: 'Eșuată',
  canceled: 'Anulată',
};

export const CONSUMPTION_RO: Record<string, string> = {
  cpc: 'Clicuri CPC',
  aiUsage: 'Consum AI',
  builderUnlock: 'Deblocare builder',
  googleAds: 'Optimizare Google Ads',
  other: 'Alte servicii',
};

/** Minor units → "1.234,56 €" (PDF text). */
export function eurText(minor: number): string {
  return `${(minor / 100).toLocaleString('ro-RO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

/** Minor units → EUR number with 2 decimals (CSV / XLSX cells). */
export function eurNum(minor: number): number {
  return Math.round(minor) / 100;
}

export function dayRo(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return x.toISOString().slice(0, 10).split('-').reverse().join('.');
}

export interface StatementLine {
  label: string;
  /** EUR minor units; null for a section header / text line. */
  amountMinor: number | null;
  bold?: boolean;
  /** Free text instead of an amount (e.g. a margin %). */
  text?: string;
}

export function missingNoteRo(m: MissingInfo): string {
  switch (m.key) {
    case 'vatUnknown':
      return `TVA neconfirmat: ${eurText(m.amountMinor ?? 0)} din încasările sau veniturile perioadei provin din plăți fără factură emisă, deci cota TVA nu este documentată. Sumele sunt incluse integral, fără TVA dedus, până la emiterea facturii.`;
    case 'expenseFx':
      return `${m.count ?? 0} cheltuieli în altă monedă nu au curs de schimb și NU sunt incluse în totaluri. Completați cursul la fiecare cheltuială.`;
    case 'aiEstimated':
      return `Costul AI (${eurText(m.amountMinor ?? 0)}) este estimat din tokeni la prețul de listă al furnizorului, în USD tratat 1:1 cu EUR. Factura reală a furnizorului este sursa exactă; nu o introduceți și ca cheltuială manuală, ca să nu fie numărată de două ori.`;
    case 'unmatched':
      return `Consum fără credite în spate în registru: ${eurText(m.amountMinor ?? 0)} (anomalie de date, vezi Verificări).`;
    case 'forfeit':
      return `Credite plătite retrase manual de admin: ${eurText(m.amountMinor ?? 0)}. Nu sunt incluse în venituri, pentru că din date nu reiese dacă banii au fost returnați în afara platformei.`;
    case 'expenseVat':
      return 'Cheltuielile sunt înregistrate cu suma totală a documentului; TVA-ul deductibil nu este separat, deci profitul este calculat cu cheltuieli brute.';
    case 'incomeTax':
      return 'Impozitul pe profit / pe venit nu este calculat (regimul fiscal al firmei nu este configurat în platformă). Profitul afișat este înainte de impozit.';
  }
}

/** `counts: false` gives every statement the exact same lines (no counts in
 *  labels, no optional rows), so monthly statements line up as a matrix. */
export function statementLines(
  st: FinancialStatement,
  balance: BalanceSnapshot | null,
  opts: { counts?: boolean } = {},
): StatementLine[] {
  const counts = opts.counts !== false;
  const L: StatementLine[] = [];
  const head = (label: string) => L.push({ label, amountMinor: null, bold: true });
  const row = (label: string, amountMinor: number, bold = false) =>
    L.push({ label, amountMinor, bold });

  head('1. ÎNCASĂRI (CASH)');
  row(
    `Încasări din vânzarea creditelor, cu TVA${counts ? ` (${st.cash.purchaseCount} plăți)` : ''}`,
    st.cash.collectedMinor,
  );
  row(
    `Rambursări plătite clienților${counts ? ` (${st.cash.refundCount})` : ''}`,
    0 - st.cash.refundedMinor,
  );
  row('Încasări nete, cu TVA', st.cash.netMinor, true);
  row('din care TVA colectat (datorat statului)', st.cash.netVatMinor);
  row('Încasări nete fără TVA', st.cash.netExVatMinor, true);
  if (st.cash.vatUnknownMinor !== 0 || !counts) {
    row('din care încasări fără factură (TVA neconfirmat)', st.cash.vatUnknownMinor);
  }
  row('Valoarea nominală a creditelor vândute', st.cash.faceValueSoldMinor);
  row('Reduceri acordate la cumpărare', st.cash.discountMinor);

  head('2. VENITURI REALIZATE (servicii prestate, fără TVA)');
  for (const k of ['cpc', 'aiUsage', 'builderUnlock', 'googleAds', 'other'] as const) {
    row(CONSUMPTION_RO[k], st.revenue.byCategory[k]);
  }
  row('Comisioane reținute din rambursări', st.revenue.refundFeesMinor);
  row('Total venituri realizate', st.revenue.totalNetMinor, true);
  row('TVA aferent veniturilor realizate', st.revenue.totalVatMinor);

  head('3. CHELTUIELI');
  for (const [k, v] of Object.entries(st.expenses.byCategory)) row(EXPENSE_CATEGORY_RO[k] ?? k, v);
  row('Cost AI: website builder (estimat)', st.expenses.ai.builderMinor);
  row('Cost AI: agent campanii Google Ads (estimat)', st.expenses.ai.campaignAgentMinor);
  row('Cost AI: optimizare Google Ads clienți (estimat)', st.expenses.ai.googleAdsOptimizerMinor);
  row('Cost AI: căutare pagina principală (estimat)', st.expenses.ai.searchMinor);
  row('Total cheltuieli', st.expenses.totalMinor, true);

  head('4. REZULTAT');
  row(
    'Profit operațional (venituri realizate - cheltuieli), înainte de impozit',
    st.result.operatingProfitMinor,
    true,
  );
  L.push({
    label: 'Marjă operațională',
    amountMinor: null,
    text: st.result.marginPct === null ? '-' : `${st.result.marginPct.toLocaleString('ro-RO')}%`,
  });
  row(
    'Rezultat pe bază de încasări (încasări nete fără TVA - cheltuieli)',
    st.result.cashResultMinor,
  );

  head('5. ELEMENTE FĂRĂ ÎNCASARE (informativ, valoare nominală)');
  row(
    'Credite gratuite consumate (bonus, afiliere, ajustări)',
    st.nonCash.freeCreditsConsumedMinor,
  );
  row('Credite din facturi anulate, consumate', st.nonCash.voidedCreditsConsumedMinor);
  row('Credite retrase manual de admin', st.nonCash.forfeitedCreditsMinor);

  if (balance) {
    head(`6. OBLIGAȚII FAȚĂ DE CLIENȚI LA ${dayRo(balance.asOf)}`);
    row(
      'Avansuri clienți: bani încasați pentru credite neconsumate (cu TVA)',
      balance.advancesMoneyMinor,
      true,
    );
    row('din care TVA', balance.advancesVatMinor);
    row('Credite plătite neconsumate (valoare nominală)', balance.unconsumedPaidCreditsMinor);
    row('Credite gratuite neconsumate (valoare nominală)', balance.unconsumedFreeCreditsMinor);
  }
  return L;
}

/** The compact per-month columns of the annual report. */
export const MONTHLY_COLUMNS: { label: string; pick: (s: FinancialStatement) => number }[] = [
  { label: 'Încasări nete cu TVA', pick: (s) => s.cash.netMinor },
  { label: 'TVA colectat', pick: (s) => s.cash.netVatMinor },
  { label: 'Încasări fără TVA', pick: (s) => s.cash.netExVatMinor },
  { label: 'Venituri realizate', pick: (s) => s.revenue.totalNetMinor },
  { label: 'Cheltuieli', pick: (s) => s.expenses.totalMinor },
  { label: 'Profit operațional', pick: (s) => s.result.operatingProfitMinor },
  { label: 'Rezultat cash', pick: (s) => s.result.cashResultMinor },
];

export const MONTHS_RO = [
  'Ianuarie',
  'Februarie',
  'Martie',
  'Aprilie',
  'Mai',
  'Iunie',
  'Iulie',
  'August',
  'Septembrie',
  'Octombrie',
  'Noiembrie',
  'Decembrie',
];
