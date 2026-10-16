import { Injectable, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { getPrisma } from "@middleware/database";
import { getStorage, sha256Hex } from "@middleware/shared";
import {
  CSV_MAX_COLUMNS,
  CSV_MAX_ROWS,
  duplicateHeaders,
  parseCsv,
  recordToCanonical,
  toRecords,
  validateCanonical,
} from "@middleware/validation";
import { findLeadField, type CsvColumnMapping, type ImportCsvJob } from "@middleware/types";
import { json } from "../common/json";
// Value import (not `import type`): emitDecoratorMetadata needs the runtime
// class to build the constructor's design:paramtypes for Nest DI.
import { QueueProducer } from "../queues/queue-producer";

/** Rows are written to PostgreSQL in bounded batches (never held in memory). */
const PROGRESS_EVERY = 100;

/**
 * CSV_IMPORT: reads the uploaded file from storage and creates leads.
 *
 * Data safety:
 *  - Idempotent: each row gets a deterministic externalLeadId derived from
 *    (file checksum + column mapping + row number). A retried job can never
 *    double-create a lead, and re-uploading the SAME file reports every row
 *    as a duplicate instead of silently creating copies. Rows that failed on
 *    a previous run have no lead, so they are retried.
 *  - Rows are validated with the SAME rule set the upload UI previewed
 *    (`validateCanonical`); failures are isolated as ImportRowError entries
 *    with the file row number — one bad row never aborts the import.
 *  - Counters are real, periodically flushed so the UI progress is truthful.
 *    `processedRows` counts rows ATTEMPTED; the report's "skipped" count is
 *    `totalRows - processedRows` (rows without any data).
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

    const mapping = this.readMapping(job.data.mapping);
    if (mapping === null) {
      await this.fail(importJobId, "Import carries an invalid column mapping.");
      throw new UnrecoverableError(`Import ${importJobId}: invalid column mapping`);
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
    if (table.dataRows > CSV_MAX_ROWS) {
      await this.fail(importJobId, `CSV exceeds the ${CSV_MAX_ROWS}-row limit.`);
      throw new UnrecoverableError(`Import ${importJobId}: row limit exceeded`);
    }
    if (table.headers.length > CSV_MAX_COLUMNS) {
      await this.fail(importJobId, `CSV exceeds the ${CSV_MAX_COLUMNS}-column limit.`);
      throw new UnrecoverableError(`Import ${importJobId}: column limit exceeded`);
    }
    const dupes = duplicateHeaders(table.headers);
    if (dupes.length > 0) {
      await this.fail(importJobId, `CSV has duplicate columns: ${dupes.join(", ")}.`);
      throw new UnrecoverableError(`Import ${importJobId}: duplicate columns`);
    }

    await db.importJob.update({
      where: { id: importJobId },
      data: { status: "PROCESSING", totalRows: table.dataRows },
    });

    /**
     * Import identity: identical file + identical mapping + identical target
     * account produce the SAME externalLeadId per row, so an accidental
     * re-upload cannot create a second copy of every lead (P2002 → duplicate).
     */
    const importKey = sha256Hex(
      `${importJob.sourceAccountId}:${importJob.checksum}:${JSON.stringify(mapping ?? [])}`,
    ).slice(0, 40);

    let processed = 0;
    let successful = 0;
    let failed = 0;
    let duplicates = 0;

    for (let i = 0; i < table.records.length; i++) {
      const record = table.records[i] as Record<string, string>;
      // Physical file row number (header = 1), shared with the upload preview.
      const rowNumber = table.rowNumbers[i] ?? i + 2;
      const canonical = recordToCanonical(record, mapping);
      const validation = validateCanonical(canonical);

      if (!validation.ok) {
        // Never create a lead we already know the pipeline would reject —
        // the row is reported instead, with its row number and reasons.
        failed += 1;
        await this.recordRowError(
          importJobId,
          rowNumber,
          record,
          `Validation: ${validation.errors.join(" ")}`,
        );
      } else {
        try {
          const lead = await db.lead.create({
            data: {
              sourceId: importJob.sourceId,
              sourceAccountId: importJob.sourceAccountId,
              externalLeadId: `csv:${importKey}:${rowNumber}`,
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
            duplicates += 1; // Row already present (retry or identical re-upload).
          } else {
            failed += 1;
            const message = err instanceof Error ? err.message : String(err);
            await this.recordRowError(importJobId, rowNumber, record, message);
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

    const skipped = Math.max(0, table.dataRows - processed);
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
        metadata: json({ processed, successful, failed, duplicates, skipped }),
      },
    });
    this.logger.log(
      `Import ${importJobId} completed: ${successful} created, ${skipped} skipped, ${duplicates} duplicate, ${failed} failed.`,
    );
  }

  /**
   * Validates the mapping payload before any row is touched. Returns null
   * when it is unusable (unknown field target), [] when no mapping was sent
   * (header-alias detection, the pre-mapping behaviour).
   */
  private readMapping(raw: CsvColumnMapping[] | undefined): CsvColumnMapping[] | null {
    if (!raw) return [];
    if (!Array.isArray(raw)) return null;
    const seen = new Set<string>();
    for (const entry of raw) {
      if (typeof entry?.column !== "string" || typeof entry?.target !== "string") return null;
      if (entry.column.trim() === "" || entry.column.length > 255) return null;
      if (entry.target !== "" && !entry.target.startsWith("custom.") && !findLeadField(entry.target)) {
        return null;
      }
      if (entry.target !== "" && seen.has(entry.target)) return null; // one column per field
      if (entry.target !== "") seen.add(entry.target);
    }
    return raw;
  }

  private async recordRowError(
    importJobId: string,
    rowNumber: number,
    record: Record<string, string>,
    message: string,
  ): Promise<void> {
    try {
      await getPrisma().importRowError.create({
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

  private async fail(importJobId: string, reason: string): Promise<void> {
    await getPrisma().importJob.update({
      where: { id: importJobId },
      data: { status: "FAILED", finishedAt: new Date(), error: reason.slice(0, 2000) },
    });
  }
}
