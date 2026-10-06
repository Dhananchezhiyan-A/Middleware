import { Injectable, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { getPrisma } from "@middleware/database";
import { getStorage, sha256Hex } from "@middleware/shared";
import type { ImportCsvJob } from "@middleware/types";
import { json } from "../common/json";
import { parseCsv, recordToCanonical, toRecords } from "../pipeline/csv";
import { QueueProducer } from "../queues/queue-producer";

/** Hard cap: a malformed/hostile upload can never exhaust the database. */
const MAX_ROWS = 100_000;
const MAX_COLUMNS = 200;
const PROGRESS_EVERY = 100;

/**
 * CSV_IMPORT: reads the uploaded file from storage and creates leads.
 *
 * Data safety:
 *  - Idempotent: each row gets a deterministic externalLeadId derived from
 *    (importJobId, rowNumber) — a retried import job can never double-create
 *    a lead (DB unique constraint), rows already present count as duplicates.
 *  - Bad rows are isolated as ImportRowError entries; one bad row never
 *    aborts the import.
 *  - Counters are real, periodically flushed so the UI progress is truthful.
 */
@Injectable()
export class CsvImportProcessor {
  private readonly logger = new Logger(CsvImportProcessor.name);

  constructor(private readonly queues: QueueProducer) {}

  async process(job: Job<ImportCsvJob>): Promise<void> {
    const db = getPrisma();
    const { importJobId, correlationId } = job.data;

    const importJob = await db.importJob.findFirst({ where: { id: importJobId } });
    if (!importJob) {
      throw new UnrecoverableError(`Import job ${importJobId} not found`);
    }
    if (["COMPLETED", "CANCELLED", "FAILED"].includes(importJob.status)) {
      this.logger.log(`Import ${importJobId} already terminal (${importJob.status}); skipping.`);
      return;
    }
    if (!importJob.sourceId || !importJob.sourceAccountId) {
      await this.fail(importJobId, "Import has no source/account attached; cannot create leads.");
      throw new UnrecoverableError(`Import ${importJobId} has no source/account`);
    }

    await db.importJob.update({
      where: { id: importJobId },
      data: { status: "PARSING", startedAt: importJob.startedAt ?? new Date() },
    });

    let text: string;
    try {
      const buffer = await getStorage().getBuffer(importJob.storageKey);
      text = buffer.toString("utf8");
    } catch (err) {
      // Storage read failures are transient (retry); missing file after
      // retries shows up as a terminal job failure via the DLQ path.
      throw new Error(`Import file unreadable: ${err instanceof Error ? err.message : String(err)}`);
    }

    const table = toRecords(parseCsv(text));
    if (!table || table.records.length === 0) {
      await this.fail(importJobId, "CSV contains no parsable data rows.");
      throw new UnrecoverableError(`Import ${importJobId}: no data rows`);
    }
    if (table.records.length > MAX_ROWS) {
      await this.fail(importJobId, `CSV exceeds the ${MAX_ROWS}-row limit.`);
      throw new UnrecoverableError(`Import ${importJobId}: row limit exceeded`);
    }
    if (table.headers.length > MAX_COLUMNS) {
      await this.fail(importJobId, `CSV exceeds the ${MAX_COLUMNS}-column limit.`);
      throw new UnrecoverableError(`Import ${importJobId}: column limit exceeded`);
    }

    await db.importJob.update({
      where: { id: importJobId },
      data: { status: "PROCESSING", totalRows: table.records.length },
    });

    let processed = 0;
    let successful = 0;
    let failed = 0;
    let duplicates = 0;

    for (let i = 0; i < table.records.length; i++) {
      const record = table.records[i] as Record<string, string>;
      const rowNumber = i + 2; // row 1 is the header
      try {
        const canonical = recordToCanonical(record);
        const lead = await db.lead.create({
          data: {
            sourceId: importJob.sourceId,
            sourceAccountId: importJob.sourceAccountId,
            externalLeadId: `csv:${importJobId}:${rowNumber}`,
            status: "RECEIVED",
            stage: "RECEIVED",
            canonicalData: json(canonical),
            correlationId,
          },
        });
        await db.leadRawPayload.create({
          data: {
            leadId: lead.id,
            sourceAccountId: importJob.sourceAccountId,
            payload: json(record),
            contentType: "text/csv",
            checksum: sha256Hex(JSON.stringify(record)),
          },
        });
        await this.queues.enqueueIntake({
          leadId: lead.id,
          correlationId,
        });
        successful += 1;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "P2002") {
          duplicates += 1; // Row already created by a previous attempt — idempotent.
        } else {
          failed += 1;
          const message = err instanceof Error ? err.message : String(err);
          try {
            await db.importRowError.create({
              data: {
                importJobId,
                rowNumber,
                rawRow: json(record),
                error: message.slice(0, 1000),
              },
            });
          } catch (rowErr) {
            this.logger.error(`Could not record row error ${rowNumber}: ${String(rowErr)}`);
          }
        }
      }

      processed += 1;
      if (processed % PROGRESS_EVERY === 0) {
        await db.importJob.update({
          where: { id: importJobId },
          data: { processedRows: processed, successfulRows: successful, failedRows: failed, duplicateRows: duplicates },
        });
      }
    }

    await db.importJob.update({
      where: { id: importJobId },
      data: {
        status: "COMPLETED",
        processedRows: processed,
        successfulRows: successful,
        failedRows: failed,
        duplicateRows: duplicates,
        finishedAt: new Date(),
        error: failed > 0 ? `${failed} row(s) could not be imported.` : null,
      },
    });
    await db.auditLog.create({
      data: {
        actorType: "WORKER",
        actorLabel: "csv-import-worker",
        action: "import.completed",
        entityType: "ImportJob",
        entityId: importJobId,
        correlationId,
        metadata: json({ processed, successful, failed, duplicates }),
      },
    });
    this.logger.log(
      `Import ${importJobId} completed: ${successful} created, ${duplicates} duplicate, ${failed} failed.`,
    );
  }

  private async fail(importJobId: string, reason: string): Promise<void> {
    await getPrisma().importJob.update({
      where: { id: importJobId },
      data: { status: "FAILED", finishedAt: new Date(), error: reason.slice(0, 2000) },
    });
  }
}
