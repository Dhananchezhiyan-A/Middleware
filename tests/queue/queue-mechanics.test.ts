import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Worker, Queue, type Job } from "bullmq";
import Redis from "ioredis";
import {
  BACKOFF_BASE_MS,
  DEFAULT_JOB_OPTIONS,
  JOB_NAMES,
  QUEUES,
} from "@middleware/types";
import { redisConnectionOptions } from "@middleware/shared";
import { QueueProducer } from "../../apps/worker/src/queues/queue-producer";

/**
 * REAL Redis + BullMQ mechanics: connection, queue creation, enqueue
 * (idempotent job ids), worker processing, retry, exponential backoff,
 * dead-lettering, concurrency and graceful shutdown.
 *
 * Nothing here is mocked — if Redis is missing these tests fail (see the
 * global setup gate). Run with: pnpm test:queue
 */

const RUN = `qtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const connection = redisConnectionOptions();
const producer = new QueueProducer();

async function waitUntil(fn: () => Promise<boolean>, timeoutMs = 15_000, stepMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return fn();
}

describe("Redis + BullMQ mechanics (real server, no mocks)", () => {
  const cleanup: Array<() => Promise<void>> = [];

  beforeAll(() => {
    cleanup.push(async () => {
      await producer.onModuleDestroy();
    });
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  });

  it("connects to Redis with PING", async () => {
    const client = new Redis({ ...connection, maxRetriesPerRequest: 1, retryStrategy: () => null });
    try {
      expect(await client.ping()).toBe("PONG");
    } finally {
      await client.quit().catch(() => undefined);
    }
  });

  it("creates queues and enqueues jobs idempotently (jobId dedupe)", async () => {
    const queue = producer.get(QUEUES.LEAD_INTAKE);
    expect(queue.name).toBe(QUEUES.LEAD_INTAKE);

    const data = { correlationId: `${RUN}:c1`, leadId: `${RUN}-lead-1` };
    await producer.enqueueIntake(data);
    await producer.enqueueIntake(data); // same lead + same deterministic jobId → collapsed
    // A DIFFERENT lead gets its own intake job (enqueueIntake's jobId is
    // per-lead by contract: "one intake job per lead").
    await producer.enqueueIntake({
      ...data,
      correlationId: `${RUN}:c2`,
      leadId: `${RUN}-lead-2`,
    });

    // Scope every count to THIS run's correlationIds. pipeline-e2e.test.ts
    // runs a real worker on the same lead-intake queue, so foreign jobs —
    // or this run's jobs in any state (waiting/delayed/active/completed/
    // failed) — must not skew the dedupe assertion. DEFAULT_JOB_OPTIONS
    // keeps failed/completed jobs for hours, so nothing can vanish here.
    const mine = async () => {
      const jobs = await queue.getJobs(["waiting", "delayed", "active", "completed", "failed"]);
      return jobs.filter((job) => String(job.data?.correlationId ?? "").startsWith(`${RUN}:`));
    };

    const all = await mine();
    const c1 = all.filter((job) => String(job.data?.correlationId) === `${RUN}:c1`);
    expect(c1).toHaveLength(1); // duplicate enqueue collapsed by deterministic jobId
    expect(all).toHaveLength(2); // distinct lead → fresh jobId

    for (const job of all) await job.remove().catch(() => undefined);
  });

  it("processes jobs with a real worker", async () => {
    const queueName = `${RUN}-process` as never;
    const queue = new Queue(queueName, { connection });
    const seen: string[] = [];
    const worker = new Worker(
      queueName,
      async (job: Job) => {
        seen.push(job.data.value as string);
        return { ok: true };
      },
      { connection },
    );
    cleanup.push(async () => {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    });

    await queue.add("process", { value: "hello" });
    const done = await waitUntil(async () => {
      const completed = await queue.getCompletedCount();
      return completed >= 1;
    });
    expect(done).toBe(true);
    expect(seen).toContain("hello");
  });

  it("schedules delayed jobs and only processes them after the delay elapses", async () => {
    const queueName = `${RUN}-delayed` as never;
    const queue = new Queue(queueName, { connection });
    let processedAt = 0;
    const worker = new Worker(
      queueName,
      async () => {
        processedAt = Date.now();
      },
      { connection },
    );
    cleanup.push(async () => {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    });

    const enqueuedAt = Date.now();
    await queue.add("later", { value: "delayed" }, { delay: 600 });

    // Still waiting in the delayed set — the worker must NOT touch it yet.
    await new Promise((r) => setTimeout(r, 200));
    expect(await queue.getCompletedCount()).toBe(0);
    const delayed = await queue.getDelayedCount();
    expect(delayed).toBe(1);

    const done = await waitUntil(async () => (await queue.getCompletedCount()) >= 1, 10_000);
    expect(done).toBe(true);
    expect(processedAt - enqueuedAt).toBeGreaterThanOrEqual(500); // honored the delay
  });

  it("retries failed jobs with exponential backoff and honors a custom strategy", async () => {
    const queueName = `${RUN}-retry` as never;
    const queue = new Queue(queueName, { connection });
    const attempts: number[] = [];
    const worker = new Worker(
      queueName,
      async (_job: Job) => {
        attempts.push(Date.now());
        throw new Error("boom");
      },
      {
        connection,
        settings: {
          backoffStrategy: (attemptsMade: number) => Math.min(200 * 2 ** (attemptsMade - 1), 1_000),
        },
      },
    );
    cleanup.push(async () => {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    });

    await queue.add(
      "flaky",
      {},
      { attempts: 3, backoff: { type: "custom", delay: 100 }, removeOnFail: false },
    );

    const exhausted = await waitUntil(async () => {
      const failed = await queue.getFailedCount();
      return failed >= 1;
    }, 20_000);
    expect(exhausted).toBe(true);
    expect(attempts.length).toBe(3); // retried until attempts exhausted

    // Backoff: attempt 2 waited at least the custom-strategy delay.
    if (attempts.length >= 2) {
      expect((attempts[1] as number) - (attempts[0] as number)).toBeGreaterThanOrEqual(150);
    }
    expect(DEFAULT_JOB_OPTIONS.backoff.type).toBe("custom");
    expect(BACKOFF_BASE_MS).toBeGreaterThan(0);
  });

  it("dead-letters exhausted jobs into <queue>-dlq with failure metadata", async () => {
    const sourceQueue = `${RUN}-dlq-src` as never;
    const queue = new Queue(sourceQueue, { connection });
    const worker = new Worker(
      sourceQueue,
      async () => {
        throw new Error("permanent failure");
      },
      { connection },
    );
    cleanup.push(async () => {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    });

    await queue.add("doomed", { correlationId: RUN, marker: "dlq-me" }, { attempts: 1 });

    const failed = await waitUntil(async () => (await queue.getFailedCount()) >= 1);
    expect(failed).toBe(true);

    // Mirror the worker's DLQ convention (WorkersService.onFailed).
    const jobs = await queue.getFailed(0, 0);
    const job = jobs[0];
    if (!job) throw new Error("expected a failed job to forward to the DLQ");
    await producer.enqueueDeadLetter(sourceQueue, job.name, job.data as Record<string, unknown>, {
      originalJobId: job.id,
      failedReason: "permanent failure",
      attempts: job.attemptsMade,
      queue: String(sourceQueue),
    });

    const dlq = producer.get(`${sourceQueue}-dlq`);
    const dlqCount = await waitUntil(async () => (await dlq.getJobCounts("waiting")).waiting >= 1);
    expect(dlqCount).toBe(true);
    const dlqJobs = await dlq.getJobs(["waiting"]);
    expect(String(dlqJobs[0]?.data?.marker)).toBe("dlq-me");
    expect(String(dlqJobs[0]?.data?.failedReason)).toBe("permanent failure");

    await dlq.obliterate({ force: true }).catch(() => undefined);
  });

  it("honors worker concurrency (multiple jobs in flight, all complete)", async () => {
    const queueName = `${RUN}-conc` as never;
    const queue = new Queue(queueName, { connection });
    const CONCURRENCY = 3;
    const JOB_COUNT = 9;
    let inFlight = 0;
    let maxInFlight = 0;

    const worker = new Worker(
      queueName,
      async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 250));
        inFlight -= 1;
      },
      { connection, concurrency: CONCURRENCY },
    );
    cleanup.push(async () => {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    });

    for (let i = 0; i < JOB_COUNT; i++) await queue.add("conc", { i });
    const done = await waitUntil(async () => (await queue.getCompletedCount()) >= JOB_COUNT, 20_000);
    expect(done).toBe(true);
    expect(maxInFlight).toBeGreaterThan(1); // actually parallel
    expect(maxInFlight).toBeLessThanOrEqual(CONCURRENCY); // never above the limit
  });

  it("shuts down gracefully: close() waits for the in-flight job", async () => {
    const queueName = `${RUN}-shutdown` as never;
    const queue = new Queue(queueName, { connection });
    let finished = false;
    const worker = new Worker(
      queueName,
      async () => {
        await new Promise((r) => setTimeout(r, 1_500));
        finished = true;
      },
      { connection, concurrency: 1 },
    );
    cleanup.push(async () => {
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    });

    await queue.add("slow", {});
    // Give the worker a moment to pick the job up.
    await new Promise((r) => setTimeout(r, 300));

    await worker.close(); // graceful: waits for active jobs
    expect(finished).toBe(true); // the job ran to completion before close resolved
  });

  it("exposes the queue names used by the producer contract", () => {
    expect(Object.values(QUEUES)).toEqual(
      expect.arrayContaining([
        QUEUES.LEAD_INTAKE,
        QUEUES.LEAD_PROCESSING,
        QUEUES.DELIVERY,
        QUEUES.RETRY,
        QUEUES.CSV_IMPORT,
      ]),
    );
    expect(JOB_NAMES.DELIVER).toBe("deliver");
    expect(DEFAULT_JOB_OPTIONS.attempts).toBeGreaterThanOrEqual(1);
  });
});
