import { Inject, Injectable } from "@nestjs/common";
import { clampLimit, decodeCursor, encodeCursor, errors } from "@middleware/shared";
import type { Database, Prisma } from "@middleware/database";
import { PRISMA } from "../../infra/prisma.module";

/** No selects on relations — audit rows are self-contained and immutable. */
const AUDIT_SELECT = {
  id: true,
  actorType: true,
  actorId: true,
  actorLabel: true,
  action: true,
  entityType: true,
  entityId: true,
  ip: true,
  correlationId: true,
  before: true,
  after: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

export type AuditLogView = Prisma.AuditLogGetPayload<{ select: typeof AUDIT_SELECT }>;

export interface AuditLogQueryInput {
  cursor?: string;
  limit?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class AuditLogsService {
  constructor(@Inject(PRISMA) private readonly prisma: Database) {}

  async listAuditLogs(
    query: AuditLogQueryInput,
  ): Promise<{ items: AuditLogView[]; nextCursor: string | null }> {
    const limit = clampLimit(query.limit);
    const cursor = this.readCursor(query.cursor);
    const from = query.from !== undefined ? new Date(query.from) : undefined;
    const to = query.to !== undefined ? new Date(query.to) : undefined;

    const where: Prisma.AuditLogWhereInput = {
      ...(query.action !== undefined ? { action: query.action } : {}),
      ...(query.entityType !== undefined ? { entityType: query.entityType } : {}),
      ...(query.entityId !== undefined ? { entityId: query.entityId } : {}),
      ...(query.actorId !== undefined ? { actorId: query.actorId } : {}),
      ...(from !== undefined || to !== undefined
        ? {
            createdAt: {
              ...(from !== undefined ? { gte: from } : {}),
              ...(to !== undefined ? { lte: to } : {}),
            },
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.t } },
              { createdAt: { equals: cursor.t }, id: { lt: cursor.i } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: AUDIT_SELECT,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ t: last.createdAt.toISOString(), i: last.id }) : null;
    return { items, nextCursor };
  }

  /** Decodes the opaque list cursor; rejects malformed cursors loudly. */
  private readCursor(cursor: string | undefined): { t: Date; i: string } | null {
    if (!cursor) return null;
    const decoded = decodeCursor<Record<string, unknown>>(cursor);
    if (
      !decoded ||
      typeof decoded.t !== "string" ||
      typeof decoded.i !== "string" ||
      Number.isNaN(Date.parse(decoded.t))
    ) {
      throw errors.validation("Invalid pagination cursor.");
    }
    return { t: new Date(decoded.t), i: decoded.i };
  }
}
