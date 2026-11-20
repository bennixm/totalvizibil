import { FinanceStatementService } from 'src/finance/finance-statement.service';
import { EngineTxn, runLedger } from 'src/finance/ledger-engine';
import { statementLines } from 'src/finance/finance-export';

const JAN = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-31T23:59:59.999Z') };

let seq = 0;
function txn(partial: Partial<EngineTxn>): EngineTxn {
  seq++;
  return {
    id: `s${String(seq).padStart(4, '0')}`,
    walletId: 'w1',
    type: 'purchase',
    status: 'completed',
    amountMinor: 0,
    eurCents: null,
    createdAt: new Date(Date.UTC(2026, 0, 10, 0, 0, seq)),
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
const noCosts = () => ({ expenses: [], ai: [], agent: [], search: [], optimizer: [] });
const svc = new FinanceStatementService(null as any);

describe('FinanceStatementService.buildStatement', () => {
  it('splits cash into VAT and net, and earned revenue (ex-VAT) by service line', () => {
    const p = txn({ amountMinor: 12_100, eurCents: 12_100, vatRatePct: 21 });
    const { events } = runLedger([
      p,
      txn({ type: 'spend', amountMinor: -6_050, spendDay: new Date('2026-01-10') }),
      txn({
        type: 'spend',
        amountMinor: -1_210,
        provider: null,
        description: 'Advanced website builder',
      }),
    ]);

    const st = svc.buildStatement(events, noCosts(), JAN);

    expect(st.cash.collectedMinor).toBe(12_100);
    expect(st.cash.netVatMinor).toBe(2_100);
    expect(st.cash.netExVatMinor).toBe(10_000);
    expect(st.revenue.byCategory.cpc).toBe(5_000);
    expect(st.revenue.byCategory.builderUnlock).toBe(1_000);
    expect(st.revenue.totalNetMinor).toBe(6_000);
    expect(st.revenue.totalVatMinor).toBe(1_260);
    expect(st.result.operatingProfitMinor).toBe(6_000);
    expect(st.missing.map((m) => m.key)).not.toContain('vatUnknown');
  });

  it('subtracts every expense in EUR, leaves rate-less foreign documents out and says so', () => {
    const st = svc.buildStatement(
      [],
      {
        expenses: [
          {
            id: '1',
            category: 'hosting',
            incurredOn: new Date('2026-01-05'),
            amountMinor: 2_000,
            currency: 'EUR',
            eurAmountMinor: null,
            source: 'manual',
            note: null,
          },
          {
            id: '2',
            category: 'domains',
            incurredOn: new Date('2026-01-06'),
            amountMinor: 4_975,
            currency: 'RON',
            eurAmountMinor: 1_000,
            source: 'manual',
            note: null,
          },
          {
            id: '3',
            category: 'other',
            incurredOn: new Date('2026-01-07'),
            amountMinor: 9_999,
            currency: 'USD',
            eurAmountMinor: null,
            source: 'manual',
            note: null,
          },
          // Outside the period: ignored.
          {
            id: '4',
            category: 'hosting',
            incurredOn: new Date('2026-02-01'),
            amountMinor: 5_000,
            currency: 'EUR',
            eurAmountMinor: null,
            source: 'manual',
            note: null,
          },
        ],
        ai: Array.from({ length: 10 }, () => ({
          estimatedCostUsd: 0.001,
          createdAt: new Date('2026-01-08'),
        })),
        agent: [{ claudeCostEstimateMinor: 250, startedAt: new Date('2026-01-09') }],
        search: [{ day: new Date('2026-01-09'), aiCostUsd: 0.5 }],
        optimizer: [],
      },
      JAN,
    );

    expect(st.expenses.byCategory.hosting).toBe(2_000);
    expect(st.expenses.byCategory.domains).toBe(1_000);
    expect(st.expenses.byCategory.other).toBe(0);
    expect(st.expenses.missingFx).toEqual({ count: 1, byCurrency: { USD: 9_999 } });
    // 10 x $0.001 summed first, rounded once = 1 cent.
    expect(st.expenses.ai).toEqual({
      builderMinor: 1,
      campaignAgentMinor: 250,
      googleAdsOptimizerMinor: 0,
      searchMinor: 50,
      totalMinor: 301,
    });
    expect(st.expenses.totalMinor).toBe(3_301);
    expect(st.result.operatingProfitMinor).toBe(-3_301);
    const keys = st.missing.map((m) => m.key);
    expect(keys).toEqual(
      expect.arrayContaining(['expenseFx', 'aiEstimated', 'incomeTax', 'expenseVat']),
    );
  });

  it('flags revenue whose VAT is unknown (no invoice) instead of guessing a rate', () => {
    const { events } = runLedger([
      txn({ amountMinor: 1_000, eurCents: 1_000 }),
      txn({ type: 'spend', amountMinor: -1_000, provider: 'x' }),
    ]);
    const st = svc.buildStatement(events, noCosts(), JAN);
    expect(st.cash.vatUnknownMinor).toBe(1_000);
    expect(st.revenue.vatUnknownGrossMinor).toBe(1_000);
    expect(st.missing.find((m) => m.key === 'vatUnknown')).toMatchObject({ count: 1 });
  });

  it('every month of the matrix export has the same lines (they line up)', () => {
    const a = svc.buildStatement([], noCosts(), JAN);
    const { events } = runLedger([txn({ amountMinor: 1_000, eurCents: 1_000 })]);
    const b = svc.buildStatement(events, noCosts(), JAN);
    const la = statementLines(a, null, { counts: false }).map((l) => l.label);
    const lb = statementLines(b, null, { counts: false }).map((l) => l.label);
    expect(la).toEqual(lb);
  });
});

describe('FinanceStatementService.checks', () => {
  it('reports duplicate payments and wallet balances that disagree with the ledger', async () => {
    const created = new Date('2026-01-10');
    const prisma = {
      walletTransaction: {
        findMany: jest.fn(async (args: any) => {
          if (args.where?.type === 'purchase') {
            return [
              {
                id: 'p1',
                providerRef: 'pi_1',
                amountMinor: 1_000,
                eurCents: 1_000,
                createdAt: created,
                invoice: { id: 'i1' },
                wallet: { user: { email: 'a@x.ro' } },
              },
              {
                id: 'p2',
                providerRef: 'pi_1',
                amountMinor: 1_000,
                eurCents: 1_000,
                createdAt: created,
                invoice: null,
                wallet: { user: { email: 'a@x.ro' } },
              },
            ];
          }
          if (args.where?.type === 'refund') return [];
          // loadLedger
          return [
            {
              id: 'p1',
              walletId: 'w1',
              type: 'purchase',
              status: 'completed',
              amountMinor: 1_000,
              eurCents: 1_000,
              createdAt: created,
              refundSources: null,
              feeMinor: null,
              provider: 'stripe',
              description: null,
              spendDay: null,
              invoice: { vatRatePct: 21, voidedAt: null },
            },
          ];
        }),
      },
      wallet: {
        findMany: jest.fn(async () => [
          { id: 'w1', balanceMinor: 2_000, user: { email: 'a@x.ro' } },
        ]),
      },
      invoice: { findMany: jest.fn(async () => []) },
      platformExpense: {
        findMany: jest.fn(async (args: any) =>
          args?.where?.externalRef ? [{ externalRef: 'stripe_fee:pi_1' }] : [],
        ),
      },
    };
    const checks = await new FinanceStatementService(prisma as any).checks();
    const by = Object.fromEntries(checks.items.map((i) => [i.key, i]));

    expect(by.duplicatePurchases).toMatchObject({ severity: 'error', count: 1 });
    expect(by.walletBalance).toMatchObject({ severity: 'error', count: 1, amountMinor: 1_000 });
    expect(by.uninvoicedPurchases).toMatchObject({ severity: 'warning', count: 1 });
    expect(by.stripeFeeMissing).toMatchObject({ severity: 'ok', count: 0 });
    expect(by.expenseFx.severity).toBe('ok');
  });
});
