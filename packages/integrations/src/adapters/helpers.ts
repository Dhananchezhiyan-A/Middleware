import type { DeliveryResult, DestinationContext, CredentialContext } from "../types";
import {
  classifyHttpStatus,
  parseRetryAfterMs,
  sanitizeResponseBody,
} from "../http";
import { AppError, errors } from "@middleware/shared";

/** Reads a required string config value (trimmed). */
export function cfgStr(config: Record<string, unknown>, key: string): string | undefined {
  const v = config[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

export function cfgNum(config: Record<string, unknown>, key: string): number | undefined {
  const v = config[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/** Returns the subset of `keys` that are missing/empty in config+credential. */
export function missingKeys(
  dest: DestinationContext,
  credential: CredentialContext | undefined,
  configKeys: string[],
  credentialRequired = true,
): string[] {
  const missing: string[] = [];
  for (const k of configKeys) {
    if (!cfgStr(dest.config, k)) missing.push(`config.${k}`);
  }
  if (credentialRequired && !credential) {
    missing.push("credential");
  }
  return missing;
}

export function notConfigured(missing: string[]): AppError {
  return errors.destinationNotConfigured(missing);
}

/** Builds a SUCCESS DeliveryResult from an HTTP response. */
export function successResult(
  res: { status: number; bodyText: string; durationMs: number; headers: Headers },
  extra: { externalId?: string; requestUrl?: string } = {},
): DeliveryResult {
  return {
    success: true,
    responseStatus: res.status,
    responseBody: sanitizeResponseBody(res.bodyText),
    externalId: extra.externalId,
    requestUrl: extra.requestUrl,
    retryable: false,
    durationMs: res.durationMs,
  };
}

/** Builds a FAILURE DeliveryResult from an HTTP response (never throws). */
export function failureResult(
  res: { status: number; bodyText: string; durationMs: number; headers: Headers },
  requestUrl: string,
  opts: { errorCode?: DeliveryResult["errorCode"]; message?: string } = {},
): DeliveryResult {
  const { retryable, rateLimited } = classifyHttpStatus(res.status);
  return {
    success: false,
    responseStatus: res.status,
    responseBody: sanitizeResponseBody(res.bodyText),
    errorCode: opts.errorCode ?? classifyErrorCode(res.status),
    errorMessage: opts.message ?? defaultMessage(res.status),
    retryable,
    rateLimited,
    retryAfterMs: rateLimited ? parseRetryAfterMs(res.headers) : undefined,
    requestUrl,
    durationMs: res.durationMs,
  };
}

function classifyErrorCode(status: number): NonNullable<DeliveryResult["errorCode"]> {
  if (status === 401 || status === 403) return "DESTINATION_AUTH_FAILED";
  if (status === 429) return "DESTINATION_RATE_LIMITED";
  if (status >= 500) return "DESTINATION_SERVER_ERROR";
  return "DESTINATION_REJECTED";
}

function defaultMessage(status: number): string {
  if (status === 401 || status === 403) return "Destination rejected the credentials.";
  if (status === 429) return "Destination rate limit exceeded.";
  if (status >= 500) return "Destination returned a server error.";
  return "Destination rejected the payload.";
}

/** Extracts a JSON pointer-ish path from a response body (best effort). */
export function extractPath(body: string, path: string[]): string | undefined {
  try {
    let current: unknown = JSON.parse(body);
    for (const seg of path) {
      if (current === null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[seg];
    }
    if (typeof current === "string" || typeof current === "number") return String(current);
    return undefined;
  } catch {
    return undefined;
  }
}
