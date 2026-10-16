import { Injectable } from "@nestjs/common";
import { getPrisma } from "@middleware/database";
import { decodeCursor, encodeCursor, errors, normalizeQuery } from "@middleware/shared";
import { idSchema } from "@middleware/validation";
import type { CursorPage, RequestActor } from "@middleware/types";
import { AuditService } from "../../infra/audit.module";
import { QueuesService } from "../../infra/redis.module";

interface DeliveryListQuery {
  cursor?: string | null;
  limit?: number;
  status?: string;
  destinationId?: string;
  leadId?: string;
  correlationId?: string;
  from?: string;
  to?: string;
}

/**
 * Delivery read/replay endpoints + REAL queue statistics.
 *
 * Every number here comes from BullMQ/PostgreSQL — the API never synthesizes
 * queue health. When Redis is down the stats endpoints report the error
 * verbatim instead of returning zeros.
 */
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly queues: QueuesService,
    private readonly audit: AuditService,
  ) {}

  async list(query: DeliveryListQuery): Promise<CursorPage<unknown>> {
    const { cursor, limit } = normalizeQuery(query);
    const where: Record<string, unknown> = {};
    if (query.status) where["status"] = query.status;
    if (query.destinationId) where["destinationId"] = query.destinationId;
    if (query.leadId) where["leadId"] = query.leadId;
    if (query.correlationId) where["correlationId"] = query.correlationId;
    const range: Record<string, Date> = {};
    if (query.from) range["gte"] = new Date(query.from);
    if (query.to) range["lte"] = new Date(query.to);
    if (Object.keys(range).length > 0) where["updatedAt"] = range;

    if (cursor) {
      const decoded = decodeCursor<{ updatedAt: string; id: string }>(cursor);
      if (decoded) where["AND"] = [{ updatedAt: { lt: new Date(decoded.updatedAt) } }];
    }

    const prisma = getPrisma();
    const rows = await prisma.delivery.findMany({
      where: where as never,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        destination: { select: { id: true, name: true, type: true } },
        lead: { select: { id: true, receivedAt: true } },
        _count: { select: { attempts: true } },
      },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id }) : null;
    const total = await prisma.delivery.count({ where: where as never });
    return { items, nextCursor, total };
  }

  /**
   * Live status counts for one operation's deliveries (`?correlationId=` of a
   * manual send) — how the UI distinguishes queued jobs from real successes.
   */
  async stats(correlationId: string) {
    if (!idSchema.safeParse(correlationId).success) {
      throw errors.validation("Invalid correlation id.");
    }
    const prisma = getPrisma();
    const rows = await prisma.delivery.groupBy({
      by: ["destinationId", "status"],
      where: { correlationId },
      _count: { _all: true },
    });

    const empty = (): Record<string, number> => ({
      PENDING: 0,
      QUEUED: 0,
      IN_PROGRESS: 0,
      SUCCEEDED: 0,
      FAILED: 0,
      DEAD: 0,
      SKIPPED: 0,
    });
    const byStatus = empty();
    const perDestination = new Map<string, Record<string, number>>();
    let total = 0;
    for (const row of rows) {
      byStatus[row.status] += row._count._all;
      total += row._count._all;
      const bucket = perDestination.get(row.destinationId) ?? empty();
      bucket[row.status] += row._count._all;
      perDestination.set(row.destinationId, bucket);
    }

    const destinationIds = [...perDestination.keys()];
    const destinations =
      destinationIds.length > 0
        ? await prisma.destination.findMany({
            where: { id: { in: destinationIds } },
            select: { id: true, name: true, type: true },
          })
        : [];

    return {
      correlationId,
      total,
      byStatus,
      destinations: destinations.map((d) => ({
        ...d,
        byStatus: perDestination.get(d.id) ?? empty(),
      })),
    };
  }

  async getDetail(id: string) {
    const delivery = await getPrisma().delivery.findFirst({
      where: { id },
      include: {
        destination: { select: { id: true, name: true, type: true, status: true } },
        lead: { select: { id: true, receivedAt: true, status: true, stage: true, score: true } },
        attempts: { orderBy: { attemptNumber: "asc" } },
      },
    });
    if (!delivery) throw errors.notFound("Delivery not found.");
    return delivery;
  }

  /** Records intent and queues an audited replay of a terminal delivery. */
  async replay(actor: RequestActor, id: string): Promise<{ queued: boolean }> {
    const prisma = getPrisma();
    const delivery = await prisma.delivery.findFirst({ where: { id } });
    if (!delivery) throw errors.notFound("Delivery not found.");
    if (["PENDING", "QUEUED", "IN_PROGRESS"].includes(delivery.status)) {
      throw errors.conflict("Delivery is already in progress.");
    }
    if (delivery.status === "SUCCEEDED") {
      throw errors.conflict("Delivery already succeeded; replay would resend a delivered lead.");
    }

    // The worker starts a new attempt cycle + re-enqueues; here we only record
    // intent so a queue outage cannot lose the request (it fails loudly with
    // QUEUE_UNAVAILABLE).
    await this.queues.enqueueReplay({
      deliveryId: id,
      requestedBy: actor.userId,
      correlationId: actor.correlationId,
    });
    await this.audit.record({
      action: "delivery.replay.requested",
      entityType: "Delivery",
      entityId: id,
      metadata: {
        previousStatus: delivery.status,
        previousAttempts: delivery.attemptCount,
        replayCycle: delivery.replayCount + 1,
        resumesAtAttempt: delivery.attemptCount + 1,
      },
    });
    return { queued: true };
  }

  /** Real BullMQ queue + DLQ counts for the operations dashboard. */
  async queueStats() {
    const [queues, deadLetters] = await Promise.all([
      this.queues.queueStats(),
      this.queues.deadLetterStats(),
    ]);
    return { queues, deadLetters };
  }

  async deadLetterJobs(queue: string, limit?: number) {
    if (!queue.endsWith("-dlq")) queue = `${queue}-dlq`;
    return this.queues.deadLetterJobs(queue, limit);
  }

  async failedJobs(queue: string, limit?: number) {
    return this.queues.failedJobs(queue, limit);
  }
}
