/**
 * The accounting engine behind the financial statement.
 *
 * Why it exists: a wallet is a fungible pool of credits, but credits do not
 * all carry the same money. A purchased credit carries what the customer paid
 * for it (less during a discount, and part of it is VAT owed to the state),
 * a bonus/affiliate credit carries no money at all. Revenue is only EARNED
 * when a credit is consumed (a click billed, an AI prompt, a builder unlock);
 * until then the money is a customer advance that may still be refunded.
 *
 * So every wallet's ledger is replayed in order, keeping each purchase and
 * each free grant as its own "lot", and every consumption takes credits from
 * the oldest lots first (FIFO, a standard and declared costing policy). That
 * tells, exactly and reproducibly, how much REAL money (and VAT) sits behind
 * every consumed credit, instead of guessing it with an average ratio.
 *
 * Pure functions only (no Prisma), so the rules are unit-testable.
 */

export type EngineTxnType = 'purchase' | 'spend' | 'refund' | 'adjustment';
export type EngineTxnStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'canceled';
export type ConsumptionCategory = 'cpc' | 'aiUsage' | 'builderUnlock' | 'googleAds' | 'other';

export interface EngineTxn {
  id: string;
  walletId: string;
  type: EngineTxnType;
  status: EngineTxnStatus;
  /** Signed credit minor units (1 credit = 1 EUR, so EUR cents). */
  amountMinor: number;
  /** Purchases: real EUR cents charged (null on legacy rows). */
  eurCents: number | null;
  createdAt: Date;
  refundSources: unknown;
  feeMinor: number | null;
  provider: string | null;
  description: string | null;
  spendDay: Date | null;
  /** Purchases: the VAT rate of the invoice issued for it, null = no invoice. */
  vatRatePct: number | null;
  /** Purchases: the invoice was voided (sale annulled). */
  invoiceVoided: boolean;
}

/**
 * One accounting fact produced by the replay.
 *  - cashIn       money collected for a purchase (VAT included)
 *  - cashOut      money sent back by a completed refund
 *  - revenue      a paid credit was consumed: revenue earned
 *  - refundFee    the processing fee kept out of a refund: revenue earned
 *  - free         a bonus / affiliate / admin credit was consumed: no money
 *  - voided       a credit from a purchase whose invoice was voided was consumed
 *  - forfeit      an admin removed credits (negative adjustment)
 *  - unmatched    consumption with no credits behind it (data anomaly)
 */
export type EngineEventKind =
  'cashIn' | 'cashOut' | 'revenue' | 'refundFee' | 'free' | 'voided' | 'forfeit' | 'unmatched';

export interface EngineEvent {
  at: Date;
  kind: EngineEventKind;
  category: ConsumptionCategory | null;
  walletId: string;
  txnId: string;
  creditsMinor: number;
  /** Real money, VAT included (EUR cents). */
  moneyMinor: number;
  /** The VAT part of `moneyMinor`; 0 when the rate is unknown. */
  vatMinor: number;
  /** False when the money comes from a purchase that has no invoice yet. */
  vatKnown: boolean;
}

export interface LotSnapshot {
  paidCreditsMinor: number;
  paidMoneyMinor: number;
  paidVatMinor: number;
  /** Money behind paid credits whose VAT rate is unknown (no invoice). */
  paidMoneyVatUnknownMinor: number;
  freeCreditsMinor: number;
  voidedCreditsMinor: number;
}

export interface EngineResult {
  events: EngineEvent[];
  /** Remaining credits per wallet after the replay (what the ledger says
   *  the balance should be). */
  balanceByWallet: Map<string, number>;
  /** What is left in every lot, summed: the customer advances still owed. */
  remaining: LotSnapshot;
}

interface Lot {
  id: string;
  kind: 'paid' | 'free' | 'voided';
  credits: number;
  money: number;
  vatRatePct: number | null;
}

/** Mirrors `wallet.service.ts`'s classification of non-CPC spend rows. */
export const AI_USAGE_PROVIDER = 'ai-usage';
export const BUILDER_UNLOCK_DESCRIPTION = 'Advanced website builder';
/** Customers' Google Ads optimization cycles (google-ads-user/). */
export const GOOGLE_ADS_OPTIMIZER_PROVIDER = 'google-ads-optimizer';

export function consumptionCategory(t: {
  spendDay: Date | null;
  provider: string | null;
  description: string | null;
}): ConsumptionCategory {
  if (t.spendDay) return 'cpc';
  if (t.provider === AI_USAGE_PROVIDER) return 'aiUsage';
  if (t.provider === GOOGLE_ADS_OPTIMIZER_PROVIDER) return 'googleAds';
  if (t.provider === null && t.description === BUILDER_UNLOCK_DESCRIPTION) return 'builderUnlock';
  return 'other';
}

