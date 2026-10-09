import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@middleware/database";
import { getPrisma } from "@middleware/database";
import { AnalyticsService } from "../../apps/api/src/modules/analytics/analytics.service";
import { PipelineService } from "../../apps/worker/src/pipeline/pipeline.service";
import type { QueueProducer } from "../../apps/worker/src/queues/queue-producer";
import { cleanupFixture, createFixture, unique, type Fixture } from "./helpers";

/**
 * INTERNAL MIDDLEWARE FALLBACK (end to end, real PostgreSQL, queue stubbed).
 *
 * `middleware` is THIS application, not a destination: when a lead has no valid
 * external destination it is simply kept in Middleware — no Delivery row, no
 * enqueue, no outbound request — and the decision stays traceable through
 * RoutingResult + the stage events.
 *
 * Covers: no match / disabled destination / all destinations invalid /
 * stop-after-first with an invalid destination / multi-destination fan-out /
 * analytics never counting the fallback as an external delivery.
 */

interface EnqueuedDelivery {
  deliveryId: string;
  leadId: string;
  destinationId: string;
}

/** Queue stub: records calls instead of touching Redis. NOT queue coverage. */
function stubProducer(): { producer: QueueProducer; calls: EnqueuedDelivery[] } {
  const calls: EnqueuedDelivery[] = [];
  const producer = {
    enqueueDelivery: async (job: EnqueuedDelivery) => {
      calls.push(job);
    },
    enqueuePipeline: async () => undefined,
    enqueuePipelineFresh: async () => undefined,
    enqueueIntake: async () => undefined,
    enqueueDeadLetter: async () => undefined,
  } as unknown as QueueProducer;
  return { producer, calls };
}

