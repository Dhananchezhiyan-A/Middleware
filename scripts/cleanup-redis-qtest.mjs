/**
 * Issue 4 — removes ONLY qtest-marked jobs from Redis (leftovers of
 * tests/queue runs). Every key touched must contain "qtest" in its id/name;
 * non-qtest queue state (sweeper repeats, E2E delivery/DLQ records) is left
 * untouched. Never uses FLUSHDB/KEYS * on unrelated data.
 */
import { Queue } from "bullmq";
import { Redis } from "ioredis";

const connection = { host: "localhost", port: 6379 };
const stats = { jobsRemoved: 0, zsetRefsRemoved: 0, stragglerKeysDeleted: 0, streamEntriesDeleted: 0, skipped: 0 };

const isQTest = (job) =>
  String(job.id ?? "").includes("qtest") ||
  String(job.name ?? "").includes("qtest") ||
  JSON.stringify(job.data ?? {}).includes("qtest");

async function purgeQueueJobs(queueName) {
  const queue = new Queue(queueName, { connection });
  try {
    const jobs = await queue.getJobs(["wait", "active", "delayed", "prioritized", "completed", "failed"]);
    for (const job of jobs) {
      if (!isQTest(job)) continue;
      try {
        await job.remove();
        stats.jobsRemoved += 1;
      } catch (err) {
        stats.skipped += 1;
        console.warn(`  skip job ${job.id}: ${err.message}`);
      }
    }
  } finally {
    await queue.close();
  }
}

await purgeQueueJobs("lead-intake");
await purgeQueueJobs("lead-intake-dlq");

const redis = new Redis({ host: "localhost", port: 6379, lazyConnect: true });
await redis.connect();

// 1) zset members referencing qtest (in case a remove() was refused above)
for (const queueName of ["lead-intake", "lead-intake-dlq"]) {
  for (const set of ["wait", "failed", "completed", "delayed", "prioritized", "active"]) {
    const key = `bull:${queueName}:${set}`;
    const ids = await redis.zrange(key, 0, -1);
    const qtest = ids.filter((id) => id.includes("qtest"));
    if (qtest.length > 0) {
      await redis.zrem(key, ...qtest);
      stats.zsetRefsRemoved += qtest.length;
    }
  }
}

// 2) straggler keys whose NAME contains qtest (job hashes etc.)
let cursor = "0";
do {
  const [next, keys] = await redis.scan(cursor, "MATCH", "bull:*qtest*", "COUNT", 200);
  cursor = next;
  if (keys.length > 0) {
    await redis.del(...keys);
    stats.stragglerKeysDeleted += keys.length;
  }
} while (cursor !== "0");

// 3) events-stream entries referencing qtest job ids
for (const stream of ["bull:lead-intake:events", "bull:lead-intake-dlq:events"]) {
  try {
    const entries = await redis.xrange(stream, "-", "+");
    for (const [id, fields] of entries) {
      if (fields.join(" ").includes("qtest")) {
        await redis.xdel(stream, id);
        stats.streamEntriesDeleted += 1;
      }
    }
  } catch {
    // stream does not exist — nothing to clean
  }
}

// verification: no qtest key may survive
const leftover = [];
cursor = "0";
do {
  const [next, keys] = await redis.scan(cursor, "MATCH", "bull:*qtest*", "COUNT", 200);
  cursor = next;
  leftover.push(...keys);
} while (cursor !== "0");

await redis.quit();
console.log("Redis qtest cleanup:", JSON.stringify(stats));
console.log(`remaining qtest keys: ${leftover.length}`);
