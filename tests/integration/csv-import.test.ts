import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UnrecoverableError } from "bullmq";
import type { Database } from "@middleware/database";
import { getPrisma } from "@middleware/database";
import { getStorage, sha256Hex } from "@middleware/shared";
import type { CsvColumnMapping } from "@middleware/types";
import { CsvImportProcessor } from "../../apps/worker/src/processors/csv-import.processor";
import type { QueueProducer } from "../../apps/worker/src/queues/queue-producer";
import { cleanupFixture, createFixture, unique, type Fixture } from "./helpers";

/**
 * End-to-end CSV import through the REAL worker processor + PostgreSQL:
 * parsing, per-row validation, idempotency, counters, row-error reporting.
 *
 * The queue is stubbed (nothing is ever delivered anywhere); leads are
 * asserted in their RECEIVED state, exactly as the pipeline leaves them.
 */
describe("CSV import worker (real PostgreSQL)", () => {
  let db: Database;
  let fixture: Fixture;
  let processor: CsvImportProcessor;
  const storedKeys: string[] = [];
  const enqueuedIntake: string[] = [];

  beforeAll(async () => {
    db = getPrisma();
    fixture = await createFixture(db);
    const queues = {
      enqueueIntake: async (payload: { leadId: string }) => {
        enqueuedIntake.push(payload.leadId);
      },
    } as unknown as QueueProducer;
    processor = new CsvImportProcessor(queues);
  });

  afterAll(async () => {
    // Storage files first (the DB rows are removed by cleanupFixture).
    await Promise.all(
      storedKeys.map((key) => getStorage().delete(key).catch(() => undefined)),
    );
    await cleanupFixture(fixture, db);
  });

  interface ImportRun {
    jobId: string;
    correlationId: string;
  }

  /** Stores the CSV and creates the ImportJob row (no processing yet). */
  async function prepare(csv: string): Promise<ImportRun> {
    const buffer = Buffer.from(csv, "utf8");
    const checksum = sha256Hex(buffer);
    const stored = await getStorage().put(buffer, {
      contentType: "text/csv",
      prefix: "imports",
      checksum,
    });
    storedKeys.push(stored.key);
    const correlationId = unique("csv-import");
    const job = await db.importJob.create({
      data: {
        sourceId: fixture.sourceId,
        sourceAccountId: fixture.accountId,
        fileName: "leads.csv",
        fileSizeBytes: stored.size,
        checksum,
        storageKey: stored.key,
        status: "PENDING",
        createdBy: "integration-test",
        correlationId,
      },
    });
    return { jobId: job.id, correlationId };
  }

  /** Runs the worker processor over a prepared job. */
  async function processImport(
    run: ImportRun,
    mapping?: CsvColumnMapping[],
  ): Promise<void> {
    await processor.process({
      data: {
        importJobId: run.jobId,
        correlationId: run.correlationId,
        createdBy: "integration-test",
        ...(mapping !== undefined ? { mapping } : {}),
      },
    } as never);
  }

  /** Prepares AND processes in one step (the happy path of every test). */
  async function runImport(
    csv: string,
    opts: { mapping?: CsvColumnMapping[] } = {},
  ): Promise<ImportRun> {
    const run = await prepare(csv);
    await processImport(run, opts.mapping);
    return run;
  }

  async function jobOf(correlationId: string) {
    return db.importJob.findFirstOrThrow({ where: { correlationId } });
  }

  const VALID_CSV = [
    "email,first name,last name,city,budget,lead source",
    "priya@example.com,Priya,Raman,Chennai,7500000,referral",
    "ravi@example.com,Ravi,Kumar,Delhi,9000000,website",
    "anita@example.com,Anita,Iyer,Pune,5000000,referral",
  ].join("\n");

  it("imports valid rows through the standard lead pipeline", async () => {
    const { correlationId } = await runImport(VALID_CSV);
    const job = await jobOf(correlationId);

    expect(job.status).toBe("COMPLETED");
    expect(job.totalRows).toBe(3);
    expect(job.processedRows).toBe(3);
    expect(job.successfulRows).toBe(3);
    expect(job.failedRows).toBe(0);
    expect(job.duplicateRows).toBe(0);
    expect(job.error).toBeNull();
    expect(job.finishedAt).not.toBeNull();

    const leads = await db.lead.findMany({ where: { correlationId } });
    expect(leads).toHaveLength(3);

    // Source + account relationship is preserved exactly as uploaded.
    for (const lead of leads) {
      expect(lead.sourceId).toBe(fixture.sourceId);
      expect(lead.sourceAccountId).toBe(fixture.accountId);
      expect(lead.status).toBe("RECEIVED");
      expect(lead.externalLeadId).toMatch(/^csv:[0-9a-f]{40}:\d+$/);
    }

    const priya = leads.find((lead) => (lead.canonicalData as { email?: string }).email === "priya@example.com");
    expect(priya).toBeDefined();
    const canonical = priya?.canonicalData as {
      name?: { first?: string; last?: string };
      location?: { city?: string };
      budget?: unknown;
    };
    expect(canonical.name).toMatchObject({ first: "Priya", last: "Raman" });
    expect(canonical.location).toMatchObject({ city: "Chennai" });
    expect(canonical.budget).toBe(7500000); // numeric string became a number

    // Raw payload kept per lead + every lead queued for intake processing.
    const rawCount = await db.leadRawPayload.count({
      where: { leadId: { in: leads.map((l) => l.id) } },
    });
    expect(rawCount).toBe(3);
    const enqueued = await db.lead.count({
      where: { id: { in: enqueuedIntake }, correlationId },
    });
    expect(enqueued).toBe(3);

    const audit = await db.auditLog.findFirst({
      where: { action: "import.completed", entityId: job.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.metadata).toMatchObject({ processed: 3, successful: 3, skipped: 0 });
  });

  it("isolates invalid rows with their file row number and skips empty rows", async () => {
    const csv = [
      "email,first name,city",
      "good@example.com,Good,Chennai",
      ",Missing,Delhi", // row 3: no contact channel
      "not-an-email,BadEmail,Pune", // row 4: invalid email
      ",,,", // row 5: entirely empty → skipped, still counted
    ].join("\n");

    const { correlationId } = await runImport(csv);
    const job = await jobOf(correlationId);

    expect(job.status).toBe("COMPLETED");
    expect(job.totalRows).toBe(4); // 4 data rows, incl. the empty one
    expect(job.processedRows).toBe(3); // the empty row is never attempted
    expect(job.successfulRows).toBe(1);
    expect(job.failedRows).toBe(2);
    expect(job.duplicateRows).toBe(0);
    expect(job.error).toBe("2 row(s) could not be imported.");

    // Exactly one lead — the good row.
    const leads = await db.lead.findMany({ where: { correlationId } });
    expect(leads).toHaveLength(1);
    expect((leads[0]?.canonicalData as { email?: string }).email).toBe("good@example.com");

    const rowErrors = await db.importRowError.findMany({
      where: { importJobId: job.id },
      orderBy: { rowNumber: "asc" },
    });
    expect(rowErrors.map((r) => r.rowNumber)).toEqual([3, 4]);
    expect(rowErrors[0]?.error).toMatch(/contact channel/i);
    expect(rowErrors[0]?.rawRow).toMatchObject({ "first name": "Missing", city: "Delhi" });
    expect(rowErrors[1]?.error).toMatch(/Email address/i);

    const audit = await db.auditLog.findFirst({
      where: { action: "import.completed", entityId: job.id },
    });
    expect(audit?.metadata).toMatchObject({ failed: 2, skipped: 1 });
  });

  it("treats an identical re-upload as duplicates instead of double-importing", async () => {
    const before = await db.lead.count({ where: { sourceId: fixture.sourceId } });

    const { correlationId } = await runImport(VALID_CSV);
    const job = await jobOf(correlationId);

    expect(job.status).toBe("COMPLETED");
    expect(job.successfulRows).toBe(0);
    expect(job.duplicateRows).toBe(3); // every row already present
    expect(job.failedRows).toBe(0);
    // No new leads were created.
    expect(await db.lead.count({ where: { sourceId: fixture.sourceId } })).toBe(before);
    expect(await db.lead.count({ where: { correlationId } })).toBe(0);
  });

  it("resumes a partial import: created rows stay duplicates, failed rows are retried", async () => {
    const csv = [
      "email,first name,city",
      "resume@example.com,Resume,Chennai",
      ",Missing,Delhi", // fails again, for the same reason
    ].join("\n");

    const first = await runImport(csv);
    const firstJob = await jobOf(first.correlationId);
    expect(firstJob.successfulRows).toBe(1);
    expect(firstJob.failedRows).toBe(1);

    // Same bytes + same mapping → same row identity → resume semantics.
    const second = await runImport(csv);
    const secondJob = await jobOf(second.correlationId);
    expect(secondJob.duplicateRows).toBe(1); // resume@example.com already exists
    expect(secondJob.failedRows).toBe(1); // retried and failed again
    expect(secondJob.successfulRows).toBe(0);
    expect(await db.lead.count({ where: { correlationId: second.correlationId } })).toBe(0);
  });

  it("applies an explicit column mapping and skips unmapped columns", async () => {
    const csv = ["Email Address,City Name,Lead Source", "map@example.com,Chennai,referral"].join(
      "\n",
    );
    const { correlationId } = await runImport(csv, {
      mapping: [
        { column: "Email Address", target: "email" },
        { column: "City Name", target: "location.city" },
        { column: "Lead Source", target: "" }, // intentionally skipped
      ],
    });

    const job = await jobOf(correlationId);
    expect(job.successfulRows).toBe(1);

    const lead = await db.lead.findFirstOrThrow({ where: { correlationId } });
    const canonical = lead.canonicalData as { email?: string; location?: { city?: string } };
    expect(canonical.email).toBe("map@example.com");
    expect(canonical.location).toMatchObject({ city: "Chennai" });
    // The skipped column was NOT imported anywhere.
    expect(canonical).not.toHaveProperty("custom");
  });

  it("fails malformed uploads loudly instead of completing with zero rows", async () => {
    // Header-only file → no data rows.
    const headerOnly = await prepare("email,city");
    await expect(processImport(headerOnly)).rejects.toBeInstanceOf(UnrecoverableError);
    const headerOnlyJob = await jobOf(headerOnly.correlationId);
    expect(headerOnlyJob.status).toBe("FAILED");
    expect(headerOnlyJob.error).toMatch(/no parsable data rows/i);

    // Duplicate columns would silently lose data → refused before importing.
    const dupes = await prepare("email,city,email\na@b.co,Chennai,c@x.co");
    await expect(processImport(dupes)).rejects.toBeInstanceOf(UnrecoverableError);
    const dupesJob = await jobOf(dupes.correlationId);
    expect(dupesJob.status).toBe("FAILED");
    expect(dupesJob.error).toMatch(/duplicate columns/i);
  });
});
