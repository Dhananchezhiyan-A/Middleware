import type { CanonicalLead, CsvColumnMapping } from "@middleware/types";

/**
 * CSV parsing + row → canonical lead conversion.
 *
 * Shared by ALL THREE consumers so the preview the user sees is exactly what
 * the import will do:
 *   - apps/api  — upload content validation (headers, row/column limits)
 *   - apps/worker — CSV_IMPORT row creation
 *   - apps/web  — upload preview, column mapping and pre-import validation
 *
 * Pure functions: no I/O, no environment, no database — unit-testable anywhere.
 */

/* ------------------------------------------------------------------ limits */

/** Hard cap: a malformed/hostile upload can never exhaust the database. */
export const CSV_MAX_ROWS = 100_000;
export const CSV_MAX_COLUMNS = 200;
/** Server-side upload ceiling (multer + re-checked in the service). */
export const CSV_MAX_BYTES = 10 * 1024 * 1024;
/** Data rows rendered in the upload preview (10–20 required by the UI). */
export const CSV_PREVIEW_ROWS = 20;

/* ----------------------------------------------------------------- parsing */

/** Parses CSV text (quoted fields, escaped quotes, CRLF/LF) into rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Ignore completely empty trailing lines.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
    } else if (ch === "\n") {
      pushRow();
    } else {
      field += ch;
    }
  }
  // Final row (file may not end with a newline).
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

export interface CsvTable {
  headers: string[];
  records: Array<Record<string, string>>;
  /**
   * 1-based file row number for `records[i]` (the header row is row 1).
   * Computed from the PARSED row index, so preview and import always agree
   * on which line a failed row lives on.
   */
  rowNumbers: number[];
  /**
   * Every data row in the file INCLUDING the rows `records` dropped as
   * completely empty. `dataRows - records.length` is the "skipped (no data)"
   * count the import report shows.
   */
  dataRows: number;
}

/**
 * First row = headers (trimmed), remaining non-empty rows = records.
 * Returns null when there is nothing to import (header-only/empty file).
 */
export function toRecords(rows: string[][]): CsvTable | null {
  if (rows.length < 2) return null;
  const headers = (rows[0] ?? []).map((h) => h.trim());
  if (headers.every((h) => h === "")) return null;
  const records: Array<Record<string, string>> = [];
  const rowNumbers: number[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    // Skip rows that are entirely empty (they are counted, never imported).
    if (row.every((cell) => cell.trim() === "")) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h === "") return;
      rec[h] = (row[idx] ?? "").trim();
    });
    records.push(rec);
    rowNumbers.push(r + 1);
  }
  return { headers, records, rowNumbers, dataRows: rows.length - 1 };
}

/** Duplicate headers silently overwrite each other — rejected up front. */
export function duplicateHeaders(headers: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const raw of headers) {
    const header = raw.trim();
    if (header === "") continue;
    if (seen.has(header) && !dupes.includes(header)) dupes.push(header);
    seen.add(header);
  }
  return dupes;
}

/* ------------------------------------------------------- header → canonical */

