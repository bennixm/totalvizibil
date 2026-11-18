import { EngineTxn, runLedger, vatOf } from 'src/finance/ledger-engine';

let seq = 0;
function txn(partial: Partial<EngineTxn>): EngineTxn {
  seq++;
  return {
    id: `t${String(seq).padStart(4, '0')}`,
    walletId: 'w1',
    type: 'purchase',
    status: 'completed',
    amountMinor: 0,
    eurCents: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
    refundSources: null,
    feeMinor: null,
    provider: null,
    description: null,
    spendDay: null,
    vatRatePct: null,
    invoiceVoided: false,
    ...partial,
  };
}
const sum = (xs: { moneyMinor: number }[]) => xs.reduce((s, x) => s + x.moneyMinor, 0);

describe('ledger engine (FIFO revenue recognition)', () => {
  it('values consumed credits at the money paid for them, with the invoice VAT split out', () => {
    const { events, remaining } = runLedger([
      txn({ amountMinor: 10_000, eurCents: 10_000, vatRatePct: 21 }),
      txn({ type: 'spend', amountMinor: -3_000, spendDay: new Date('2026-01-01') }),
    ]);

    const cashIn = events.find((e) => e.kind === 'cashIn')!;
    expect(cashIn.moneyMinor).toBe(10_000);
    expect(cashIn.vatMinor).toBe(vatOf(10_000, 21)); // 1736

    const rev = events.filter((e) => e.kind === 'revenue');
    expect(rev).toHaveLength(1);
    expect(rev[0].category).toBe('cpc');
    expect(rev[0].moneyMinor).toBe(3_000);
    expect(rev[0].vatMinor).toBe(521); // 3000 * 21/121
    expect(remaining.paidMoneyMinor).toBe(7_000);
  });

  it('a discounted purchase yields proportionally less money per credit', () => {
    const { events } = runLedger([
      txn({ amountMinor: 10_000, eurCents: 8_000 }),
      txn({ type: 'spend', amountMinor: -5_000, provider: 'ai-usage' }),
    ]);
    const rev = events.filter((e) => e.kind === 'revenue');
    expect(rev[0].moneyMinor).toBe(4_000);
    expect(rev[0].category).toBe('aiUsage');
    // No invoice: VAT unknown, never guessed.
    expect(rev[0].vatKnown).toBe(false);
    expect(rev[0].vatMinor).toBe(0);
  });

  it('bonus / affiliate credits produce no revenue, consumed in FIFO order', () => {
    const { events } = runLedger([
      txn({ type: 'adjustment', amountMinor: 500 }), // bonus first (oldest)
      txn({ amountMinor: 1_000, eurCents: 1_000 }),
      txn({ type: 'spend', amountMinor: -1_200, spendDay: new Date('2026-01-01') }),
    ]);
    const free = events.filter((e) => e.kind === 'free');
    const rev = events.filter((e) => e.kind === 'revenue');
    expect(free.reduce((s, e) => s + e.creditsMinor, 0)).toBe(500);
    expect(rev.reduce((s, e) => s + e.creditsMinor, 0)).toBe(700);
    expect(sum(rev)).toBe(700);
  });

  it('a completed refund returns cash, keeps the fee as revenue, and reconciles to the cent', () => {
    const purchase = txn({ amountMinor: 10_000, eurCents: 10_000, vatRatePct: 21 });
    const { events, remaining } = runLedger([
      purchase,
      txn({ type: 'spend', amountMinor: -4_000, spendDay: new Date('2026-01-01') }),
      txn({
        type: 'refund',
        amountMinor: -6_000,
        feeMinor: 600,
        refundSources: [{ purchaseId: purchase.id, amountMinor: 6_000, moneyMinor: 6_000 }],
      }),
    ]);
    const cashOut = events.find((e) => e.kind === 'cashOut')!;
    const fee = events.find((e) => e.kind === 'refundFee')!;
    const rev = events.filter((e) => e.kind === 'revenue');
    expect(cashOut.moneyMinor).toBe(5_400);
    expect(fee.moneyMinor).toBe(600);
    expect(sum(rev)).toBe(4_000);
    // collected = earned + returned + kept fee + still owed
    expect(10_000).toBe(sum(rev) + cashOut.moneyMinor + fee.moneyMinor + remaining.paidMoneyMinor);
    expect(remaining.paidMoneyMinor).toBe(0);
  });

  it('a pending refund holds its credits (balance) but moves no cash yet; a canceled one is ignored', () => {
    const p = txn({ amountMinor: 10_000, eurCents: 10_000 });
    const { events, balanceByWallet } = runLedger([
      p,
      txn({
        type: 'refund',
        status: 'pending',
        amountMinor: -2_000,
        refundSources: [{ purchaseId: p.id, amountMinor: 2_000, moneyMinor: 2_000 }],
      }),
      txn({
        type: 'refund',
        status: 'canceled',
        amountMinor: -3_000,
        refundSources: [{ purchaseId: p.id, amountMinor: 3_000, moneyMinor: 3_000 }],
      }),
    ]);
    expect(events.some((e) => e.kind === 'cashOut')).toBe(false);
    expect(balanceByWallet.get('w1')).toBe(8_000);
  });

  it('a voided-invoice purchase brings in no cash and its consumption is not revenue', () => {
    const { events } = runLedger([
      txn({ amountMinor: 1_000, eurCents: 1_000, invoiceVoided: true, vatRatePct: 21 }),
      txn({ type: 'spend', amountMinor: -400, spendDay: new Date('2026-01-01') }),
    ]);
    expect(events.some((e) => e.kind === 'cashIn')).toBe(false);
    expect(events.filter((e) => e.kind === 'voided')[0].creditsMinor).toBe(400);
    expect(events.some((e) => e.kind === 'revenue')).toBe(false);
  });

  it('flags consumption with no credits behind it', () => {
    const { events, balanceByWallet } = runLedger([
      txn({ type: 'spend', amountMinor: -250, spendDay: new Date('2026-01-01') }),
    ]);
    expect(events[0].kind).toBe('unmatched');
    expect(balanceByWallet.get('w1')).toBe(-250);
  });

  it('never drifts by rounding: the slices of a lot add back to exactly its money', () => {
    const { events } = runLedger([
      txn({ amountMinor: 300, eurCents: 100 }),
      txn({ type: 'spend', amountMinor: -100, provider: 'x' }),
      txn({ type: 'spend', amountMinor: -100, provider: 'x' }),
      txn({ type: 'spend', amountMinor: -100, provider: 'x' }),
    ]);
    expect(sum(events.filter((e) => e.kind === 'revenue'))).toBe(100);
  });

  it('a negative admin adjustment removes credits as a forfeit, never as revenue', () => {
    const { events, balanceByWallet } = runLedger([
      txn({ amountMinor: 1_000, eurCents: 1_000 }),
      txn({ type: 'adjustment', amountMinor: -300 }),
    ]);
    const f = events.filter((e) => e.kind === 'forfeit');
    expect(f[0].moneyMinor).toBe(300);
    expect(events.some((e) => e.kind === 'revenue')).toBe(false);
    expect(balanceByWallet.get('w1')).toBe(700);
  });

  it('keeps wallets independent', () => {
    const { balanceByWallet } = runLedger([
      txn({ walletId: 'a', amountMinor: 1_000, eurCents: 1_000 }),
      txn({ walletId: 'b', type: 'adjustment', amountMinor: 50 }),
      txn({ walletId: 'a', type: 'spend', amountMinor: -100, provider: 'x' }),
    ]);
    expect(balanceByWallet.get('a')).toBe(900);
    expect(balanceByWallet.get('b')).toBe(50);
  });
});
