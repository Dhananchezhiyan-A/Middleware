import type { CanonicalLead } from "@middleware/types";

/**
 * RFC 4180 CSV parsing + row → canonical lead conversion for the CSV_IMPORT
 * queue. Pure functions (unit-tested without Redis/PostgreSQL).
 */

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
}

/** First row = headers (case/space-insensitive), remaining rows = records. */
export function toRecords(rows: string[][]): CsvTable | null {
  if (rows.length < 2) return null;
  const headers = (rows[0] ?? []).map((h) => h.trim());
  if (headers.every((h) => h === "")) return null;
  const records: Array<Record<string, string>> = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    // Skip rows that are entirely empty.
    if (row.every((cell) => cell.trim() === "")) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h === "") return;
      rec[h] = (row[idx] ?? "").trim();
    });
    records.push(rec);
  }
  return { headers, records };
}

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
  jobTitle: ["job title", "jobtitle", "job_title", "designation", "title", "role"],
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

function canonicalKeyFor(header: string): string {
  const h = header
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ");
  for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(h)) return key;
  }
  return `custom:${header.trim()}`;
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

/** Converts one CSV record into a canonical lead (best-effort, verbatim custom). */
export function recordToCanonical(record: Record<string, string>): CanonicalLead {
  const canonical: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};

  for (const [header, rawValue] of Object.entries(record)) {
    const value = rawValue.trim();
    if (value === "") continue;
    const key = canonicalKeyFor(header);
    if (key.startsWith("custom:")) {
      custom[key.slice(7)] = value;
      continue;
    }
    if (key === "budget") {
      if (NUMERIC_BUDGET_RE.test(value)) {
        const n = Number(value.replace(/,/g, ""));
        if (!Number.isNaN(n)) setPath(canonical, key, n);
        else setPath(canonical, key, value);
      } else {
        setPath(canonical, key, value);
      }
      continue;
    }
    setPath(canonical, key, value);
  }

  if (Object.keys(custom).length > 0) canonical.custom = custom;
  return canonical as unknown as CanonicalLead;
}
