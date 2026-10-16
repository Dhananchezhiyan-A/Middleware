import { describe, expect, it } from "vitest";
import { leadListQuerySchema, leadFilterQuerySchema } from "./index";
import {
  assertReceivedRangeValid,
  receivedRangeIssues,
  resolveReceivedRange,
  wallToUtcInstant,
} from "./received-range";

/**
 * receivedAt range filtering happens SERVER-SIDE in APP_TIMEZONE — these
 * tests pin the format rules, the cross-field validation, and the exact UTC
 * boundaries (including DST transitions) the API filters on.
 */

const IST = "Asia/Kolkata"; // UTC+05:30, no DST
const NY = "America/New_York";

describe("query schema (format validation)", () => {
  it("accepts date/time/quick-range fields on the lead list query", () => {
    const parsed = leadListQuerySchema.parse({
      limit: "25",
      dateFrom: "2026-10-01",
      timeFrom: "09:30",
      dateTo: "2026-10-09",
      timeTo: "18:00",
    });
    expect(parsed.dateFrom).toBe("2026-10-01");
    expect(parsed.timeFrom).toBe("09:30");
    expect(parsed.quickRange).toBeUndefined();
  });

  it("rejects malformed dates, times and unknown quick ranges", () => {
    expect(leadListQuerySchema.safeParse({ dateFrom: "01-10-2026" }).success).toBe(false);
    expect(leadListQuerySchema.safeParse({ dateTo: "2026/10/09" }).success).toBe(false);
    expect(leadListQuerySchema.safeParse({ timeFrom: "25:00" }).success).toBe(false);
    expect(leadListQuerySchema.safeParse({ timeTo: "9:5" }).success).toBe(false);
    expect(leadListQuerySchema.safeParse({ quickRange: "last7days" }).success).toBe(false);
  });

  it("the cursorless filter schema mirrors the same filter fields", () => {
    const parsed = leadFilterQuerySchema.parse({ status: "RECEIVED", quickRange: "today" });
    expect(parsed.quickRange).toBe("today");
    // No cursor keys on the filter-only schema.
    expect(leadFilterQuerySchema.safeParse({ cursor: "abc" }).success).toBe(true); // stripped
  });
});

describe("receivedRangeIssues (cross-field validation)", () => {
  it("accepts a coherent explicit range", () => {
    expect(
      receivedRangeIssues({ dateFrom: "2026-10-01", dateTo: "2026-10-09", timeFrom: "09:00" }),
    ).toEqual([]);
    expect(receivedRangeIssues({ quickRange: "last7" })).toEqual([]);
    expect(receivedRangeIssues({})).toEqual([]);
  });

  it("rejects impossible calendar dates", () => {
    expect(receivedRangeIssues({ dateFrom: "2026-02-30" })).toEqual([
      "Start date must be a valid calendar date (YYYY-MM-DD).",
    ]);
    expect(receivedRangeIssues({ dateTo: "2026-13-01" })).toHaveLength(1);
  });

  it("rejects times without dates", () => {
    expect(receivedRangeIssues({ timeFrom: "09:00" })).toEqual(["A start time requires a start date."]);
    expect(receivedRangeIssues({ timeTo: "18:00" })).toEqual(["An end time requires an end date."]);
  });

  it("rejects a quick range combined with explicit dates", () => {
    expect(receivedRangeIssues({ quickRange: "today", dateFrom: "2026-10-01" })).toEqual([
      "A quick range cannot be combined with specific dates or times.",
    ]);
  });

  it("rejects mixing the new fields with legacy from/to instants", () => {
    expect(
      receivedRangeIssues({ dateFrom: "2026-10-01", from: "2026-10-01T00:00:00.000Z" }),
    ).toHaveLength(1);
    expect(receivedRangeIssues({ quickRange: "today", to: "2026-10-09T00:00:00.000Z" })).toHaveLength(
      1,
    );
  });

  it("rejects inverted ranges (dates and same-day times)", () => {
    expect(receivedRangeIssues({ dateFrom: "2026-10-09", dateTo: "2026-10-01" })).toEqual([
      "Start date must be on or before the end date.",
    ]);
    expect(
      receivedRangeIssues({ dateFrom: "2026-10-01", dateTo: "2026-10-01", timeFrom: "18:00", timeTo: "09:00" }),
    ).toEqual(["Start time must be on or before the end time."]);
    // Different days with times are fine.
    expect(
      receivedRangeIssues({ dateFrom: "2026-10-01", dateTo: "2026-10-02", timeFrom: "18:00", timeTo: "09:00" }),
    ).toEqual([]);
  });

  it("assertReceivedRangeValid throws with every issue", () => {
    expect(() => assertReceivedRangeValid({ timeFrom: "09:00" })).toThrow(/start date/i);
    expect(() => assertReceivedRangeValid({ dateFrom: "2026-10-01" })).not.toThrow();
  });
});

