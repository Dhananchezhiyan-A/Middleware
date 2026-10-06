import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Worker, type Job, type WorkerOptions } from "bullmq";
import Redis from "ioredis";
import { getEnv } from "@middleware/config";
import { getPrisma } from "@middleware/database";
import { backoffDelayMs, QUEUES, type QueueName } from "@middleware/types";
import { newCorrelationId, redisConnectionOptions, runWithContext } from "@middleware/shared";
import { QueueProducer } from "../queues/queue-producer";
import { DeliveryService, DeliveryRetryError } from "../delivery/delivery.service";
import { PipelineService } from "../pipeline/pipeline.service";
import { IntakeProcessor } from "../processors/intake.processor";
import { PipelineProcessor } from "../processors/pipeline.processor";
import { ReplayProcessor } from "../processors/replay.processor";
import { CsvImportProcessor } from "../processors/csv-import.processor";

/**
 * BullMQ consumer wiring: every queue has a REAL worker with an explicit
 * concurrency, a custom backoff strategy (honors destination Retry-After),
 * dead-letter handling on exhaustion, and graceful shutdown that waits for
 * in-flight jobs.
 *
 * Redis is REQUIRED. On startup the worker probes Redis and fails fast with
 * an actionable error instead of pretending to run while processing nothing.
 */

const SWEEP_JOB = "sweep-deliveries";
const SWEEP_EVERY_MS = 60_000;
const STALE_MS = 10 * 60_000;

type Handler = (job: Job) => Promise<unknown>;

