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
import type { Database, Prisma } from "@middleware/database";
import type { ImportJobStatus, RequestActor } from "@middleware/types";
import { PRISMA } from "../../infra/prisma.module";
import { AuditService } from "../../infra/audit.module";
import { QueuesService } from "../../infra/redis.module";
import type { UploadedCsvFile } from "./imports.dtos";

/** Safe list shape — `storageKey` and `checksum` never leave the server here. */
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

export interface ImportListQueryInput {
  cursor?: string;
  limit?: number;
  status?: ImportJobStatus;
  from?: string;
  to?: string;
}

const ACCEPTED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

/** First line must look like `col_a,col b,col-c`. */
const CSV_HEADER_RE = /^[A-Za-z0-9 _-]+(,[A-Za-z0-9 _-]+)+$/;

const MAX_ERROR_ROWS = 10_000;

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
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
    sourceId?: string,
  ): Promise<ImportJobView> {
    if (!file) throw errors.badRequest("CSV file is required.");

    const contentType = (file.mimetype ?? "").split(";")[0].trim().toLowerCase();
    if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
      throw errors.badRequest("Only CSV files are accepted.");
    }

    const firstLine = (file.buffer.toString("utf8").split(/\r?\n/, 1)[0] ?? "").trim();
    if (!firstLine.includes(",") || !CSV_HEADER_RE.test(firstLine)) {
      throw errors.validation("File does not look like a CSV with a header row.");
    }

    if (sourceId !== undefined) {
      const source = await this.prisma.leadSource.findFirst({
        where: { id: sourceId },
        select: { id: true },
      });
      if (!source) throw errors.notFound("Source not found.");
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
        sourceId: sourceId ?? null,
        sourceAccountId: null,
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

  /** Full import job row. */
  async getImport(_actor: RequestActor, id: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id },
    });
    if (!job) throw errors.notFound("Import not found.");
    return job;
  }

  /**
   * Streams the row-error report as CSV. Bounded: at most MAX_ERROR_ROWS rows
   * are included; truncation is noted in a trailing comment row.
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
      csv = "rowNumber,error,rawRow\n";
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
}
