import { Injectable } from "@nestjs/common";
import { getPrisma } from "@middleware/database";
import { errors } from "@middleware/shared";
import { ROUTING_FALLBACK_TYPE } from "@middleware/types";

/**
 * Dashboard analytics — EVERY number is a real aggregate over PostgreSQL.
 * There are no mocked/fallback metrics: if a query fails the request fails.
 */
@Injectable()
export class AnalyticsService {
  async overview(now = new Date()) {
    const prisma = getPrisma();
    const day = (n: number) => new Date(now.getTime() - n * 24 * 3600_000);

    const [
      leadsByStatus,
      leads24h,
      leads7d,
      leads30d,
      deliveriesByStatus,
      deliveryTotals,
      deliverySucceeded,
      attemptAgg,
      topSources,
      topDestinations,
      webhookEvents,
      routingMatched,
      routingUnmatched,
      routingFallback,
    ] = await Promise.all([
      prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.lead.count({ where: { createdAt: { gte: day(1) } } }),
      prisma.lead.count({ where: { createdAt: { gte: day(7) } } }),
      prisma.lead.count({ where: { createdAt: { gte: day(30) } } }),
      prisma.delivery.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.delivery.count(),
      prisma.delivery.count({ where: { status: "SUCCEEDED" } }),
      prisma.delivery.aggregate({
        where: { status: "SUCCEEDED" },
        _avg: { attemptCount: true },
        _count: { _all: true },
      }),
      prisma.lead.groupBy({
        by: ["sourceId"],
        _count: { _all: true },
        orderBy: { _count: { sourceId: "desc" } },
        take: 5,
      }),
      prisma.delivery.groupBy({
        by: ["destinationId"],
        _count: { _all: true },
        orderBy: { _count: { destinationId: "desc" } },
        take: 5,
      }),
      prisma.webhookEvent.count({ where: { receivedAt: { gte: day(1) } } }),
      // Routing decisions (RoutingResult rows written by the ROUTING stage).
      prisma.routingResult.count({ where: { matched: true } }),
      prisma.routingResult.count({ where: { matched: false } }),
      // Leads kept inside Middleware (INTERNAL_MIDDLEWARE fallback), recognised
      // by the marker in RoutingResult.reason. Covers BOTH "no rule matched"
      // and "rule matched but no usable destination" — neither case created a
      // delivery, so these leads are never counted as delivery success/failure.
      // The exact legacy wording is included for rows written before the marker
      // existed: those carry an empty destinationIds list and no Delivery row,
      // i.e. the same "kept in Middleware" outcome.
      prisma.routingResult.count({
        where: {
          OR: [
            { reason: { contains: ROUTING_FALLBACK_TYPE } },
            { reason: "no routing rule matched" },
          ],
        },
      }),
    ]);

    const succeeded = deliverySucceeded;
    const failedish = deliveriesByStatus
      .filter((r) => ["FAILED", "DEAD"].includes(r.status))
      .reduce((sum, r) => sum + r._count._all, 0);

    const sourceIds = topSources.map((s) => s.sourceId);
    const destinationIds = topDestinations.map((d) => d.destinationId);
    const [sources, destinations] = await Promise.all([
      sourceIds.length > 0
        ? prisma.leadSource.findMany({
            where: { id: { in: sourceIds } },
            select: { id: true, name: true, code: true, type: true },
          })
        : [],
      destinationIds.length > 0
        ? prisma.destination.findMany({
            where: { id: { in: destinationIds } },
            select: { id: true, name: true, type: true },
          })
        : [],
    ]);

    return {
      leads: {
        total24h: leads24h,
        total7d: leads7d,
        total30d: leads30d,
        byStatus: Object.fromEntries(leadsByStatus.map((r) => [r.status, r._count._all])),
      },
      deliveries: {
        total: deliveryTotals,
        succeeded,
        failedOrDead: failedish,
        successRate: deliveryTotals > 0 ? Math.round((succeeded / deliveryTotals) * 1000) / 10 : null,
        avgAttemptsOnSuccess:
          attemptAgg._avg.attemptCount !== null
            ? Math.round(attemptAgg._avg.attemptCount * 100) / 100
            : null,
        byStatus: Object.fromEntries(deliveriesByStatus.map((r) => [r.status, r._count._all])),
      },
      inbound: { webhookEvents24h: webhookEvents },
      routing: {
        matchedRules: routingMatched,
        unmatchedLeads: routingUnmatched,
        fallbackLeads: routingFallback,
      },
      topSources: topSources.map((s) => ({
        ...s,
        source: sources.find((x) => x.id === s.sourceId) ?? null,
      })),
      topDestinations: topDestinations.map((d) => ({
        ...d,
        destination: destinations.find((x) => x.id === d.destinationId) ?? null,
      })),
      generatedAt: now.toISOString(),
    };
  }

