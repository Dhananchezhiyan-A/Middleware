import { Injectable } from "@nestjs/common";
import { getPrisma } from "@middleware/database";
import {
  decodeCursor,
  encodeCursor,
  errors,
  normalizeQuery,
  sha256Hex,
} from "@middleware/shared";
import type { CursorPage, RequestActor } from "@middleware/types";
import { AuditService } from "../../infra/audit.module";
import { QueuesService } from "../../infra/redis.module";

interface LeadListQuery {
  cursor?: string | null;
  limit?: number;
  status?: string;
  sourceId?: string;
  destinationId?: string;
  scoreMin?: number;
  q?: string;
  from?: string;
  to?: string;
  sort?: "receivedAt:asc" | "receivedAt:desc";
}

const SORT_FIELDS = {
  "receivedAt:asc": { receivedAt: "asc" },
  "receivedAt:desc": { receivedAt: "desc" },
} as const;

/**
 * Lead read/model endpoints; cursors are opaque and validated server-side.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly audit: AuditService,
    private readonly queues: QueuesService,
  ) {}

  async list(_actor: RequestActor, query: LeadListQuery): Promise<CursorPage<unknown>> {
    const { cursor, limit } = normalizeQuery(query);
    const sort = SORT_FIELDS[query.sort ?? "receivedAt:desc"];
    const desc = (query.sort ?? "receivedAt:desc") === "receivedAt:desc";

    const where: Record<string, unknown> = {};
    if (query.status) where["status"] = query.status;
    if (query.sourceId) where["sourceId"] = query.sourceId;
    if (query.scoreMin !== undefined) where["score"] = { gte: query.scoreMin };

    const range: Record<string, Date> = {};
    if (query.from) range["gte"] = new Date(query.from);
    if (query.to) range["lte"] = new Date(query.to);
    if (Object.keys(range).length > 0) where["receivedAt"] = range;

    if (query.destinationId) {
      where["deliveries"] = { some: { destinationId: query.destinationId } };
    }
    if (query.q) {
      const q = query.q.trim();
      const asEmail = q.toLowerCase();
      const asPhone = q.replace(/\D/g, "");
      where["OR"] = [
        { id: { contains: q } },
        { leadId: q },
        { canonicalData: { path: ["name", "full"], string_contains: q, mode: "insensitive" } },
        { canonicalData: { path: ["name", "first"], string_contains: q, mode: "insensitive" } },
        { canonicalData: { path: ["name", "last"], string_contains: q, mode: "insensitive" } },
        { canonicalData: { path: ["email"], equals: asEmail } },
        ...(asPhone.length >= 6 ? [{ canonicalData: { path: ["phone"], equals: q } }] : []),
        { externalLeadId: q },
      ];
    }

    if (cursor) {
      const decoded = decodeCursor<{ receivedAt: string; id: string }>(cursor);
      if (decoded) {
        const receivedAt = new Date(decoded.receivedAt);
        where["AND"] = [
          desc
            ? { receivedAt: { lt: receivedAt } }
            : { receivedAt: { gt: receivedAt } },
        ];
      }
    }

    const rows = await getPrisma().lead.findMany({
      where: where as never,
      orderBy: [{ ...sort }, { id: desc ? "desc" : "asc" }],
      take: limit + 1,
      include: {
        source: { select: { id: true, code: true, name: true, type: true } },
        _count: { select: { deliveries: true } },
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ receivedAt: last.receivedAt.toISOString(), id: last.id })
        : null;
    const total = await getPrisma().lead.count({ where: where as never });

    return { items, nextCursor, total };
  }

  async getDetail(_actor: RequestActor, id: string) {
    const prisma = getPrisma();
    const lead = await prisma.lead.findFirst({
      where: { id },
      include: {
        source: { select: { id: true, code: true, name: true, type: true } },
        sourceAccount: { select: { id: true, name: true, publicId: true } },
        processing: true,
        scores: { orderBy: { computedAt: "desc" } },
        duplicateOf: { select: { originalLeadId: true, strategy: true, confidence: true } },
        deliveries: {
          include: {
            destination: { select: { id: true, name: true, type: true } },
            attempts: { orderBy: { attemptNumber: "desc" }, take: 3 },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!lead) throw errors.notFound("Lead not found.");
    return lead;
  }

  async getTimeline(_actor: RequestActor, id: string) {
    const prisma = getPrisma();
    const lead = await prisma.lead.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!lead) throw errors.notFound("Lead not found.");

    const [stageEvents, scores, routingResults] = await Promise.all([
      prisma.leadStageEvent.findMany({
        where: { leadId: id },
        orderBy: { startedAt: "asc" },
      }),
      prisma.leadScore.findMany({
        where: { leadId: id },
        orderBy: { computedAt: "asc" },
      }),
      prisma.routingResult.findMany({
        where: { leadId: id },
        orderBy: { evaluatedAt: "asc" },
      }),
    ]);
    return { stageEvents, scores, routingResults };
  }

  async getPayloads(_actor: RequestActor, id: string) {
    const prisma = getPrisma();
    const lead = await prisma.lead.findFirst({
      where: { id },
      select: { id: true, canonicalData: true, normalizedData: true },
    });
    if (!lead) throw errors.notFound("Lead not found.");
    const payloads = await prisma.leadRawPayload.findMany({
      where: { leadId: id },
      orderBy: { receivedAt: "desc" },
    });
    return { canonical: lead.canonicalData, normalized: lead.normalizedData, payloads };
  }

  /** Manual/API lead creation — persists, then enqueues the intake job. */
  async create(
    actor: RequestActor,
    input: { sourceId: string; sourceAccountId: string; externalLeadId?: string; data: Record<string, unknown> },
  ) {
    const prisma = getPrisma();
    const [source, account] = await Promise.all([
      prisma.leadSource.findFirst({ where: { id: input.sourceId } }),
      prisma.leadSourceAccount.findFirst({
        where: { id: input.sourceAccountId, sourceId: input.sourceId },
      }),
    ]);
    if (!source) throw errors.notFound("Source not found.");
    if (!account) throw errors.notFound("Source account not found for that source.");

    try {
      const lead = await prisma.lead.create({
        data: {
          sourceId: input.sourceId,
          sourceAccountId: input.sourceAccountId,
          externalLeadId: input.externalLeadId ?? null,
          status: "RECEIVED",
          stage: "RECEIVED",
          canonicalData: input.data as never,
          correlationId: actor.correlationId,
        },
      });
      await prisma.leadRawPayload.create({
        data: {
          leadId: lead.id,
          sourceAccountId: input.sourceAccountId,
          payload: input.data as never,
          contentType: "application/json",
          checksum: sha256Hex(JSON.stringify(input.data)),
        },
      });
      await this.queues.enqueueLeadIntake({
        leadId: lead.id,
        correlationId: actor.correlationId,
      });
      await this.audit.record({
        action: "lead.created",
        entityType: "Lead",
        entityId: lead.id,
        metadata: { sourceId: input.sourceId, externalLeadId: input.externalLeadId ?? null },
      });
      return lead;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw errors.conflict(
          "A lead with this external id already exists for this source account.",
        );
      }
      throw err;
    }
  }

  /** Re-runs the full pipeline for an existing lead (fresh pipeline job). */
  async replay(actor: RequestActor, id: string): Promise<{ replayed: boolean }> {
    const prisma = getPrisma();
    const lead = await prisma.lead.findFirst({ where: { id } });
    if (!lead) throw errors.notFound("Lead not found.");

    await prisma.lead.update({
      where: { id },
      data: { status: "PROCESSING", stage: "RECEIVED" },
    });
    await this.queues.enqueueProcessing({
      leadId: id,
      correlationId: actor.correlationId,
    });
    await this.audit.record({
      action: "lead.replayed",
      entityType: "Lead",
      entityId: id,
      metadata: { previousStatus: lead.status, previousStage: lead.stage },
    });
    return { replayed: true };
  }

  async remove(_actor: RequestActor, id: string): Promise<{ deleted: boolean }> {
    const prisma = getPrisma();
    const lead = await prisma.lead.findFirst({ where: { id } });
    if (!lead) throw errors.notFound("Lead not found.");
    const canonical = lead.canonicalData as { email?: string; phone?: string } | null;

    await prisma.lead.delete({ where: { id } });
    await this.audit.record({
      action: "lead.deleted",
      entityType: "Lead",
      entityId: id,
      before: {
        status: lead.status,
        stage: lead.stage,
        email: canonical?.email ?? null,
        phone: canonical?.phone ?? null,
      },
    });
    return { deleted: true };
  }
}
