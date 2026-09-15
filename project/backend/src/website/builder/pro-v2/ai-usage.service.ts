/**
 * Cost accounting + billing for PRO V2's model router — one row per actual
 * provider call (see `AiUsageRecord` in schema.prisma for why), across both
 * Claude and DeepSeek. Answers "where is the money going" (item 8), enforces
 * the hard per-request safety cap that protects against a single runaway
 * turn (item 9's `REQUEST_MAX_*` constants — a technical safety net, kept
 * regardless of billing model), and charges the owner's wallet for what was
 * actually used (2 credits per $1 of estimated cost — see `chargeForUsage`).
 * The exact USD figures recorded here are internal-only: the user is gated
 * purely on their wallet balance (see `assertUserCanAfford`), never shown a
 * dollar amount.
 */
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { WalletService } from '../../../wallet/wallet.service';
import { CREDIT_MINOR } from '../../../wallet/money';
import type { ProviderName } from '../../../ai/provider.types';
import type { TaskCategory } from './model-router';

export const REQUEST_MAX_COST_USD = 0.75;
export const REQUEST_MAX_TOOL_CALLS = 30;
export const REQUEST_MAX_ITERATIONS = 24;
export const REQUEST_MAX_REPAIR_ATTEMPTS = 3;
export const REQUEST_MAX_PEXELS_SEARCHES = 3;

/** Credits charged to the owner's wallet per $1 of estimated AI cost — a
 *  deliberate markup, not a 1:1 pass-through (credits are EUR-denominated,
 *  see wallet/money.ts; USD cost is treated as the same reference unit,
 *  same simplification the rest of this app's cost tracking already makes). */
export const CREDITS_PER_USD = 2;

export interface UsageEntry {
  userId: string;
  companyId: string;
  projectId: string;
  requestId: string;
  provider: ProviderName;
  model: string;
  taskCategory: TaskCategory;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  toolCalls?: number;
  iterations?: number;
  pexelsSearches?: number;
  estimatedCostUsd: number;
  repairAttempt?: number;
  escalatedFrom?: string;
  succeeded?: boolean;
}

function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function startOfUtcMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async record(entry: UsageEntry): Promise<void> {
    await this.prisma.aiUsageRecord.create({
      data: {
        userId: entry.userId,
        projectId: entry.projectId,
        requestId: entry.requestId,
        provider: entry.provider,
        model: entry.model,
        taskCategory: entry.taskCategory,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheReadTokens: entry.cacheReadTokens ?? 0,
        toolCalls: entry.toolCalls ?? 0,
        iterations: entry.iterations ?? 0,
        pexelsSearches: entry.pexelsSearches ?? 0,
        estimatedCostUsd: entry.estimatedCostUsd,
        repairAttempt: entry.repairAttempt,
        escalatedFrom: entry.escalatedFrom,
        succeeded: entry.succeeded ?? true,
      },
    });
    const creditsMinor = Math.round(entry.estimatedCostUsd * CREDITS_PER_USD * CREDIT_MINOR);
    await this.wallet.chargeAiUsage(entry.userId, creditsMinor, entry.companyId);
  }

  async costForRequest(requestId: string): Promise<number> {
    const r = await this.prisma.aiUsageRecord.aggregate({
      where: { requestId },
      _sum: { estimatedCostUsd: true },
    });
    return r._sum.estimatedCostUsd ?? 0;
  }

  async dailySpend(userId: string): Promise<number> {
    const r = await this.prisma.aiUsageRecord.aggregate({
      where: { userId, createdAt: { gte: startOfUtcDay() } },
      _sum: { estimatedCostUsd: true },
    });
    return r._sum.estimatedCostUsd ?? 0;
  }

  async monthlySpend(userId: string): Promise<number> {
    const r = await this.prisma.aiUsageRecord.aggregate({
      where: { userId, createdAt: { gte: startOfUtcMonth() } },
      _sum: { estimatedCostUsd: true },
    });
    return r._sum.estimatedCostUsd ?? 0;
  }

  /** Called before starting a new turn — rejects up front, on the SAME
   *  wallet balance/blocked check every other spend in the app already uses,
   *  rather than letting a turn start and fail expensively partway through.
   *  No dollar figure is ever surfaced to the caller — just "can't afford
   *  it" — the user only ever sees their own wallet balance. */
  async assertUserCanAfford(userId: string): Promise<void> {
    const canAfford = await this.wallet.canAfford(userId, 1);
    if (!canAfford) throw new BadRequestException('insufficient_credits');
  }

  /** Called after each hop within a turn (initial try + any escalation) —
   *  a request that has already spent its cap stops instead of trying the
   *  next, pricier tier. */
  async assertRequestBudget(requestId: string): Promise<void> {
    const spent = await this.costForRequest(requestId);
    if (spent >= REQUEST_MAX_COST_USD) throw new BadRequestException('request_ai_budget_exceeded');
  }

  /** For the usage UI (item 11) — current user's day/month totals plus a
   *  provider/model/category breakdown for the admin/debug view. */
  async summaryForUser(userId: string) {
    const [daily, monthly, byProvider, byCategory] = await Promise.all([
      this.dailySpend(userId),
      this.monthlySpend(userId),
      this.prisma.aiUsageRecord.groupBy({
        by: ['provider'],
        where: { userId, createdAt: { gte: startOfUtcMonth() } },
        _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
      this.prisma.aiUsageRecord.groupBy({
        by: ['taskCategory'],
        where: { userId, createdAt: { gte: startOfUtcMonth() } },
        _sum: { estimatedCostUsd: true },
        _count: true,
      }),
    ]);
    return {
      dailySpendUsd: daily,
      monthlySpendUsd: monthly,
      byProvider: byProvider.map((p) => ({
        provider: p.provider,
        calls: p._count,
        costUsd: p._sum.estimatedCostUsd ?? 0,
        inputTokens: p._sum.inputTokens ?? 0,
        outputTokens: p._sum.outputTokens ?? 0,
      })),
      byCategory: byCategory.map((c) => ({
        taskCategory: c.taskCategory,
        calls: c._count,
        costUsd: c._sum.estimatedCostUsd ?? 0,
      })),
    };
  }

  /** Cost-by-project, for the admin/debug view. */
  async summaryForProject(projectId: string) {
    const rows = await this.prisma.aiUsageRecord.groupBy({
      by: ['provider', 'model'],
      where: { projectId },
      _sum: { estimatedCostUsd: true },
      _count: true,
    });
    return rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      calls: r._count,
      costUsd: r._sum.estimatedCostUsd ?? 0,
    }));
  }
}
