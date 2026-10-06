import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@middleware/database";
import { getPrisma } from "@middleware/database";
import { PipelineService } from "../../apps/worker/src/pipeline/pipeline.service";
import type { QueueProducer } from "../../apps/worker/src/queues/queue-producer";
import { cleanupFixture, createFixture, unique, RUN, type Fixture } from "./helpers";

/**
 * PIPELINE AGAINST THE REAL DATABASE.
 *
 * The queue side is stubbed on purpose: this file proves the DB effects of the
 * pipeline (stage events, dedup links, delivery identity, terminal states).
 * Worker/queue behaviour (enqueue, retry, backoff, DLQ, concurrency) is covered
 * by `pnpm test:queue` — BLOCKED until Redis is available. Do not read these
 * stubs as queue coverage.
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

describe("pipeline stage chain (real PostgreSQL, queue stubbed)", () => {
  let db: Database;
  let fx: Fixture;
  let producer: QueueProducer;
  let enqueued: EnqueuedDelivery[];
  let pipeline: PipelineService;

  beforeAll(async () => {
    db = getPrisma();
    fx = await createFixture(db);
    const stub = stubProducer();
    producer = stub.producer;
    enqueued = stub.calls;
    pipeline = new PipelineService(producer);
  });

  afterAll(async () => {
    await cleanupFixture(fx, db);
  });

  async function newLead(canonical: Record<string, unknown>, externalLeadId?: string) {
    return db.lead.create({
      data: {
        sourceId: fx.sourceId,
        sourceAccountId: fx.accountId,
        ...(externalLeadId !== undefined ? { externalLeadId } : {}),
        canonicalData: canonical,
      },
    });
  }

  function stageNames(events: Array<{ stage: string }>): string[] {
    return events.map((e) => e.stage);
  }

  it("runs every stage, records append-only events, and queues exactly one delivery", async () => {
    const lead = await newLead({
      email: "pipeline@example.com",
      phone: "+1 555 0100",
      name: { first: "Pipe", last: "Line" },
      company: "Acme",
    });

    // Catch-all routing rule → the fixture destination.
    const rule = await db.routingRule.create({
      data: { name: unique("all"), priority: 1, conditions: [], stopOnMatch: true },
    });
    await db.routingRuleDestination.create({
      data: { ruleId: rule.id, destinationId: fx.destinationId, order: 0 },
    });

    const result = await pipeline.processLead({
      leadId: lead.id,
      correlationId: "itest-pipeline-1",
    });

    expect(result.outcome).toBe("distributed");
    expect(result.deliveries).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.leadId).toBe(lead.id);

    const events = await db.leadStageEvent.findMany({
      where: { leadId: lead.id },
      orderBy: { startedAt: "asc" },
    });
    const names = stageNames(events);
    expect(names).toEqual(
      expect.arrayContaining([
        "VALIDATION",
        "NORMALIZATION",
        "DEDUPLICATION",
        "ENRICHMENT",
        "SCORING",
        "ROUTING",
        "MAPPING",
        "QUEUED",
      ]),
    );
    // COMPLETED is deliberately NOT written yet: the lead is QUEUED with a
    // delivery in flight. It is only recorded by finalizeLeadIfDone() once
    // every delivery reaches a terminal state (covered below).
    expect(names).not.toContain("COMPLETED");

    // HONEST reporting: enrichment is not implemented in Phase 1.
    const enrichment = events.find((e) => e.stage === "ENRICHMENT");
    expect(enrichment?.status).toBe("SKIPPED");
    expect((enrichment?.detail as { implemented?: boolean } | null)?.implemented).toBe(false);

    // No scoring ruleset → SKIPPED, and score stays null (never a fake 0).
    const scoring = events.find((e) => e.stage === "SCORING");
    expect(scoring?.status).toBe("SKIPPED");

    const refreshed = await db.lead.findUnique({ where: { id: lead.id } });
    expect(refreshed?.score).toBeNull();
    expect(refreshed?.stage).toBe("QUEUED");

    // Delivery identity: exactly one row, snapshot of the mapped payload.
    const deliveries = await db.delivery.findMany({ where: { leadId: lead.id } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.destinationId).toBe(fx.destinationId);
    expect(deliveries[0]?.status).toBe("QUEUED");
    expect(deliveries[0]?.mappedPayload).toMatchObject({ email: "pipeline@example.com" });

    // Routing decision is persisted as evidence.
    const routing = await db.routingResult.findMany({ where: { leadId: lead.id } });
    expect(routing).toHaveLength(1);
    expect(routing[0]?.matched).toBe(true);

    // Normalization wrote salted dedup hashes (never raw PII in index columns).
    expect(refreshed?.dedupEmailHash).toBeTruthy();
    expect(refreshed?.dedupEmailHash).not.toContain("pipeline@example.com");
  });

  it("re-running the pipeline is idempotent (no second delivery, no duplicate enqueue)", async () => {
    const lead = await db.lead.findFirstOrThrow({
      where: { canonicalData: { path: ["email"], equals: "pipeline@example.com" } },
    });

    const beforeDeliveries = await db.delivery.count({ where: { leadId: lead.id } });
    const beforeEnqueued = enqueued.length;
    const beforeEvents = await db.leadStageEvent.count({ where: { leadId: lead.id } });

    const result = await pipeline.processLead({
      leadId: lead.id,
      correlationId: "itest-pipeline-2",
    });

    expect(result.outcome).toBe("distributed");
    // Delivery identity prevents a duplicate row AND a duplicate enqueue.
    expect(
      await db.delivery.count({ where: { leadId: lead.id } }),
    ).toBe(beforeDeliveries);
    expect(enqueued.length).toBe(beforeEnqueued);

    // Stage events are append-only: history grows, nothing is rewritten.
    const afterEvents = await db.leadStageEvent.count({ where: { leadId: lead.id } });
    expect(afterEvents).toBeGreaterThan(beforeEvents);
  });

  it("rejects an invalid lead terminally (job succeeds, no retries, no delivery)", async () => {
    const lead = await newLead({ name: { full: "No Contact" } }); // no email AND no phone
    const result = await pipeline.processLead({
      leadId: lead.id,
      correlationId: "itest-invalid",
    });

    expect(result.outcome).toBe("rejected");
    expect(result.deliveries).toBe(0);

    const refreshed = await db.lead.findUnique({ where: { id: lead.id } });
    expect(refreshed?.status).toBe("REJECTED");
    expect(refreshed?.stage).toBe("FAILED");

    const processing = await db.leadProcessing.findUnique({ where: { leadId: lead.id } });
    expect(processing?.validationStatus).toBe("FAILED");
    expect(processing?.finishedAt).not.toBeNull();

    const events = await db.leadStageEvent.findMany({ where: { leadId: lead.id } });
    const validation = events.find((e) => e.stage === "VALIDATION");
    expect(validation?.status).toBe("FAILED");

    expect(await db.delivery.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("links duplicates instead of distributing them (never deletes)", async () => {
    await db.deduplicationConfig.upsert({
      where: { instanceKey: "default" },
      create: { enabled: true, strategy: "EMAIL", matchFields: [] },
      update: { enabled: true, strategy: "EMAIL", matchFields: [] },
    });

    const original = await newLead({ email: "dupe@example.com", phone: "+1 555 0200" }, "DUPE-ORIG");
    const first = await pipeline.processLead({
      leadId: original.id,
      correlationId: "itest-dupe-1",
    });
    expect(first.outcome).toBe("distributed");

    const duplicate = await newLead({ email: "DUPE@example.com ", phone: "+1 555 0200" }, "DUPE-2");
    const second = await pipeline.processLead({
      leadId: duplicate.id,
      correlationId: "itest-dupe-2",
    });

    expect(second.outcome).toBe("duplicate");
    expect(second.deliveries).toBe(0);

    // Linked, not deleted.
    expect(await db.lead.findUnique({ where: { id: duplicate.id } })).not.toBeNull();
    const link = await db.leadDuplicate.findUnique({ where: { leadId: duplicate.id } });
    expect(link).not.toBeNull();
    expect(link?.originalLeadId).toBe(original.id);

    // Distribution was skipped: only the original lead owns deliveries.
    expect(await db.delivery.count({ where: { leadId: duplicate.id } })).toBe(0);
    expect(
      await db.delivery.count({ where: { leadId: original.id } }),
    ).toBe(1);

    const refreshed = await db.lead.findUnique({ where: { id: duplicate.id } });
    expect(refreshed?.status).toBe("PROCESSED");
    expect(refreshed?.stage).toBe("COMPLETED");
  });

  it("reports 'no destination matched' honestly instead of pretending to deliver", async () => {
    // Disable every routing rule created by this run.
    await db.routingRule.updateMany({ where: { name: { contains: RUN } }, data: { enabled: false } });

    const lead = await newLead({ email: "nowhere@example.com" }, "NO-DEST-1");
    const result = await pipeline.processLead({
      leadId: lead.id,
      correlationId: "itest-no-dest",
    });

    expect(result.outcome).toBe("no-destination");
    expect(result.deliveries).toBe(0);
    expect(await db.delivery.count({ where: { leadId: lead.id } })).toBe(0);

    const refreshed = await db.lead.findUnique({ where: { id: lead.id } });
    expect(refreshed?.status).toBe("PROCESSED");
    expect(refreshed?.stage).toBe("COMPLETED");

    const events = await db.leadStageEvent.findMany({ where: { leadId: lead.id } });
    const completed = events.find((e) => e.stage === "COMPLETED");
    expect((completed?.detail as { reason?: string } | null)?.reason).toBe("no-destination-matched");
  });

  it("finalizeLeadIfDone only flips the lead when NO delivery is still in flight (CAS)", async () => {
    await db.routingRule.updateMany({ where: { name: { contains: RUN } }, data: { enabled: true } });

    const lead = await newLead({ email: "finalize@example.com" }, "FIN-1");
    await pipeline.processLead({
      leadId: lead.id,
      correlationId: "itest-finalize",
    });

    const delivery = await db.delivery.findFirstOrThrow({
      where: { leadId: lead.id },
    });

    // Still queued → not final.
    expect(await pipeline.finalizeLeadIfDone(lead.id, "itest-finalize")).toBe(false);

    // First terminal attempt wins the CAS...
    await db.delivery.update({
      where: { id: delivery.id },
      data: { status: "SUCCEEDED", attemptCount: 1, completedAt: new Date() },
    });
    expect(await pipeline.finalizeLeadIfDone(lead.id, "itest-finalize")).toBe(true);

    let refreshed = await db.lead.findUnique({ where: { id: lead.id } });
    expect(refreshed?.stage).toBe("COMPLETED");
    expect(refreshed?.status).toBe("PROCESSED");

    // Finalization writes the COMPLETED evidence row exactly once.
    const completedEvents = await db.leadStageEvent.findMany({
      where: { leadId: lead.id, stage: "COMPLETED" },
    });
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]?.status).toBe("PASSED");
    expect(completedEvents[0]?.correlationId).toBe("itest-finalize");

    // ...and a second caller does not flip it again (stage no longer matches).
    expect(await pipeline.finalizeLeadIfDone(lead.id, "itest-finalize")).toBe(false);

    // All-delivery-failure path marks the lead FAILED, never PROCESSED.
    const failing = await newLead({ email: "allfail@example.com" }, "FIN-2");
    await pipeline.processLead({
      leadId: failing.id,
      correlationId: "itest-finalize-2",
    });
    const failDelivery = await db.delivery.findFirstOrThrow({
      where: { leadId: failing.id },
    });
    await db.delivery.update({
      where: { id: failDelivery.id },
      data: { status: "FAILED", attemptCount: 5, completedAt: new Date(), errorCode: "DESTINATION_REJECTED" },
    });
    expect(await pipeline.finalizeLeadIfDone(failing.id, "itest-finalize-2")).toBe(true);

    refreshed = await db.lead.findUnique({ where: { id: failing.id } });
    expect(refreshed?.stage).toBe("FAILED");
    expect(refreshed?.status).toBe("FAILED");
  });

  it("stage events for a missing lead fail permanently instead of retrying forever", async () => {
    await expect(
      pipeline.processLead({ leadId: "lead-that-never-existed", correlationId: "x" }),
    ).rejects.toThrow(/not found/i);
  });
});
