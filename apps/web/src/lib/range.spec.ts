import { describe, expect, it } from "vitest";
import {
  RANGE_LABELS,
  isRangeKey,
  rangeFilterLabel,
  rangeToFromTo,
  readListFilterParams,
  shortDate,
  type SearchParamsValue,
} from "./range";

/**
 * Dashboard drill-down plumbing: a card's metric and the list it links to must
 * use the SAME window, and the URL must state the active filter explicitly.
 */

const sp = (values: Record<string, SearchParamsValue>) => values;

describe("isRangeKey", () => {
  it("accepts only the known ranges", () => {
    expect(isRangeKey("24h")).toBe(true);
    expect(isRangeKey("7d")).toBe(true);
    expect(isRangeKey("30d")).toBe(true);
    expect(isRangeKey("24H")).toBe(false);
    expect(isRangeKey("all")).toBe(false);
    expect(isRangeKey(undefined)).toBe(false);
    expect(isRangeKey(["24h"])).toBe(false);
  });
});

describe("rangeToFromTo", () => {
  it("builds a rolling window of the expected width", () => {
    const now = new Date("2026-10-07T12:00:00.000Z");

    const day = rangeToFromTo("24h", now);
    expect(day.to).toBe(now.toISOString());
    expect(new Date(day.from).getTime()).toBe(now.getTime() - 24 * 3_600_000);

    const week = rangeToFromTo("7d", now);
    expect(new Date(week.from).getTime()).toBe(now.getTime() - 7 * 24 * 3_600_000);

    const month = rangeToFromTo("30d", now);
    expect(new Date(month.from).getTime()).toBe(now.getTime() - 30 * 24 * 3_600_000);
  });

  it("always returns ISO-8601 instants", () => {
    const bounds = rangeToFromTo("24h");
    expect(bounds.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(bounds.from).getTime()).toBeLessThan(new Date(bounds.to).getTime());
  });
});

describe("readListFilterParams", () => {
  it("reads every supported filter", () => {
    const parsed = readListFilterParams(
      sp({
        range: "7d",
        status: "PROCESSED",
        sourceId: "src_1",
        q: "pune",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
      }),
    );

    expect(parsed).toEqual({
      range: "7d",
      status: "PROCESSED",
      sourceId: "src_1",
      q: "pune",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    });
  });

  it("expands a bare range into from/to so the URL states the window", () => {
    const parsed = readListFilterParams(sp({ range: "24h" }));
    expect(parsed.range).toBe("24h");
    expect(parsed.from).toBeDefined();
    expect(parsed.to).toBeDefined();
    expect(new Date(parsed.to as string).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("never overwrites explicit from/to with the range window", () => {
    const parsed = readListFilterParams(
      sp({ range: "7d", from: "2026-01-01T00:00:00.000Z" }),
    );
    expect(parsed.from).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.to).toBeUndefined();
  });

  it("ignores invalid values so a hand-edited URL cannot break the query", () => {
    expect(readListFilterParams(sp({ range: "nope", status: "HAX" }))).toEqual({});
    expect(readListFilterParams(sp({}))).toEqual({});
  });

  it("scopes status against the caller's enum (leads vs deliveries)", () => {
    expect(readListFilterParams(sp({ status: "SUCCEEDED" })).status).toBeUndefined();
    expect(
      readListFilterParams(sp({ status: "SUCCEEDED" }), ["PENDING", "SUCCEEDED"]).status,
    ).toBe("SUCCEEDED");
    expect(readListFilterParams(sp({ status: "PROCESSED" })).status).toBe("PROCESSED");
  });

  it("takes the first value when searchParams sneaks in an array", () => {
    expect(readListFilterParams(sp({ range: ["7d", "24h"], q: ["a", "b"] }))).toMatchObject({
      range: "7d",
      q: "a",
    });
  });

  it("drops empty strings", () => {
    expect(readListFilterParams(sp({ range: "", q: "", sourceId: "" }))).toEqual({});
  });
});

describe("labels", () => {
  it("names the active filter the way the banner shows it", () => {
    expect(rangeFilterLabel("24h")).toBe("Received: Last 24 Hours");
    expect(rangeFilterLabel("7d")).toBe("Received: Last 7 Days");
    expect(rangeFilterLabel("30d")).toBe("Received: Last 30 Days");
    expect(Object.keys(RANGE_LABELS)).toEqual(["24h", "7d", "30d"]);
  });

  it("formats chip dates as YYYY-MM-DD and passes bad input through", () => {
    expect(shortDate("2026-10-07T18:30:00.000Z")).toBe("2026-10-07");
    expect(shortDate("not-a-date")).toBe("not-a-date");
  });
});
