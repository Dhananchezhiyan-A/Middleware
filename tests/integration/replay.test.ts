import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { Database } from "@middleware/database";
import { getPrisma } from "@middleware/database";
import { UnrecoverableError } from "bullmq";
import { PipelineService } from "../../apps/worker/src/pipeline/pipeline.service";
import { DeliveryService, DeliveryRetryError } from "../../apps/worker/src/delivery/delivery.service";
import { ReplayProcessor } from "../../apps/worker/src/processors/replay.processor";
import { DeliveriesService } from "../../apps/api/src/modules/deliveries/deliveries.service";
import type { QueueProducer } from "../../apps/worker/src/queues/queue-producer";
import type { RequestActor } from "@middleware/types";
import { cleanupFixture, createFixture, unique, RUN, type Fixture } from "./helpers";

/**
 * REPLAY REGRESSION SUITE (permanent).
 *
 * Covers the Phase 2 findings:
 *  A. Delivery replay attempt numbering continues globally (6..10, 11..15, …)
 *  B. Multiple replays each start a fresh cycle
 *  C. Historical DeliveryAttempt rows are immutable (never renumbered/reused)
 *  D. Lead replay finalizes IMMEDIATELY when every delivery is reused
 *     (enqueued === 0) — no 10-minute sweeper wait
 *  E. Multi-destination reuse never duplicates delivery rows
 *  F. Partial reuse (delivery still in flight) does not finalize early
 *  G. A DEAD delivery can be replayed into a successful cycle
 *  H. A SUCCEEDED delivery is never resent (API refuses + worker skips stale jobs)
 *
 * Real PostgreSQL through Prisma; the queue is stubbed on purpose (queue
 * behaviour is `pnpm test:queue`). HTTP attempts hit 127.0.0.1:9 (refused →
 * retryable transport failure) and a local success server spun up here.
 */

interface QueueCalls {
  deliveries: unknown[];
  fresh: unknown[];
  replays: unknown[];
}

function stubProducer(calls: QueueCalls): QueueProducer {
  return {
    enqueueDelivery: async (job: unknown) => {
      calls.deliveries.push(job);
    },
    enqueueDeliveryFresh: async (job: unknown) => {
      calls.fresh.push(job);
    },
    enqueueReplay: async (job: unknown) => {
      calls.replays.push(job);
    },
    enqueuePipeline: async () => undefined,
    enqueuePipelineFresh: async () => undefined,
    enqueueIntake: async () => undefined,
    enqueueDeadLetter: async () => undefined,
  } as unknown as QueueProducer;
}