describe("wallToUtcInstant (timezone boundaries)", () => {
  it("converts IST midnight to the previous UTC day", () => {
    expect(wallToUtcInstant(2026, 10, 1, 0, 0, 0, 0, IST).toISOString()).toBe(
      "2026-09-30T18:30:00.000Z",
    );
  });

  it("handles DST transitions (US spring-forward)", () => {
    // Before the 2026-03-08 transition New York is UTC-5.
    expect(wallToUtcInstant(2026, 3, 7, 12, 0, 0, 0, NY).toISOString()).toBe(
      "2026-03-07T17:00:00.000Z",
    );
    // After it the zone is UTC-4 — the offset must be re-resolved.
    expect(wallToUtcInstant(2026, 3, 9, 0, 0, 0, 0, NY).toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
  });
});

describe("resolveReceivedRange (inclusive boundaries)", () => {
  const now = new Date("2026-10-10T12:00:00.000Z"); // 17:30 IST, 08:00 EDT

  it("dateFrom alone starts at 00:00 in APP_TIMEZONE", () => {
    const range = resolveReceivedRange({ dateFrom: "2026-10-01" }, IST, now);
    expect(range.gte?.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(range.lte).toBeUndefined();
  });

  it("dateTo alone ends at 23:59:59.999 in APP_TIMEZONE (inclusive)", () => {
    const range = resolveReceivedRange({ dateTo: "2026-10-09" }, IST, now);
    expect(range.lte?.toISOString()).toBe("2026-10-09T18:29:59.999Z");
    expect(range.gte).toBeUndefined();
  });

  it("honours explicit start/end times (end time is inclusive to its minute)", () => {
    const range = resolveReceivedRange(
      { dateFrom: "2026-10-01", timeFrom: "09:00", dateTo: "2026-10-01", timeTo: "18:00" },
      IST,
      now,
    );
    expect(range.gte?.toISOString()).toBe("2026-10-01T03:30:00.000Z");
    expect(range.lte?.toISOString()).toBe("2026-10-01T12:30:59.999Z");
  });

  it("quick range 'today' is the calendar day in APP_TIMEZONE", () => {
    // now = 17:30 IST on 2026-10-10 → the IST day 2026-10-10.
    const range = resolveReceivedRange({ quickRange: "today" }, IST, now);
    expect(range.gte?.toISOString()).toBe("2026-10-09T18:30:00.000Z");
    expect(range.lte?.toISOString()).toBe("2026-10-10T18:29:59.999Z");

    // The SAME instant is still 2026-10-10 in New York (08:00 EDT).
    const ny = resolveReceivedRange({ quickRange: "today" }, NY, now);
    expect(ny.gte?.toISOString()).toBe("2026-10-10T04:00:00.000Z");
    expect(ny.lte?.toISOString()).toBe("2026-10-11T03:59:59.999Z");
  });

  it("quick range 'yesterday' covers the previous zoned calendar day", () => {
    const range = resolveReceivedRange({ quickRange: "yesterday" }, IST, now);
    expect(range.gte?.toISOString()).toBe("2026-10-08T18:30:00.000Z");
    expect(range.lte?.toISOString()).toBe("2026-10-09T18:29:59.999Z");
  });

  it("quick ranges 'last7'/'last30' include today (calendar days in the zone)", () => {
    const last7 = resolveReceivedRange({ quickRange: "last7" }, IST, now);
    expect(last7.gte?.toISOString()).toBe("2026-10-03T18:30:00.000Z"); // today-6 start
    expect(last7.lte?.toISOString()).toBe("2026-10-10T18:29:59.999Z");

    const last30 = resolveReceivedRange({ quickRange: "last30" }, IST, now);
    expect(last30.gte?.toISOString()).toBe("2026-09-10T18:30:00.000Z"); // (today-29) 00:00 IST
    expect(last30.lte?.toISOString()).toBe("2026-10-10T18:29:59.999Z");
  });

  it("throws on incoherent input instead of matching everything", () => {
    expect(() => resolveReceivedRange({ timeFrom: "09:00" }, IST, now)).toThrow();
    expect(() => resolveReceivedRange({ dateFrom: "2026-10-05", dateTo: "2026-10-01" }, IST, now)).toThrow();
  });
});