describe("routing fallback is INTERNAL_MIDDLEWARE (kept in Middleware)", () => {
  let db: Database;
  let fx: Fixture;
  let disabledDestinationId: string;
  let secondDestinationId: string;
  let enqueued: EnqueuedDelivery[];
  let pipeline: PipelineService;
  let previouslyEnabledRuleIds: string[] = [];

  beforeAll(async () => {
    db = getPrisma();
    fx = await createFixture(db);
    disabledDestinationId = (
      await db.destination.create({
        data: {
          type: "WEBHOOK",
          name: unique("DisabledDestination"),
          status: "DISABLED",
          config: { url: "http://127.0.0.1:9/never-called" },
        },
      })
    ).id;
    secondDestinationId = (
      await db.destination.create({
        data: {
          type: "WEBHOOK",
          name: unique("SecondDestination"),
          status: "ACTIVE",
          config: { url: "http://127.0.0.1:9/never-called" },
        },
      })
    ).id;

    const stub = stubProducer();
    enqueued = stub.calls;
    pipeline = new PipelineService(stub.producer);

    // Routing evaluates every ENABLED rule in the database, so this file takes
    // ownership of the rule set and hands the previous state back afterwards.
    previouslyEnabledRuleIds = (
      await db.routingRule.findMany({ where: { enabled: true }, select: { id: true } })
    ).map((row) => row.id);
    await db.routingRule.updateMany({ data: { enabled: false } });
  });

  afterAll(async () => {
    await cleanupFixture(fx, db);
    if (previouslyEnabledRuleIds.length > 0) {
      await db.routingRule.updateMany({
        where: { id: { in: previouslyEnabledRuleIds } },
        data: { enabled: true },
      });
    }
  });

  /** Disables every rule except the ones this test needs. */
  async function enableOnly(...ruleIds: string[]): Promise<void> {
    await db.routingRule.updateMany({ data: { enabled: false } });
    if (ruleIds.length > 0) {
      await db.routingRule.updateMany({ where: { id: { in: ruleIds } }, data: { enabled: true } });
    }
  }

  /** Creates a rule whose condition only matches leads tagged with `marker`. */
  async function createRule(options: {
    marker: string;
    name?: string;
    priority?: number;
    stopOnMatch?: boolean;
    destinationIds: string[];
  }): Promise<string> {
    const rule = await db.routingRule.create({
      data: {
        name: options.name ?? unique("fallback-rule"),
        priority: options.priority ?? 1,
        stopOnMatch: options.stopOnMatch ?? false,
        conditions: {
          match: "ALL",
          conditions: [
            { field: "canonical.email", operator: "CONTAINS", value: options.marker },
          ],
        },
      },
    });
    for (const [index, destinationId] of [...new Set(options.destinationIds)].entries()) {
      await db.routingRuleDestination.create({
        data: { ruleId: rule.id, destinationId, order: index },
      });
    }
    return rule.id;
  }

  async function newLead(marker: string) {
    // Deduplication is off for this file so each marker produces one lead
    // (the shared config is restored by cleanupFixture).
    await db.deduplicationConfig.upsert({
      where: { instanceKey: "default" },
      create: { enabled: false, strategy: "PHONE", matchFields: [] },
      update: { enabled: false, strategy: "PHONE", matchFields: [] },
    });
    return db.lead.create({
      data: {
        sourceId: fx.sourceId,
        sourceAccountId: fx.accountId,
        canonicalData: { email: `${marker}@example.com`, phone: "+1 555 0100" },
      },
    });
  }

  async function routingResultFor(leadId: string) {
    return db.routingResult.findFirstOrThrow({ where: { leadId } });
  }

  it("CASE 1 — no rule matches: lead stays in Middleware, nothing is delivered", async () => {
    await enableOnly(); // no rules at all
    const lead = await newLead("fb-nomatch");

    const before = await new AnalyticsService().overview();
    const enqueuedBefore = enqueued.length;
    const result = await pipeline.processLead({
      leadId: lead.id,
      correlationId: "itest-fallback-1",
    });
    const after = await new AnalyticsService().overview();

    // The pipeline reports "no destination", never a failure.
    expect(result.outcome).toBe("no-destination");
    expect(result.deliveries).toBe(0);
    expect(await db.delivery.count({ where: { leadId: lead.id } })).toBe(0);
    // No BullMQ external-delivery job for the internal fallback.
    expect(enqueued.length).toBe(enqueuedBefore);

    // Still there, still traceable.
    const refreshed = await db.lead.findFirstOrThrow({ where: { id: lead.id } });
    expect(refreshed.status).toBe("PROCESSED");
    expect(refreshed.stage).toBe("COMPLETED");

    const routing = await routingResultFor(lead.id);
    expect(routing.matched).toBe(false);
    expect(routing.destinationIds).toEqual([]);
    expect(routing.reason).toContain("INTERNAL_MIDDLEWARE");

    // NOT an external delivery: no total, success or failure movement.
    expect(after.routing.fallbackLeads).toBe(before.routing.fallbackLeads + 1);
    expect(after.deliveries.total).toBe(before.deliveries.total);
    expect(after.deliveries.succeeded).toBe(before.deliveries.succeeded);
    expect(after.deliveries.failedOrDead).toBe(before.deliveries.failedOrDead);
  });

  it("CASE 2 — valid external destination: exactly one delivery job", async () => {
    const ruleId = await createRule({ marker: "fb-active", destinationIds: [fx.destinationId] });
    await enableOnly(ruleId);
    const lead = await newLead("fb-active");

    const beforeEnqueued = enqueued.length;
    const result = await pipeline.processLead({
      leadId: lead.id,
      correlationId: "itest-fallback-2",
    });

    expect(result.outcome).toBe("distributed");
    expect(result.deliveries).toBe(1);
    expect(enqueued.length).toBe(beforeEnqueued + 1);
    expect(await db.delivery.count({ where: { leadId: lead.id } })).toBe(1);

    const routing = await routingResultFor(lead.id);
    expect(routing.matched).toBe(true);
    expect(routing.destinationIds).toEqual([fx.destinationId]);
    expect(routing.reason).toContain("matched rules");
    expect(routing.reason).not.toContain("INTERNAL_MIDDLEWARE");
  });

  it("CASE 3 — multiple valid destinations: one delivery per unique destination", async () => {
    const first = await createRule({
      marker: "fb-multi",
      priority: 1,
      destinationIds: [fx.destinationId, secondDestinationId],
    });
    // A second rule re-selects the same destination: still ONE delivery for it.
    const second = await createRule({
      marker: "fb-multi",
      name: unique("multi-overlap"),
      priority: 2,
      destinationIds: [fx.destinationId],
    });
    await enableOnly(first, second);
    const lead = await newLead("fb-multi");

    const result = await pipeline.processLead({
      leadId: lead.id,
      correlationId: "itest-fallback-3",
    });

    expect(result.outcome).toBe("distributed");
    expect(result.deliveries).toBe(2); // overlap de-duplicated
    expect(await db.delivery.count({ where: { leadId: lead.id } })).toBe(2);
    expect(
      await db.delivery.count({ where: { leadId: lead.id, destinationId: secondDestinationId } }),
    ).toBe(1);
    expect(await db.delivery.count({ where: { leadId: lead.id, destinationId: fx.destinationId } })).toBe(1);
  });

  it("CASE 4/6 — stop-after-first with a DISABLED destination does not swallow the lead", async () => {
    const blocked = await createRule({
      marker: "fb-stop",
      name: unique("stop-blocked"),
      priority: 1,
      stopOnMatch: true,
      destinationIds: [disabledDestinationId],
    });
    const fallback = await createRule({
      marker: "fb-stop",
      name: unique("stop-active"),
      priority: 2,
      destinationIds: [fx.destinationId],
    });
    await enableOnly(blocked, fallback);
    const lead = await newLead("fb-stop");

    const result = await pipeline.processLead({
      leadId: lead.id,
      correlationId: "itest-fallback-4",
    });

    expect(result.outcome).toBe("distributed");
    expect(result.deliveries).toBe(1);
    const deliveries = await db.delivery.findMany({ where: { leadId: lead.id } });
    expect(deliveries).toHaveLength(1);
    // Delivered to the ACTIVE destination, never to the disabled one.
    expect(deliveries[0]?.destinationId).toBe(fx.destinationId);

    const routing = await routingResultFor(lead.id);
    expect(routing.matched).toBe(true);
    expect(routing.destinationIds).toEqual([fx.destinationId]);
  });

  it("CASE 5/7 — every destination DISABLED: rule matched, lead kept in Middleware", async () => {
    const ruleId = await createRule({
      marker: "fb-all-disabled",
      priority: 1,
      stopOnMatch: true,
      destinationIds: [disabledDestinationId],
    });
    await enableOnly(ruleId);
    const lead = await newLead("fb-all-disabled");

    const before = await new AnalyticsService().overview();
    const result = await pipeline.processLead({
      leadId: lead.id,
      correlationId: "itest-fallback-5",
    });
    const after = await new AnalyticsService().overview();

    // Not delivered, not failed — retained.
    expect(result.outcome).toBe("no-destination");
    expect(result.deliveries).toBe(0);
    expect(await db.delivery.count({ where: { leadId: lead.id } })).toBe(0);
    expect(enqueued.filter((job) => job.leadId === lead.id)).toHaveLength(0);

    const refreshed = await db.lead.findFirstOrThrow({ where: { id: lead.id } });
    expect(refreshed.status).toBe("PROCESSED");
    expect(refreshed.stage).toBe("COMPLETED");

    const routing = await routingResultFor(lead.id);
    // The rule matched — recorded honestly — but nothing was deliverable.
    expect(routing.matched).toBe(true);
    expect(routing.destinationIds).toEqual([]);
    expect(routing.reason).toMatch(/no valid external destination/i);
    expect(routing.reason).toContain("INTERNAL_MIDDLEWARE");

    // Still not an external delivery in either direction.
    expect(after.routing.fallbackLeads).toBe(before.routing.fallbackLeads + 1);
    expect(after.deliveries.total).toBe(before.deliveries.total);
    expect(after.deliveries.succeeded).toBe(before.deliveries.succeeded);
    expect(after.deliveries.failedOrDead).toBe(before.deliveries.failedOrDead);
  });

  it("no 'middleware' destination row is ever read or created for the fallback", async () => {
    const rows = await db.destination.findMany({
      where: { name: { equals: "middleware", mode: "insensitive" } },
      select: { id: true, name: true },
    });
    expect(rows).toEqual([]);
  });
});