describe("delivery replay attempt history + lead replay finalization", () => {
  let db: Database;
  let fx: Fixture;
  let userId: string;
  let calls: QueueCalls;
  let pipeline: PipelineService;
  let deliverySvc: DeliveryService;
  let replayProc: ReplayProcessor;
  let apiDeliveries: DeliveriesService;
  let sink: Server;
  let sinkUrl: string;
  let sinkHits = 0;

  const CORRELATION = "itest-replay";

  beforeAll(async () => {
    db = getPrisma();
    fx = await createFixture(db);

    // Real user — ReplayProcessor's audit row FKs actorId -> User.
    const role = await db.role.create({
      data: { name: unique("Replay Tester"), permissions: [] },
    });
    const user = await db.user.create({
      data: {
        roleId: role.id,
        email: `${unique("replay")}@itest.local`,
        passwordHash: "itest-hash",
        name: "Replay Tester",
      },
    });
    userId = user.id;

    // Local success sink for the replay-to-success scenario.
    sink = createServer((_req, res) => {
      sinkHits += 1;
      res.statusCode = 200;
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
    const addr = sink.address();
    if (addr === null || typeof addr === "string") throw new Error("sink not listening");
    sinkUrl = `http://127.0.0.1:${addr.port}/ok`;

    calls = { deliveries: [], fresh: [], replays: [] };
    const producer = stubProducer(calls);
    pipeline = new PipelineService(producer);
    deliverySvc = new DeliveryService(pipeline);
    replayProc = new ReplayProcessor(producer);
    apiDeliveries = new DeliveriesService({} as never, {} as never);
  });

  afterAll(async () => {
    await cleanupFixture(fx, db);
    if (sink) await new Promise<void>((resolve) => sink.close(() => resolve()));
  });

  async function newLead(externalId: string) {
    return db.lead.create({
      data: {
        sourceId: fx.sourceId,
        sourceAccountId: fx.accountId,
        externalLeadId: externalId,
        canonicalData: { email: `${externalId.toLowerCase()}@example.com`, phone: "+1 555 0101" },
      },
    });
  }

  function fakeJob(deliveryId: string, cycleLocalAttempt: number) {
    return {
      data: { deliveryId, correlationId: CORRELATION },
      opts: { attempts: 5 },
      // Fresh BullMQ job per cycle: attemptsMade restarts with every replay.
      attemptsMade: cycleLocalAttempt,
    };
  }

  /** Drives one full attempt cycle (like a fresh BullMQ job would) to terminal. */
  async function driveCycle(deliveryId: string): Promise<string> {
    for (let i = 0; i < 12; i += 1) {
      const d = await db.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
      if (["SUCCEEDED", "FAILED", "DEAD"].includes(d.status)) return d.status;
      try {
        await deliverySvc.attempt(fakeJob(deliveryId, i) as never);
      } catch (err) {
        if (err instanceof DeliveryRetryError || err instanceof UnrecoverableError) continue;
        throw err;
      }
    }
    throw new Error(`cycle for ${deliveryId} did not terminate`);
  }

  async function attemptRows(deliveryId: string) {
    return db.deliveryAttempt.findMany({
      where: { deliveryId },
      orderBy: { attemptNumber: "asc" },
    });
  }

  const terminal = (status: string) => ["SUCCEEDED", "FAILED", "DEAD"].includes(status);

  /** AuditLog.metadata is a Json column — Prisma returns it already parsed. */
  function auditMeta(raw: unknown): Record<string, unknown> {
    if (raw == null) return {};
    if (typeof raw === "string") return JSON.parse(raw) as Record<string, unknown>;
    return raw as Record<string, unknown>;
  }

  // ===========================================================================
  // Original cycle + replay numbering (A, B, C, G)
  // ===========================================================================

  let cycleDeliveryId: string;
  let originalSnapshot: unknown;

  it("original delivery records attempts 1..5 as immutable rows (cycle 0)", async () => {
    const lead = await newLead("REPLAY-CYCLE-1");
    const delivery = await db.delivery.create({
      data: {
        leadId: lead.id,
        destinationId: fx.destinationId,
        status: "QUEUED",
        maxAttempts: 5,
        mappedPayload: { email: "cycle@example.com" },
        correlationId: CORRELATION,
        enqueuedAt: new Date(),
      },
    });
    cycleDeliveryId = delivery.id;

    const finalStatus = await driveCycle(cycleDeliveryId);
    expect(finalStatus).toBe("DEAD");

    const rows = await attemptRows(cycleDeliveryId);
    expect(rows.map((r) => r.attemptNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.every((r) => r.replayCycle === 0)).toBe(true);

    const after = await db.delivery.findUniqueOrThrow({ where: { id: cycleDeliveryId } });
    expect(after.status).toBe("DEAD");
    expect(after.attemptCount).toBe(5);
    expect(after.maxAttempts).toBe(5);
    expect(after.replayCount).toBe(0);
    expect(after.cycleStartAttempt).toBe(1);

    // Terminal failure is audited (audit logging requirement).
    const dead = await db.auditLog.findMany({
      where: { action: "delivery.dead", entityId: cycleDeliveryId },
    });
    expect(dead.length).toBeGreaterThanOrEqual(1);

    originalSnapshot = rows;
  });

  it("replay starts cycle 2 at attempt 6 without touching history (A, C)", async () => {
    await replayProc.process({
      data: { deliveryId: cycleDeliveryId, requestedBy: userId, correlationId: CORRELATION },
    } as never);

    // Fresh job queued for the replay.
    expect(calls.fresh).toHaveLength(1);

    const d = await db.delivery.findUniqueOrThrow({ where: { id: cycleDeliveryId } });
    expect(d.status).toBe("QUEUED");
    expect(d.attemptCount).toBe(5); // NOT reset — global counter preserved
    expect(d.replayCount).toBe(1);
    expect(d.cycleStartAttempt).toBe(6);
    expect(d.maxAttempts).toBe(10); // 5 + cycle size (DELIVERY_MAX_ATTEMPTS)

    // Replay audit carries the cycle information.
    const replayed = await db.auditLog.findMany({
      where: { action: "delivery.replayed", entityId: cycleDeliveryId },
    });
    expect(replayed).toHaveLength(1);
    const meta = auditMeta(replayed[0]?.metadata);
    expect(meta.replayCycle).toBe(1);
    expect(meta.resumesAtAttempt).toBe(6);
    expect(meta.previousAttempts).toBe(5);

    // No new attempt rows exist yet — history untouched before the cycle runs.
    expect((await attemptRows(cycleDeliveryId)).map((r) => r.attemptNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it("cycle-local backoff restarts the ladder for replay attempts", async () => {
    // One manual attempt of cycle 2: attempt 6 fails -> QUEUED with a fresh
    // ~2s delay (a global ladder would schedule ~64s for attempt 6).
    await expect(deliverySvc.attempt(fakeJob(cycleDeliveryId, 0) as never)).rejects.toBeInstanceOf(
      DeliveryRetryError,
    );
    const d = await db.delivery.findUniqueOrThrow({ where: { id: cycleDeliveryId } });
    expect(d.status).toBe("QUEUED");
    expect(d.attemptCount).toBe(6);
    const wait = (d.nextAttemptAt?.getTime() ?? 0) - Date.now();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThan(4_000); // ~2s ±10% jitter, never the 64s global step

    const rows = await attemptRows(cycleDeliveryId);
    expect(rows.find((r) => r.attemptNumber === 6)?.replayCycle).toBe(1);
  });

  it("cycle 2 exhausts at attempt 10; original rows stay byte-identical (B, C)", async () => {
    // Continue after the manual attempt above (attemptCount = 6).
    for (let i = 1; i < 12; i += 1) {
      const d = await db.delivery.findUniqueOrThrow({ where: { id: cycleDeliveryId } });
      if (terminal(d.status)) break;
      try {
        await deliverySvc.attempt(fakeJob(cycleDeliveryId, i) as never);
      } catch (err) {
        if (err instanceof DeliveryRetryError || err instanceof UnrecoverableError) continue;
        throw err;
      }
    }

    const d = await db.delivery.findUniqueOrThrow({ where: { id: cycleDeliveryId } });
    expect(d.status).toBe("DEAD");
    expect(d.attemptCount).toBe(10); // 5 original + 5 replay
    expect(d.maxAttempts).toBe(10);
    expect(d.replayCount).toBe(1);

    const rows = await attemptRows(cycleDeliveryId);
    expect(rows.map((r) => r.attemptNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows.filter((r) => r.replayCycle === 1).map((r) => r.attemptNumber)).toEqual([6, 7, 8, 9, 10]);

    // IMMUTABILITY: the original five rows are byte-for-byte unchanged after
    // a full replay cycle.
    expect(rows.slice(0, 5)).toEqual(originalSnapshot);
  });

  it("second replay (cycle 3) succeeds at attempt 11 with replayCycle 2 (B, G)", async () => {
    // Destination now works — replay must be able to SUCCEED.
    await db.destination.update({
      where: { id: fx.destinationId },
      data: { config: { url: sinkUrl } },
    });
    const hitsBefore = sinkHits;

    await replayProc.process({
      data: { deliveryId: cycleDeliveryId, requestedBy: userId, correlationId: CORRELATION },
    } as never);
    const queued = await db.delivery.findUniqueOrThrow({ where: { id: cycleDeliveryId } });
    expect(queued.replayCount).toBe(2);
    expect(queued.cycleStartAttempt).toBe(11);
    expect(queued.maxAttempts).toBe(15);
    expect(queued.attemptCount).toBe(10); // PRESERVED by the replay (not reset to 0/5)

    const finalStatus = await driveCycle(cycleDeliveryId);
    expect(finalStatus).toBe("SUCCEEDED");

    const d = await db.delivery.findUniqueOrThrow({ where: { id: cycleDeliveryId } });
    expect(d.attemptCount).toBe(11);
    expect(d.status).toBe("SUCCEEDED");
    expect(d.errorCode).toBeNull();

    const rows = await attemptRows(cycleDeliveryId);
    expect(rows.map((r) => r.attemptNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(rows[10]?.replayCycle).toBe(2);
    expect(rows[10]?.status).toBe("SUCCEEDED");
    expect(rows[10]?.responseStatus).toBe(200);

    // The replay really hit the wire exactly once (attempt 11).
    expect(sinkHits - hitsBefore).toBe(1);

    // Full-history immutability after TWO replays.
    expect(rows.slice(0, 5)).toEqual(originalSnapshot);

    // Success is audited like any terminal state.
    const ok = await db.auditLog.findMany({
      where: { action: "delivery.succeeded", entityId: cycleDeliveryId },
    });
    expect(ok.length).toBeGreaterThanOrEqual(1);
  });

  // ===========================================================================
  // Successful delivery is never resent (H)
  // ===========================================================================

  it("refuses to replay a SUCCEEDED delivery and never resends it (H)", async () => {
    const actor = {
      userId,
      correlationId: CORRELATION,
      use: "USER",
      permissions: ["*"],
    } as unknown as RequestActor;

    await expect(apiDeliveries.replay(actor, cycleDeliveryId)).rejects.toThrow(/already succeeded/i);
    expect(calls.replays).toHaveLength(0); // nothing was queued

    // Stale/duplicate delivery job arriving after success: skipped without a
    // transport call (idempotency — terminal deliveries only change via replay).
    const hitsBefore = sinkHits;
    const rowsBefore = await attemptRows(cycleDeliveryId);
    await deliverySvc.attempt(fakeJob(cycleDeliveryId, 0) as never);
    expect(sinkHits).toBe(hitsBefore);
    expect(await attemptRows(cycleDeliveryId)).toEqual(rowsBefore);

    const d = await db.delivery.findUniqueOrThrow({ where: { id: cycleDeliveryId } });
    expect(d.status).toBe("SUCCEEDED");
    expect(d.attemptCount).toBe(11);
  });

  // ===========================================================================
  // Lead replay finalization when enqueued === 0 (D, E, F)
  // ===========================================================================

  async function makeDestination(url: string) {
    return db.destination.create({
      data: { type: "WEBHOOK", name: unique("Dst"), status: "ACTIVE", config: { url } },
    });
  }

  it("finalizes the lead IMMEDIATELY when all deliveries are reused (D, E)", async () => {
    // Isolate routing: only this test's rule may match (empty conditions would
    // otherwise let an earlier rule cascade via stopOnMatch).
    await db.routingRule.updateMany({ where: { name: { contains: RUN } }, data: { enabled: false } });

    // Three destinations: SUCCEEDED + DEAD + SUCCEEDED (failed one with
    // successful siblings), all terminal before the replay.
    const dA = await makeDestination(sinkUrl);
    const dB = await makeDestination("http://127.0.0.1:9/never");
    const dC = await makeDestination(sinkUrl);

    const rule = await db.routingRule.create({
      data: { name: unique("all"), priority: 1, conditions: [], stopOnMatch: true },
    });
    for (const [i, d] of [dA, dB, dC].entries()) {
      await db.routingRuleDestination.create({
        data: { ruleId: rule.id, destinationId: d.id, order: i },
      });
    }

    const lead = await newLead("REPLAY-LEAD-1");
    for (const [dest, status, attempts] of [
      [dA, "SUCCEEDED", 1],
      [dB, "DEAD", 5],
      [dC, "SUCCEEDED", 1],
    ] as const) {
      const delivery = await db.delivery.create({
        data: {
          leadId: lead.id,
          destinationId: dest.id,
          status,
          attemptCount: attempts,
          maxAttempts: 5,
          completedAt: new Date(),
          mappedPayload: { email: "pre@example.com" },
          correlationId: CORRELATION,
          enqueuedAt: new Date(),
        },
      });
      // Realistic immutable history a completed run would have produced.
      await db.deliveryAttempt.createMany({
        data: Array.from({ length: attempts }, (_, i) => ({
          deliveryId: delivery.id,
          attemptNumber: i + 1,
          status: status === "SUCCEEDED" ? ("SUCCEEDED" as const) : ("FAILED" as const),
          durationMs: 1,
          finishedAt: new Date(),
        })),
      });
    }

    const freshBefore = calls.deliveries.length;
    const startedAt = Date.now();
    const result = await pipeline.processLead({ leadId: lead.id, correlationId: CORRELATION });
    const elapsed = Date.now() - startedAt;

    expect(result.outcome).toBe("distributed");
    // All three rows reused — nothing new was enqueued.
    expect(calls.deliveries.length).toBe(freshBefore);
    expect(await db.delivery.count({ where: { leadId: lead.id } })).toBe(3);

    // FINAL: no sweeper wait (STALE_MS is 10 minutes — assert seconds).
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.stage).toBe("COMPLETED");
    expect(after.status).toBe("PROCESSED");
    expect(elapsed).toBeLessThan(5_000);

    // Honest aggregate: 2 of 3 succeeded, 1 dead sibling did not sink the lead.
    const completedEvents = await db.leadStageEvent.findMany({
      where: { leadId: lead.id, stage: "COMPLETED" },
    });
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]?.status).toBe("PASSED");
    const detail = completedEvents[0]?.detail as { total: number; succeeded: number; failed: number };
    expect(detail).toEqual({ total: 3, succeeded: 2, failed: 1 });
  });

  it("partial reuse: does not finalize while a delivery is still in flight (F)", async () => {
    await db.routingRule.updateMany({ where: { name: { contains: RUN } }, data: { enabled: false } });
    const dest = await makeDestination(sinkUrl);
    const rule = await db.routingRule.create({
      data: { name: unique("one"), priority: 2, conditions: [], stopOnMatch: true },
    });
    await db.routingRuleDestination.create({
      data: { ruleId: rule.id, destinationId: dest.id, order: 0 },
    });

    const lead = await newLead("REPLAY-LEAD-2");
    await db.delivery.create({
      data: {
        leadId: lead.id,
        destinationId: dest.id,
        status: "QUEUED", // reused but still in flight
        maxAttempts: 5,
        mappedPayload: { email: "inflight@example.com" },
        correlationId: CORRELATION,
        enqueuedAt: new Date(),
      },
    });

    await pipeline.processLead({ leadId: lead.id, correlationId: CORRELATION });

    // enqueued === 0 but the reused row is active -> lead must NOT finalize.
    let after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.stage).toBe("QUEUED");
    expect(after.status).toBe("PROCESSING");

    // Worker completes the delivery -> finalization flips it.
    await db.delivery.updateMany({
      where: { leadId: lead.id },
      data: { status: "SUCCEEDED", attemptCount: 1, completedAt: new Date() },
    });
    expect(await pipeline.finalizeLeadIfDone(lead.id, CORRELATION)).toBe(true);
    after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.stage).toBe("COMPLETED");
    expect(after.status).toBe("PROCESSED");
    expect(await db.delivery.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("all-reused FAILED deliveries finalize the lead as FAILED immediately", async () => {
    await db.routingRule.updateMany({ where: { name: { contains: RUN } }, data: { enabled: false } });
    const dest = await makeDestination("http://127.0.0.1:9/never");
    const rule = await db.routingRule.create({
      data: { name: unique("failrule"), priority: 3, conditions: [], stopOnMatch: true },
    });
    await db.routingRuleDestination.create({
      data: { ruleId: rule.id, destinationId: dest.id, order: 0 },
    });

    const lead = await newLead("REPLAY-LEAD-3");
    await db.delivery.create({
      data: {
        leadId: lead.id,
        destinationId: dest.id,
        status: "FAILED",
        attemptCount: 1,
        maxAttempts: 5,
        completedAt: new Date(),
        errorCode: "DESTINATION_REJECTED",
        mappedPayload: { email: "rejected@example.com" },
        correlationId: CORRELATION,
        enqueuedAt: new Date(),
      },
    });

    await pipeline.processLead({ leadId: lead.id, correlationId: CORRELATION });

    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.stage).toBe("FAILED");
    expect(after.status).toBe("FAILED");
    expect(await db.delivery.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("replaying the DEAD sibling of a completed lead re-runs only that delivery", async () => {
    // Locate the DEAD delivery from the multi-destination scenario above.
    const dead = await db.delivery.findFirstOrThrow({
      where: { status: "DEAD" },
    });
    expect(dead.attemptCount).toBe(5);

    // Destination works now — replay goes through a full new cycle.
    await db.destination.update({ where: { id: dead.destinationId }, data: { config: { url: sinkUrl } } });
    const freshBefore = calls.fresh.length;
    const historyBefore = await attemptRows(dead.id);
    expect(historyBefore.map((r) => r.attemptNumber)).toEqual([1, 2, 3, 4, 5]);

    await replayProc.process({
      data: { deliveryId: dead.id, requestedBy: userId, correlationId: CORRELATION },
    } as never);
    expect(calls.fresh.length).toBe(freshBefore + 1);

    const status = await driveCycle(dead.id);
    expect(status).toBe("SUCCEEDED");

    const after = await db.delivery.findUniqueOrThrow({ where: { id: dead.id } });
    // Destination was fixed before the replay, so cycle 2 succeeds on its
    // FIRST attempt — numbering continues at 6 regardless.
    expect(after.attemptCount).toBe(6); // 5 dead + 1 successful replayed attempt
    expect(after.replayCount).toBe(1);
    expect(after.cycleStartAttempt).toBe(6);

    const rows = await attemptRows(dead.id);
    expect(rows.map((r) => r.attemptNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.filter((r) => r.replayCycle === 1)).toHaveLength(1);
    expect(rows[5]?.status).toBe("SUCCEEDED");
    expect(rows[5]?.replayCycle).toBe(1);
    // Historical rows untouched by the replay.
    expect(rows.slice(0, 5)).toEqual(historyBefore);
  });
});
