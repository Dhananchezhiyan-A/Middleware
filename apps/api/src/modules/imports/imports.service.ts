import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  errors,
  getCorrelationId,
  getStorage,
  sanitizeFileName,
  sha256Hex,
} from "@middleware/shared";
import {
  CSV_MAX_BYTES,
  CSV_MAX_COLUMNS,
  CSV_MAX_ROWS,
  duplicateHeaders,
  parseCsv,
  toRecords,
} from "@middleware/validation";
import type { Database, Prisma } from "@middleware/database";
import type { CsvColumnMapping, ImportJobStatus, RequestActor } from "@middleware/types";
import { findLeadField } from "@middleware/types";
import { PRISMA } from "../../infra/prisma.module";
import { AuditService } from "../../infra/audit.module";
import { QueuesService } from "../../infra/redis.module";
import type { ImportUploadInput, UploadedCsvFile } from "./imports.dtos";

/** Safe row shape — `storageKey` and `checksum` never leave the server here. */
const IMPORT_SELECT = {
  id: true,
  fileName: true,
  fileSizeBytes: true,
  status: true,
  totalRows: true,
  processedRows: true,
  successfulRows: true,
  failedRows: true,
  duplicateRows: true,
  createdAt: true,
  finishedAt: true,
  error: true,
} satisfies Prisma.ImportJobSelect;

export type ImportJobView = Prisma.ImportJobGetPayload<{ select: typeof IMPORT_SELECT }>;

const IMPORT_ROW_ERROR_SELECT = {
  id: true,
  rowNumber: true,
  error: true,
  rawRow: true,
} satisfies Prisma.ImportRowErrorSelect;

export interface ImportListQueryInput {
  cursor?: string;
  limit?: number;
  status?: ImportJobStatus;
  from?: string;
  to?: string;
}

export interface ImportRowErrorsQueryInput {
  cursor?: string;
  limit?: number;
}

const ACCEPTED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/octet-stream",
  "text/plain",
]);

const MAX_ERROR_ROWS = 10_000;

/**
 * Spreadsheet formula injection (CSV injection): a cell whose text begins with
 * `=`, `+`, `-`, `@` (or a control char) is executed by Excel/Sheets when the
 * report is opened. Every TEXT cell written to the report is neutralised with
 * a leading apostrophe; numbers (rowNumber) are emitted as-is.
 */
function guardFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvEscape(value: string): string {
  const safe = guardFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: Database,
    private readonly audit: AuditService,
    private readonly queues: QueuesService,
  ) {}

  async createImport(
    actor: RequestActor,
    file: UploadedCsvFile | undefined,
    input: ImportUploadInput,
  ): Promise<ImportJobView> {
    if (!file) throw errors.badRequest("CSV file is required.");

    // --- limits: extension, size, content ---------------------------------
    if (!file.originalname.toLowerCase().endsWith(".csv")) {
      throw errors.badRequest("Only .csv files can be imported.");
    }
    if (file.size > CSV_MAX_BYTES || file.buffer.length > CSV_MAX_BYTES) {
      const mb = Math.round(CSV_MAX_BYTES / (1024 * 1024));
      throw errors.badRequest(`CSV file exceeds the ${mb} MB limit.`);
    }
    const contentType = (file.mimetype ?? "").split(";")[0].trim().toLowerCase();
    if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
      throw errors.badRequest("Only CSV files are accepted.");
    }

    // Real content check (the client-provided extension/mimetype are hints):
    // parse the bytes with the SAME parser the worker will use, so quoted
    // headers, BOMs and unicode column names are handled identically.
    const text = file.buffer.toString("utf8");
    if (text.includes("\u0000")) {
      throw errors.badRequest("File content is not CSV text.");
    }
    const table = toRecords(parseCsv(text));
    if (!table) {
      throw errors.validation("File does not look like a CSV with a header row.");
    }
    if (table.headers.length > CSV_MAX_COLUMNS) {
      throw errors.validation(`CSV exceeds the ${CSV_MAX_COLUMNS}-column limit.`);
    }
    if (table.dataRows > CSV_MAX_ROWS) {
      throw errors.validation(
        `CSV exceeds the ${CSV_MAX_ROWS}-row limit (found ${table.dataRows}).`,
      );
    }
    const dupes = duplicateHeaders(table.headers);
    if (dupes.length > 0) {
      throw errors.validation(`CSV has duplicate columns: ${dupes.join(", ")}.`, [
        { path: "headers", message: "Column names must be unique." },
      ]);
    }
    if (table.records.length === 0) {
      throw errors.validation("CSV contains no data rows.");
    }

    const mapping = this.validateMapping(input.mapping, table.headers);

    // --- source + account (the worker refuses to import without both) ------
    const source = await this.prisma.leadSource.findFirst({
      where: { id: input.sourceId },
      select: { id: true },
    });
    if (!source) throw errors.notFound("Source not found.");
    const account = await this.prisma.leadSourceAccount.findFirst({
      where: {
        sourceId: input.sourceId,
        ...(input.sourceAccountId !== undefined ? { id: input.sourceAccountId } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!account) {
      throw errors.notFound(
        input.sourceAccountId !== undefined
          ? "That account does not belong to the selected source."
          : "The selected source has no account yet; create one before importing.",
      );
    }

    const fileName = sanitizeFileName(file.originalname);
    const checksum = sha256Hex(file.buffer);
    const stored = await getStorage().put(file.buffer, {
      contentType,
      prefix: "imports",
      checksum,
    });
    const correlationId = getCorrelationId();

    const job = await this.prisma.importJob.create({
      data: {
        sourceId: source.id,
        sourceAccountId: account.id,
        fileName,
        fileSizeBytes: stored.size,
        checksum,
        storageKey: stored.key,
        status: "PENDING",
        createdBy: actor.userId,
        correlationId,
      },
      select: IMPORT_SELECT,
    });

    try {
      await this.queues.enqueueCsvImport({
        importJobId: job.id,
        correlationId,
        createdBy: actor.userId,
        ...(mapping !== undefined ? { mapping } : {}),
      });
    } catch (err) {
      // The file and the job row are persisted — mark the job FAILED so it is
      // visible and recoverable, then surface the original queue error.
      await this.prisma.importJob
        .update({ where: { id: job.id }, data: { status: "FAILED", error: "Queue unavailable" } })
        .catch((updateErr: unknown) =>
          this.logger.error(
            `Failed to mark import ${job.id} as FAILED: ${String(updateErr)}`,
          ),
        );
      throw err;
    }

    await this.audit.record({
      action: "import.created",
      entityType: "ImportJob",
      entityId: job.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      after: {
        id: job.id,
        fileName: job.fileName,
        fileSizeBytes: job.fileSizeBytes,
        status: job.status,
      },
      metadata: {
        sourceId: source.id,
        sourceAccountId: account.id,
        rows: table.dataRows,
        columns: table.headers.length,
        mappedColumns: mapping?.length ?? 0,
      },
    });
    return job;
  }

  async listImports(
    _actor: RequestActor,
    query: ImportListQueryInput,
  ): Promise<{ items: ImportJobView[]; nextCursor: string | null }> {
    const limit = clampLimit(query.limit);
    const cursor = this.readCursor(query.cursor);
    const from = query.from !== undefined ? new Date(query.from) : undefined;
    const to = query.to !== undefined ? new Date(query.to) : undefined;

    const where: Prisma.ImportJobWhereInput = {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(from !== undefined || to !== undefined
        ? {
            createdAt: {
              ...(from !== undefined ? { gte: from } : {}),
              ...(to !== undefined ? { lte: to } : {}),
            },
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.t } },
              { createdAt: { equals: cursor.t }, id: { lt: cursor.i } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.importJob.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: IMPORT_SELECT,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ t: last.createdAt.toISOString(), i: last.id }) : null;
    return { items, nextCursor };
  }

  /** Safe import job shape (same fields as the list — no storage internals). */
  async getImport(_actor: RequestActor, id: string): Promise<ImportJobView> {
    const job = await this.prisma.importJob.findFirst({
      where: { id },
      select: IMPORT_SELECT,
    });
    if (!job) throw errors.notFound("Import not found.");
    return job;
  }

  /**
   * Failed rows for the import summary table: CSV row number + reason, cursor
   * paginated. The full raw row is included so the user can fix it and
   * re-upload; contents are NEVER logged.
   */
  async listRowErrors(
    _actor: RequestActor,
    id: string,
    query: ImportRowErrorsQueryInput,
  ): Promise<{ items: Array<{ rowNumber: number; error: string; rawRow: unknown }>; nextCursor: string | null }> {
    const job = await this.prisma.importJob.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!job) throw errors.notFound("Import not found.");

    const limit = clampLimit(query.limit);
    const cursor = this.readRowCursor(query.cursor);

    const rows = await this.prisma.importRowError.findMany({
      where: {
        importJobId: job.id,
        ...(cursor
          ? {
              OR: [
                { rowNumber: { gt: cursor.r } },
                { rowNumber: { equals: cursor.r }, id: { gt: cursor.i } },
              ],
            }
          : {}),
      },
      orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: IMPORT_ROW_ERROR_SELECT,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ r: last.rowNumber, i: last.id }) : null;
    return {
      items: items.map((row) => ({ rowNumber: row.rowNumber, error: row.error, rawRow: row.rawRow })),
      nextCursor,
    };
  }

  /**
   * Streams the row-error report as CSV. Bounded: at most MAX_ERROR_ROWS rows
   * are included; truncation is noted in a trailing comment row. Cell text is
   * formula-injection guarded (see guardFormula).
   */
  async downloadErrors(actor: RequestActor, id: string): Promise<string> {
    const job = await this.prisma.importJob.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!job) throw errors.notFound("Import not found.");

    const rows = await this.prisma.importRowError.findMany({
      where: { importJobId: job.id },
      orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
      take: MAX_ERROR_ROWS + 1,
      select: { rowNumber: true, error: true, rawRow: true },
    });

    const truncated = rows.length > MAX_ERROR_ROWS;
    const visible = truncated ? rows.slice(0, MAX_ERROR_ROWS) : rows;

    let csv: string;
    if (visible.length === 0) {
      csv = "rowNumber,error,json\n";
    } else {
      const lines = [
        "rowNumber,error,json",
        ...visible.map(
          (row) =>
            `${row.rowNumber},${csvEscape(row.error)},${csvEscape(JSON.stringify(row.rawRow) ?? "")}`,
        ),
      ];
      if (truncated) {
        lines.push(`"# truncated: showing the first ${MAX_ERROR_ROWS} errors"`);
      }
      csv = `${lines.join("\n")}\n`;
    }

    await this.audit.record({
      action: "import.errors_downloaded",
      entityType: "ImportJob",
      entityId: job.id,
      actorId: actor.userId,
      actorLabel: actor.email || null,
      actorType: actor.actorType,
      metadata: { count: visible.length },
    });
    return csv;
  }

  /**
   * Server-side mapping validation: unknown targets, duplicate targets and
   * columns that are not in the file are rejected at upload time so the job
   * can never run with a mapping the worker would refuse.
   */
  private validateMapping(
    mapping: CsvColumnMapping[] | undefined,
    headers: readonly string[],
  ): CsvColumnMapping[] | undefined {
    if (mapping === undefined) return undefined;
    const headerSet = new Set(headers);
    const seen = new Set<string>();
    for (const entry of mapping) {
      const { column, target } = entry;
      if (!headerSet.has(column)) {
        throw errors.validation(`Mapping references a column that is not in the file: ${column}.`, [
          { path: "mapping", message: `Unknown column: ${column}` },
        ]);
      }
      if (target === "") continue; // column intentionally skipped
      if (!target.startsWith("custom.") && !findLeadField(target)) {
        throw errors.validation(`Unknown lead field "${target}" in the column mapping.`, [
          { path: "mapping", message: `Unknown lead field: ${target}` },
        ]);
      }
      if (seen.has(target)) {
        throw errors.validation(`Column mapping assigns "${target}" to more than one column.`, [
          { path: "mapping", message: `Duplicate target: ${target}` },
        ]);
      }
      seen.add(target);
    }
    return mapping;
  }

  /** Decodes the opaque list cursor; rejects malformed cursors loudly. */
  private readCursor(cursor: string | undefined): { t: Date; i: string } | null {
    if (!cursor) return null;
    const decoded = decodeCursor<Record<string, unknown>>(cursor);
    if (
      !decoded ||
      typeof decoded.t !== "string" ||
      typeof decoded.i !== "string" ||
      Number.isNaN(Date.parse(decoded.t))
    ) {
      throw errors.validation("Invalid pagination cursor.");
    }
    return { t: new Date(decoded.t), i: decoded.i };
  }

  /** Cursor for the row-error list: { r: rowNumber, i: rowErrorId }. */
  private readRowCursor(cursor: string | undefined): { r: number; i: string } | null {
    if (!cursor) return null;
    const decoded = decodeCursor<Record<string, unknown>>(cursor);
    if (
      !decoded ||
      typeof decoded.r !== "number" ||
      !Number.isInteger(decoded.r) ||
      typeof decoded.i !== "string"
    ) {
      throw errors.validation("Invalid pagination cursor.");
    }
    return { r: decoded.r, i: decoded.i };
  }
}