/** VAT included in a gross amount at `ratePct` (rounded to the cent). */
export function vatOf(grossMinor: number, ratePct: number | null): number {
  if (!ratePct || ratePct <= 0) return 0;
  return Math.round((grossMinor * ratePct) / (100 + ratePct));
}

export function parseSources(
  json: unknown,
): { purchaseId: string | null; amountMinor: number; moneyMinor: number }[] {
  if (!Array.isArray(json)) return [];
  const out: { purchaseId: string | null; amountMinor: number; moneyMinor: number }[] = [];
  for (const s of json) {
    if (typeof s !== 'object' || s === null) continue;
    const o = s as Record<string, unknown>;
    if (typeof o.amountMinor !== 'number') continue;
    out.push({
      purchaseId: typeof o.purchaseId === 'string' ? o.purchaseId : null,
      amountMinor: o.amountMinor,
      moneyMinor: typeof o.moneyMinor === 'number' ? o.moneyMinor : o.amountMinor,
    });
  }
  return out;
}

/** Takes `credits` out of one lot; the last slice takes the remaining money
 *  so a lot's money always sums back exactly (no rounding drift). */
function takeFromLot(lot: Lot, credits: number): number {
  if (credits >= lot.credits) {
    const money = lot.money;
    lot.credits = 0;
    lot.money = 0;
    return money;
  }
  const money = Math.round((credits * lot.money) / lot.credits);
  lot.credits -= credits;
  lot.money -= money;
  return money;
}

