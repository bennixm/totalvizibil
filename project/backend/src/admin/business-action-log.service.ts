import { Injectable, Logger } from '@nestjs/common';
import { Prisma, CompanyRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Whoever performed a logged business-level write, as resolved from the
 * company-membership check that already ran at the call site (`AuthPrincipal`
 * carries no company roles — those are per-company, looked up per request).
 */
export interface BusinessActor {
  id: string;
  role: CompanyRole;
}

/** One company-scoped write, as it will be stored. `before`/`after` are
 *  shallow snapshots of ONLY the fields the action touched — same contract
 *  as `AuditLogEntry`, just scoped to a company instead of the platform. */
export interface BusinessActionLogEntry {
  companyId: string;
  actorId: string;
  actorRole: CompanyRole;
  /** Short machine code: `campaign.activate`, `company.publish`, … */
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface ListBusinessActionLogParams {
  /** Exact match — set when deep-linking from a company's own detail page. */
  companyId?: string;
  /** Free-text match against the business name/slug, for the general browse case. */
  company?: string;
  /** Free-text match against the actor's name/email. */
  actor?: string;
  action?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
}

/**
 * Append-only "who changed what on their own business" log — the Nivel-2
 * counterpart to `AuditLogService` (staff actions). Exists for support
 * disputes ("the owner says they didn't touch the budget") and nothing else:
 * money already has `WalletTransaction` as its log, this never duplicates it.
 *
 * `log()` NEVER throws, same rule as `AuditLogService.log()` — the row is
 * written after the real mutation already committed, so a logging failure
 * must never turn a successful owner action into an error response.
 */
@Injectable()
export class BusinessActionLogService {
  private readonly logger = new Logger(BusinessActionLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: BusinessActionLogEntry): Promise<void> {
    try {
      await this.prisma.businessActionLog.create({
        data: {
          companyId: entry.companyId,
          actorId: entry.actorId,
          actorRole: entry.actorRole,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId ?? null,
          before: toJson(entry.before),
          after: toJson(entry.after),
        },
      });
    } catch (err) {
      this.logger.error(
        `Business action log write failed (action=${entry.action} company=${entry.companyId} target=${entry.targetType}:${entry.targetId ?? '-'} actor=${entry.actorId})`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async list(params: ListBusinessActionLogParams) {
    const where: Prisma.BusinessActionLogWhereInput = {
      companyId: params.companyId,
      action: params.action,
      createdAt:
        params.dateFrom || params.dateTo ? { gte: params.dateFrom, lte: params.dateTo } : undefined,
      ...(params.actor
        ? {
            actor: {
              OR: [
                { name: { contains: params.actor, mode: 'insensitive' } },
                { email: { contains: params.actor, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
      ...(params.company
        ? {
            company: {
              OR: [
                { displayName: { contains: params.company, mode: 'insensitive' } },
                { slug: { contains: params.company, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.businessActionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: {
          actor: { select: { id: true, name: true, email: true } },
          company: { select: { id: true, displayName: true, slug: true } },
        },
      }),
      this.prisma.businessActionLog.count({ where }),
    ]);

    return { items: rows, page: params.page, pageSize: params.pageSize, total };
  }
}

/** `undefined` leaves the column NULL; anything else is stored as-is. Prisma
 *  rejects a literal `undefined` inside a Json field value, hence the cast
 *  at this single boundary instead of at every call site. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return value as Prisma.InputJsonValue;
}
