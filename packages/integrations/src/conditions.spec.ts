import { describe, expect, it } from "vitest";
import {
  combineClauses,
  evaluateCondition,
  evaluateDateCondition,
  evaluateRouting,
  evaluateRuleClauses,
  evaluateTimeCondition,
  isInternalMiddlewareFallback,
  parseRuleConditions,
  resolveConditionField,
  type ConditionContext,
  type RoutingRuleInput,
} from "./conditions";

/**
 * The routing condition engine is shared by the worker pipeline and the
 * preview endpoint — these specs lock the behaviour both sides rely on:
 * the two stored `conditions` shapes, the typed operators, the
 * timezone-aware date/time/month/day clauses and the INTERNAL_MIDDLEWARE
 * fallback (a lead with no valid external destination simply stays in
 * Middleware — there is no destination record for it).
 */

const CTX: ConditionContext = {
  canonical: {
    email: "Lead@Example.com",
    city: "Pune",
    budget: 75,
    name: { first: "Ada" },
    custom: { tier: "gold" },
  },
  score: 82,
  source: { id: "src_1", name: "Website", type: "WEBHOOK", accountId: "acc_1" },
  // 18:30 UTC on a Saturday = 00:00 Sunday in Asia/Kolkata (UTC+05:30).
  receivedAt: new Date("2024-06-15T18:30:00.000Z"),
};

function rule(overrides: Partial<RoutingRuleInput>): RoutingRuleInput {
  return {
    id: "rule_1",
    name: "Rule",
    priority: 1,
    enabled: true,
    stopOnMatch: false,
    conditions: [],
    destinations: [],
    ...overrides,
  };
}

describe("resolveConditionField", () => {
  it("reads canonical, score, source and custom paths", () => {
    expect(resolveConditionField("canonical.city", CTX)).toBe("Pune");
    expect(resolveConditionField("city", CTX)).toBe("Pune");
    expect(resolveConditionField("canonical.name.first", CTX)).toBe("Ada");
    expect(resolveConditionField("score", CTX)).toBe(82);
    expect(resolveConditionField("source.type", CTX)).toBe("WEBHOOK");
    expect(resolveConditionField("custom.tier", CTX)).toBe("gold");
    expect(resolveConditionField("canonical.missing", CTX)).toBeUndefined();
  });
});

describe("evaluateCondition (typed operators)", () => {
  it("compares text case-insensitively", () => {
    expect(
      evaluateCondition({ field: "canonical.email", operator: "EQ", value: "lead@example.com" }, CTX),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "canonical.city", operator: "CONTAINS", value: "pun" }, CTX),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "canonical.city", operator: "NOT_CONTAINS", value: "mum" }, CTX),
    ).toBe(true);
  });

  it("compares numbers numerically, not lexicographically", () => {
    expect(evaluateCondition({ field: "score", operator: "GT", value: "10" }, CTX)).toBe(true);
    expect(evaluateCondition({ field: "canonical.budget", operator: "LTE", value: "75" }, CTX)).toBe(
      true,
    );
    // "82" > "10" lexicographically is also true, but "9" > "10" is not.
    expect(evaluateCondition({ field: "canonical.budget", operator: "LT", value: "10" }, CTX)).toBe(
      false,
    );
  });

  it("supports IN/NOT_IN lists and BETWEEN pairs", () => {
    expect(
      evaluateCondition(
        { field: "canonical.city", operator: "IN", value: ["Pune", "Mumbai"] },
        CTX,
      ),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "canonical.budget", operator: "BETWEEN", value: ["50", "100"] }, CTX),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "canonical.budget", operator: "BETWEEN", value: ["10", "20"] }, CTX),
    ).toBe(false);
  });

  it("handles EXISTS / NOT_EXISTS on empty values", () => {
    expect(evaluateCondition({ field: "canonical.city", operator: "EXISTS" }, CTX)).toBe(true);
    expect(evaluateCondition({ field: "canonical.nope", operator: "EXISTS" }, CTX)).toBe(false);
    expect(evaluateCondition({ field: "canonical.nope", operator: "NOT_EXISTS" }, CTX)).toBe(true);
  });
});

