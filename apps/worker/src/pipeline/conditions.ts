import type { RuleOperator } from "@middleware/types";

/**
 * Rule evaluation engine shared by the SCORING and ROUTING stages.
 *
 * Conditions are DATA (RoutingRule.conditions, ScoringRuleSet.rules), never
 * hardcoded logic. All operators are implemented here so a scoring rule and
 * a routing rule with the same condition always behave identically.
 */

export interface RuleCondition {
  field: string;
  operator: RuleOperator;
  value?: string | number | boolean | Array<string | number>;
}

export interface ConditionContext {
  /** Canonical lead (the source-independent representation). */
  canonical: Record<string, unknown>;
  /** Computed score, when evaluating post-scoring routing rules. */
  score?: number | null;
  /** Source metadata, e.g. { type: "WEBHOOK", code: "meta-ads" }. */
  source?: Record<string, unknown>;
}

/** Resolves a dotted field path against the condition context. */
export function resolveConditionField(path: string, ctx: ConditionContext): unknown {
  const p = path.trim();
  if (p === "score") return ctx.score ?? undefined;

  let base: Record<string, unknown> | undefined;
  let rest = p;
  if (p.startsWith("canonical.")) {
    base = ctx.canonical;
    rest = p.slice(10);
  } else if (p.startsWith("lead.")) {
    base = ctx.canonical;
    rest = p.slice(5);
  } else if (p.startsWith("source.")) {
    base = ctx.source;
    rest = p.slice(7);
  } else if (p.startsWith("custom.")) {
    base = ctx.canonical.custom as Record<string, unknown> | undefined;
    rest = p.slice(7);
  } else {
    base = ctx.canonical;
  }

  const segments = rest.split(".");
  let current: unknown = base;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

function asComparableString(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function numeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function compareOrder(a: unknown, b: unknown): number | null {
  const na = numeric(a);
  const nb = numeric(b);
  if (na !== null && nb !== null) return na === nb ? 0 : na < nb ? -1 : 1;
  const sa = asComparableString(a).toLowerCase();
  const sb = asComparableString(b).toLowerCase();
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

/** Evaluates a single condition. Unknown fields count as "not exists". */
export function evaluateCondition(cond: RuleCondition, ctx: ConditionContext): boolean {
  const actual = resolveConditionField(cond.field, ctx);
  const expected = cond.value;

  switch (cond.operator) {
    case "EXISTS":
      return !isEmpty(actual);
    case "NOT_EXISTS":
      return isEmpty(actual);
    case "EQ": {
      if (isEmpty(actual) && isEmpty(expected)) return true;
      if (isEmpty(actual) || isEmpty(expected)) return false;
      const na = numeric(actual);
      const nb = numeric(expected);
      if (na !== null && nb !== null) return na === nb;
      return asComparableString(actual).toLowerCase() === asComparableString(expected).toLowerCase();
    }
    case "NEQ":
      return !evaluateCondition({ ...cond, operator: "EQ" }, ctx);
    case "CONTAINS":
      return (
        !isEmpty(actual) &&
        !isEmpty(expected) &&
        asComparableString(actual).toLowerCase().includes(asComparableString(expected).toLowerCase())
      );
    case "NOT_CONTAINS":
      return !evaluateCondition({ ...cond, operator: "CONTAINS" }, ctx);
    case "STARTS_WITH":
      return (
        !isEmpty(actual) &&
        !isEmpty(expected) &&
        asComparableString(actual).toLowerCase().startsWith(asComparableString(expected).toLowerCase())
      );
    case "ENDS_WITH":
      return (
        !isEmpty(actual) &&
        !isEmpty(expected) &&
        asComparableString(actual).toLowerCase().endsWith(asComparableString(expected).toLowerCase())
      );
    case "GT": {
      const c = compareOrder(actual, expected);
      return c !== null && c > 0;
    }
    case "GTE": {
      const c = compareOrder(actual, expected);
      return c !== null && c >= 0;
    }
    case "LT": {
      const c = compareOrder(actual, expected);
      return c !== null && c < 0;
    }
    case "LTE": {
      const c = compareOrder(actual, expected);
      return c !== null && c <= 0;
    }
    case "IN": {
      if (!Array.isArray(expected) || expected.length === 0) return false;
      if (isEmpty(actual)) return false;
      const needle = asComparableString(actual).toLowerCase();
      return expected.some((v) => asComparableString(v).toLowerCase() === needle);
    }
    case "NOT_IN":
      return !evaluateCondition({ ...cond, operator: "IN" }, ctx);
    default: {
      const never: never = cond.operator;
      void never;
      return false;
    }
  }
}

/** All conditions must hold (logical AND). An empty list matches everything. */
export function evaluateConditions(conditions: RuleCondition[], ctx: ConditionContext): boolean {
  return conditions.every((c) => evaluateCondition(c, ctx));
}

/** Parses raw JSON conditions defensively — bad data never crashes a pipeline. */
export function parseConditions(raw: unknown): RuleCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: RuleCondition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.field !== "string" || typeof obj.operator !== "string") continue;
    out.push({
      field: obj.field,
      operator: obj.operator as RuleOperator,
      ...(obj.value !== undefined
        ? { value: obj.value as RuleCondition["value"] }
        : {}),
    });
  }
  return out;
}
