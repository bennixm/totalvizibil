/**
 * Cost accounting + budget enforcement for PRO V2's model router — one row
 * per actual provider call (see `AiUsageRecord` in schema.prisma for why),
 * across both Claude and DeepSeek. Answers "where is the money going" (the
 * whole point of item 8) and enforces the hard per-request/day/month caps
 * from item 9. Never used for real billing/invoicing — same disclaimer as
 * every other cost estimate in this codebase.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ProviderName } from '../../../ai/provider.types';
import type { TaskCategory } from './model-router';

export const REQUEST_MAX_COST_USD = 0.75;
export const REQUEST_MAX_TOOL_CALLS = 30;
export const REQUEST_MAX_ITERATIONS = 24;
export const REQUEST_MAX_REPAIR_ATTEMPTS = 3;
export const REQUEST_MAX_PEXELS_SEARCHES = 3;
export const USER_DAILY_MAX_USD = 5;
export const USER_MONTHLY_MAX_USD = 50;

export interface UsageEntry {
  userId: string;
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
  constructor(private readonly prisma: PrismaService) {}

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

  /** Called before starting a new turn — rejects up front rather than
   *  letting a turn start and fail expensively partway through. */
  async assertUserBudget(userId: string): Promise<void> {
    const [daily, monthly] = await Promise.all([
      this.dailySpend(userId),
      this.monthlySpend(userId),
    ]);
    if (daily >= USER_DAILY_MAX_USD) throw new BadRequestException('daily_ai_budget_exceeded');
    if (monthly >= USER_MONTHLY_MAX_USD)
      throw new BadRequestException('monthly_ai_budget_exceeded');
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
      dailyLimitUsd: USER_DAILY_MAX_USD,
      monthlySpendUsd: monthly,
      monthlyLimitUsd: USER_MONTHLY_MAX_USD,
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
