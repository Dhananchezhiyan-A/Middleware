import { describe, expect, it } from "vitest";
import {
  evaluateCondition,
  evaluateConditions,
  parseConditions,
  resolveConditionField,
  type ConditionContext,
} from "./conditions";

const ctx: ConditionContext = {
  canonical: {
    email: "Lead@Example.com",
    phone: "+919876543210",
    company: "Acme Builders",
    budget: 5_000_000,
    location: { city: "Chennai", state: "Tamil Nadu" },
    custom: { budget_range: "50L-75L", qualified: true },
  },
  score: 80,
  source: { type: "WEBHOOK", code: "meta-ads" },
};

describe("resolveConditionField", () => {
  it("resolves canonical, custom, source and score paths", () => {
    expect(resolveConditionField("canonical.location.city", ctx)).toBe("Chennai");
    expect(resolveConditionField("location.city", ctx)).toBe("Chennai");
    expect(resolveConditionField("custom.budget_range", ctx)).toBe("50L-75L");
    expect(resolveConditionField("source.type", ctx)).toBe("WEBHOOK");
    expect(resolveConditionField("score", ctx)).toBe(80);
    expect(resolveConditionField("canonical.nothere.deep", ctx)).toBeUndefined();
  });
});

describe("evaluateCondition operators", () => {
  it("EQ/NEQ compare strings case-insensitively and numbers numerically", () => {
    expect(evaluateCondition({ field: "location.state", operator: "EQ", value: "tamil nadu" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "budget", operator: "EQ", value: "5000000" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "location.city", operator: "NEQ", value: "Chennai" }, ctx)).toBe(false);
  });

  it("CONTAINS / STARTS_WITH / ENDS_WITH work case-insensitively", () => {
    expect(evaluateCondition({ field: "company", operator: "CONTAINS", value: "acme" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "email", operator: "STARTS_WITH", value: "lead@" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "email", operator: "ENDS_WITH", value: ".com" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "company", operator: "NOT_CONTAINS", value: "acme" }, ctx)).toBe(false);
  });

  it("GT/GTE/LT/LTE handle numeric comparisons", () => {
    expect(evaluateCondition({ field: "budget", operator: "GT", value: 1_000_000 }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "budget", operator: "GTE", value: 5_000_000 }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "budget", operator: "LT", value: 1_000_000 }, ctx)).toBe(false);
    expect(evaluateCondition({ field: "score", operator: "LTE", value: 80 }, ctx)).toBe(true);
  });

  it("IN / NOT_IN match against arrays", () => {
    expect(evaluateCondition({ field: "location.city", operator: "IN", value: ["Chennai", "Coimbatore"] }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "location.city", operator: "NOT_IN", value: ["Chennai"] }, ctx)).toBe(false);
    expect(evaluateCondition({ field: "location.city", operator: "IN", value: [] }, ctx)).toBe(false);
  });

  it("EXISTS / NOT_EXISTS respect empty values", () => {
    expect(evaluateCondition({ field: "company", operator: "EXISTS" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "jobTitle", operator: "NOT_EXISTS" }, ctx)).toBe(true);
    expect(evaluateCondition({ field: "missing.field", operator: "NOT_EXISTS" }, ctx)).toBe(true);
  });
});

describe("evaluateConditions (AND semantics)", () => {
  it("requires every condition to match", () => {
    expect(
      evaluateConditions(
        [
          { field: "location.city", operator: "EQ", value: "Chennai" },
          { field: "budget", operator: "GT", value: 1_000_000 },
        ],
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [
          { field: "location.city", operator: "EQ", value: "Chennai" },
          { field: "budget", operator: "LT", value: 1_000_000 },
        ],
        ctx,
      ),
    ).toBe(false);
  });

  it("an empty condition list matches everything", () => {
    expect(evaluateConditions([], ctx)).toBe(true);
  });
});

describe("parseConditions", () => {
  it("drops malformed entries instead of throwing", () => {
    const parsed = parseConditions([
      { field: "score", operator: "GT", value: 50 },
      { field: 42, operator: "EQ" },
      "garbage",
      null,
      { operator: "EQ" },
    ]);
    expect(parsed).toEqual([{ field: "score", operator: "GT", value: 50 }]);
  });

  it("returns an empty list for non-arrays", () => {
    expect(parseConditions("nope")).toEqual([]);
    expect(parseConditions(null)).toEqual([]);
  });
});
