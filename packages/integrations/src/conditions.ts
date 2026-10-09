import {
  DAY_NAMES,
  MONTH_NAMES,
  ROUTING_FALLBACK_TYPE,
  type DatePreset,
  type RuleOperator,
  type RoutingFallbackType,
} from "@middleware/types";

/**
 * Condition / routing evaluation engine shared by SCORING, ROUTING and the
 * routing PREVIEW endpoint.
 *
 * Conditions are DATA (RoutingRule.conditions, ScoringRuleSet.rules), never
 * hardcoded logic. Every consumer — worker pipeline, API preview, scoring —
 * calls the functions in this module so a rule always behaves identically
 * wherever it is evaluated.
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
  /** Source metadata: { type, code, id, accountId, name }. */
  source?: Record<string, unknown>;
  /** Lead's SERVER-SIDE receive time (Lead.receivedAt) — never a browser clock. */
  receivedAt?: Date;
  /** IANA timezone used for date/time/month/day evaluation (APP_TIMEZONE). */
  timezone?: string;
}

// ---------------------------------------------------------------------------
// Field resolution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

function asComparableString(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
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

/** Date-like values compare chronologically, everything else lexicographically. */
function temporal(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "string") {
    const s = v.trim();
    // Full ISO or bare date — avoids treating "10" as a date.
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) {
      const t = Date.parse(s);
      return Number.isNaN(t) ? null : t;
    }
  }
  return null;
}

function compareOrder(a: unknown, b: unknown): number | null {
  const ta = temporal(a);
  const tb = temporal(b);
  if (ta !== null && tb !== null) return ta === tb ? 0 : ta < tb ? -1 : 1;
  const na = numeric(a);
  const nb = numeric(b);
  if (na !== null && nb !== null) return na === nb ? 0 : na < nb ? -1 : 1;
  const sa = asComparableString(a).toLowerCase();
  const sb = asComparableString(b).toLowerCase();
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

function pairValue(value: unknown): [unknown, unknown] | null {
  if (Array.isArray(value) && value.length >= 2) return [value[0], value[1]];
  return null;
}

// ---------------------------------------------------------------------------
// Single condition evaluation
// ---------------------------------------------------------------------------

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
    case "BETWEEN": {
      const pair = pairValue(expected);
      if (!pair || isEmpty(actual)) return false;
      const low = compareOrder(actual, pair[0]);
      const high = compareOrder(actual, pair[1]);
      return low !== null && high !== null && low >= 0 && high <= 0;
    }
    case "BEFORE": {
      if (isEmpty(actual) || isEmpty(expected)) return false;
      const c = compareOrder(actual, expected);
      return c !== null && c < 0;
    }
    case "AFTER": {
      if (isEmpty(actual) || isEmpty(expected)) return false;
      const c = compareOrder(actual, expected);
      return c !== null && c > 0;
    }
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

// ---------------------------------------------------------------------------
// Structured routing conditions (source / date / time / month / day / fields)
// ---------------------------------------------------------------------------

export interface DateCondition {
  preset: DatePreset;
  /** YYYY-MM-DD — used by before / after / between. */
  from?: string;
  /** YYYY-MM-DD — used by after / between. */
  to?: string;
}

export interface TimeCondition {
  /** HH:MM (00:00–23:59), application timezone. */
  from: string;
  /** HH:MM — when from > to the window wraps past midnight. */
  to: string;
}

export interface RuleConditions {
  match: "ALL" | "ANY";
  sourceId?: string;
  sourceAccountId?: string;
  date?: DateCondition;
  time?: TimeCondition;
  /** 1..12 (January..December). */
  months?: number[];
  /** 1..7 Monday..Sunday (ISO-8601). */
  days?: number[];
  /** Lead-field conditions. */
  conditions: RuleCondition[];
  /** Nested OR groups: each group is ORed internally, groups join the rest. */
  anyGroups?: RuleCondition[][];
}

const DATE_PRESET_VALUES = new Set<string>([
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "before",
  "after",
  "between",
]);

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseNumberSet(raw: unknown, min: number, max: number): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = [...new Set(raw.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max))];
  out.sort((a, b) => a - b);
  return out.length > 0 ? out : undefined;
}

