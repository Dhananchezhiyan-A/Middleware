import { z } from "zod";

/**
 * Server-side receivedAt date/time filtering in the APPLICATION timezone.
 *
 * The browser sends calendar dates (`YYYY-MM-DD`), optional times (`HH:MM`)
 * and/or a quick range token — never instants. The server resolves them to
 * UTC boundaries using `APP_TIMEZONE`, so "Today" and a date range mean the
 * same thing for every operator regardless of their machine's timezone.
 *
 * Boundaries are inclusive:
 *   start → dateFrom @ timeFrom (default 00:00:00.000)
 *   end   → dateTo   @ timeTo   (default 23:59:59.999), to the end of the
 *           selected minute when an end time is given (18:00 → 18:00:59.999).
 */

export const QUICK_RANGES = ["today", "yesterday", "last7", "last30"] as const;
export type QuickRange = (typeof QUICK_RANGES)[number];

export const QUICK_RANGE_LABELS: Record<QuickRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 Days",
  last30: "Last 30 Days",
};

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Zod field definitions spread into list/filter query schemas. */
export const receivedRangeShape = {
  dateFrom: z.string().regex(ISO_DATE_RE, "Start date must be YYYY-MM-DD").optional(),
  dateTo: z.string().regex(ISO_DATE_RE, "End date must be YYYY-MM-DD").optional(),
  timeFrom: z.string().regex(HH_MM_RE, "Start time must be HH:MM").optional(),
  timeTo: z.string().regex(HH_MM_RE, "End time must be HH:MM").optional(),
  quickRange: z.enum(QUICK_RANGES).optional(),
};

export interface ReceivedRangeFields {
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
  quickRange?: string;
  /** Legacy rolling instants (`?from=` / `?to=`) — mutually exclusive with the fields above. */
  from?: string;
  to?: string;
}

/** Valid Gregorian calendar date (rejects 2026-02-30 etc.). */
export function isCalendarDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d
  );
}

function hasReceivedRangeFields(f: ReceivedRangeFields): boolean {
  return Boolean(f.dateFrom || f.dateTo || f.timeFrom || f.timeTo || f.quickRange);
}

/**
 * Cross-field/format validation, returned as human-readable issues so the
 * caller can map them onto a VALIDATION_FAILED (422) response. Format checks
 * are repeated here (the zod shape already enforces them) so this function is
 * safe to use standalone.
 */
export function receivedRangeIssues(f: ReceivedRangeFields): string[] {
  const issues: string[] = [];

  if (f.dateFrom !== undefined && !isCalendarDate(f.dateFrom)) {
    issues.push("Start date must be a valid calendar date (YYYY-MM-DD).");
  }
  if (f.dateTo !== undefined && !isCalendarDate(f.dateTo)) {
    issues.push("End date must be a valid calendar date (YYYY-MM-DD).");
  }
  if (f.timeFrom !== undefined && !HH_MM_RE.test(f.timeFrom)) {
    issues.push("Start time must be HH:MM.");
  }
  if (f.timeTo !== undefined && !HH_MM_RE.test(f.timeTo)) {
    issues.push("End time must be HH:MM.");
  }
  if (f.quickRange !== undefined && !QUICK_RANGES.includes(f.quickRange as QuickRange)) {
    issues.push(`Quick range must be one of: ${QUICK_RANGES.join(", ")}.`);
  }

  if (f.quickRange && (f.dateFrom || f.dateTo || f.timeFrom || f.timeTo)) {
    issues.push("A quick range cannot be combined with specific dates or times.");
  }
  if (f.timeFrom && !f.dateFrom) {
    issues.push("A start time requires a start date.");
  }
  if (f.timeTo && !f.dateTo) {
    issues.push("An end time requires an end date.");
  }
  if (hasReceivedRangeFields(f) && (f.from || f.to)) {
    issues.push(
      "Date filters cannot be combined with the legacy receivedAt range (from/to) parameters.",
    );
  }

  if (
    f.dateFrom &&
    f.dateTo &&
    isCalendarDate(f.dateFrom) &&
    isCalendarDate(f.dateTo) &&
    f.dateFrom > f.dateTo
  ) {
    issues.push("Start date must be on or before the end date.");
  } else if (
    f.dateFrom &&
    f.dateTo &&
    f.dateFrom === f.dateTo &&
    f.timeFrom &&
    f.timeTo &&
    f.timeFrom > f.timeTo
  ) {
    issues.push("Start time must be on or before the end time.");
  }

  return issues;
}