const FIELD_ALIASES: Record<string, string[]> = {
  email: ["email", "email address", "email_address", "e-mail", "e mail", "mail"],
  emailAlt: ["email2", "alt email", "alternate email", "secondary email"],
  phone: [
    "phone",
    "phone number",
    "phone_number",
    "phonenumber",
    "mobile",
    "mobile number",
    "mobile_number",
    "contact number",
    "tel",
    "telephone",
    "whatsapp number",
  ],
  "name.first": ["first name", "firstname", "first_name", "fname"],
  "name.last": ["last name", "lastname", "last_name", "lname"],
  "name.full": ["name", "full name", "full_name", "fullname", "contact name", "lead name"],
  company: [
    "company",
    "company name",
    "company_name",
    "organisation",
    "organization",
    "business",
    "business name",
  ],
  "jobTitle": ["job title", "jobtitle", "job_title", "designation", "title", "role"],
  "location.line1": ["address", "address line 1", "address1", "street", "street address"],
  "location.line2": ["address line 2", "address2", "landmark"],
  "location.city": ["city", "town"],
  "location.state": ["state", "province", "region", "district"],
  "location.country": ["country"],
  "location.postalCode": ["zip", "zip code", "zipcode", "postal", "postal code", "pincode", "pin"],
  project: ["project", "project name", "project_name", "property", "development"],
  budget: ["budget", "budget range", "expected budget", "budget(inr)", "budget (inr)", "value"],
  currency: ["currency"],
  "sourceInfo.campaign": ["campaign", "campaign name", "campaign_name", "ad campaign"],
  "sourceInfo.adGroup": ["ad group", "adgroup", "ad_group"],
  "sourceInfo.medium": ["medium", "utm medium"],
  "sourceInfo.content": ["content", "utm content"],
  "sourceInfo.term": ["term", "utm term"],
  "sourceInfo.pageUrl": ["landing page", "page url", "url", "page", "landing_page", "utm source"],
};

/** Canonical prefix for anything that is not a known lead field. */
const CUSTOM_PREFIX = "custom.";

/**
 * Auto-detects the canonical target for one header (case/space/separator
 * insensitive). Unknown headers keep their own name under `custom.` so no
 * column is ever dropped on the floor.
 */
export function canonicalTargetFor(header: string): string {
  const h = header
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ");
  for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(h)) return key;
  }
  return `${CUSTOM_PREFIX}${header.trim()}`;
}

/** Default column mapping shown in the upload UI (same rule the worker uses). */
export function suggestColumnMapping(headers: readonly string[]): CsvColumnMapping[] {
  return headers
    .filter((header) => header.trim() !== "")
    .map((header) => ({ column: header, target: canonicalTargetFor(header) }));
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let cur = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i] as string;
    if (typeof cur[seg] !== "object" || cur[seg] === null) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segments[segments.length - 1] as string] = value;
}

const NUMERIC_BUDGET_RE = /^[\d,.]+$/;

/**
 * Converts one CSV record into a canonical lead.
 *
 * An explicit `mapping` (chosen in the upload UI) wins; columns it does not
 * mention — and columns it marks with `target: ""` — fall back to being
 * skipped / alias-detected exactly as before.
 */
export function recordToCanonical(
  record: Record<string, string>,
  mapping?: readonly CsvColumnMapping[] | null,
): CanonicalLead {
  const explicit = indexMapping(mapping);
  const canonical: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};

  for (const [header, rawValue] of Object.entries(record)) {
    const value = rawValue.trim();
    if (value === "") continue;
    // Explicit entry wins; columns the mapping does not mention keep the
    // header-alias behaviour, and `target: ""` is the only way to drop one.
    const target =
      explicit && explicit.has(header)
        ? (explicit.get(header) ?? "")
        : canonicalTargetFor(header);
    if (target === "") continue;

    if (target.startsWith(CUSTOM_PREFIX)) {
      // Flat key: the header itself (or a `custom.*` lead field key).
      custom[target.slice(CUSTOM_PREFIX.length)] = value;
      continue;
    }
    if (target === "budget") {
      if (NUMERIC_BUDGET_RE.test(value)) {
        const n = Number(value.replace(/,/g, ""));
        if (!Number.isNaN(n)) setPath(canonical, target, n);
        else setPath(canonical, target, value);
      } else {
        setPath(canonical, target, value);
      }
      continue;
    }
    setPath(canonical, target, value);
  }

  if (Object.keys(custom).length > 0) canonical.custom = custom;
  return canonical as unknown as CanonicalLead;
}

/** Header → target lookup; null when no explicit mapping was supplied. */
function indexMapping(
  mapping?: readonly CsvColumnMapping[] | null,
): Map<string, string> | null {
  if (!mapping || mapping.length === 0) return null;
  const map = new Map<string, string>();
  for (const entry of mapping) {
    if (typeof entry?.column === "string") map.set(entry.column, entry.target ?? "");
  }
  return map;
}
