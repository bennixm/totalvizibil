import { BadRequestException } from '@nestjs/common';
import { AiUsageService, REQUEST_MAX_COST_USD, CREDITS_PER_USD } from './ai-usage.service';
import { CREDIT_MINOR } from '../../../wallet/money';

function fakePrisma() {
  const rows: Record<string, unknown>[] = [];
  let seq = 0;
  return {
    aiUsageRecord: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `id_${++seq}`, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      aggregate: jest.fn(
        async ({
          where,
        }: {
          where: { requestId?: string; userId?: string; createdAt?: { gte: Date } };
        }) => {
          const matching = rows.filter((r) => {
            if (where.requestId) return r.requestId === where.requestId;
            if (where.userId) {
              const dateOk = !where.createdAt || (r.createdAt as Date) >= where.createdAt.gte;
              return r.userId === where.userId && dateOk;
            }
            return true;
          });
          const sum = matching.reduce((s, r) => s + ((r.estimatedCostUsd as number) ?? 0), 0);
          return { _sum: { estimatedCostUsd: matching.length ? sum : null } };
        },
      ),
      groupBy: jest.fn(async ({ by }: { by: string[] }) => {
        const key = by[0] as 'provider' | 'taskCategory' | 'model';
        const buckets = new Map<string, { count: number; cost: number; in: number; out: number }>();
        for (const r of rows) {
          const k = String(r[key]);
          const b = buckets.get(k) ?? { count: 0, cost: 0, in: 0, out: 0 };
          b.count++;
          b.cost += (r.estimatedCostUsd as number) ?? 0;
          b.in += (r.inputTokens as number) ?? 0;
          b.out += (r.outputTokens as number) ?? 0;
          buckets.set(k, b);
        }
        return [...buckets.entries()].map(([k, b]) => ({
          [key]: k,
          _count: b.count,
          _sum: { estimatedCostUsd: b.cost, inputTokens: b.in, outputTokens: b.out },
        }));
      }),
    },
    __rows: rows,
  };
}

/** A minimal in-memory wallet double — just enough to exercise the REAL
 *  `assertUserCanAfford` (reads `canAfford`) and `record`'s wallet charge
 *  (calls `chargeAiUsage`), without a real database. */
function fakeWallet(balanceMinor = 10_000) {
  let balance = balanceMinor;
  let blocked = false;
  return {
    canAfford: jest.fn(async (_userId: string, minor: number) => !blocked && balance >= minor),
    chargeAiUsage: jest.fn(async (_userId: string, minor: number, _companyId: string) => {
      const delta = Math.min(minor, Math.max(0, balance));
      balance -= delta;
    }),
    __setBlocked: (v: boolean) => (blocked = v),
    __balance: () => balance,
  };
}

function entry(overrides: Partial<Parameters<AiUsageService['record']>[0]> = {}) {
  return {
    userId: 'u1',
    companyId: 'c1',
    projectId: 'p1',
    requestId: 'r1',
    provider: 'claude' as const,
    model: 'claude-sonnet-5',
    taskCategory: 'simple_edit' as const,
    inputTokens: 1000,
    outputTokens: 200,
    estimatedCostUsd: 0.01,
    ...overrides,
  };
}

describe('AiUsageService', () => {
  it('records a usage row with all the accounting fields', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never, fakeWallet() as never);
    await svc.record(entry());
    expect(prisma.__rows).toHaveLength(1);
    expect(prisma.__rows[0]).toMatchObject({ userId: 'u1', provider: 'claude', succeeded: true });
  });

  it('sums cost across every hop sharing the same requestId (escalation)', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never, fakeWallet() as never);
    await svc.record(entry({ requestId: 'r1', estimatedCostUsd: 0.01, provider: 'deepseek' }));
    await svc.record(entry({ requestId: 'r1', estimatedCostUsd: 0.02, provider: 'deepseek' }));
    await svc.record(entry({ requestId: 'r1', estimatedCostUsd: 0.4, provider: 'claude' }));
    expect(await svc.costForRequest('r1')).toBeCloseTo(0.43);
  });

  it('returns 0 for a request/user with no recorded usage yet', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never, fakeWallet() as never);
    expect(await svc.costForRequest('none')).toBe(0);
    expect(await svc.dailySpend('nobody')).toBe(0);
  });

  it('charges the wallet 2 credits per $1 of estimated cost, tagged to the company', async () => {
    const prisma = fakePrisma();
    const wallet = fakeWallet();
    const svc = new AiUsageService(prisma as never, wallet as never);
    await svc.record(entry({ estimatedCostUsd: 0.5, companyId: 'c42' }));
    const expectedMinor = Math.round(0.5 * CREDITS_PER_USD * CREDIT_MINOR);
    expect(wallet.chargeAiUsage).toHaveBeenCalledWith('u1', expectedMinor, 'c42');
  });

  it('assertUserCanAfford rejects once the wallet has no balance left', async () => {
    const prisma = fakePrisma();
    const wallet = fakeWallet(0);
    const svc = new AiUsageService(prisma as never, wallet as never);
    await expect(svc.assertUserCanAfford('u1')).rejects.toThrow(BadRequestException);
  });

  it('assertUserCanAfford rejects a blocked wallet even with a positive balance', async () => {
    const prisma = fakePrisma();
    const wallet = fakeWallet(10_000);
    wallet.__setBlocked(true);
    const svc = new AiUsageService(prisma as never, wallet as never);
    await expect(svc.assertUserCanAfford('u1')).rejects.toThrow(BadRequestException);
  });

  it('assertUserCanAfford allows a turn while the wallet has any balance', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never, fakeWallet(100) as never);
    await expect(svc.assertUserCanAfford('u1')).resolves.toBeUndefined();
  });

  it('rejects further escalation once the per-request cost cap is hit', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never, fakeWallet() as never);
    await svc.record(entry({ requestId: 'r1', estimatedCostUsd: REQUEST_MAX_COST_USD }));
    await expect(svc.assertRequestBudget('r1')).rejects.toThrow(BadRequestException);
  });

  it('summaryForUser breaks down spend by provider and task category', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never, fakeWallet() as never);
    await svc.record(
      entry({ provider: 'deepseek', taskCategory: 'simple_edit', estimatedCostUsd: 0.01 }),
    );
    await svc.record(
      entry({ provider: 'claude', taskCategory: 'initial_generation', estimatedCostUsd: 0.5 }),
    );

    const summary = await svc.summaryForUser('u1');
    expect(summary.byProvider.map((p) => p.provider).sort()).toEqual(['claude', 'deepseek']);
    expect(summary.byCategory.map((c) => c.taskCategory).sort()).toEqual([
      'initial_generation',
      'simple_edit',
    ]);
  });
});
