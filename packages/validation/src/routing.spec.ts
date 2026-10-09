import { describe, expect, it } from "vitest";
import {
  routingConditionsSchema,
  routingPreviewSchema,
  routingRuleUpsertSchema,
} from "./index";

/**
 * Routing validation contracts.
 *
 * Two `conditions` shapes must keep working — the legacy flat array (written
 * before source/date/time/month/day existed) and the structured object — and
 * neither may ever require a schema migration to store.
 */

const DESTINATION_ID = "cmuxrvwfh000550oj6b8hyw55";

const structured = {
  match: "ANY",
  sourceId: "cmuxskd9u000p50ojog8uitjz",
  sourceAccountId: "cmuxskd9u000r50ojog8uitjz",
  date: { preset: "between", from: "2026-01-01", to: "2026-12-31" },
  time: { from: "09:00", to: "18:00" },
  months: [1, 6, 12],
  days: [1, 5, 7],
  conditions: [{ field: "canonical.city", operator: "EQ", value: "Pune" }],
  anyGroups: [[{ field: "score", operator: "GT", value: "70" }]],
};

describe("routingConditionsSchema", () => {
  it("accepts the full structured shape", () => {
    const parsed = routingConditionsSchema.parse(structured);
    expect(parsed.match).toBe("ANY");
    expect(parsed.months).toEqual([1, 6, 12]);
    expect(parsed.anyGroups).toHaveLength(1);
  });

  it("defaults match to ALL when omitted", () => {
    const parsed = routingConditionsSchema.parse({
      conditions: [{ field: "score", operator: "GT", value: "50" }],
    });
    expect(parsed.match).toBe("ALL");
  });

  it("accepts a rule constrained only by source", () => {
    expect(routingConditionsSchema.safeParse({ sourceId: structured.sourceId }).success).toBe(true);
  });

  it("accepts a rule constrained only by an OR group", () => {
    expect(
      routingConditionsSchema.safeParse({ anyGroups: [structured.anyGroups[0]] }).success,
    ).toBe(true);
  });

  it("rejects an empty rule — at least one condition is required", () => {
    const result = routingConditionsSchema.safeParse({ conditions: [] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("at least one condition");
  });

  it("rejects out-of-range months and days", () => {
    expect(routingConditionsSchema.safeParse({ months: [13] }).success).toBe(false);
    expect(routingConditionsSchema.safeParse({ days: [0] }).success).toBe(false);
    expect(routingConditionsSchema.safeParse({ months: [1, 12], days: [1, 7] }).success).toBe(true);
  });

  it("rejects malformed time and date values", () => {
    expect(
      routingConditionsSchema.safeParse({ time: { from: "9am", to: "18:00" } }).success,
    ).toBe(false);
    expect(
      routingConditionsSchema.safeParse({
        date: { preset: "between", from: "01/01/2026" },
      }).success,
    ).toBe(false);
    expect(
      routingConditionsSchema.safeParse({ date: { preset: "last_7_days" } }).success,
    ).toBe(true);
  });

  it("rejects an unknown date preset", () => {
    expect(
      routingConditionsSchema.safeParse({ date: { preset: "someday" } }).success,
    ).toBe(false);
  });
});

describe("routingRuleUpsertSchema", () => {
  const base = { name: "High budget", destinationIds: [DESTINATION_ID] };

  it("keeps legacy flat-array conditions valid (no migration needed)", () => {
    const parsed = routingRuleUpsertSchema.parse({
      ...base,
      conditions: [{ field: "score", operator: "GT", value: "70" }],
    });
    expect(parsed.conditions).toEqual([{ field: "score", operator: "GT", value: "70" }]);
    expect(parsed.enabled).toBe(true);
    expect(parsed.priority).toBe(100);
    // Match-all is the default mode (PART 14).
    expect(parsed.stopOnMatch).toBe(false);
  });

  it("accepts the structured shape", () => {
    const parsed = routingRuleUpsertSchema.parse({ ...base, conditions: structured });
    expect(parsed.conditions).toMatchObject({ match: "ANY", months: [1, 6, 12] });
  });

  it("requires a name and at least one destination", () => {
    expect(routingRuleUpsertSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(
      routingRuleUpsertSchema.safeParse({
        ...base,
        conditions: structured,
        destinationIds: [],
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown operator", () => {
    expect(
      routingRuleUpsertSchema.safeParse({
        ...base,
        conditions: [{ field: "score", operator: "LIKE", value: "x" }],
      }).success,
    ).toBe(false);
  });

  it("rejects conditions with no constraint at all", () => {
    expect(routingRuleUpsertSchema.safeParse({ ...base, conditions: [] }).success).toBe(false);
    expect(
      routingRuleUpsertSchema.safeParse({ ...base, conditions: { conditions: [] } }).success,
    ).toBe(false);
  });
});

describe("routingPreviewSchema", () => {
  it("accepts a bare dry-run (all stored rules)", () => {
    expect(routingPreviewSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a rule subset plus a sample lead", () => {
    const parsed = routingPreviewSchema.parse({
      ruleIds: ["cmuxskd9u000q50ojog8uitjz"],
      sourceId: structured.sourceId,
      receivedAt: "2026-10-07T09:15:00.000Z",
      score: 82,
      canonical: { email: "lead@example.com", city: "Pune" },
    });
    expect(parsed.ruleIds).toHaveLength(1);
    expect(parsed.canonical).toMatchObject({ email: "lead@example.com" });
  });

  it("accepts draft rules so unsaved edits can be tested", () => {
    const parsed = routingPreviewSchema.parse({
      rules: [
        {
          name: "Draft rule",
          priority: 10,
          stopOnMatch: false,
          conditions: structured,
          destinationIds: [DESTINATION_ID],
        },
        {
          conditions: [{ field: "score", operator: "GT", value: "70" }],
          destinationIds: [DESTINATION_ID],
        },
      ],
    });
    expect(parsed.rules).toHaveLength(2);
  });

  it("rejects a draft rule with no destinations", () => {
    expect(
      routingPreviewSchema.safeParse({
        rules: [{ conditions: structured, destinationIds: [] }],
      }).success,
    ).toBe(false);
  });

  it("rejects a non-ISO receivedAt (the preview never uses the browser clock)", () => {
    expect(routingPreviewSchema.safeParse({ receivedAt: "7 Oct 2026" }).success).toBe(false);
  });
});
