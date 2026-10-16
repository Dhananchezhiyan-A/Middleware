import { Global, Injectable, Logger, Module, type OnModuleDestroy } from "@nestjs/common";
import { Queue, type JobsOptions } from "bullmq";
import Redis from "ioredis";
import {
  DEFAULT_JOB_OPTIONS,
  JOB_NAMES,
  QUEUES,
  jobId,
  type ImportCsvJob,
  type LeadIntakeJob,
  type QueueName,
  type DeliverJob,
  type ReplayDeliveryJob,
} from "@middleware/types";
import { errors, redisConnectionOptions, getContext, withTimeout } from "@middleware/shared";
import { LeadSelectionStore } from "./selection.store";

/**
 * Queue access for the API (producer side) + queue health statistics.
 *
 * Redis/BullMQ is the source of truth for queue state; the API never
 * fabricates queue numbers. When Redis is down, enqueueing fails loudly with
 * QUEUE_UNAVAILABLE (503) — data already persisted in PostgreSQL is safe and
 * recoverable (worker sweeper + provider retries + idempotency).
 */
@Injectable()
export class QueuesService implements OnModuleDestroy {
  private readonly logger = new Logger(QueuesService.name);
  private readonly queues = new Map<string, Queue>();

  get(name: QueueName | string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: redisConnectionOptions(),
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private async enqueue(
    name: QueueName,
    jobName: string,
    data: Record<string, unknown>,
    opts?: JobsOptions,
  ): Promise<void> {
    const correlationId = getContext()?.correlationId ?? data.correlationId;
    try {
      // Bounded: a buffered command never settles while Redis is down, so
      // without this the caller (e.g. webhook ingress) would hang forever.
      await withTimeout(
        this.get(name).add(jobName, { correlationId, ...data }, opts),
        QueuesService.ENQUEUE_TIMEOUT_MS,
        `enqueue(${name}/${jobName})`,
      );
    } catch (err) {
      this.logger.error(`Failed to enqueue ${name}/${jobName}: ${String(err)}`);
      throw errors.queueUnavailable(`Failed to enqueue ${jobName}.`, err);
    }
  }

  /** Idempotent: one intake job per lead (jobId dedupe). */
  enqueueLeadIntake(data: LeadIntakeJob, opts?: JobsOptions): Promise<void> {
    return this.enqueue(
      QUEUES.LEAD_INTAKE,
      JOB_NAMES.PROCESS_LEAD_INTAKE,
      data as unknown as Record<string, unknown>,
      { ...opts, jobId: jobId("intake", data.leadId) },
    );
  }

  /** Unique job ids allow explicit reprocessing (manual replay). */
  enqueueLeadIntakeFresh(data: LeadIntakeJob): Promise<void> {
    return this.enqueue(
      QUEUES.LEAD_INTAKE,
      JOB_NAMES.PROCESS_LEAD_INTAKE,
      data as unknown as Record<string, unknown>,
      { jobId: jobId("intake", data.leadId, Date.now()) },
    );
  }

  enqueueDelivery(data: DeliverJob): Promise<void> {
    return this.enqueue(
      QUEUES.DELIVERY,
      JOB_NAMES.DELIVER,
      data as unknown as Record<string, unknown>,
      { jobId: jobId("deliver", data.deliveryId) },
    );
  }

  enqueueReplay(data: ReplayDeliveryJob): Promise<void> {
    return this.enqueue(
      QUEUES.RETRY,
      JOB_NAMES.REPLAY_DELIVERY,
      data as unknown as Record<string, unknown>,
      { jobId: jobId("replay", data.deliveryId, Date.now()) },
    );
  }

  enqueueCsvImport(data: ImportCsvJob): Promise<void> {
    return this.enqueue(
      QUEUES.CSV_IMPORT,
      JOB_NAMES.IMPORT_CSV,
      data as unknown as Record<string, unknown>,
      { jobId: jobId("import", data.importJobId) },
    );
  }

  /** Re-enqueues a lead's processing pipeline (recovery/replay). */
  enqueueProcessing(data: { leadId: string; correlationId: string }): Promise<void> {
    return this.enqueue(
      QUEUES.LEAD_PROCESSING,
      JOB_NAMES.PROCESS_LEAD_PIPELINE,
      data as unknown as Record<string, unknown>,
      { jobId: jobId("pipeline", data.leadId, Date.now()) },
    );
  }

  /**
   * Reads never hang: `maxRetriesPerRequest: null` (required by BullMQ) makes
   * ioredis buffer commands indefinitely while Redis is down, so the try/catch
   * below would never fire. Bound every read so stats endpoints fail fast with
   * an honest error instead of hanging the request.
   */
  private static readonly READ_TIMEOUT_MS = 3_000;
  /** Enqueue sits on the webhook critical path — fail fast, not forever. */
  private static readonly ENQUEUE_TIMEOUT_MS = 5_000;

  private withTimeout<T>(op: Promise<T>, label: string): Promise<T> {
    return withTimeout(op, QueuesService.READ_TIMEOUT_MS, label);
  }

  /** Real queue depths/status from BullMQ. Never synthesized. */
  async queueStats(): Promise<
    Record<string, Record<string, number> | { error: string }>
  > {
    const out: Record<string, Record<string, number> | { error: string }> = {};
    // Parallel: worst case is one READ_TIMEOUT_MS, not one per queue.
    await Promise.all(
      Object.values(QUEUES).map(async (name) => {
        try {
          const counts = await this.withTimeout(
            this.get(name).getJobCounts(
              "waiting",
              "active",
              "completed",
              "failed",
              "delayed",
              "prioritized",
            ),
            `queueStats(${name})`,
          );
          out[name] = counts as unknown as Record<string, number>;
        } catch (err) {
          out[name] = { error: `unavailable: ${err instanceof Error ? err.message : "unknown"}` };
        }
      }),
    );
    return out;
  }

  /** Dead-letter queue entries for a given source queue. */
  async deadLetterStats(): Promise<Record<string, Record<string, number> | { error: string }>> {
    const out: Record<string, Record<string, number> | { error: string }> = {};
    await Promise.all(
      Object.values(QUEUES).map(async (name) => {
        try {
          const counts = await this.withTimeout(
            this.get(`${name}-dlq`).getJobCounts(
              "waiting",
              "active",
              "failed",
              "completed",
              "delayed",
            ),
            `deadLetterStats(${name})`,
          );
          out[`${name}-dlq`] = counts as unknown as Record<string, number>;
        } catch (err) {
          out[`${name}-dlq`] = {
            error: `unavailable: ${err instanceof Error ? err.message : "unknown"}`,
          };
        }
      }),
    );
    return out;
  }

  /** Redis liveness probe (health endpoint) via a dedicated connection. */
  async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    let client: Redis | undefined;
    try {
      const opts = redisConnectionOptions() as { host: string; port: number; password?: string };
      client = new Redis({
        host: opts.host,
        port: opts.port,
        ...(opts.password ? { password: opts.password } : {}),
        connectTimeout: 5_000,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
      const started = Date.now();
      const reply = await client.ping();
      if (reply !== "PONG") throw new Error(`Unexpected PING reply: ${String(reply)}`);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Redis unreachable" };
    } finally {
      await client?.quit().catch(() => undefined);
    }
  }

  /** Recent dead-lettered jobs (real BullMQ state, newest first). */
  async deadLetterJobs(queue: QueueName | string, limit = 50): Promise<unknown[]> {
    try {
      const name = queue.endsWith("-dlq") ? queue : `${queue}-dlq`;
      const dlq = this.get(name);
      const jobs = await this.withTimeout(
        dlq.getJobs(["waiting", "failed", "completed", "delayed", "active"]),
        `deadLetterJobs(${name})`,
      );
      return jobs
        .map((job) => ({
          id: job.id,
          name: job.name,
          queue: name,
          data: job.data,
          failedReason: (job as { failedReason?: string }).failedReason ?? null,
          attemptsMade: job.attemptsMade,
          createdAt: job.timestamp ? new Date(job.timestamp) : null,
          processedOn: job.processedOn ? new Date(job.processedOn) : null,
        }))
        .slice(0, limit);
    } catch (err) {
      return [{ error: `unavailable: ${err instanceof Error ? err.message : "unknown"}` }];
    }
  }

  /** Recent failed (not yet dead-lettered) jobs for a source queue. */
  async failedJobs(queue: QueueName | string, limit = 50): Promise<unknown[]> {
    try {
      const jobs = await this.withTimeout(this.get(queue).getFailed(0, limit - 1), `failedJobs(${queue})`);
      return jobs.map((job) => ({
        id: job.id,
        name: job.name,
        queue,
        data: job.data,
        failedReason: (job as { failedReason?: string }).failedReason ?? null,
        attemptsMade: job.attemptsMade,
        retryAt: job.timestamp ? new Date(job.timestamp) : null,
      }));
    } catch (err) {
      return [{ error: `unavailable: ${err instanceof Error ? err.message : "unknown"}` }];
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close().catch(() => undefined)));
    this.queues.clear();
  }
}

@Global()
@Module({
  providers: [QueuesService, LeadSelectionStore],
  exports: [QueuesService, LeadSelectionStore],
})
export class RedisModule {}
