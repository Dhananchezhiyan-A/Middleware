import { Global, Injectable, Logger, Module } from "@nestjs/common";
import type { AuditActorType } from "@middleware/types";
import { getPrisma } from "@middleware/database";
import { getContext, sanitizeDeep } from "@middleware/shared";

export interface AuditRecordInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Override when the actor isn't the ambient request actor (e.g. WORKER). */
  actorType?: AuditActorType;
  actorId?: string | null;
  actorLabel?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Audit trail writer.
 *
 * - Secrets are stripped via sanitizeDeep before persistence.
 * - Audit failures are LOUD (error log) but never break the business
 *   operation that triggered them (the operation itself already succeeded
 *   transactionally; a failed audit insert must not roll back user work
 *   after the fact).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  async record(input: AuditRecordInput): Promise<void> {
    const ctx = getContext();
    try {
      await getPrisma().auditLog.create({
        data: {
          actorType: input.actorType ?? ctx?.actorType ?? "SYSTEM",
          actorId: input.actorId ?? ctx?.userId ?? null,
          actorLabel: input.actorLabel ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          ip: input.ip ?? ctx?.ip ?? null,
          userAgent: input.userAgent ?? null,
          correlationId: input.correlationId ?? ctx?.correlationId ?? null,
          before: input.before === undefined ? undefined : (sanitizeDeep(input.before) as never),
          after: input.after === undefined ? undefined : (sanitizeDeep(input.after) as never),
          metadata: input.metadata === undefined ? undefined : (sanitizeDeep(input.metadata) as never),
        },
      });
    } catch (err) {
      this.logger.error(
        `AUDIT WRITE FAILED action=${input.action} entity=${input.entityType}:${input.entityId ?? "-"} err=${String(err)}`,
      );
    }
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
