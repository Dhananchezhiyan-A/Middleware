import { describe, expect, it } from "vitest";
import type { CsvColumnMapping } from "@middleware/types";
import {
  CsvPreviewError,
  mappingProblems,
  readCsvFile,
  validateRows,
  withTarget,
} from "./csv";

/** Minimal File shim — Node's File is fine, this keeps the tests explicit. */
function fileOf(content: string, name = "leads.csv", size?: number): File {
  return {
    name,
    size: size ?? Buffer.byteLength(content, "utf8"),
    text: async () => content,
  } as unknown as File;
}

async function readOk(content: string, name?: string) {
  return readCsvFile(fileOf(content, name));
}

const VALID_CSV = [
  "Email,First Name,City,Mobile Number",
  '"priya@example.com","Priya, Raman","Chennai","9876543210"',
  '"ravi@example.com","Ravi\nKumar","Delhi","9123456780"',
  ",,,", // an empty (but present) row → skipped by the importer, still counted
  '"bad-email","Anil","Pune","123"',
].join("\n");

describe("readCsvFile — valid files", () => {
  it("parses headers, rows and a preview", async () => {
    const preview = await readOk(VALID_CSV);

    expect(preview.headers).toEqual(["Email", "First Name", "City", "Mobile Number"]);
    expect(preview.records).toHaveLength(3);
    // 4 data rows exist, one of them is blank → counted as skipped.
    expect(preview.totalRows).toBe(4);
    expect(preview.skippedRows).toBe(1);
    expect(preview.previewRows).toHaveLength(3);
    expect(preview.previewRows[0]?.rowNumber).toBe(2);
    expect(preview.previewRows[2]?.rowNumber).toBe(5); // the empty row is row 4
    expect(preview.previewRows[0]?.values).toMatchObject({
      Email: "priya@example.com",
      "First Name": "Priya, Raman",
      City: "Chennai",
    });
  });

  it("keeps quoted commas, multiline fields and escaped quotes", async () => {
    const preview = await readOk(
      'name,notes\n"Doe, Jane","Line 1\nLine 2"\n"He said ""hi""",ok',
    );
    expect(preview.records[0]).toEqual({ name: "Doe, Jane", notes: "Line 1\nLine 2" });
    expect(preview.records[1]).toEqual({ name: 'He said "hi"', notes: "ok" });
  });

  it("suggests lead-field targets for the headers (case/space tolerant)", async () => {
    const preview = await readOk("E-MAIL,CITY ,Phone Number\na@b.co,Chennai,9876543210");
    expect(preview.mapping).toEqual([
      { column: "E-MAIL", target: "email" },
      { column: "CITY", target: "location.city" },
      { column: "Phone Number", target: "phone" },
    ]);
  });

  it("handles CRLF line endings and a UTF-8 BOM", async () => {
    const preview = await readOk("\uFEFFemail,city\r\na@b.co,Chennai\r\n");
    expect(preview.headers).toEqual(["email", "city"]);
    expect(preview.records).toEqual([{ email: "a@b.co", city: "Chennai" }]);
  });
});

describe("readCsvFile — rejected files", () => {
  it("rejects a non-.csv extension", async () => {
    await expect(readOk("a,b\n1,2", "leads.xlsx")).rejects.toBeInstanceOf(CsvPreviewError);
    await expect(readOk("a,b\n1,2", "leads.txt")).rejects.toThrow(/Only \.csv files/i);
  });

  it("rejects an oversized file before reading it", async () => {
    const tooBig = fileOf("email\na@b.co", "leads.csv", 11 * 1024 * 1024);
    await expect(readCsvFile(tooBig)).rejects.toThrow(/limit/i);
  });

  it("rejects an empty file and a header-only file", async () => {
    await expect(readOk("")).rejects.toThrow(/header row/i);
    await expect(readOk("email,city")).rejects.toThrow(/header row/i);
  });

  it("rejects a file whose rows are all empty", async () => {
    await expect(readOk("email,city\n,\n")).rejects.toThrow(/no data rows/i);
  });

  it("rejects duplicate column names", async () => {
    await expect(readOk("email,city,email\na@b.co,Chennai,c@x.co")).rejects.toThrow(
      /duplicate columns: email/i,
    );
  });

  it("rejects binary content", async () => {
    await expect(readOk("email,city\na\u0000b,c")).rejects.toThrow(/not CSV text/i);
  });

  it("rejects a file above the row limit", async () => {
    const rows = Array.from({ length: 100_001 }, (_, i) => `row${i}@example.com`);
    await expect(readOk(["email", ...rows].join("\n"))).rejects.toThrow(/row limit/i);
  });

  it("rejects a file above the column limit", async () => {
    const headers = Array.from({ length: 201 }, (_, i) => `col${i}`).join(",");
    await expect(readOk(`${headers}\n${Array.from({ length: 201 }, () => "x").join(",")}`)).rejects.toThrow(
      /column limit/i,
    );
  });
});