@Injectable()
export class WorkersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkersService.name);
  private readonly workers: Worker[] = [];

  constructor(
    private readonly producer: QueueProducer,
    private readonly intake: IntakeProcessor,
    private readonly pipelineProcessor: PipelineProcessor,
    private readonly pipeline: PipelineService,
    private readonly delivery: DeliveryService,
    private readonly replay: ReplayProcessor,
    private readonly csvImport: CsvImportProcessor,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.probeRedisOrFailFast();

    const env = getEnv();
    this.spawn(QUEUES.LEAD_INTAKE, env.LEAD_INTAKE_CONCURRENCY, (job) =>
      this.intake.process(job as never),
    );
    this.spawn(QUEUES.LEAD_PROCESSING, env.LEAD_PROCESSING_CONCURRENCY, (job) =>
      this.pipelineProcessor.process(job as never),
    );
    this.spawn(QUEUES.ENRICHMENT, 2, (job) =>
      this.pipelineProcessor.processStage(job as never, "ENRICHMENT"),
    );
    this.spawn(QUEUES.SCORING, 2, (job) =>
      this.pipelineProcessor.processStage(job as never, "SCORING"),
    );
    this.spawn(QUEUES.ROUTING, 2, (job) =>
      this.pipelineProcessor.processStage(job as never, "ROUTING"),
    );
    this.spawn(QUEUES.DELIVERY, env.DELIVERY_CONCURRENCY, (job) => this.delivery.attempt(job as never));
    this.spawn(QUEUES.RETRY, 4, async (job) => {
      if (job.name === SWEEP_JOB) return this.sweep();
      return this.replay.process(job as never);
    });
    this.spawn(QUEUES.CSV_IMPORT, env.CSV_IMPORT_CONCURRENCY, (job) =>
      this.csvImport.process(job as never),
    );

    await this.scheduleSweeper();
    this.logger.log(
      `Worker started — queues: ${Object.values(QUEUES).join(", ")} ` +
        `(delivery concurrency ${env.DELIVERY_CONCURRENCY})`,
    );
  }

  // ===========================================================================
  // Startup probe — fail loudly when Redis is missing
  // ===========================================================================

  private async probeRedisOrFailFast(): Promise<void> {
    const opts = redisConnectionOptions() as { host: string; port: number; password?: string };
    const client = new Redis({
      host: opts.host,
      port: opts.port,
      ...(opts.password ? { password: opts.password } : {}),
      connectTimeout: 5_000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // no endless silent retries during the probe
    });
    try {
      const started = Date.now();
      await client.ping();
      this.logger.log(`Redis probe OK at ${opts.host}:${opts.port} (${Date.now() - started}ms)`);
    } catch (err) {
      this.logger.error(
        `Redis is UNAVAILABLE at ${opts.host}:${opts.port} — ${err instanceof Error ? err.message : String(err)}. ` +
          `BullMQ requires a real Redis server; the worker will not start without it. ` +
          `Start Redis (or set REDIS_HOST/REDIS_PORT/REDIS_PASSWORD) and relaunch.`,
      );
      client.disconnect();
      throw new Error(
        `Redis unavailable at ${opts.host}:${opts.port}. Start Redis before running the worker.`,
      );
    } finally {
      await client.quit().catch(() => undefined);
    }
  }

  // ===========================================================================
  // Worker creation
  // ===========================================================================

  private spawn(name: QueueName, concurrency: number, handler: Handler): void {
    const options: WorkerOptions = {
      connection: redisConnectionOptions(),
      concurrency,
      // Custom backoff: exponential + jitter, extended by destination
      // Retry-After hints (DeliveryRetryError).
      settings: {
        backoffStrategy: (attemptsMade: number, _type?: string, err?: Error) => {
          const hint = err instanceof DeliveryRetryError ? err.retryAfterMs : undefined;
          return Math.max(backoffDelayMs(attemptsMade), hint ?? 0);
        },
      },
      lockDuration: 120_000,
    };

    const worker = new Worker(
      name,
      async (job) => {
        const data = (job.data ?? {}) as { correlationId?: string };
        return runWithContext(
          {
            correlationId: data.correlationId ?? newCorrelationId(),
            actorType: "WORKER",
          },
          () => handler(job),
        );
      },
      options,
    );

    worker.on("failed", (job, err) => void this.onFailed(name, job, err));
    worker.on("error", (err) => {
      // Connection/Redis errors surface here — loud, never swallowed.
      this.logger.error(`Worker "${name}" error: ${err.message}`);
    });
    worker.on("stalled", (jobId) => {
      this.logger.warn(`Worker "${name}" job ${jobId} stalled; it will be retried.`);
    });

    this.workers.push(worker);
  }

  /**
   * Dead-letter handling: when a job is permanently failed (retries
   * exhausted or UnrecoverableError), a copy is written to `<queue>-dlq`
   * with failure metadata for inspection and replay.
   */
  private async onFailed(queue: QueueName, job: Job | undefined, err: Error): Promise<void> {
    if (!job) return;
    const attemptsAllowed = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= attemptsAllowed;
    const permanent = err.name === "UnrecoverableError";
    if (!exhausted && !permanent) return;

    this.logger.error(
      `Job ${queue}/${job.name} (${job.id ?? "no-id"}) dead-lettered after ${job.attemptsMade} attempt(s): ${err.message}`,
    );
    await this.producer.enqueueDeadLetter(queue, job.name, (job.data ?? {}) as Record<string, unknown>, {
      originalJobId: job.id,
      failedReason: err.message.slice(0, 1000),
      attempts: job.attemptsMade,
      queue,
    });
  }

  private async scheduleSweeper(): Promise<void> {
    try {
      await this.producer.get(QUEUES.RETRY).upsertJobScheduler(
        SWEEP_JOB,
        { every: SWEEP_EVERY_MS },
        {
          name: SWEEP_JOB,
          data: { correlationId: newCorrelationId() },
        },
      );
      this.logger.log(`Delivery/lead sweep scheduler registered (every ${SWEEP_EVERY_MS / 1000}s).`);
    } catch (err) {
      this.logger.error(`Failed to register sweep scheduler: ${String(err)}`);
    }
  }

  // ===========================================================================
  // Sweeper — crash recovery so no lead/delivery is ever stuck forever
  // ===========================================================================

  private async sweep(): Promise<void> {
    const db = getPrisma();
    const cutoff = new Date(Date.now() - STALE_MS);
    let recovered = 0;

    // 1. Deliveries stuck IN_PROGRESS (worker crashed mid-attempt).
    const staleActive = await db.delivery.findMany({
      where: { status: "IN_PROGRESS", updatedAt: { lt: cutoff } },
      take: 50,
      select: { id: true, leadId: true, destinationId: true, correlationId: true },
    });
    for (const d of staleActive) {
      const released = await this.delivery.releaseStaleDelivery(d.id);
      if (!released) continue;
      await this.producer.enqueueDeliveryFresh({
        deliveryId: d.id,
        leadId: d.leadId,
        destinationId: d.destinationId,
        correlationId: d.correlationId ?? newCorrelationId(),
      });
      recovered += 1;
    }

    // 2. QUEUED deliveries whose scheduled attempt is long overdue (lost job).
    const staleQueued = await db.delivery.findMany({
      where: {
        status: "QUEUED",
        OR: [
          { nextAttemptAt: { lt: cutoff } },
          { nextAttemptAt: null, enqueuedAt: { lt: cutoff } },
        ],
      },
      take: 50,
      select: { id: true, leadId: true, destinationId: true, correlationId: true },
    });
    for (const d of staleQueued) {
      await this.producer.enqueueDeliveryFresh({
        deliveryId: d.id,
        leadId: d.leadId,
        destinationId: d.destinationId,
        correlationId: d.correlationId ?? newCorrelationId(),
      });
      recovered += 1;
    }

    // 3. Leads stuck mid-pipeline (pipeline job lost before fan-out).
    const stuckLeads = await db.lead.findMany({
      where: {
        status: "PROCESSING",
        stage: {
          in: [
            "RECEIVED",
            "VALIDATION",
            "NORMALIZATION",
            "DEDUPLICATION",
            "ENRICHMENT",
            "SCORING",
            "ROUTING",
            "MAPPING",
          ],
        },
        updatedAt: { lt: cutoff },
      },
      take: 25,
      select: { id: true, correlationId: true },
    });
    for (const l of stuckLeads) {
      await this.producer.enqueuePipelineFresh({
        leadId: l.id,
        correlationId: l.correlationId ?? newCorrelationId(),
      });
      recovered += 1;
    }

    // 4. Leads finalized at QUEUED but whose delivery tally never completed.
    const stuckQueued = await db.lead.findMany({
      where: { status: "PROCESSING", stage: "QUEUED", updatedAt: { lt: cutoff } },
      take: 25,
      select: { id: true, correlationId: true },
    });
    for (const l of stuckQueued) {
      const finalized = await this.pipeline.finalizeLeadIfDone(
        l.id,
        l.correlationId ?? undefined,
      );
      if (finalized) recovered += 1;
    }

    if (recovered > 0) this.logger.warn(`Sweep recovered ${recovered} stuck job(s)/record(s).`);
  }

  // ===========================================================================
  // Shutdown — wait for in-flight jobs (no job loss on deploy/restart)
  // ===========================================================================

  async onModuleDestroy(): Promise<void> {
    this.logger.log(`Closing ${this.workers.length} worker(s) gracefully…`);
    await Promise.all(
      this.workers.map((w) =>
        w.close(true).then(
          () => undefined,
          (err: unknown) => this.logger.error(`Worker close failed: ${String(err)}`),
        ),
      ),
    );
    this.workers.length = 0;
    this.logger.log("All workers closed.");
  }
}