function parseDateCondition(raw: unknown): DateCondition | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.preset !== "string" || !DATE_PRESET_VALUES.has(o.preset)) return undefined;
  const preset = o.preset as DatePreset;
  const needsRange = preset === "before" || preset === "after" || preset === "between";
  const from = typeof o.from === "string" && DATE_RE.test(o.from) ? o.from : undefined;
  const to = typeof o.to === "string" && DATE_RE.test(o.to) ? o.to : undefined;
  if (needsRange && (from === undefined || (preset !== "before" && to === undefined))) return undefined;
  return { preset, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

function parseTimeCondition(raw: unknown): TimeCondition | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.from !== "string" || typeof o.to !== "string") return undefined;
  if (!TIME_RE.test(o.from) || !TIME_RE.test(o.to)) return undefined;
  return { from: o.from, to: o.to };
}

function parseAnyGroups(raw: unknown): RuleCondition[][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const groups: RuleCondition[][] = [];
  for (const g of raw) {
    const parsed = parseConditions(g);
    if (parsed.length > 0) groups.push(parsed);
  }
  return groups.length > 0 ? groups : undefined;
}

/**
 * Accepts BOTH shapes:
 *  - legacy flat array `[{field, operator, value}]` (existing rows) → ALL
 *  - structured `{ match, sourceId, date, time, months, days, conditions, anyGroups }`
 * so no stored rule needs migrating.
 */
