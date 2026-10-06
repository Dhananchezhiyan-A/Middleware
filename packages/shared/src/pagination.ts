import type { CursorQuery } from "@middleware/types";

/**
 * Opaque cursor pagination helpers.
 *
 * Cursors are base64url-encoded JSON of the last item's sort key — stable for
 * large datasets where OFFSET pagination degrades.
 */

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor<T extends Record<string, unknown>>(cursor: string): T | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object") return parsed as T;
    return null;
  } catch {
    return null;
  }
}

export function clampLimit(
  limit: number | undefined,
  { def = 25, max = 100 }: { def?: number; max?: number } = {},
): number {
  if (limit === undefined || Number.isNaN(limit)) return def;
  return Math.min(Math.max(Math.floor(limit), 1), max);
}

export function normalizeQuery(query: CursorQuery | undefined): Required<CursorQuery> {
  return {
    cursor: query?.cursor ?? null,
    limit: clampLimit(query?.limit),
  };
}
