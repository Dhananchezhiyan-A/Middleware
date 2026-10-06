/**
 * Queue names, job names, retry policy and dead-letter conventions.
 *
 * All queues are BullMQ queues backed by Redis. Failed jobs are NEVER
 * silently discarded: when attempts are exhausted the job is moved to the
 * matching dead-letter queue and its database state is updated.
 */

export const QUEUES = {
  LEAD_INTAKE: "lead-intake",
  LEAD_PROCESSING: "lead-processing",
  ENRICHMENT: "enrichment",
  SCORING: "scoring",
  ROUTING: "routing",
  DELIVERY: "delivery",
  RETRY: "retry",
  CSV_IMPORT: "csv-import",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const QUEUE_NAMES: QueueName[] = Object.values(QUEUES);

/** Dead-letter queue for a given queue: `${queue}-dlq`. */
export const DLQ_SUFFIX = "-dlq";

export function dlqName(queue: QueueName): string {
  return `${queue}${DLQ_SUFFIX}`;
}

export const JOB_NAMES = {
  PROCESS_LEAD_INTAKE: "process-lead-intake",
  PROCESS_LEAD_PIPELINE: "process-lead-pipeline",
  ENRICH_LEAD: "enrich-lead",
  SCORE_LEAD: "score-lead",
  ROUTE_LEAD: "route-lead",
  DELIVER: "deliver",
  REPLAY_DELIVERY: "replay-delivery",
  IMPORT_CSV: "import-csv",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/**
 * Builds a BullMQ custom `jobId`.
 *
 * BullMQ rejects custom ids containing `:` UNLESS they split into exactly
 * three segments (the repeatable-job format). Naively building ids like
 * `intake:${leadId}` therefore throws `Custom Id cannot contain :` at
 * enqueue time — so join with `-` and strip any `:` from the parts.
 *
 * Idempotency/dedupe relies on this being deterministic for the same inputs.
 */
export function jobId(kind: string, ...parts: Array<string | number>): string {
  const clean = (v: string | number): string => String(v).replace(/:/g, "-");
  return [kind, ...parts].map(clean).join("-");
}

/** Exponential backoff base (ms). Attempt N waits base * 2^(N-1) (+ jitter). */
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export function backoffDelayMs(attempt: number): number {
  const exp = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS);
  // ±10% jitter to avoid thundering herds against a struggling destination.
  const jitter = exp * 0.1 * (Math.random() * 2 - 1);
  return Math.round(exp + jitter);
}

/** Default per-queue job options (retries, backoff, retention). */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  // 'custom' → the worker's `settings.backoffStrategy` computes each delay
  // (exponential + jitter, extended by destination Retry-After hints).
  backoff: { type: "custom" as const, delay: BACKOFF_BASE_MS },
  // Keep completed jobs briefly for the Delivery UI/queue health — the
  // database remains the source of truth for history.
  removeOnComplete: { age: 3600, count: 5_000 },
  // Keep failed jobs for inspection; they are also moved to the DLQ.
  removeOnFail: { age: 7 * 24 * 3600 },
};
