import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The staff member performing a privileged write, as threaded from the
 * controller's `@CurrentUser()` down into whichever service does the work.
 * Both halves are needed: the id for attribution, the roles because they are
 * snapshotted (an action taken by someone who held only `finance` at the
 * time reads very differently from one taken by an `admin`).
 */
export interface AuditActor {
  id: string;
  roles: string[];
}

/** One privileged write, as it will be stored. `before`/`after` are shallow
 *  snapshots of ONLY the fields the action touched — never the whole row, so
 *  the actual change isn't buried in noise. */
export interface AuditLogEntry {
  actorId: string;
  /** Point-in-time snapshot of the actor's platform roles — not a join, so
   *  revoking a role later can't rewrite what they were allowed to do then. */
  actorRoles: string[];
  /** Short machine code: `wallet.adjust`, `invoice.void`, `settings.update`, … */
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/**
 * Append-only "who did what to money" log.
 *
 * Exists as the prerequisite for letting the `finance` role write to wallets,
 * invoices and platform pricing: an admin-only action could get away with no
 * attribution record because the acting set was tiny, a wider staff set
 * cannot. Every mutating endpoint widened to `finance` appends one row here.
 *
 * `log()` NEVER throws. An audit row is written after the thing it describes
 * has already committed (the money has moved, the invoice is already voided),
 * so a failure here must not turn a successful privileged action into an
 * error response — the same "already committed, best-effort side effect"
 * rule the notification calls in those same methods follow. Failures are
 * logged loudly instead.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          actorId: entry.actorId,
          actorRoles: entry.actorRoles,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId ?? null,
          before: toJson(entry.before),
          after: toJson(entry.after),
          reason: entry.reason ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Audit log write failed (action=${entry.action} target=${entry.targetType}:${entry.targetId ?? '-'} actor=${entry.actorId})`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}

/** `undefined` leaves the column NULL; anything else is stored as-is. Prisma
 *  rejects a literal `undefined` inside a Json field value, hence the cast
 *  at this single boundary instead of at every call site. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return value as Prisma.InputJsonValue;
}
