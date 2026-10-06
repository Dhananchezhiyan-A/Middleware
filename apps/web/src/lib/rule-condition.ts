/**
 * Helpers for reading condition payloads.
 *
 * `RoutingRule.conditions` and `ScoringRuleSet.rules` are stored as JSON in
 * PostgreSQL, so the API types them as loose JSON. These helpers normalize the
 * value defensively — bad data is dropped instead of crashing a view.
 */

import { RuleOperators, type RuleOperator } from "@middleware/types";
import { EMPTY } from "@/lib/format";
import type { RuleCondition, ScoringRule } from "@/lib/types";

const OPERATOR_SET = new Set<string>(RuleOperators);

/** Operators that never carry a value. */
export function operatorNeedsValue(operator: string): boolean {
  return operator !== "EXISTS" && operator !== "NOT_EXISTS";
}

/** Operators whose value is a comma-separated list on the wire. */
export function operatorTakesList(operator: string): boolean {
  return operator === "IN" || operator === "NOT_IN";
}

export function isRuleOperator(value: unknown): value is RuleOperator {
  return typeof value === "string" && OPERATOR_SET.has(value);
}

/** `unknown` (JSON column) → a renderable condition list. */
export function normalizeConditions(value: unknown): RuleCondition[] {
  if (!Array.isArray(value)) return [];
  const out: RuleCondition[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.field !== "string" || !isRuleOperator(row.operator)) continue;
    out.push({
      field: row.field,
      operator: row.operator,
      ...("value" in row ? { value: row.value as RuleCondition["value"] } : {}),
    });
  }
  return out;
}

/** Human-readable rendering of a single condition, e.g. `canonical.city EQ Berlin`. */
export function conditionLabel(condition: RuleCondition): string {
  if (!operatorNeedsValue(condition.operator)) return `${condition.field} ${condition.operator}`;
  const raw = condition.value;
  const rendered = Array.isArray(raw)
    ? raw.join(", ")
    : raw === undefined || raw === null || raw === ""
      ? EMPTY
      : String(raw);
  return `${condition.field} ${condition.operator} ${rendered}`;
}

/** `unknown` (JSON column) → a renderable scoring rule list. */
export function normalizeScoringRules(value: unknown): ScoringRule[] {
  if (!Array.isArray(value)) return [];
  const out: ScoringRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const condition = row.condition as Record<string, unknown> | undefined;
    if (typeof row.label !== "string") continue;
    if (!condition || typeof condition.field !== "string" || !isRuleOperator(condition.operator)) {
      continue;
    }
    out.push({
      id: typeof row.id === "string" ? row.id : "",
      label: row.label,
      points: typeof row.points === "number" ? row.points : 0,
      condition: {
        field: condition.field,
        operator: condition.operator,
        ...("value" in condition ? { value: condition.value as RuleCondition["value"] } : {}),
      },
    });
  }
  return out;
}
