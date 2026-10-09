import { describe, expect, it } from "vitest";
import { emptyRow, fieldsToRows, rowsToFields, type FieldRow } from "./field-editor";

const row = (source: string, target: string, required = false): FieldRow => ({
  source,
  target,
  required,
});

describe("rowsToFields", () => {
  it("rejects an empty editor", () => {
    expect(rowsToFields([emptyRow()])).toEqual({
      fields: [],
      error: "Add at least one source → target pair.",
    });
  });

  it("ignores untouched rows alongside filled ones", () => {
    const result = rowsToFields([row("email", "email_address"), emptyRow()]);
    expect(result.error).toBeNull();
    expect(result.fields).toEqual([{ source: "email", target: "email_address" }]);
  });

  it("still reports rows missing a source or a target", () => {
    expect(rowsToFields([row("", "email_address")]).error).toBe(
      "Row 1: both source and target are required.",
    );
    expect(rowsToFields([row("email", "")]).error).toBe(
      "Row 1: both source and target are required.",
    );
  });

  it("trims values and keeps the required flag", () => {
    const result = rowsToFields([row("  name.first ", "  FirstName", true)]);
    expect(result.error).toBeNull();
    expect(result.fields).toEqual([
      { source: "name.first", target: "FirstName", required: true },
    ]);
  });

  it("refuses the same source twice in one version", () => {
    const result = rowsToFields([
      row("email", "Email"),
      row("name.first", "FirstName"),
      row("email", "email_address"),
    ]);
    expect(result.fields).toEqual([]);
    expect(result.error).toBe('Row 3: source field "email" is already used in row 1.');
  });

  it("counts rows by position, matching the row numbers shown in the editor", () => {
    const result = rowsToFields([row("phone", "MobilePhone"), row("phone", "Phone")]);
    expect(result.error).toBe('Row 2: source field "phone" is already used in row 1.');
  });
});

describe("fieldsToRows", () => {
  it("round-trips an existing mapping such as email → email_address", () => {
    const fields = [{ source: "email", target: "email_address" }];
    expect(fieldsToRows(fields)).toEqual([{ source: "email", target: "email_address", required: false }]);
    expect(rowsToFields(fieldsToRows(fields)).fields).toEqual(fields);
  });

  it("keeps legacy source values verbatim (never rewrites them)", () => {
    const legacy = [
      { source: "Name", target: "FirstName" },
      { source: "Source account", target: "LeadSource" },
    ];
    expect(fieldsToRows(legacy)).toEqual([
      { source: "Name", target: "FirstName", required: false },
      { source: "Source account", target: "LeadSource", required: false },
    ]);
    expect(rowsToFields(fieldsToRows(legacy)).error).toBeNull();
  });

  it("starts an empty editor with one blank row", () => {
    expect(fieldsToRows(undefined)).toEqual([emptyRow()]);
    expect(fieldsToRows([])).toEqual([emptyRow()]);
  });
});