export function parseRuleConditions(raw: unknown): RuleConditions {
  if (Array.isArray(raw)) return { match: "ALL", conditions: parseConditions(raw) };
  if (!raw || typeof raw !== "object") return { match: "ALL", conditions: [] };
  const o = raw as Record<string, unknown>;
  return {
    match: o.match === "ANY" ? "ANY" : "ALL",
    ...(typeof o.sourceId === "string" && o.sourceId ? { sourceId: o.sourceId } : {}),
    ...(typeof o.sourceAccountId === "string" && o.sourceAccountId
      ? { sourceAccountId: o.sourceAccountId }
      : {}),
    ...(parseDateCondition(o.date) ? { date: parseDateCondition(o.date) } : {}),
    ...(parseTimeCondition(o.time) ? { time: parseTimeCondition(o.time) } : {}),
    ...(parseNumberSet(o.months, 1, 12) ? { months: parseNumberSet(o.months, 1, 12) } : {}),
    ...(parseNumberSet(o.days, 1, 7) ? { days: parseNumberSet(o.days, 1, 7) } : {}),
    conditions: parseConditions(o.conditions),
    ...(parseAnyGroups(o.anyGroups) ? { anyGroups: parseAnyGroups(o.anyGroups) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Timezone-aware date/time helpers (application timezone, never the browser)
// ---------------------------------------------------------------------------

const DEFAULT_TIMEZONE = "UTC";
const MS_PER_DAY = 86_400_000;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  isoDay: number; // 1..7 Monday..Sunday
  minutes: number; // 0..1439
}

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Calendar parts of `date` as seen in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "0";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    isoDay: WEEKDAY_TO_ISO[get("weekday")] ?? 1,
    minutes: (Number.isNaN(hour) ? 0 : hour) * 60 + (Number.isNaN(minute) ? 0 : minute),
  };
}

/** Absolute day number for a zoned calendar date (timezone-independent maths). */
function dayIndex(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function zonedDayIndex(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return dayIndex(p.year, p.month, p.day);
}

function parseDayIndex(value: string): number | null {
  if (!DATE_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  return dayIndex(y, m, d);
}

function toMinutes(hhmm: string): number | null {
  const m = TIME_RE.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Evaluates a DATE condition against the lead's receive time in `timeZone`. */
export function evaluateDateCondition(
  condition: DateCondition,
  receivedAt: Date,
  timeZone: string,
): boolean {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const idx = zonedDayIndex(receivedAt, tz);
  const nowIdx = zonedDayIndex(new Date(), tz);

  switch (condition.preset) {
    case "today":
      return idx === nowIdx;
    case "yesterday":
      return idx === nowIdx - 1;
    case "last_7_days":
      return idx >= nowIdx - 6 && idx <= nowIdx;
    case "last_30_days":
      return idx >= nowIdx - 29 && idx <= nowIdx;
    case "this_week": {
      const monday = nowIdx - (zonedParts(new Date(), tz).isoDay - 1);
      return idx >= monday && idx <= nowIdx;
    }
    case "last_week": {
      const monday = nowIdx - (zonedParts(new Date(), tz).isoDay - 1);
      return idx >= monday - 7 && idx <= monday - 1;
    }
    case "this_month":
      return zonedSameMonth(receivedAt, new Date(), tz);
    case "last_month":
      return zonedPreviousMonth(receivedAt, new Date(), tz);
    case "before": {
      const from = condition.from ? parseDayIndex(condition.from) : null;
      return from !== null ? idx < from : false;
    }
    case "after": {
      const to = condition.to ? parseDayIndex(condition.to) : null;
      return to !== null ? idx > to : false;
    }
    case "between": {
      const from = condition.from ? parseDayIndex(condition.from) : null;
      const to = condition.to ? parseDayIndex(condition.to) : null;
      return from !== null && to !== null ? idx >= from && idx <= to : false;
    }
    default:
      return false;
  }
}

function zonedSameMonth(a: Date, b: Date, timeZone: string): boolean {
  const pa = zonedParts(a, timeZone);
  const pb = zonedParts(b, timeZone);
  return pa.year === pb.year && pa.month === pb.month;
}

/** True when `a` falls in the calendar month immediately before `b`'s month. */
function zonedPreviousMonth(a: Date, b: Date, timeZone: string): boolean {
  const pa = zonedParts(a, timeZone);
  const pb = zonedParts(b, timeZone);
  const prevYear = pb.month === 1 ? pb.year - 1 : pb.year;
  const prevMonth = pb.month === 1 ? 12 : pb.month - 1;
  return pa.year === prevYear && pa.month === prevMonth;
}

/** Evaluates a TIME window (HH:MM → HH:MM) in `timeZone`; supports wrap-over-midnight. */
export function evaluateTimeCondition(
  condition: TimeCondition,
  receivedAt: Date,
  timeZone: string,
): boolean {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const minutes = zonedParts(receivedAt, tz).minutes;
  const from = toMinutes(condition.from);
  const to = toMinutes(condition.to);
  if (from === null || to === null) return false;
  if (from <= to) return minutes >= from && minutes <= to;
  return minutes >= from || minutes <= to;
}

// ---------------------------------------------------------------------------
// Rule clauses (per-condition results — powers the preview's checkmarks)
// ---------------------------------------------------------------------------

export interface RuleClause {
  key: string;
  label: string;
  matched: boolean;
}

function describeDateCondition(condition: DateCondition): string {
  switch (condition.preset) {
    case "today":
      return "Date = Today";
    case "yesterday":
      return "Date = Yesterday";
    case "last_7_days":
      return "Date = Last 7 days";
    case "last_30_days":
      return "Date = Last 30 days";
    case "this_week":
      return "Date = This week";
    case "last_week":
      return "Date = Last week";
    case "this_month":
      return "Date = This month";
    case "last_month":
      return "Date = Last month";
    case "before":
      return `Date before ${condition.from ?? "?"}`;
    case "after":
      return `Date after ${condition.to ?? "?"}`;
    case "between":
      return `Date between ${condition.from ?? "?"} and ${condition.to ?? "?"}`;
    default:
      return "Date";
  }
}

function formatCondition(cond: RuleCondition): string {
  const value = Array.isArray(cond.value) ? cond.value.join(", ") : cond.value;
  switch (cond.operator) {
    case "EXISTS":
      return `${cond.field} is not empty`;
    case "NOT_EXISTS":
      return `${cond.field} is empty`;
    case "BETWEEN":
      return `${cond.field} between ${Array.isArray(cond.value) ? cond.value.join(" and ") : cond.value}`;
    case "BEFORE":
      return `${cond.field} before ${value}`;
    case "AFTER":
      return `${cond.field} after ${value}`;
    default:
      return `${cond.field} ${cond.operator} ${value ?? ""}`.trim();
  }
}

/**
 * Evaluates a rule into individual clauses so callers can show exactly which
 * condition matched (preview) or why a rule did not.
 */
export function evaluateRuleClauses(
  rule: RuleConditions,
  ctx: ConditionContext,
): RuleClause[] {
  const clauses: RuleClause[] = [];
  const tz = ctx.timezone ?? DEFAULT_TIMEZONE;
  const receivedAt = ctx.receivedAt ?? new Date();
  const source = ctx.source ?? {};

  if (rule.sourceId) {
    const label = `Source = ${typeof source.name === "string" && source.name ? source.name : rule.sourceId}`;
    clauses.push({ key: "source", label, matched: String(source.id ?? "") === rule.sourceId });
  }
  if (rule.sourceAccountId) {
    const label = `Source account = ${
      typeof source.accountName === "string" && source.accountName
        ? source.accountName
        : rule.sourceAccountId
    }`;
    clauses.push({
      key: "source_account",
      label,
      matched: String(source.accountId ?? "") === rule.sourceAccountId,
    });
  }
  if (rule.date) {
    const label = describeDateCondition(rule.date);
    clauses.push({ key: "date", label, matched: evaluateDateCondition(rule.date, receivedAt, tz) });
  }
  if (rule.time) {
    clauses.push({
      key: "time",
      label: `Time = ${rule.time.from}–${rule.time.to}`,
      matched: evaluateTimeCondition(rule.time, receivedAt, tz),
    });
  }
  if (rule.months && rule.months.length > 0) {
    const names = rule.months.map((m) => MONTH_NAMES[m - 1] ?? String(m)).join(", ");
    const current = zonedParts(receivedAt, tz).month;
    clauses.push({ key: "month", label: `Month = ${names}`, matched: rule.months.includes(current) });
  }
  if (rule.days && rule.days.length > 0) {
    const names = rule.days.map((d) => DAY_NAMES[d - 1] ?? String(d)).join(", ");
    const current = zonedParts(receivedAt, tz).isoDay;
    clauses.push({ key: "day", label: `Day = ${names}`, matched: rule.days.includes(current) });
  }

  rule.conditions.forEach((cond, index) => {
    clauses.push({
      key: `condition:${index}`,
      label: formatCondition(cond),
      matched: evaluateCondition(cond, ctx),
    });
  });

  (rule.anyGroups ?? []).forEach((group, index) => {
    const matched = group.some((cond) => evaluateCondition(cond, ctx));
    clauses.push({
      key: `group:${index}`,
      label: `ANY: ${group.map((c) => formatCondition(c)).join(" OR ")}`,
      matched,
    });
  });

  return clauses;
}

/** Combines clauses with the rule's ALL/ANY mode. No clauses = match everything. */
export function combineClauses(clauses: RuleClause[], match: "ALL" | "ANY"): boolean {
  if (clauses.length === 0) return true;
  return match === "ANY" ? clauses.some((c) => c.matched) : clauses.every((c) => c.matched);
}

/** Parses + evaluates a raw `RoutingRule.conditions` value in one call. */
export function evaluateRuleConditions(rawConditions: unknown, ctx: ConditionContext): boolean {
  const rule = parseRuleConditions(rawConditions);
  return combineClauses(evaluateRuleClauses(rule, ctx), rule.match);
}

// ---------------------------------------------------------------------------
// Routing evaluation (shared by the worker and the preview endpoint)
// ---------------------------------------------------------------------------

export interface RoutingDestinationInput {
  id: string;
  name: string;
  type?: string;
  status?: string;
}

export interface RoutingRuleInput {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  /** Stop evaluating lower-priority rules after this one matches. */
  stopOnMatch: boolean;
  /** Raw `RoutingRule.conditions` JSON (legacy array or structured object). */
  conditions: unknown;
  destinations: RoutingDestinationInput[];
}

/**
 * Internal fallback decision: "Middleware" is THIS application, so the lead is
 * simply kept where it already is. There is no Destination row, no Delivery
 * record and no outbound request involved.
 */
export interface RoutingFallback {
  type: RoutingFallbackType;
  reason: string;
}

export interface EvaluatedRule {
  rule: RoutingRuleInput;
  clauses: RuleClause[];
  matched: boolean;
  /** true when evaluation stopped before this rule (stop-after-first). */
  skipped: boolean;
}

export interface RoutingEvaluation {
  evaluated: EvaluatedRule[];
  matchedRuleIds: string[];
  matchedRuleNames: string[];
  /** Unique VALID external destination ids, in rule-priority order — one delivery each. */
  destinationIds: string[];
  /** Display names of matched destinations that were skipped (DISABLED / unavailable). */
  unavailableDestinationNames: string[];
  /** true when the lead stays inside Middleware instead of being delivered. */
  usedFallback: boolean;
  /** Internal fallback decision — null when a valid external destination exists. */
  fallback: RoutingFallback | null;
  /** true when a rule matched but contributed no usable external destination. */
  matchedWithoutValidDestination: boolean;
  /** Human-readable routing decision stored on RoutingResult.reason. */
  reason: string;
  /** Same text as `fallback.reason`, kept for existing consumers. */
  fallbackReason: string | null;
}

/**
 * Evaluates routing rules against one lead.
 *
 * - Rules must arrive pre-sorted by priority (ascending).
 * - Every matched rule contributes its USABLE (ACTIVE) destinations; ids are
 *   de-duped so a destination selected by several rules still gets ONE delivery.
 * - A DISABLED / unavailable destination never receives a delivery and never
 *   counts as a routing decision: `stopOnMatch` only stops evaluation when the
 *   matched rule actually produced a valid external destination, so an invalid
 *   destination can never swallow the lead (a lower-priority rule can still
 *   deliver it).
 * - When no valid external destination remains, the INTERNAL_MIDDLEWARE
 *   fallback applies: the lead stays inside Middleware. No Destination row is
 *   read or written, no Delivery is created and nothing is sent anywhere.
 *
 * @returns the routing decision — `destinationIds` are external only, so an
 * empty list means "kept in Middleware".
 */
export function evaluateRouting(
  rules: RoutingRuleInput[],
  ctx: ConditionContext,
): RoutingEvaluation {
  const evaluated: EvaluatedRule[] = [];
  const matchedRuleIds: string[] = [];
  const matchedRuleNames: string[] = [];
  const destinationIds: string[] = [];
  const unavailableDestinationNames: string[] = [];
  let stopped = false;

  for (const rule of rules) {
    if (!rule.enabled) {
      evaluated.push({ rule, clauses: [], matched: false, skipped: true });
      continue;
    }
    if (stopped) {
      evaluated.push({ rule, clauses: [], matched: false, skipped: true });
      continue;
    }
    const parsed = parseRuleConditions(rule.conditions);
    const clauses = evaluateRuleClauses(parsed, ctx);
    const matched = combineClauses(clauses, parsed.match);
    evaluated.push({ rule, clauses, matched, skipped: false });

    if (!matched) continue;
    matchedRuleIds.push(rule.id);
    matchedRuleNames.push(rule.name);

    let usable = 0;
    for (const target of rule.destinations) {
      if (!isUsableDestination(target)) {
        if (target.name && !unavailableDestinationNames.includes(target.name)) {
          unavailableDestinationNames.push(target.name);
        }
        continue;
      }
      usable += 1;
      if (!destinationIds.includes(target.id)) destinationIds.push(target.id);
    }

    // INVALID DESTINATION != SUCCESSFUL ROUTING: stop-after-first only stops
    // when this rule produced a valid external destination. A matched rule
    // whose destinations are all disabled keeps evaluation going so the lead
    // can still be delivered (or explicitly kept) by a lower-priority rule.
    if (rule.stopOnMatch && usable > 0) stopped = true;
  }

  const matchedWithoutValidDestination =
    matchedRuleIds.length > 0 && destinationIds.length === 0;

  let usedFallback = false;
  let fallback: RoutingFallback | null = null;
  let reason: string;

  if (destinationIds.length > 0) {
    reason = `matched rules: ${matchedRuleNames
      .map((name, i) => `${name} (${matchedRuleIds[i]})`)
      .join(", ")}`;
  } else if (matchedWithoutValidDestination) {
    reason = `Rule matched but no valid external destination was available; lead kept in Middleware. [${ROUTING_FALLBACK_TYPE}]`;
    fallback = { type: ROUTING_FALLBACK_TYPE, reason };
    usedFallback = true;
  } else {
    reason = `no rule matched; lead kept in Middleware. [${ROUTING_FALLBACK_TYPE}]`;
    fallback = { type: ROUTING_FALLBACK_TYPE, reason };
    usedFallback = true;
  }

  return {
    evaluated,
    matchedRuleIds,
    matchedRuleNames,
    destinationIds,
    unavailableDestinationNames,
    usedFallback,
    fallback,
    matchedWithoutValidDestination,
    reason,
    fallbackReason: fallback ? fallback.reason : null,
  };
}

/**
 * A destination takes part in EXTERNAL delivery only when its record is
 * usable. A missing row (draft preview) is already dropped when the list is
 * built; an explicit non-ACTIVE status means "do not deliver".
 */
function isUsableDestination(target: RoutingDestinationInput): boolean {
  if (!target.id) return false;
  return !target.status || target.status === "ACTIVE";
}

/** True when a routing reason records the internal Middleware fallback. */
export function isInternalMiddlewareFallback(reason: string | null | undefined): boolean {
  return Boolean(reason) && (reason as string).includes(ROUTING_FALLBACK_TYPE);
}
