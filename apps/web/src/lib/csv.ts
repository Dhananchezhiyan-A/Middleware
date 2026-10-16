import type { CsvColumnMapping } from "@middleware/types";
import { findLeadField } from "@middleware/types";
import {
  CSV_MAX_BYTES,
  CSV_MAX_COLUMNS,
  CSV_MAX_ROWS,
  CSV_PREVIEW_ROWS,
  duplicateHeaders,
  parseCsv,
  recordToCanonical,
  suggestColumnMapping,
  toRecords,
  validateCanonical,
} from "@middleware/validation";
import { formatBytes } from "@/lib/format";

/**
 * Browser-side CSV preview + column mapping helpers.
 *
 * Nothing here is trusted: it parses the SAME bytes the server will with the
 * SAME code (`@middleware/validation`), so what the user previews, maps and
 * validates here is exactly what the import will do. The server re-validates
 * everything on upload — this only exists so the user is never surprised.
 */

/** One row rendered in the preview table. */
export interface PreviewRow {
  /** 1-based file row (the header row is row 1). */
  rowNumber: number;
  values: Record<string, string>;
}

/** A row that would be rejected, with the reasons (identical to the server's). */
export interface RowIssue {
  rowNumber: number;
  reasons: string[];
}

export interface CsvFilePreview {
  headers: string[];
  records: Array<Record<string, string>>;
  rowNumbers: number[];
  /** Every data row in the file, INCLUDING rows skipped as completely empty. */
  totalRows: number;
  /** Rows with no data at all — the import reports these as "skipped". */
  skippedRows: number;
  /** Header-alias suggestion the user can adjust before importing. */
  mapping: CsvColumnMapping[];
  /** First {@link CSV_PREVIEW_ROWS} data rows. */
  previewRows: PreviewRow[];
  /** Validation problems across ALL rows (not just the previewed ones). */
  issues: RowIssue[];
}

/** User-facing failure: the message is shown verbatim in the file step. */
export class CsvPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvPreviewError";
  }
}

/**
 * Reads, parses and validates a picked file. Throws {@link CsvPreviewError}
 * with a message the user can act on ("file too large", "no header row"…).
 */
export async function readCsvFile(file: File): Promise<CsvFilePreview> {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    throw new CsvPreviewError("Only .csv files can be imported.");
  }
  if (file.size > CSV_MAX_BYTES) {
    const mb = Math.round(CSV_MAX_BYTES / (1024 * 1024));
    throw new CsvPreviewError(`File is ${formatBytes(file.size)} — the limit is ${mb} MB.`);
  }

  const text = await file.text();
  if (text.includes("\u0000")) {
    throw new CsvPreviewError("File content is not CSV text.");
  }

  const table = toRecords(parseCsv(text));
  if (!table) {
    throw new CsvPreviewError("File does not look like a CSV with a header row.");
  }
  if (table.headers.length > CSV_MAX_COLUMNS) {
    throw new CsvPreviewError(`CSV exceeds the ${CSV_MAX_COLUMNS}-column limit.`);
  }
  if (table.dataRows > CSV_MAX_ROWS) {
    throw new CsvPreviewError(`CSV exceeds the ${CSV_MAX_ROWS}-row limit (found ${table.dataRows}).`);
  }
  const dupes = duplicateHeaders(table.headers);
  if (dupes.length > 0) {
    throw new CsvPreviewError(`CSV has duplicate columns: ${dupes.join(", ")}.`);
  }
  if (table.records.length === 0) {
    throw new CsvPreviewError("CSV contains no data rows.");
  }

  const mapping = suggestColumnMapping(table.headers);
  const previewRows: PreviewRow[] = [];
  for (let i = 0; i < table.records.length && i < CSV_PREVIEW_ROWS; i++) {
    previewRows.push({
      rowNumber: table.rowNumbers[i] ?? i + 2,
      values: table.records[i] as Record<string, string>,
    });
  }

  return {
    headers: table.headers,
    records: table.records,
    rowNumbers: table.rowNumbers,
    totalRows: table.dataRows,
    skippedRows: Math.max(0, table.dataRows - table.records.length),
    mapping,
    previewRows,
    issues: validateRows(table.records, table.rowNumbers, mapping),
  };
}

/** Validates every row exactly like the worker will. */
export function validateRows(
  records: Array<Record<string, string>>,
  rowNumbers: readonly number[],
  mapping: CsvColumnMapping[],
): RowIssue[] {
  const issues: RowIssue[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i] as Record<string, string>;
    const result = validateCanonical(recordToCanonical(record, mapping));
    if (!result.ok) {
      issues.push({ rowNumber: rowNumbers[i] ?? i + 2, reasons: result.errors });
    }
  }
  return issues;
}

/**
 * Blocking problems with the chosen mapping — checked BEFORE the upload so
 * the import never starts in a state the worker would have to reject.
 */
export function mappingProblems(
  mapping: readonly CsvColumnMapping[],
  headers: readonly string[],
): string[] {
  const problems: string[] = [];
  const headerSet = new Set(headers);
  const targetCounts = new Map<string, number>();

  for (const entry of mapping) {
    if (!headerSet.has(entry.column)) {
      problems.push(`Mapping references a column that is not in the file: ${entry.column}.`);
    }
    if (entry.target === "") continue;
    if (!entry.target.startsWith("custom.") && !findLeadField(entry.target)) {
      problems.push(`Unknown lead field "${entry.target}".`);
      continue;
    }
    targetCounts.set(entry.target, (targetCounts.get(entry.target) ?? 0) + 1);
  }

  for (const [target, count] of targetCounts) {
    if (count > 1) problems.push(`"${target}" is assigned to ${count} columns.`);
  }

  // The pipeline requires a contact channel (email or phone) per lead — the
  // same rule the worker validates each row against.
  const hasContact = mapping.some((entry) => entry.target === "email" || entry.target === "phone");
  if (!hasContact) {
    problems.push("Map at least one column to email or phone — every lead needs a contact channel.");
  }
  return problems;
}

/** Returns a new mapping with `column` pointing at `target` ("" = skip). */
export function withTarget(
  mapping: readonly CsvColumnMapping[],
  column: string,
  target: string,
): CsvColumnMapping[] {
  return mapping.map((entry) => (entry.column === column ? { ...entry, target } : entry));
}
