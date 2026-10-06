import { Global, Injectable, Logger, Module, type OnModuleDestroy } from "@nestjs/common";
import { Queue, type JobsOptions } from "bullmq";
import { DEFAULT_JOB_OPTIONS, JOB_NAMES, QUEUES, jobId, type QueueName } from "@middleware/types";
import { errors, redisConnectionOptions, getContext, withTimeout } from "@middleware/shared";

/**
 * Worker-side queue producer. The worker both consumes and produces jobs:
 *  intake → pipeline → delivery are chained by the worker itself, and
 *  failed deliveries are moved to dead-letter queues by the worker.
 *
 * Same contract as the API-side QueuesService: Redis/BullMQ is the only
 * source of truth for queue state; enqueue failures fail loudly
 * (QUEUE_UNAVAILABLE) — PostgreSQL data is already safe at that point.
 */
@Injectable()
export class QueueProducer implements OnModuleDestroy {
  private readonly logger = new Logger(QueueProducer.name);
  private readonly queues = new Map<string, Queue>();

  /**
   * `maxRetriesPerRequest: null` (required by BullMQ) makes ioredis buffer
   * commands forever while Redis is down, so an unbounded `add()` would hang
   * the pipeline instead of failing loudly. Bound it → QUEUE_UNAVAILABLE.
   */
  private static readonly ENQUEUE_TIMEOUT_MS = 5_000;

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
      await withTimeout(
        this.get(name).add(jobName, { correlationId, ...data }, opts),
        QueueProducer.ENQUEUE_TIMEOUT_MS,
        `enqueue(${name}/${jobName})`,
      );
    } catch (err) {
      this.logger.error(`Failed to enqueue ${name}/${jobName}: ${String(err)}`);
      throw errors.queueUnavailable(`Failed to enqueue ${jobName}.`, err);
    }
  }

  enqueuePipeline(data: { leadId: string; correlationId: string }): Promise<void> {
    return this.enqueue(
      QUEUES.LEAD_PROCESSING,
      JOB_NAMES.PROCESS_LEAD_PIPELINE,
      data as unknown as Record<string, unknown>,
      { jobId: jobId("pipeline", data.leadId) },
    );
  }

  /** Idempotent: one intake job per lead (jobId dedupe). */
  enqueueIntake(data: { leadId: string; correlationId: string; webhookEventId?: string }): Promise<void> {
    return this.enqueue(
      QUEUES.LEAD_INTAKE,
      JOB_NAMES.PROCESS_LEAD_INTAKE,
      data as unknown as Record<string, unknown>,
      { jobId: jobId("intake", data.leadId) },
    );
  }

  /** Fresh job id — used when re-running a finished pipeline (replay). */
  enqueuePipelineFresh(data: { leadId: string; correlationId: string }): Promise<void> {
    return this.enqueue(
      QUEUES.LEAD_PROCESSING,
      JOB_NAMES.PROCESS_LEAD_PIPELINE,
      data as unknown as Record<string, unknown>,
      { jobId: jobId("pipeline", data.leadId, Date.now()) },
    );
  }

  enqueueDelivery(data: { deliveryId: string; leadId: string; destinationId: string; correlationId: string }): Promise<void> {
    return this.enqueue(
      QUEUES.DELIVERY,
      JOB_NAMES.DELIVER,
      data as unknown as Record<string, unknown>,
      { jobId: jobId("deliver", data.deliveryId) },
    );
  }

  /** Explicit replay of a terminal (FAILED/DEAD) delivery. */
  enqueueDeliveryFresh(data: { deliveryId: string; leadId: string; destinationId: string; correlationId: string }): Promise<void> {
    return this.enqueue(
      QUEUES.DELIVERY,
      JOB_NAMES.DELIVER,
      data as unknown as Record<string, unknown>,
      { jobId: jobId("deliver", data.deliveryId, Date.now()) },
    );
  }

  /** Moves a job that exhausted its retries into the matching dead-letter queue. */
  async enqueueDeadLetter(
    sourceQueue: QueueName | string,
    jobName: string,
    payload: Record<string, unknown>,
    meta: { originalJobId?: string; failedReason: string; attempts: number; queue: string },
  ): Promise<void> {
    try {
      const dlq = this.get(`${sourceQueue}-dlq`);
      await withTimeout(
        dlq.add(
          jobName,
          { ...payload, deadLetteredAt: new Date().toISOString(), ...meta },
          {
            jobId: jobId(
              "dlq",
              String(meta.originalJobId ?? payload.id ?? Date.now()),
              Date.now(),
            ),
            removeOnComplete: false,
            removeOnFail: false,
          },
        ),
        QueueProducer.ENQUEUE_TIMEOUT_MS,
        `deadLetter(${sourceQueue}/${jobName})`,
      );
    } catch (err) {
      // DLQ write failure must be visible — this is a data-safety path.
      this.logger.error(
        `FAILED to write dead-letter record for ${sourceQueue}/${jobName}: ${String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close().catch(() => undefined)));
    this.queues.clear();
  }
}

@Global()
@Module({
  providers: [QueueProducer],
  exports: [QueueProducer],
})
export class QueueProducerModule {}