describe("validateRows — required fields and invalid values", () => {
  const mapping: CsvColumnMapping[] = [
    { column: "email", target: "email" },
    { column: "phone", target: "phone" },
    { column: "city", target: "location.city" },
  ];

  it("flags rows without any contact channel", () => {
    const issues = validateRows(
      [{ email: "", phone: "", city: "Pune" }],
      [2],
      mapping,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rowNumber).toBe(2);
    expect(issues[0]?.reasons.join(" ")).toMatch(/contact channel/i);
  });

  it("flags malformed email and phone values", () => {
    const issues = validateRows(
      [
        { email: "not-an-email", phone: "", city: "" },
        { email: "", phone: "abc", city: "" },
      ],
      [2, 3],
      mapping,
    );
    expect(issues.map((issue) => issue.rowNumber)).toEqual([2, 3]);
    expect(issues[0]?.reasons.join(" ")).toMatch(/Email address/);
    expect(issues[1]?.reasons.join(" ")).toMatch(/Phone number/);
  });

  it("accepts rows the pipeline accepts", () => {
    const issues = validateRows(
      [{ email: "a@b.co", phone: "+91 98765 43210", city: "Chennai" }],
      [2],
      mapping,
    );
    expect(issues).toEqual([]);
  });

  it("reports the real file row number (empty rows are not renumbered)", () => {
    // Physical file: header(1), row(2), blank(3), row(4).
    const issues = validateRows([{ email: "", phone: "" }], [4], mapping);
    expect(issues[0]?.rowNumber).toBe(4);
  });
});

describe("mappingProblems — checked before the upload", () => {
  const headers = ["Email", "City"];

  it("requires at least one contact channel", () => {
    const problems = mappingProblems(
      [
        { column: "Email", target: "" },
        { column: "City", target: "location.city" },
      ],
      headers,
    );
    expect(problems.join(" ")).toMatch(/email or phone/);
  });

  it("rejects duplicate targets", () => {
    const problems = mappingProblems(
      [
        { column: "Email", target: "email" },
        { column: "City", target: "email" },
      ],
      headers,
    );
    expect(problems.join(" ")).toMatch(/assigned to 2 columns/);
  });

  it("rejects unknown lead fields", () => {
    const problems = mappingProblems(
      [
        { column: "Email", target: "email" },
        { column: "City", target: "not.a.field" },
      ],
      headers,
    );
    expect(problems.join(" ")).toMatch(/Unknown lead field/);
  });

  it("rejects columns that are not in the file", () => {
    const problems = mappingProblems([{ column: "Phone", target: "phone" }], headers);
    expect(problems.join(" ")).toMatch(/not in the file/);
  });

  it("passes for a complete, consistent mapping (custom fields allowed)", () => {
    const problems = mappingProblems(
      [
        { column: "Email", target: "email" },
        { column: "City", target: "custom.leadCity" },
      ],
      headers,
    );
    expect(problems).toEqual([]);
  });
});

describe("withTarget", () => {
  it("changes only the targeted column and keeps the rest", () => {
    const mapping: CsvColumnMapping[] = [
      { column: "Email", target: "email" },
      { column: "City", target: "location.city" },
    ];
    const next = withTarget(mapping, "City", "");
    expect(next).toEqual([
      { column: "Email", target: "email" },
      { column: "City", target: "" },
    ]);
    // Original array untouched (React state must stay pure).
    expect(mapping[1]?.target).toBe("location.city");
  });
});
