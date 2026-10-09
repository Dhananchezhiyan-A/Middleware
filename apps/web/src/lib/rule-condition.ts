/**
 * Helpers for reading condition payloads.
 *
 * `RoutingRule.conditions` and `ScoringRuleSet.rules` are stored as JSON in
 * PostgreSQL, so the API types them as loose JSON. These helpers normalize the
 * value defensively — bad data is dropped instead of crashing a view.
 */

import { LEAD_FIELDS, RULE_OPERATOR_GROUPS, RuleOperators, findLeadField, type LeadFieldType, type RuleOperator } from "@middleware/types";
import { EMPTY } from "@/lib/format";
import type { RuleCondition, RoutingRule, ScoringRule } from "@/lib/types";

const OPERATOR_SET = new Set<string>(RuleOperators);

/** Operators that never carry a value. */
export function operatorNeedsValue(operator: string): boolean {
  return operator !== "EXISTS" && operator !== "NOT_EXISTS";
}

/**
 * Operators whose value is a comma-separated list on the wire.
 * BETWEEN needs the same treatment: the engine only accepts a 2-item array.
 */
export function operatorTakesList(operator: string): boolean {
  return operator === "IN" || operator === "NOT_IN" || operator === "BETWEEN";
}

export function isRuleOperator(value: unknown): value is RuleOperator {
  return typeof value === "string" && OPERATOR_SET.has(value);
}

/**
 * Canonical path of a condition field, e.g. `canonical.city` → `city`.
 * Strips the prefixes the worker's condition engine accepts.
 */
function canonicalKey(field: string): string {
  const path = field.trim();
  if (path.startsWith("canonical.")) return path.slice(10);
  if (path.startsWith("lead.")) return path.slice(5);
  return path;
}

/**
 * Field type used to offer ONLY valid operators (type-aware builder).
 * Reuses `LEAD_FIELDS` metadata — no second field definition exists.
 */
export function fieldOperatorGroup(field: string): LeadFieldType {
  const path = field.trim();
  if (path === "score") return "number";
  if (path.startsWith("source.")) return path === "source.type" ? "enum" : "text";
  return findLeadField(canonicalKey(path))?.type ?? "text";
}

/** Operators valid for this field's type, keeping a legacy value selectable. */
export function operatorsForField(field: string, current: string): RuleOperator[] {
  const group = [...RULE_OPERATOR_GROUPS[fieldOperatorGroup(field)]] as RuleOperator[];
  if (current && OPERATOR_SET.has(current) && !group.includes(current as RuleOperator)) {
    return [current as RuleOperator, ...group];
  }
  return group;
}

/** Field suggestions for the condition picker — canonical paths + engine roots. */
export const FIELD_SUGGESTIONS: string[] = [
  ...LEAD_FIELDS.map((field) => `canonical.${field.key}`),
  "score",
  "source.type",
  "source.code",
  "source.name",
  "source.accountName",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** `unknown` (JSON column) → a renderable condition list (both stored shapes). */
export function normalizeConditions(value: unknown): RuleCondition[] {
  let items: unknown[] = [];
  if (Array.isArray(value)) {
    items = value;
  } else if (isPlainObject(value)) {
    // Structured shape: top-level conditions + the rows inside every OR group.
    const groups = Array.isArray(value.anyGroups) ? value.anyGroups : [];
    items = [...(Array.isArray(value.conditions) ? value.conditions : []), ...groups.flat()];
  }

  const out: RuleCondition[] = [];
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    if (typeof item.field !== "string" || !isRuleOperator(item.operator)) continue;
    out.push({
      field: item.field,
      operator: item.operator,
      ...("value" in item ? { value: item.value as RuleCondition["value"] } : {}),
    });
  }
  return out;
}

/**
 * Non-lead-field constraints of a rule (source / date / time / month / day)
 * rendered as chips in the rules table and the lead routing panel.
 */
export function constraintLabels(value: unknown): string[] {
  if (!isPlainObject(value)) return [];
  const out: string[] = [];

  if (typeof value.sourceId === "string" && value.sourceId) out.push(`Source: ${value.sourceId}`);
  if (typeof value.sourceAccountId === "string" && value.sourceAccountId) {
    out.push(`Account: ${value.sourceAccountId}`);
  }

  if (isPlainObject(value.date) && typeof value.date.preset === "string") {
    const { preset, from, to } = value.date as { preset: string; from?: string; to?: string };
    out.push(`Date: ${preset}${from ? ` ${from}` : ""}${to ? ` → ${to}` : ""}`);
  }
  if (isPlainObject(value.time) && typeof value.time.from === "string") {
    const { from, to } = value.time as { from: string; to?: string };
    out.push(`Time: ${from}–${to ?? "?"}`);
  }
  if (Array.isArray(value.months) && value.months.length > 0) {
    out.push(`Months: ${value.months.join(", ")}`);
  }
  if (Array.isArray(value.days) && value.days.length > 0) {
    out.push(`Days: ${value.days.join(", ")}`);
  }

  return out;
}

/** Rule-level combination mode ("ALL"/"ANY"); legacy arrays are ALL. */
export function ruleMatchMode(value: unknown): "ALL" | "ANY" {
  return isPlainObject(value) && value.match === "ANY" ? "ANY" : "ALL";
}

/** `sourceId` / `sourceAccountId` stored on a rule (structured shape only). */
export function ruleSourceIds(value: unknown): { sourceId?: string; sourceAccountId?: string } {
  if (!isPlainObject(value)) return {};
  return {
    ...(typeof value.sourceId === "string" && value.sourceId ? { sourceId: value.sourceId } : {}),
    ...(typeof value.sourceAccountId === "string" && value.sourceAccountId
      ? { sourceAccountId: value.sourceAccountId }
      : {}),
  };
}

/** `routingMode` is derived, never stored: stopOnMatch decides it. */
export function routingModeLabel(rule: Pick<RoutingRule, "stopOnMatch">): string {
  return rule.stopOnMatch ? "Stop after first match" : "All matching rules";
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