  /** Daily lead intake + delivery outcomes for the dashboard charts. */
  async timeseries(days = 30) {
    const clamped = Math.min(Math.max(days, 1), 90);
    const from = new Date(Date.now() - clamped * 24 * 3600_000);
    const prisma = getPrisma();

    const leads = await prisma.$queryRaw<Array<{ day: Date; leads: number }>>`
      SELECT date_trunc('day', "createdAt")::date AS day, count(*)::int AS leads
      FROM "Lead"
      WHERE "createdAt" >= ${from}
      GROUP BY 1 ORDER BY 1`;

    const deliveries = await prisma.$queryRaw<
      Array<{ day: Date; total: number; succeeded: number }>
    >`
      SELECT date_trunc('day', "createdAt")::date AS day,
             count(*)::int AS total,
             count(*) FILTER (WHERE "status" = 'SUCCEEDED')::int AS succeeded
      FROM "Delivery"
      WHERE "createdAt" >= ${from}
      GROUP BY 1 ORDER BY 1`;

    return { days: clamped, leads, deliveries };
  }

  async sourcePerformance() {
    const prisma = getPrisma();
    const grouped = await prisma.lead.groupBy({
      by: ["sourceId", "status"],
      _count: { _all: true },
    });
    const sources = await prisma.leadSource.findMany({
      select: { id: true, name: true, code: true, type: true },
    });
    return sources.map((source) => {
      const rows = grouped.filter((g) => g.sourceId === source.id);
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
      const total = rows.reduce((sum, r) => sum + r._count._all, 0);
      return { source, total, byStatus };
    });
  }

  async destinationPerformance() {
    const prisma = getPrisma();
    const grouped = await prisma.delivery.groupBy({
      by: ["destinationId", "status"],
      _count: { _all: true },
    });
    const durations = await prisma.deliveryAttempt.groupBy({
      by: ["deliveryId"],
      where: { status: "SUCCEEDED" },
      _avg: { durationMs: true },
    });
    const deliveries = await prisma.delivery.findMany({
      select: { id: true, destinationId: true },
    });
    const destinations = await prisma.destination.findMany({
      select: { id: true, name: true, type: true, status: true },
    });

    return destinations.map((destination) => {
      const rows = grouped.filter((g) => g.destinationId === destination.id);
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
      const total = rows.reduce((sum, r) => sum + r._count._all, 0);
      const succeeded = byStatus["SUCCEEDED"] ?? 0;
      const deliveryIds = new Set(
        deliveries.filter((d) => d.destinationId === destination.id).map((d) => d.id),
      );
      const avgMs = durations
        .filter((d) => deliveryIds.has(d.deliveryId) && d._avg.durationMs !== null)
        .map((d) => d._avg.durationMs as number);
      return {
        destination,
        total,
        succeeded,
        byStatus,
        successRate: total > 0 ? Math.round((succeeded / total) * 1000) / 10 : null,
        avgLatencyMs:
          avgMs.length > 0 ? Math.round(avgMs.reduce((a, b) => a + b, 0) / avgMs.length) : null,
      };
    });
  }

  /** Lead pipeline funnel (current stage distribution). */
  async pipelineFunnel() {
    const grouped = await getPrisma().lead.groupBy({
      by: ["stage"],
      _count: { _all: true },
    });
    const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
    return {
      total,
      stages: grouped.map((g) => ({
        stage: g.stage,
        count: g._count._all,
        share: total > 0 ? Math.round((g._count._all / total) * 1000) / 10 : 0,
      })),
    };
  }

  assertDays(value: number | undefined): number {
    if (value === undefined) return 30;
    if (!Number.isFinite(value) || value < 1 || value > 90) {
      throw errors.badRequest("days must be between 1 and 90.");
    }
    return Math.floor(value);
  }
}