describe("parseRuleConditions", () => {
  it("keeps legacy flat-array conditions working as an ALL rule", () => {
    const parsed = parseRuleConditions([
      { field: "canonical.city", operator: "EQ", value: "Pune" },
      { field: "score", operator: "GT", value: "50" },
      { bogus: true },
    ]);
    expect(parsed.match).toBe("ALL");
    expect(parsed.conditions).toHaveLength(2);
    expect(parsed.sourceId).toBeUndefined();
    expect(parsed.months).toBeUndefined();
  });

  it("parses the structured shape and drops invalid values", () => {
    const parsed = parseRuleConditions({
      match: "ANY",
      sourceId: "src_1",
      sourceAccountId: "acc_1",
      date: { preset: "between", from: "2024-01-01", to: "2024-12-31" },
      time: { from: "09:00", to: "18:00" },
      months: [1, 6, 99],
      days: [1, 7, 0],
      conditions: [{ field: "canonical.city", operator: "EQ", value: "Pune" }],
      anyGroups: [[{ field: "score", operator: "GT", value: "50" }]],
    });

    expect(parsed.match).toBe("ANY");
    expect(parsed.sourceId).toBe("src_1");
    expect(parsed.date).toEqual({ preset: "between", from: "2024-01-01", to: "2024-12-31" });
    expect(parsed.time).toEqual({ from: "09:00", to: "18:00" });
    expect(parsed.months).toEqual([1, 6]);
    expect(parsed.days).toEqual([1, 7]);
    expect(parsed.anyGroups).toHaveLength(1);
  });

  it("treats a date preset without its bounds as absent", () => {
    expect(parseRuleConditions({ date: { preset: "between" } }).date).toBeUndefined();
    expect(parseRuleConditions({ time: { from: "09:00" } }).time).toBeUndefined();
    expect(parseRuleConditions(null).match).toBe("ALL");
  });
});

describe("evaluateRuleClauses / combineClauses", () => {
  it("emits one clause per constraint with its own result", () => {
    const parsed = parseRuleConditions({
      sourceId: "src_1",
      date: { preset: "between", from: "2024-01-01", to: "2024-12-31" },
      time: { from: "18:00", to: "19:00" },
      months: [6],
      days: [6],
      conditions: [{ field: "canonical.city", operator: "EQ", value: "Pune" }],
    });
    const clauses = evaluateRuleClauses(parsed, CTX);
    expect(clauses.map((clause) => clause.key)).toEqual([
      "source",
      "date",
      "time",
      "month",
      "day",
      "condition:0",
    ]);
    expect(clauses.every((clause) => clause.matched)).toBe(true);
  });

  it("combines clauses with ALL (AND) or ANY (OR)", () => {
    const clauses = [
      { key: "a", label: "a", matched: true },
      { key: "b", label: "b", matched: false },
    ];
    expect(combineClauses(clauses, "ALL")).toBe(false);
    expect(combineClauses(clauses, "ANY")).toBe(true);
  });

  it("an OR group is a single clause", () => {
    const parsed = parseRuleConditions({
      match: "ALL",
      conditions: [{ field: "canonical.city", operator: "EQ", value: "Pune" }],
      anyGroups: [
        [
          { field: "score", operator: "GT", value: "90" },
          { field: "canonical.budget", operator: "GT", value: "50" },
        ],
      ],
    });
    const clauses = evaluateRuleClauses(parsed, CTX);
    const group = clauses.find((clause) => clause.key === "group:0");
    expect(group).toBeDefined();
    expect(group?.matched).toBe(true); // budget 75 > 50 satisfies the group
    expect(combineClauses(clauses, "ALL")).toBe(true);
  });
});

