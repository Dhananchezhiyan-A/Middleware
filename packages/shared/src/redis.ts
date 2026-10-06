import type { ConnectionOptions } from "bullmq";

/**
 * Redis connection configuration shared by the API (producer) and the
 * worker (consumer).
 *
 * `maxRetriesPerRequest: null` is required by BullMQ for workers that use
 * blocking commands.
 */
export function redisConnectionOptions(): ConnectionOptions {
  const host = process.env.REDIS_HOST ?? "localhost";
  const port = Number(process.env.REDIS_PORT ?? 6379);
  const password = process.env.REDIS_PASSWORD || undefined;
  return {
    host,
    port,
    ...(password ? { password } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10_000,
  };
}

export function redisUrl(): string {
  const opts = redisConnectionOptions() as { host: string; port: number; password?: string };
  const auth = opts.password ? `:${encodeURIComponent(opts.password)}@` : "";
  return `redis://${auth}${opts.host}:${opts.port}`;
}

/**
 * Bounds a Redis/BullMQ operation so it fails fast instead of hanging.
 *
 * `maxRetriesPerRequest: null` (required by BullMQ) makes ioredis buffer
 * commands indefinitely while Redis is unreachable — the command's promise
 * simply never settles, so a `try/catch` around it never fires. Every queue
 * read/write must therefore be raced against this timeout.
 *
 * On timeout the operation is rejected, but note the buffered command may
 * still be delivered later if Redis comes back: callers must remain
 * idempotent (jobId dedupe, DB-backed idempotency keys).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms (Redis unreachable)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
