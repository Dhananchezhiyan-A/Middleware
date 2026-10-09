import { hmacSha256Hex, timingSafeEqualStr } from "@middleware/shared";
import type {
  ConnectionTestResult,
  DeliveryRequest,
  DeliveryResult,
  DestinationAdapter,
  DestinationContext,
  CredentialContext,
} from "../types";
import { safeFetch, type SafeFetchResult } from "../http";
import {
  cfgNum,
  cfgStr,
  extractPath,
  failureResult,
  missingKeys,
  notConfigured,
  successResult,
} from "./helpers";

/**
 * Request body for a webhook delivery.
 *
 * - `bodyMode: "envelope"` (default) wraps the mapped payload in delivery
 *   metadata (`idempotencyKey`, `attempt`, `correlationId`, `leadId`,
 *   `timestamp`) — receivers read `body.payload.*`.
 * - `bodyMode: "flat"` sends only the mapped payload, top-level, for receivers
 *   whose contract expects the destination fields themselves (e.g. an Apex
 *   REST resource reading `body.FirstName`).
 */
export function buildWebhookBody(
  parts: {
    mappedPayload: Record<string, unknown>;
    idempotencyKey: string;
    attempt: number;
    correlationId: string;
    leadId: string;
    /** Only used by the envelope form. */
    now?: string;
  },
  config: Record<string, unknown>,
): string {
  if (cfgStr(config, "bodyMode") === "flat") return JSON.stringify(parts.mappedPayload);
  return JSON.stringify({
    idempotencyKey: parts.idempotencyKey,
    attempt: parts.attempt,
    correlationId: parts.correlationId,
    leadId: parts.leadId,
    payload: parts.mappedPayload,
    timestamp: parts.now ?? new Date().toISOString(),
  });
}

function webhookBusinessFailureMessage(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const response = parsed as Record<string, unknown>;
  if (typeof response.Status !== "string" || response.Status.trim().toLowerCase() !== "failed") {
    return undefined;
  }
  return typeof response.Msg === "string" && response.Msg.length > 0
    ? response.Msg
    : "CRM reported Status=Failed.";
}

export function webhookResponseResult(res: SafeFetchResult, url: string): DeliveryResult {
  const businessFailure = webhookBusinessFailureMessage(res.bodyText);
  if (businessFailure !== undefined) return failureResult(res, url, { message: businessFailure });
  if (res.ok) return successResult(res, { requestUrl: url });
  return failureResult(res, url);
}

/**
 * Webhook destination — POSTs the mapped payload to a customer URL with an
 * HMAC-SHA256 signature so the receiver can verify authenticity
 * (headers: x-middleware-signature, x-middleware-timestamp).
 */
export class WebhookAdapter implements DestinationAdapter {
  readonly type = "WEBHOOK" as const;

  validate(dest: DestinationContext, credential?: CredentialContext): string[] {
    return missingKeys(dest, credential, ["url"], false);
  }

  async deliver(req: DeliveryRequest): Promise<DeliveryResult> {
    const missing = this.validate(req.destination, req.credential);
    if (missing.length > 0) throw notConfigured(missing);

    const url = cfgStr(req.destination.config, "url");
    if (url === undefined) throw notConfigured(["config.url"]);
    const started = Date.now();
    const body = buildWebhookBody(
      {
        mappedPayload: req.mappedPayload,
        idempotencyKey: req.idempotencyKey,
        attempt: req.attempt,
        correlationId: req.correlationId,
        leadId: req.lead.id,
      },
      req.destination.config,
    );

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-middleware-delivery": req.idempotencyKey,
      "x-middleware-correlation": req.correlationId,
    };
    const secret = req.credential?.secret;
    if (secret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      headers["x-middleware-timestamp"] = timestamp;
      headers["x-middleware-signature"] = `sha256=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
    }

    try {
      const res = await safeFetch(url, {
        method: cfgStr(req.destination.config, "method") === "PUT" ? "PUT" : "POST",
        headers,
        body,
        timeoutMs: cfgNum(req.destination.config, "timeoutMs"),
      });
      return webhookResponseResult(res, url);
    } catch (err) {
      return this.transportFailure(err, url, started);
    }
  }

  async testConnection(
    dest: DestinationContext,
    _credential?: CredentialContext,
  ): Promise<ConnectionTestResult> {
    const missing = this.validate(dest, _credential);
    if (missing.length > 0) {
      return { ok: false, status: "NOT_CONFIGURED", error: `Missing: ${missing.join(", ")}` };
    }
    const url = cfgStr(dest.config, "url");
    if (url === undefined) {
      return { ok: false, status: "NOT_CONFIGURED", error: "Missing: config.url" };
    }
    try {
      const res = await safeFetch(url, {
        method: "OPTIONS",
        timeoutMs: 5_000,
      });
      // Any HTTP response proves reachability + SSRF check passed.
      return { ok: true, status: "CONNECTED", latencyMs: res.durationMs };
    } catch (err) {
      return {
        ok: false,
        status: "ERROR",
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }

  private transportFailure(err: unknown, url: string, started: number): DeliveryResult {
    if (err && typeof err === "object" && "code" in err) {
      const appErr = err as { code: string; message: string; retryable?: boolean };
      return {
        success: false,
        errorCode: appErr.code as DeliveryResult["errorCode"],
        errorMessage: appErr.message,
        retryable: appErr.retryable ?? false,
        requestUrl: url,
        durationMs: Date.now() - started,
      };
    }
    return {
      success: false,
      errorCode: "DESTINATION_UNREACHABLE",
      errorMessage: "Webhook destination could not be reached.",
      retryable: true,
      requestUrl: url,
      durationMs: Date.now() - started,
    };
  }
}

// Re-exported for tests that verify signature round-trips.
export { hmacSha256Hex, timingSafeEqualStr, extractPath };