/** Throws when the given fields are not a coherent receivedAt range. */
export function assertReceivedRangeValid(f: ReceivedRangeFields): void {
  const issues = receivedRangeIssues(f);
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
}

// --- Timezone maths ---------------------------------------------------------

const WALL_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = WALL_FORMATTERS.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    WALL_FORMATTERS.set(timeZone, fmt);
  }
  return fmt;
}

/** UTC offset of `timeZone` at the instant `utcMs`, in milliseconds. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const wholeSeconds = Math.floor(utcMs / 1000) * 1000;
  const parts = wallFormatter(timeZone).formatToParts(new Date(wholeSeconds));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - wholeSeconds;
}

/**
 * Wall-clock time in `timeZone` → the UTC instant it represents.
 * Two passes keep DST transitions correct (the first guess resolves the
 * offset, the second re-resolves it at the corrected instant).
 */
export function wallToUtcInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const firstGuess = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(firstGuess, timeZone));
}

/** Calendar date (Y/M/D) of `date` as seen in `timeZone`. */
function zonedYmd(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = wallFormatter(timeZone).formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Calendar arithmetic on a Y/M/D triple (timezone-independent). */
function addDays(ymd: { year: number; month: number; day: number }, days: number) {
  const next = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day) + days * 86_400_000);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function dayStartEnd(ymd: { year: number; month: number; day: number }, timeZone: string) {
  return {
    gte: wallToUtcInstant(ymd.year, ymd.month, ymd.day, 0, 0, 0, 0, timeZone),
    lte: wallToUtcInstant(ymd.year, ymd.month, ymd.day, 23, 59, 59, 999, timeZone),
  };
}

export interface ReceivedRange {
  gte?: Date;
  lte?: Date;
}

/**
 * Resolves validated date/time/quick-range fields into inclusive UTC
 * boundaries for `receivedAt`. Assumes `receivedRangeIssues()` is empty;
 * throws on incoherent input so bugs surface instead of silently matching
 * everything.
 */
export function resolveReceivedRange(
  f: ReceivedRangeFields,
  timeZone: string,
  now: Date = new Date(),
): ReceivedRange {
  const issues = receivedRangeIssues(f);
  if (issues.length > 0) throw new Error(issues.join(" "));

  if (f.quickRange) {
    const today = zonedYmd(now, timeZone);
    switch (f.quickRange as QuickRange) {
      case "today":
        return dayStartEnd(today, timeZone);
      case "yesterday":
        return dayStartEnd(addDays(today, -1), timeZone);
      case "last7":
        return {
          gte: dayStartEnd(addDays(today, -6), timeZone).gte,
          lte: dayStartEnd(today, timeZone).lte,
        };
      case "last30":
        return {
          gte: dayStartEnd(addDays(today, -29), timeZone).gte,
          lte: dayStartEnd(today, timeZone).lte,
        };
    }
  }

  const range: ReceivedRange = {};
  if (f.dateFrom) {
    const [y, m, d] = f.dateFrom.split("-").map(Number);
    const [hh, mm] = (f.timeFrom ?? "00:00").split(":").map(Number);
    range.gte = wallToUtcInstant(y, m, d, hh, mm, 0, 0, timeZone);
  }
  if (f.dateTo) {
    const [y, m, d] = f.dateTo.split("-").map(Number);
    const [hh, mm] = (f.timeTo ?? "23:59").split(":").map(Number);
    // Inclusive to the end of the selected minute (18:00 → 18:00:59.999).
    range.lte = wallToUtcInstant(y, m, d, hh, mm, 59, 999, timeZone);
  }
  return range;
}
