import { LeadStatuses } from "@middleware/types";

/**
 * Dashboard drill-down ranges.
 *
 * These are ROLLING windows computed from the browser clock only to build an
 * ISO instant that the API filters on — the same window /analytics/overview
 * uses (`createdAt >= now - N*24h`), so a card's number equals the list count.
 */
export const RANGE_LABELS = {
  "24h": "Last 24 Hours",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
} as const;

export type RangeKey = keyof typeof RANGE_LABELS;

export function isRangeKey(value: unknown): value is RangeKey {
  return typeof value === "string" && value in RANGE_LABELS;
}

/** Rolling window bounds for a range key, as ISO-8601 instants. */
export function rangeToFromTo(
  range: RangeKey,
  now: Date = new Date(),
): { from: string; to: string } {
  const hours = range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
  return {
    from: new Date(now.getTime() - hours * 3_600_000).toISOString(),
    to: now.toISOString(),
  };
}

export type SearchParamsValue = string | string[] | undefined;

/** Next.js `searchParams` prop — first value wins when an array sneaks in. */
function first(value: SearchParamsValue): string | undefined {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved && resolved.length > 0 ? resolved : undefined;
}

/** Filters a drill-down page reads from its URL query string. */
export interface ListFilterParams {
  range?: RangeKey;
  from?: string;
  to?: string;
  /** Status of either enum — narrowed by the consumer (leads vs deliveries). */
  status?: string;
  sourceId?: string;
  q?: string;
}

/**
 * Reads drill-down filters (`?range=`, `?from=`, `?to=`, `?status=`,
 * `?sourceId=`, `?q=`) out of a page's searchParams. Unknown/invalid values
 * are ignored so a hand-edited URL can never produce a broken query.
 *
 * `validStatuses` scopes the status check — leads and deliveries use
 * different status enums.
 */
export function readListFilterParams(
  searchParams: Record<string, SearchParamsValue>,
  validStatuses: readonly string[] = LeadStatuses,
): ListFilterParams {
  const out: ListFilterParams = {};

  const range = first(searchParams.range);
  if (isRangeKey(range)) out.range = range;

  const status = first(searchParams.status);
  if (status && validStatuses.includes(status)) {
    out.status = status;
  }

  const sourceId = first(searchParams.sourceId);
  if (sourceId) out.sourceId = sourceId;

  const q = first(searchParams.q);
  if (q) out.q = q;

  const from = first(searchParams.from);
  if (from) out.from = from;

  const to = first(searchParams.to);
  if (to) out.to = to;

  if (out.range && !out.from && !out.to) {
    const bounds = rangeToFromTo(out.range);
    out.from = bounds.from;
    out.to = bounds.to;
  }

  return out;
}

/** Human label for the active range, e.g. "Received: Last 24 Hours". */
export function rangeFilterLabel(range: RangeKey): string {
  return `Received: ${RANGE_LABELS[range]}`;
}

/** YYYY-MM-DD for a "From"/"To" chip. */
export function shortDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toISOString().slice(0, 10);
}