describe("date / time / month / day use the application timezone", () => {
  it("evaluates explicit before/after/between bounds", () => {
    const at = new Date("2024-06-15T12:00:00.000Z");
    expect(evaluateDateCondition({ preset: "before", from: "2099-01-01" }, at, "UTC")).toBe(true);
    expect(evaluateDateCondition({ preset: "before", from: "2000-01-01" }, at, "UTC")).toBe(false);
    expect(evaluateDateCondition({ preset: "after", to: "2000-01-01" }, at, "UTC")).toBe(true);
    expect(
      evaluateDateCondition(
        { preset: "between", from: "2024-01-01", to: "2024-12-31" },
        at,
        "UTC",
      ),
    ).toBe(true);
    expect(
      evaluateDateCondition({ preset: "between", from: "2025-01-01", to: "2025-12-31" }, at, "UTC"),
    ).toBe(false);
  });

  it("answers relative presets from the lead's own receive time", () => {
    const at = new Date();
    const twoDaysAgo = new Date(at.getTime() - 2 * 86_400_000);
    expect(evaluateDateCondition({ preset: "today" }, at, "Asia/Kolkata")).toBe(true);
    expect(evaluateDateCondition({ preset: "today" }, at, "UTC")).toBe(true);
    expect(evaluateDateCondition({ preset: "today" }, twoDaysAgo, "Asia/Kolkata")).toBe(false);
    expect(evaluateDateCondition({ preset: "yesterday" }, twoDaysAgo, "UTC")).toBe(false);
    expect(evaluateDateCondition({ preset: "last_7_days" }, twoDaysAgo, "UTC")).toBe(true);
  });

  it("evaluates the time window in the given timezone", () => {
    const at = CTX.receivedAt as Date; // 18:30Z == 00:30 IST
    expect(evaluateTimeCondition({ from: "00:00", to: "01:00" }, at, "Asia/Kolkata")).toBe(true);
    expect(evaluateTimeCondition({ from: "00:00", to: "01:00" }, at, "UTC")).toBe(false);
    // wrap past midnight: 22:00 → 06:00 — 00:30 IST is inside, 18:30 UTC is not
    expect(evaluateTimeCondition({ from: "22:00", to: "06:00" }, at, "Asia/Kolkata")).toBe(true);
    expect(evaluateTimeCondition({ from: "22:00", to: "06:00" }, at, "UTC")).toBe(false);
  });

  it("month and day follow the timezone too (Sat UTC / Sun IST)", () => {
    const clausesFor = (tz: string) =>
      evaluateRuleClauses(
        parseRuleConditions({ months: [6], days: [7] }),
        { ...CTX, timezone: tz },
      );
    expect(clausesFor("Asia/Kolkata").every((clause) => clause.matched)).toBe(true);
    expect(clausesFor("UTC").find((clause) => clause.key === "day")?.matched).toBe(false);
  });
});

