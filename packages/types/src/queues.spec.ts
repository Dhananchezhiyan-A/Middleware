import { describe, expect, it } from "vitest";
import { jobId } from "./queues";

/**
 * BullMQ rejects a custom `jobId` containing ":" unless it splits into
 * EXACTLY three segments (the repeatable-job format). See bullmq
 * `classes/job.js`: `if (jobId.includes(':') && jobId.split(':').length !== 3)
 * throw new Error('Custom Id cannot contain :')`.
 *
 * Every enqueue in the API and worker goes through `jobId()`, so this
 * invariant must hold for every id we produce — otherwise enqueuing throws
 * at runtime while Redis is down, silently masking the bug until Redis exists.
 */
describe("jobId", () => {
  it("never emits a colon, whatever the inputs", () => {
    const ids = [
      jobId("intake", "cmup1br7i0005igojuna6ze50"),
      jobId("deliver", "cmup1ety30000i4oj1fi5kwgj", Date.now()),
      jobId("pipeline", "lead-1", 1712345678901),
      jobId("dlq", undefined as unknown as string, Date.now()),
      // Inputs that themselves contain colons must be sanitised too:
      jobId("dlq", "qtest:1712345678901:abc123", 1712345678901),
      jobId("intake", "weird:id:with:colons"),
    ];
    for (const id of ids) {
      expect(id).not.toContain(":");
      // Belt-and-braces: never accidental repeatable-job shaped either.
      expect(id.split(":").length).not.toBe(3);
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic for the same inputs (jobId dedupe depends on it)", () => {
    expect(jobId("intake", "lead-1")).toBe(jobId("intake", "lead-1"));
    expect(jobId("deliver", "d-1", 123)).toBe(jobId("deliver", "d-1", 123));
  });

  it("distinguishes different entities and different purposes", () => {
    expect(jobId("intake", "lead-1")).not.toBe(jobId("intake", "lead-2"));
    expect(jobId("intake", "lead-1")).not.toBe(jobId("deliver", "lead-1"));
    // The "fresh" variants must not collapse onto the idempotent ones.
    expect(jobId("pipeline", "lead-1", 1)).not.toBe(jobId("pipeline", "lead-1", 2));
  });

  it("keeps the idempotent id free of timestamps", () => {
    expect(jobId("intake", "lead-1")).toBe("intake-lead-1");
    expect(jobId("deliver", "d-1")).toBe("deliver-d-1");
  });
});
