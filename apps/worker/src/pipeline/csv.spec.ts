import { describe, expect, it } from "vitest";
import { parseCsv, recordToCanonical, toRecords } from "./csv";

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

  it("skips entirely empty rows", () => {
    const table = toRecords(parseCsv("email\na@b.co\n,\n"));
    expect(table?.records).toEqual([{ email: "a@b.co" }]);
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