describe("evaluateRouting", () => {
  it("collects one delivery per unique destination across matching rules", () => {
    const evaluation = evaluateRouting(
      [
        rule({
          id: "r1",
          priority: 1,
          conditions: [{ field: "score", operator: "GT", value: "50" }],
          destinations: [{ id: "d1", name: "CRM" }, { id: "d2", name: "Slack" }],
        }),
        rule({
          id: "r2",
          priority: 2,
          conditions: [{ field: "score", operator: "GT", value: "50" }],
          destinations: [{ id: "d2", name: "Slack" }, { id: "d3", name: "Mail" }],
        }),
      ],
      CTX,
    );

    expect(evaluation.matchedRuleIds).toEqual(["r1", "r2"]);
    expect(evaluation.destinationIds).toEqual(["d1", "d2", "d3"]);
    expect(evaluation.usedFallback).toBe(false);
    expect(evaluation.reason).toContain("matched rules: Rule (r1), Rule (r2)");
  });

  it("skips lower-priority rules when stop-after-first matched", () => {
    const evaluation = evaluateRouting(
      [
        rule({ id: "r1", stopOnMatch: true, destinations: [{ id: "d1", name: "CRM" }] }),
        rule({ id: "r2", destinations: [{ id: "d2", name: "Slack" }] }),
      ],
      CTX,
    );
    expect(evaluation.matchedRuleIds).toEqual(["r1"]);
    expect(evaluation.destinationIds).toEqual(["d1"]);
    expect(evaluation.evaluated[1]?.skipped).toBe(true);
  });

  it("keeps evaluating when the first match is match-all mode", () => {
    const evaluation = evaluateRouting(
      [rule({ id: "r1", destinations: [{ id: "d1", name: "CRM" }] }), rule({ id: "r2" })],
      CTX,
    );
    expect(evaluation.matchedRuleIds).toEqual(["r1", "r2"]);
    expect(evaluation.evaluated[1]?.skipped).toBe(false);
  });

  it("ignores disabled rules and inactive destinations", () => {
    const evaluation = evaluateRouting(
      [
        rule({
          id: "r1",
          enabled: false,
          destinations: [{ id: "d1", name: "CRM" }],
        }),
        rule({
          id: "r2",
          destinations: [
            { id: "d2", name: "Slack", status: "ACTIVE" },
            { id: "d3", name: "Paused", status: "PAUSED" },
          ],
        }),
      ],
      CTX,
    );
    expect(evaluation.matchedRuleIds).toEqual(["r2"]);
    expect(evaluation.destinationIds).toEqual(["d2"]);
    expect(evaluation.evaluated[0]?.skipped).toBe(true);
  });

  it("CASE 1 — no rule matched: INTERNAL_MIDDLEWARE, no external destination", () => {
    const evaluation = evaluateRouting(
      [rule({ conditions: [{ field: "score", operator: "GT", value: "99" }] })],
      CTX,
    );
    expect(evaluation.matchedRuleIds).toEqual([]);
    // Nothing to deliver: the lead simply stays where it already is.
    expect(evaluation.destinationIds).toEqual([]);
    expect(evaluation.usedFallback).toBe(true);
    expect(evaluation.fallback).toEqual({
      type: "INTERNAL_MIDDLEWARE",
      reason: evaluation.reason,
    });
    expect(evaluation.fallbackReason).toBe(evaluation.reason);
    expect(evaluation.reason).toMatch(/no rule matched/i);
    expect(evaluation.reason).toContain("[INTERNAL_MIDDLEWARE]");
    expect(isInternalMiddlewareFallback(evaluation.reason)).toBe(true);
  });

  it("CASE 5/7 — rule matched but every destination is invalid → INTERNAL_MIDDLEWARE", () => {
    const evaluation = evaluateRouting(
      [
        rule({
          destinations: [
            { id: "d_off_1", name: "Salesforce", status: "DISABLED" },
            { id: "d_off_2", name: "DCT CRM", status: "DISABLED" },
          ],
        }),
      ],
      CTX,
    );
    // The rule DID match — that is recorded honestly…
    expect(evaluation.matchedRuleIds).toEqual(["rule_1"]);
    expect(evaluation.matchedWithoutValidDestination).toBe(true);
    // …but no external destination is available, so nothing can be delivered.
    expect(evaluation.destinationIds).toEqual([]);
    expect(evaluation.usedFallback).toBe(true);
    expect(evaluation.fallback?.type).toBe("INTERNAL_MIDDLEWARE");
    expect(evaluation.reason).toMatch(/no valid external destination/i);
    expect(evaluation.reason).toContain("[INTERNAL_MIDDLEWARE]");
    // The unavailable destinations are surfaced instead of silently dropped.
    expect(evaluation.unavailableDestinationNames).toEqual(["Salesforce", "DCT CRM"]);
  });

  it("CASE 4/6 — a disabled destination never swallows the lead (stop-after-first)", () => {
    const evaluation = evaluateRouting(
      [
        rule({
          id: "r1",
          priority: 1,
          stopOnMatch: true,
          destinations: [{ id: "d_off", name: "Salesforce", status: "DISABLED" }],
        }),
        rule({
          id: "r2",
          priority: 2,
          destinations: [{ id: "d_on", name: "DCT CRM", status: "ACTIVE" }],
        }),
      ],
      CTX,
    );
    // INVALID DESTINATION != SUCCESSFUL ROUTING: evaluation continues.
    expect(evaluation.evaluated[1]?.skipped).toBe(false);
    expect(evaluation.matchedRuleIds).toEqual(["r1", "r2"]);
    expect(evaluation.destinationIds).toEqual(["d_on"]);
    expect(evaluation.fallback).toBeNull();
    expect(evaluation.reason).toBe("matched rules: Rule (r1), Rule (r2)");
  });

  it("CASE 9 — match-all mode with an invalid destination still delivers", () => {
    const evaluation = evaluateRouting(
      [
        rule({
          id: "r1",
          priority: 1,
          stopOnMatch: false,
          destinations: [{ id: "d_off", name: "Salesforce", status: "DISABLED" }],
        }),
        rule({
          id: "r2",
          priority: 2,
          destinations: [{ id: "d_on", name: "DCT CRM", status: "ACTIVE" }],
        }),
      ],
      CTX,
    );
    expect(evaluation.evaluated[1]?.skipped).toBe(false);
    expect(evaluation.destinationIds).toEqual(["d_on"]);
    expect(evaluation.usedFallback).toBe(false);
    expect(evaluation.fallback).toBeNull();
  });

  it("CASE 2/13 — a valid external destination routes for delivery (unchanged)", () => {
    const evaluation = evaluateRouting(
      [rule({ destinations: [{ id: "d1", name: "DCT CRM", status: "ACTIVE" }] })],
      CTX,
    );
    expect(evaluation.destinationIds).toEqual(["d1"]);
    expect(evaluation.fallback).toBeNull();
    expect(evaluation.usedFallback).toBe(false);
    expect(evaluation.matchedWithoutValidDestination).toBe(false);
    expect(evaluation.reason).toBe("matched rules: Rule (rule_1)");
    expect(isInternalMiddlewareFallback(evaluation.reason)).toBe(false);
  });

  it("keeps BOTH stored `conditions` shapes compatible with the internal fallback", () => {
    const conditions = [{ field: "canonical.city", operator: "EQ", value: "Pune" }] as const;
    const legacy = evaluateRouting([rule({ conditions: [...conditions] })], CTX);
    const structured = evaluateRouting(
      [rule({ conditions: { match: "ALL", conditions: [...conditions] } })],
      CTX,
    );

    // Same decision from either shape: matched, nothing deliverable, retained.
    expect(legacy.matchedRuleIds).toEqual(["rule_1"]);
    expect(structured.matchedRuleIds).toEqual(["rule_1"]);
    expect(legacy.destinationIds).toEqual([]);
    expect(structured.destinationIds).toEqual([]);
    expect(legacy.fallback?.type).toBe("INTERNAL_MIDDLEWARE");
    expect(structured.fallback?.type).toBe("INTERNAL_MIDDLEWARE");
  });

  it("honours match: ANY — one matching clause is enough", () => {
    const evaluation = evaluateRouting(
      [
        rule({
          id: "r1",
          conditions: {
            match: "ANY",
            conditions: [
              { field: "score", operator: "GT", value: "99" },
              { field: "canonical.city", operator: "EQ", value: "Pune" },
            ],
          },
          destinations: [{ id: "d1", name: "CRM" }],
        }),
      ],
      CTX,
    );
    expect(evaluation.matchedRuleIds).toEqual(["r1"]);
  });
});
