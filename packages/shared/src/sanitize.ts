/**
 * Sanitization helpers — the LAST line of defense before data reaches logs,
 * audit records or API responses. Strips credential material recursively.
 */

const SENSITIVE_KEY_PATTERN =
  /(pass(word|phrase)?|secret|token|api[-_]?key|apikey|authorization|credential|private[-_]?key|client[-_]?secret|refresh[-_]?token|cookie|signature|access[-_]?key|password_hash|passwordhash)/i;

export const REDACTED = "[REDACTED]";

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_STRING = 4_000;
const DEFAULT_MAX_ARRAY = 100;

/**
 * Deep-clones a value, replacing sensitive keys with [REDACTED], capping
 * string lengths, array sizes and depth. Never throws.
 */
export function sanitizeDeep(
  value: unknown,
  opts: { maxDepth?: number; maxString?: number; maxArray?: number } = {},
): unknown {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxString = opts.maxString ?? DEFAULT_MAX_STRING;
  const maxArray = opts.maxArray ?? DEFAULT_MAX_ARRAY;

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === "string") {
      return v.length > maxString ? `${v.slice(0, maxString)}…[truncated]` : v;
    }
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Error) {
      return { name: v.name, message: v.message, stack: v.stack };
    }
    if (depth >= maxDepth) return "[max-depth]";
    if (Array.isArray(v)) {
      const slice = v.slice(0, maxArray).map((item) => walk(item, depth + 1));
      if (v.length > maxArray) slice.push(`…${v.length - maxArray} more`);
      return slice;
    }
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEY_PATTERN.test(k) ? REDACTED : walk(val, depth + 1);
      }
      return out;
    }
    return String(v);
  };

  try {
    return walk(value, 0);
  } catch {
    return "[unserializable]";
  }
}

/** Keeps only the inbound headers that are safe to persist. */
export function sanitizeHeaders(
  headers: Record<string, unknown>,
): Record<string, string | string[]> {
  const allow = [
    "content-type",
    "content-length",
    "user-agent",
    "referer",
    "x-request-id",
    "x-correlation-id",
    "x-webhook-id",
    "x-hub-signature",
    "x-hub-signature-256",
    "x-signature",
    "x-goog-signature",
    "meta-app-id",
    "x-middleware-signature",
    "idempotency-key",
  ];
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (!allow.includes(key)) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = v as string | string[];
    }
  }
  return out;
}

export function truncate(str: string, max = 2_000): string {
  return str.length > max ? `${str.slice(0, max)}…[truncated ${str.length - max}]` : str;
}
