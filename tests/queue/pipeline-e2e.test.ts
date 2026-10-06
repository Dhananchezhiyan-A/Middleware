import http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Worker, type Job, type Queue } from "bullmq";

/**
 * FULL pipeline over real infrastructure:
 *
 *   public webhook ingress → lead-intake → lead-processing (validation →
 *   normalization → dedup → scoring → routing → mapping) → delivery →
 *   REAL HTTP POST to a local destination → SUCCEEDED + lead finalized.
 *
 * Then the same external lead is re-sent and must NOT create a
 * second lead, delivery or outbound POST.
 *
 * Requires BOTH Redis (BullMQ) and PostgreSQL (middleware database).
 * Without Redis this suite is BLOCKED — see require-redis.global-setup.ts.
 * Run with: pnpm test:queue
 */

// Must be set before @middleware/config is first evaluated: the destination
// is a loopback URL, so the SSRF guard needs local-host allowance.
vi.hoisted(() => {
  process.env.SSRF_ALLOW_PRIVATE_HOSTS = "true";
});

const RUN = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

interface Captured {
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

describe("end-to-end: webhook → pipeline → delivery (real Redis + PostgreSQL)", () => {
  let server: http.Server;
  const received: Captured[] = [];
  let baseUrl = "";
  let port = 0;

  let producer: import("../../apps/worker/src/queues/queue-producer").QueueProducer;
  let queuesApi: import("../../apps/api/src/infra/redis.module").QueuesService;
  let sources: import("../../apps/api/src/modules/sources/sources.service").SourcesService;
  let webhooks: import("../../apps/api/src/modules/webhooks/webhooks.service").WebhooksService;
  let prisma: ReturnType<typeof import("@middleware/database").getPrisma>;
  let workers: Worker[] = [];
  let queues: Queue[] = [];

  let sourceId = "";
  let accountId = "";
  let destinationId = "";

  beforeAll(async () => {
    // --- local destination server -------------------------------------------
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          received.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch {
          received.push({ headers: req.headers, body: null });
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
    baseUrl = `http://127.0.0.1:${port}/lead`;

    // --- application wiring (services are plain classes, no Nest bootstrap) ---
    const { AuditService } = await import("../../apps/api/src/infra/audit.module");
    const { SourcesService } = await import("../../apps/api/src/modules/sources/sources.service");
    const { WebhooksService } = await import("../../apps/api/src/modules/webhooks/webhooks.service");
    const { QueuesService } = await import("../../apps/api/src/infra/redis.module");
    const { QueueProducer } = await import("../../apps/worker/src/queues/queue-producer");
    const { PipelineService } = await import("../../apps/worker/src/pipeline/pipeline.service");
    const { DeliveryService } = await import("../../apps/worker/src/delivery/delivery.service");
    const { IntakeProcessor } = await import("../../apps/worker/src/processors/intake.processor");
    const { PipelineProcessor } = await import("../../apps/worker/src/processors/pipeline.processor");
    const { getPrisma } = await import("@middleware/database");
    const { redisConnectionOptions } = await import("@middleware/shared");
    const { backoffDelayMs } = await import("@middleware/types");

    prisma = getPrisma();
    const audit = new AuditService();
    sources = new SourcesService(audit);
    producer = new QueueProducer();
    queuesApi = new QueuesService();
    webhooks = new WebhooksService(sources, queuesApi);
    const pipeline = new PipelineService(producer);
    const deliveryService = new DeliveryService(pipeline);
    const intakeProcessor = new IntakeProcessor(producer);
    const pipelineProcessor = new PipelineProcessor(pipeline);

    const connection = redisConnectionOptions();
    const settings = {
      backoffStrategy: (attemptsMade: number, _type?: string, err?: Error) => {
        void err;
        return backoffDelayMs(attemptsMade);
      },
    };

    const spawn = (queueName: string, handler: (job: Job) => Promise<unknown>, concurrency = 2) => {
      const queue = producer.get(queueName);
      queues.push(queue);
      const worker = new Worker(queueName, handler, { connection, concurrency, settings });
      workers.push(worker);
    };

    spawn("lead-intake", (job) => intakeProcessor.process(job as never));
    spawn("lead-processing", (job) => pipelineProcessor.process(job as never));
    spawn("delivery", (job) => deliveryService.attempt(job as never), 3);

    // --- seed source/destination/routing -------------------------------------
    const source = await prisma.leadSource.create({
      data: { type: "WEBHOOK", code: `qtest-${RUN}`, name: "Queue E2E Webhook" },
    });
    sourceId = source.id;

    const accountResult = await sources.createAccount(
      { userId: "qtest", email: "qtest@example.com", role: "admin", permissions: [], actorType: "USER", correlationId: RUN } as never,
      sourceId,
      { name: "Queue E2E account", config: { provider: "generic", requiredFields: ["name", "phone"] } },
    );
    accountId = accountResult.id;

    const destination = await prisma.destination.create({
      data: {
        type: "WEBHOOK",
        name: `qtest-dest-${RUN}`,
        config: { url: baseUrl, timeoutMs: 5_000 },
      },
    });
    destinationId = destination.id;

    // Catch-all routing rule → the destination (empty conditions match all).
    const rule = await prisma.routingRule.create({
      data: { name: `qtest-all-${RUN}`, priority: 1, conditions: [], stopOnMatch: true },
    });
    await prisma.routingRuleDestination.create({
      data: { ruleId: rule.id, destinationId, order: 0 },
    });
  }, 60_000);

  afterAll(async () => {
    for (const w of workers) await w.close(true).catch(() => undefined);
    workers = [];
    for (const q of queues) await q.close().catch(() => undefined);
    queues = [];
    await producer?.onModuleDestroy().catch(() => undefined);
    await queuesApi?.onModuleDestroy().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));

    if (prisma && sourceId) {
      // Ordered cleanup: children first where FKs are Restrict. Everything
      // this suite created hangs off the fixture ids seeded in beforeAll —
      // there is no tenant column to scope on anymore.
      const leadRows = await prisma.lead
        .findMany({ where: { sourceId }, select: { id: true } })
        .catch(() => [] as { id: string }[]);
      const leadIds = leadRows.map((r) => r.id);
      const deliveryRows = await prisma.delivery
        .findMany({ where: { OR: [{ leadId: { in: leadIds } }, { destinationId }] }, select: { id: true } })
        .catch(() => [] as { id: string }[]);
      const deliveryIds = deliveryRows.map((r) => r.id);
      await prisma.deliveryAttempt.deleteMany({ where: { deliveryId: { in: deliveryIds } } }).catch(() => undefined);
      await prisma.auditLog
        .deleteMany({ where: { entityId: { in: [...leadIds, ...deliveryIds, sourceId, accountId, destinationId] } } })
        .catch(() => undefined);
      await prisma.delivery.deleteMany({ where: { id: { in: deliveryIds } } }).catch(() => undefined);
      await prisma.leadStageEvent.deleteMany({ where: { leadId: { in: leadIds } } }).catch(() => undefined);
      await prisma.leadScore.deleteMany({ where: { leadId: { in: leadIds } } }).catch(() => undefined);
      await prisma.leadDuplicate.deleteMany({ where: { leadId: { in: leadIds } } }).catch(() => undefined);
      await prisma.routingResult.deleteMany({ where: { leadId: { in: leadIds } } }).catch(() => undefined);
      await prisma.leadProcessing.deleteMany({ where: { leadId: { in: leadIds } } }).catch(() => undefined);
      await prisma.leadRawPayload.deleteMany({ where: { leadId: { in: leadIds } } }).catch(() => undefined);
      await prisma.lead.deleteMany({ where: { id: { in: leadIds } } }).catch(() => undefined);
      await prisma.webhookEvent.deleteMany({ where: { sourceAccountId: accountId } }).catch(() => undefined);
      await prisma.routingRuleDestination.deleteMany({ where: { destinationId } }).catch(() => undefined);
      await prisma.routingRule.deleteMany({ where: { name: `qtest-all-${RUN}` } }).catch(() => undefined);
      await prisma.destinationHealth.deleteMany({ where: { destinationId } }).catch(() => undefined);
      await prisma.destination.deleteMany({ where: { id: destinationId } }).catch(() => undefined);
      await prisma.leadSourceAccount.deleteMany({ where: { id: accountId } }).catch(() => undefined);
      await prisma.leadSource.deleteMany({ where: { id: sourceId } }).catch(() => undefined);
      // Tenant rows leaked by pre-refactor runs of this suite (the seeded
      // application row never matches this prefix).
      await prisma.tenant.deleteMany({ where: { name: { startsWith: "Queue E2E" } } }).catch(() => undefined);
    }
  }, 60_000);

  async function waitFor(check: () => Promise<boolean>, timeoutMs = 45_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return check();
  }

  it("ingresses an unsigned public webhook and processes it through to a real delivery", async () => {
    const payload = {
      externalLeadId: `${RUN}-lead`,
      leadId: "LD-9999999",
      email: "e2e.lead@example.com",
      phone: "+91 98765 43210",
      name: "Queue Tester",
      company: "E2E Builders",
      city: "Chennai",
    };
    const rawBody = JSON.stringify(payload);

    const result = await webhooks.ingress(
      await publicId(),
      payload,
      {},
      rawBody,
      "127.0.0.1",
    );

    expect(result.received).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.leadId).toBeTruthy();

    // Wait for the full pipeline + delivery over real queues.
    const delivered = await waitFor(async () => {
      const lead = await prisma.lead.findUnique({ where: { id: result.leadId as string } });
      return lead?.stage === "COMPLETED" && lead.status === "PROCESSED";
    });
    expect(delivered).toBe(true);

    const lead = await prisma.lead.findUnique({ where: { id: result.leadId as string } });
    expect(lead?.leadId).toMatch(/^LD-[0-9]{7}$/);
    expect(lead?.leadId).not.toBe(payload.leadId);
    expect(lead?.score).toBeNull(); // no scoring ruleset → honest SKIPPED, not a fake 0

    const delivery = await prisma.delivery.findFirst({
      where: { leadId: result.leadId as string, destinationId },
      include: { attempts: true },
    });
    expect(delivery).not.toBeNull();
    expect(delivery?.status).toBe("SUCCEEDED");
    expect(delivery?.attemptCount).toBe(1);
    expect(delivery?.attempts).toHaveLength(1);
    expect(delivery?.attempts[0]?.status).toBe("SUCCEEDED");

    // Exactly ONE real HTTP POST reached the destination.
    expect(received).toHaveLength(1);
    const body = received[0]?.body as { payload?: Record<string, unknown>; idempotencyKey?: string };
    expect(body.payload?.email).toBe("e2e.lead@example.com");
    expect(body.payload?.company).toBe("E2E Builders");

    // Webhook event fully processed + linked.
    const event = await prisma.webhookEvent.findFirst({
      where: { externalEventId: `${RUN}-lead` },
    });
    expect(event?.status).toBe("PROCESSED");
    expect(event?.leadId).toBe(result.leadId);

    // Destination health reflects the REAL probe/attempt.
    const health = await prisma.destinationHealth.findUnique({ where: { destinationId } });
    expect(health?.status).toBe("CONNECTED");

    // Stage timeline exists (append-only evidence).
    const stages = await prisma.leadStageEvent.findMany({
      where: { leadId: result.leadId as string },
      orderBy: { startedAt: "asc" },
    });
    const names = stages.map((s) => s.stage);
    expect(names).toEqual(
      expect.arrayContaining(["VALIDATION", "NORMALIZATION", "DEDUPLICATION", "SCORING", "ROUTING", "MAPPING", "QUEUED"]),
    );
    expect(names).toContain("COMPLETED");
    const enrichment = stages.find((s) => s.stage === "ENRICHMENT");
    expect(enrichment?.status).toBe("SKIPPED"); // honest: not implemented, never fake-passed

    // Correlation ID propagation: the id minted at ingress (wh:<eventId>)
    // must reach every downstream row — processing, lead, delivery, attempt.
    const expectedCorrelation = `wh:${event.id}`;
    const processing = await prisma.leadProcessing.findUnique({
      where: { leadId: result.leadId as string },
    });
    expect(processing?.correlationId).toBe(expectedCorrelation);
    expect(lead?.correlationId).toBe(expectedCorrelation);
    expect(delivery?.correlationId).toBe(expectedCorrelation);
    expect(stages.every((s) => s.correlationId === expectedCorrelation)).toBe(true);
  }, 60_000);

  it("collapses duplicate webhook deliveries of the SAME external lead", async () => {
    const payload = {
      externalLeadId: `${RUN}-lead`,
      leadId: "LD-9999999",
      email: "e2e.lead@example.com",
      phone: "+91 98765 43210",
      name: "Queue Tester",
      company: "E2E Builders",
      city: "Chennai",
    };
    const rawBody = JSON.stringify(payload);

    const replay = await webhooks.ingress(
      await publicId(),
      payload,
      {},
      rawBody,
      "127.0.0.1",
    );

    expect(replay.received).toBe(true);
    expect(replay.duplicate).toBe(true);

    const leadCount = await prisma.lead.count({ where: { sourceId } });
    expect(leadCount).toBe(1); // no second lead
    const deliveryCount = await prisma.delivery.count({ where: { destinationId } });
    expect(deliveryCount).toBe(1); // no second delivery

    // And no additional outbound POST arrives.
    await new Promise((r) => setTimeout(r, 1_500));
    expect(received).toHaveLength(1);
  }, 30_000);

  async function publicId(): Promise<string> {
    const account = await prisma.leadSourceAccount.findFirst({ where: { id: accountId } });
    return account?.publicId ?? "";
  }
});