/** The order the replay processes rows in: time, then id (deterministic). */
export function compareTxns(a: EngineTxn, b: EngineTxn): number {
  const d = a.createdAt.getTime() - b.createdAt.getTime();
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Replays every wallet's ledger. `txns` may come in any order and may mix
 * wallets; rows that never moved a balance (pending/failed purchases,
 * canceled/failed refunds) are ignored.
 */
export function runLedger(txns: EngineTxn[]): EngineResult {
  const events: EngineEvent[] = [];
  const lotsByWallet = new Map<string, Lot[]>();
  const lotById = new Map<string, Lot>();
  const unmatchedByWallet = new Map<string, number>();
  const sorted = [...txns].sort(compareTxns);

  const lotsOf = (walletId: string): Lot[] => {
    let lots = lotsByWallet.get(walletId);
    if (!lots) {
      lots = [];
      lotsByWallet.set(walletId, lots);
    }
    return lots;
  };

  const emit = (
    t: EngineTxn,
    kind: EngineEventKind,
    credits: number,
    money: number,
    ratePct: number | null,
    category: ConsumptionCategory | null,
  ) => {
    events.push({
      at: t.createdAt,
      kind,
      category,
      walletId: t.walletId,
      txnId: t.id,
      creditsMinor: credits,
      moneyMinor: money,
      vatMinor: vatOf(money, ratePct),
      vatKnown: ratePct !== null,
    });
  };

  /** FIFO consumption. Paid slices become `paidKind` events, free/voided
   *  slices their own kinds, and anything beyond the lots is `unmatched`. */
  const consume = (
    t: EngineTxn,
    credits: number,
    paidKind: 'revenue' | 'forfeit',
    category: ConsumptionCategory | null,
  ) => {
    let left = credits;
    for (const lot of lotsOf(t.walletId)) {
      if (left <= 0) break;
      if (lot.credits <= 0) continue;
      const slice = Math.min(left, lot.credits);
      const money = takeFromLot(lot, slice);
      left -= slice;
      if (lot.kind === 'paid') emit(t, paidKind, slice, money, lot.vatRatePct, category);
      else if (lot.kind === 'free')
        emit(t, paidKind === 'forfeit' ? 'forfeit' : 'free', slice, 0, null, category);
      else emit(t, paidKind === 'forfeit' ? 'forfeit' : 'voided', slice, 0, null, category);
    }
    if (left > 0) {
      emit(t, 'unmatched', left, 0, null, category);
      unmatchedByWallet.set(t.walletId, (unmatchedByWallet.get(t.walletId) ?? 0) + left);
    }
  };

  for (const t of sorted) {
    const lots = lotsOf(t.walletId);

    if (t.type === 'purchase') {
      if (t.status !== 'completed' || t.amountMinor <= 0) continue;
      const money = t.eurCents ?? t.amountMinor;
      const lot: Lot = {
        id: t.id,
        kind: t.invoiceVoided ? 'voided' : 'paid',
        credits: t.amountMinor,
        money: t.invoiceVoided ? 0 : money,
        vatRatePct: t.vatRatePct,
      };
      lots.push(lot);
      lotById.set(t.id, lot);
      if (!t.invoiceVoided) emit(t, 'cashIn', t.amountMinor, money, t.vatRatePct, null);
      continue;
    }

    if (t.type === 'adjustment') {
      if (t.status !== 'completed' || t.amountMinor === 0) continue;
      if (t.amountMinor > 0) {
        lots.push({ id: t.id, kind: 'free', credits: t.amountMinor, money: 0, vatRatePct: null });
      } else {
        consume(t, -t.amountMinor, 'forfeit', null);
      }
      continue;
    }

    if (t.type === 'spend') {
      if (t.status !== 'completed' || t.amountMinor === 0) continue;
      const category = consumptionCategory(t);
      if (t.amountMinor < 0) consume(t, -t.amountMinor, 'revenue', category);
      // A positive spend row would be a reversal; it gives credits back
      // without money, so it is booked like a free grant.
      else
        lots.push({ id: t.id, kind: 'free', credits: t.amountMinor, money: 0, vatRatePct: null });
      continue;
    }

    // Refunds: the balance is debited when the refund is REQUESTED (pending)
    // and given back if it is canceled or fails, so pending / processing /
    // completed rows all hold their credits; canceled / failed never did.
    if (t.status === 'canceled' || t.status === 'failed') continue;
    const credits = Math.abs(t.amountMinor);
    const sources = parseSources(t.refundSources);
    let left = credits;
    let lotMoney = 0;
    let weightedRateMoney = 0;
    let rateKnownMoney = 0;
    let rate: number | null = null;
    const takeLot = (lot: Lot, want: number) => {
      const slice = Math.min(want, lot.credits);
      if (slice <= 0) return 0;
      const money = takeFromLot(lot, slice);
      lotMoney += money;
      if (lot.vatRatePct !== null) {
        rateKnownMoney += money;
        weightedRateMoney += money * lot.vatRatePct;
      }
      return slice;
    };
    // The lots the refund was actually charged against first …
    for (const s of sources) {
      if (left <= 0) break;
      const lot = s.purchaseId ? lotById.get(s.purchaseId) : undefined;
      if (lot && lot.credits > 0) left -= takeLot(lot, Math.min(s.amountMinor, left));
    }
    // … then FIFO for anything those lots no longer held.
    for (const lot of lots) {
      if (left <= 0) break;
      if (lot.credits > 0) left -= takeLot(lot, left);
    }
    if (rateKnownMoney > 0) rate = Math.round(weightedRateMoney / rateKnownMoney);
    const rateKnown = lotMoney > 0 && rateKnownMoney === lotMoney;

    if (t.status !== 'completed') continue;
    // Real cash sent back: the money behind each source minus the fee kept.
    const fee = t.feeMinor ?? 0;
    const sourceMoney = sources.reduce((s, x) => s + x.moneyMinor, 0);
    const cashOut = Math.max(0, sourceMoney - fee);
    emit(t, 'cashOut', credits, cashOut, rateKnown ? rate : null, null);
    // Whatever the lots carried beyond the cash returned stays with the
    // platform: normally exactly the processing fee.
    const kept = lotMoney - cashOut;
    if (kept !== 0) emit(t, 'refundFee', 0, kept, rateKnown ? rate : null, null);
  }

  const balanceByWallet = new Map<string, number>();
  const remaining: LotSnapshot = {
    paidCreditsMinor: 0,
    paidMoneyMinor: 0,
    paidVatMinor: 0,
    paidMoneyVatUnknownMinor: 0,
    freeCreditsMinor: 0,
    voidedCreditsMinor: 0,
  };
  for (const [walletId, lots] of lotsByWallet) {
    let bal = 0;
    for (const lot of lots) {
      bal += lot.credits;
      if (lot.kind === 'paid') {
        remaining.paidCreditsMinor += lot.credits;
        remaining.paidMoneyMinor += lot.money;
        if (lot.vatRatePct === null) remaining.paidMoneyVatUnknownMinor += lot.money;
        else remaining.paidVatMinor += vatOf(lot.money, lot.vatRatePct);
      } else if (lot.kind === 'free') remaining.freeCreditsMinor += lot.credits;
      else remaining.voidedCreditsMinor += lot.credits;
    }
    // Unmatched consumption took credits the wallet never had.
    balanceByWallet.set(walletId, bal - (unmatchedByWallet.get(walletId) ?? 0));
  }

  return { events, balanceByWallet, remaining };
}
