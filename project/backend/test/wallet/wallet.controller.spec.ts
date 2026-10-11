import { WalletController } from 'src/wallet/wallet.controller';

const user = { id: 'u1', name: 'Ion', email: 'ion@example.com', sessionId: 's1', platformRoles: [], emailVerifiedAt: null };

function fakeWallet() {
  return {
    getSummary: jest.fn().mockResolvedValue({ balance: { minor: 0, credits: 0, display: '0' }, currency: 'RON', eurRonRate: 5.05 }),
    fx: jest.fn().mockResolvedValue({ currency: 'RON', eurRonRate: 5.05 }),
    setCurrency: jest.fn().mockResolvedValue({ currency: 'EUR' }),
    listTransactions: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    spendBreakdownFor: jest.fn().mockResolvedValue({ items: [] }),
    consumptionLedgerFor: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listPayments: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    exportPaymentsPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    startPurchase: jest.fn().mockResolvedValue({ txnId: 'txn1' }),
    confirmPurchase: jest.fn().mockResolvedValue({ ok: true }),
    requestRefund: jest.fn().mockResolvedValue({ ok: true }),
    cancelRefund: jest.fn().mockResolvedValue({ ok: true }),
  };
}

function makeController() {
  const wallet = fakeWallet();
  const ctrl = new WalletController(wallet as any);
  return { ctrl, wallet };
}

describe('WalletController', () => {
  it('get → delegates to wallet.getSummary with userId', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.get(user as any);
    expect(wallet.getSummary).toHaveBeenCalledWith('u1');
  });

  it('fx → delegates to wallet.fx with userId', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.fx(user as any);
    expect(wallet.fx).toHaveBeenCalledWith('u1');
  });

  it('setCurrency → delegates to wallet.setCurrency', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.setCurrency(user as any, { currency: 'EUR' });
    expect(wallet.setCurrency).toHaveBeenCalledWith('u1', 'EUR');
  });

  it('transactions → forwards all query params', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.transactions(user as any, '10', 'cursor1', 'co1', 'credit', 'click', '2024-01-01', '2024-12-31', 'foo');
    expect(wallet.listTransactions).toHaveBeenCalledWith('u1', {
      limit: 10,
      cursor: 'cursor1',
      companyId: 'co1',
      type: 'credit',
      category: 'click',
      from: '2024-01-01',
      to: '2024-12-31',
      search: 'foo',
    });
  });

  it('payments → defaults kind to "purchase" when not provided', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.payments(user as any, undefined, '5', 'c1', '2024-01-01', '2024-12-31');
    expect(wallet.listPayments).toHaveBeenCalledWith('u1', {
      kind: 'purchase',
      limit: 5,
      cursor: 'c1',
      from: '2024-01-01',
      to: '2024-12-31',
    });
  });

  it('payments → passes kind "refund" when provided', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.payments(user as any, 'refund');
    expect(wallet.listPayments).toHaveBeenCalledWith('u1', expect.objectContaining({ kind: 'refund' }));
  });

  it('buy → delegates to wallet.startPurchase with credits', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.buy(user as any, { credits: 50 });
    expect(wallet.startPurchase).toHaveBeenCalledWith('u1', 50);
  });

  it('confirm → delegates to wallet.confirmPurchase', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.confirm(user as any, 'txn1');
    expect(wallet.confirmPurchase).toHaveBeenCalledWith('u1', 'txn1');
  });

  it('requestRefund → delegates to wallet.requestRefund with credits', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.requestRefund(user as any, { credits: 10 });
    expect(wallet.requestRefund).toHaveBeenCalledWith('u1', 10);
  });

  it('cancelRefund → delegates to wallet.cancelRefund with refundId', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.cancelRefund(user as any, 'ref1');
    expect(wallet.cancelRefund).toHaveBeenCalledWith('u1', 'ref1');
  });

  it('spendBreakdown → delegates with userId + companyId', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.spendBreakdown(user as any, 'co1');
    expect(wallet.spendBreakdownFor).toHaveBeenCalledWith('u1', 'co1');
  });

  it('consumption → forwards all query params', async () => {
    const { ctrl, wallet } = makeController();
    await ctrl.consumption(user as any, 'co1', 'click', '2024-01-01', '2024-12-31', 'foo', 'cur1', '20');
    expect(wallet.consumptionLedgerFor).toHaveBeenCalledWith('u1', 'co1', {
      category: 'click',
      from: '2024-01-01',
      to: '2024-12-31',
      search: 'foo',
      cursor: 'cur1',
      limit: 20,
    });
  });
});
