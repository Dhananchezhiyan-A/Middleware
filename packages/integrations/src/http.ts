import { lookup } from "node:dns/promises";
import { AppError, errors, sanitizeDeep, truncate } from "@middleware/shared";

/**
 * HTTP delivery transport with SSRF protection and hard timeouts.
 *
 * SSRF rules (custom URLs, webhook targets):
 *  - only http/https
 *  - no embedded credentials
 *  - hostname must resolve to PUBLIC addresses — unless explicitly allowed
 *    (development defaults allow loopback so local testing works; production
 *    allows nothing private without explicit configuration)
 */

export interface SafeFetchResult {
  status: number;
  ok: boolean;
  bodyText: string;
  headers: Headers;
  durationMs: number;
}

function allowedPrivateHosts(): Set<string> {
  const explicit = (process.env.SSRF_ALLOW_PRIVATE_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const devDefaults =
    process.env.NODE_ENV === "production" ? [] : ["localhost", "127.0.0.1", "::1", "[::1]"];
  return new Set([...explicit, ...devDefaults]);
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    // IPv6: loopback, link-local, unique-local, unspecified.
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower === "::" ||
      lower.startsWith("fe80:") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd")
    );
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw errors.badRequest("Destination URL is invalid.", { url: "[invalid]" });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("DESTINATION_SSRF_BLOCKED", "Only http/https URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new AppError("DESTINATION_SSRF_BLOCKED", "URLs with embedded credentials are blocked.");
  }

  const host = url.hostname.toLowerCase();
  const allowed = allowedPrivateHosts();
  if (allowed.has(host)) return url;

  // Literal IP hostname?
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    if (isPrivateIp(host)) {
      throw new AppError(
        "DESTINATION_SSRF_BLOCKED",
        "Destination resolves to a private/internal address.",
      );
    }
    return url;
  }

  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new AppError("DESTINATION_UNREACHABLE", "Destination hostname could not be resolved.", {
      retryable: true,
    });
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new AppError(
      "DESTINATION_SSRF_BLOCKED",
      "Destination resolves to a private/internal address.",
    );
  }
  return url;
}

/**
 * fetch() with a hard timeout. Network/timeout failures throw typed
 * AppErrors (DESTINATION_TIMEOUT / DESTINATION_UNREACHABLE); HTTP status
 * codes are returned to the caller for classification.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<SafeFetchResult> {
  const url = await assertSafeUrl(rawUrl);
  const timeoutMs = init.timeoutMs ?? 15_000;
  const { timeoutMs: _ignored, ...rest } = init;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const bodyText = truncate(await res.text(), 8_000);
    return {
      status: res.status,
      ok: res.ok,
      bodyText,
      headers: res.headers,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const aborted = err instanceof Error && err.name === "AbortError";
    if (aborted) {
      throw new AppError("DESTINATION_TIMEOUT", `Destination timed out after ${timeoutMs}ms.`, {
        retryable: true,
      });
    }
    throw new AppError("DESTINATION_UNREACHABLE", "Destination could not be reached.", {
      cause: err,
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Parses Retry-After (seconds or HTTP-date) into milliseconds. */
export function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (!Number.isNaN(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/** Classifies an HTTP response into retry semantics. */
export function classifyHttpStatus(status: number): {
  retryable: boolean;
  rateLimited: boolean;
} {
  if (status === 429) return { retryable: true, rateLimited: true };
  if (status >= 500) return { retryable: true, rateLimited: false };
  if (status === 408) return { retryable: true, rateLimited: false };
  return { retryable: false, rateLimited: false };
}

/** Response bodies stored in attempt records (sanitized + capped). */
export function sanitizeResponseBody(body: string): string {
  const trimmed = truncate(body, 2_000);
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return truncate(JSON.stringify(sanitizeDeep(parsed)), 2_000);
  } catch {
    return trimmed;
  }
}
