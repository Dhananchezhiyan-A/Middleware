import { describe, expect, it } from "vitest";
import type { CsvColumnMapping } from "@middleware/types";
import {
  CSV_MAX_BYTES,
  CSV_MAX_COLUMNS,
  CSV_MAX_ROWS,
  canonicalTargetFor,
  duplicateHeaders,
  parseCsv,
  recordToCanonical,
  suggestColumnMapping,
  toRecords,
} from "./csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles quoted fields with commas, newlines and escaped quotes", () => {
    const text = 'name,notes\n"Doe, Jane","Line 1\nLine 2"\n"He said ""hi""",ok';
    expect(parseCsv(text)).toEqual([
      ["name", "notes"],
      ["Doe, Jane", "Line 1\nLine 2"],
      ['He said "hi"', "ok"],
    ]);
  });

  it("handles CRLF line endings and a UTF-8 BOM", () => {
    const text = "\uFEFFa,b\r\n1,2\r\n";
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty fields and ignores trailing empty lines", () => {
    expect(parseCsv("a,b,c\n1,,3\n\n")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("parses quoted headers containing commas (not a comma split)", () => {
    expect(parseCsv('"Full, Name",Phone\n"Doe, Jane",12345')).toEqual([
      ["Full, Name", "Phone"],
      ["Doe, Jane", "12345"],
    ]);
  });
});

describe("toRecords", () => {
  it("maps rows onto headers", () => {
    const table = toRecords(parseCsv("email,city\na@b.co,Chennai\n"));
    expect(table).not.toBeNull();
    expect(table?.records).toEqual([{ email: "a@b.co", city: "Chennai" }]);
  });

  it("returns null for header-only or empty files", () => {
    expect(toRecords([["email"]])).toBeNull();
    expect(toRecords([])).toBeNull();
  });

  it("skips entirely empty rows but still counts them", () => {
    const table = toRecords(parseCsv("email\na@b.co\n,\n"));
    expect(table?.records).toEqual([{ email: "a@b.co" }]);
    expect(table?.rowNumbers).toEqual([2]); // physical file row (header = 1)
    expect(table?.dataRows).toBe(2); // one real row + one skipped empty row
  });

  it("keeps headers with spaces and mixed capitalization verbatim", () => {
    const table = toRecords(parseCsv("First Name,E-MAIL\nPriya, a@b.co "));
    expect(table?.headers).toEqual(["First Name", "E-MAIL"]);
    expect(table?.records).toEqual([{ "First Name": "Priya", "E-MAIL": "a@b.co" }]);
  });
});

describe("duplicateHeaders", () => {
  it("reports only the repeated headers", () => {
    expect(duplicateHeaders(["Email", "City", "Email", "City", "Email"])).toEqual(["Email", "City"]);
  });

  it("is empty for a well-formed header row", () => {
    expect(duplicateHeaders(["Email", "City", "Phone"])).toEqual([]);
  });
});

describe("canonicalTargetFor / suggestColumnMapping", () => {
  it("matches common aliases case/space-insensitively", () => {
    expect(canonicalTargetFor("First Name")).toBe("name.first");
    expect(canonicalTargetFor("e-mail")).toBe("email");
    expect(canonicalTargetFor("PHONE_NUMBER")).toBe("phone");
    expect(canonicalTargetFor("Budget (INR)")).toBe("budget");
  });

  it("keeps unknown headers under custom.<header>", () => {
    expect(canonicalTargetFor("Lucky Number")).toBe("custom.Lucky Number");
  });

  it("suggests one target per column, skipping blank headers", () => {
    const mapping = suggestColumnMapping(["Email", "  ", "City"]);
    expect(mapping).toEqual([
      { column: "Email", target: "email" },
      { column: "City", target: "location.city" },
    ]);
  });
});

describe("recordToCanonical", () => {
  it("maps common header aliases onto canonical paths", () => {
    const canonical = recordToCanonical({
      "First Name": "Priya",
      "Last Name": "Raman",
      Email: "priya@example.com",
      "Phone Number": "+91 98765 43210",
      Company: "Acme",
      City: "Chennai",
      Budget: "50,00,000",
      Campaign: "Diwali2025",
    });

    expect(canonical).toMatchObject({
      name: { first: "Priya", last: "Raman" },
      email: "priya@example.com",
      phone: "+91 98765 43210",
      company: "Acme",
      location: { city: "Chennai" },
      sourceInfo: { campaign: "Diwali2025" },
      budget: 5000000,
    });
  });

  it("preserves unknown headers verbatim under custom", () => {
    const canonical = recordToCanonical({ Email: "a@b.co", "Lucky Number": "7" });
    expect(canonical.custom).toEqual({ "Lucky Number": "7" });
    expect(canonical.email).toBe("a@b.co");
  });

  it("keeps non-numeric budget values as text", () => {
    expect(recordToCanonical({ Email: "a@b.co", Budget: "50L-75L" }).budget).toBe("50L-75L");
  });

  it("drops empty cells instead of writing empty strings", () => {
    const canonical = recordToCanonical({ Email: "a@b.co", Company: "   ", City: "" });
    expect(canonical.company).toBeUndefined();
    expect((canonical.location ?? undefined)).toBeUndefined();
  });
});

describe("recordToCanonical with an explicit mapping", () => {
  const mapping: CsvColumnMapping[] = [
    { column: "Mail", target: "email" },
    { column: "Contact", target: "phone" },
    { column: "Internal Ref", target: "" }, // skipped
    { column: "Whatever", target: "custom.leadSource" },
  ];

  it("lets the chosen target win over header-alias detection", () => {
    // "Mail" would alias to nothing useful on its own; "Contact" would land in
    // custom — the explicit mapping decides instead.
    const canonical = recordToCanonical(
      { Mail: "a@b.co", Contact: "9876543210", "Internal Ref": "REF-1", Whatever: "site" },
      mapping,
    );
    expect(canonical.email).toBe("a@b.co");
    expect(canonical.phone).toBe("9876543210");
    expect(canonical.custom).toEqual({ leadSource: "site" });
    // The skipped column must not survive anywhere.
    expect(JSON.stringify(canonical)).not.toContain("REF-1");
  });

  it("falls back to header-alias detection for columns the mapping omits", () => {
    const canonical = recordToCanonical(
      { Mail: "a@b.co", "Unmapped Column": "kept" },
      mapping,
    );
    expect(canonical.email).toBe("a@b.co");
    expect(canonical.custom).toEqual({ "Unmapped Column": "kept" });
  });

  it("treats an explicit empty target list as no mapping (alias fallback)", () => {
    const canonical = recordToCanonical({ Email: "a@b.co", "Lucky Number": "7" }, []);
    expect(canonical.email).toBe("a@b.co");
    expect(canonical.custom).toEqual({ "Lucky Number": "7" });
  });
});

describe("limits", () => {
  it("exposes conservative server-side caps", () => {
    expect(CSV_MAX_ROWS).toBeGreaterThan(0);
    expect(CSV_MAX_COLUMNS).toBeGreaterThan(0);
    expect(CSV_MAX_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
  });
});
