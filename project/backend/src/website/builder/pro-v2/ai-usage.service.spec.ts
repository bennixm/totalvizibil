import { BadRequestException } from '@nestjs/common';
import {
  AiUsageService,
  USER_DAILY_MAX_USD,
  USER_MONTHLY_MAX_USD,
  REQUEST_MAX_COST_USD,
} from './ai-usage.service';

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

function entry(overrides: Partial<Parameters<AiUsageService['record']>[0]> = {}) {
  return {
    userId: 'u1',
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
    const svc = new AiUsageService(prisma as never);
    await svc.record(entry());
    expect(prisma.__rows).toHaveLength(1);
    expect(prisma.__rows[0]).toMatchObject({ userId: 'u1', provider: 'claude', succeeded: true });
  });

  it('sums cost across every hop sharing the same requestId (escalation)', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never);
    await svc.record(entry({ requestId: 'r1', estimatedCostUsd: 0.01, provider: 'deepseek' }));
    await svc.record(entry({ requestId: 'r1', estimatedCostUsd: 0.02, provider: 'deepseek' }));
    await svc.record(entry({ requestId: 'r1', estimatedCostUsd: 0.4, provider: 'claude' }));
    expect(await svc.costForRequest('r1')).toBeCloseTo(0.43);
  });

  it('returns 0 for a request/user with no recorded usage yet', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never);
    expect(await svc.costForRequest('none')).toBe(0);
    expect(await svc.dailySpend('nobody')).toBe(0);
  });

  it('rejects a new turn once the user is at or over the daily budget', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never);
    await svc.record(entry({ estimatedCostUsd: USER_DAILY_MAX_USD }));
    await expect(svc.assertUserBudget('u1')).rejects.toThrow(BadRequestException);
  });

  it('rejects once the user is at or over the monthly budget even under the daily cap', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never);
    // Spread across many small entries so daily alone wouldn't trip it.
    for (let i = 0; i < 10; i++)
      await svc.record(entry({ estimatedCostUsd: USER_MONTHLY_MAX_USD / 10 }));
    await expect(svc.assertUserBudget('u1')).rejects.toThrow(BadRequestException);
  });

  it('allows a turn comfortably under both budgets', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never);
    await svc.record(entry({ estimatedCostUsd: 0.5 }));
    await expect(svc.assertUserBudget('u1')).resolves.toBeUndefined();
  });

  it('rejects further escalation once the per-request cost cap is hit', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never);
    await svc.record(entry({ requestId: 'r1', estimatedCostUsd: REQUEST_MAX_COST_USD }));
    await expect(svc.assertRequestBudget('r1')).rejects.toThrow(BadRequestException);
  });

  it('summaryForUser breaks down spend by provider and task category', async () => {
    const prisma = fakePrisma();
    const svc = new AiUsageService(prisma as never);
    await svc.record(
      entry({ provider: 'deepseek', taskCategory: 'simple_edit', estimatedCostUsd: 0.01 }),
    );
    await svc.record(
      entry({ provider: 'claude', taskCategory: 'initial_generation', estimatedCostUsd: 0.5 }),
    );

    const summary = await svc.summaryForUser('u1');
    expect(summary.dailyLimitUsd).toBe(USER_DAILY_MAX_USD);
    expect(summary.monthlyLimitUsd).toBe(USER_MONTHLY_MAX_USD);
    expect(summary.byProvider.map((p) => p.provider).sort()).toEqual(['claude', 'deepseek']);
    expect(summary.byCategory.map((c) => c.taskCategory).sort()).toEqual([
      'initial_generation',
      'simple_edit',
    ]);
  });
});
