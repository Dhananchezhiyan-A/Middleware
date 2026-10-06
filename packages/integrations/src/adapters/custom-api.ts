import type { DestinationType } from "@middleware/types";
import type {
  ConnectionTestResult,
  CredentialContext,
  DeliveryRequest,
  DeliveryResult,
  DestinationAdapter,
  DestinationContext,
} from "../types";
import { safeFetch } from "../http";
import {
  cfgNum,
  cfgStr,
  extractPath,
  failureResult,
  missingKeys,
  notConfigured,
  successResult,
} from "./helpers";

type AuthType = "none" | "bearer" | "basic" | "apikey";

/**
 * Generic REST destination for "Custom API" integrations.
 *
 * Config: { url, method?, authType?, apiKeyHeader?, headerName?, headers?, timeoutMs?, idempotencyHeader? }
 * Credential (optional): the bearer token / basic password / api key.
 *
 * Always SSRF-guarded and timeout-bounded; the stable delivery idempotency
 * key is sent so receivers can deduplicate retries.
 */
export class CustomApiAdapter implements DestinationAdapter {
  readonly type: DestinationType = "CUSTOM_API";

  validate(dest: DestinationContext, credential?: CredentialContext): string[] {
    const missing = missingKeys(dest, credential, ["url"], false);
    const authType = (cfgStr(dest.config, "authType") ?? "none") as AuthType;
    if (authType !== "none" && !credential) missing.push("credential");
    return missing;
  }

  async deliver(req: DeliveryRequest): Promise<DeliveryResult> {
    const missing = this.validate(req.destination, req.credential);
    if (missing.length > 0) throw notConfigured(missing);

    const config = req.destination.config;
    const url = cfgStr(config, "url");
    if (url === undefined) throw notConfigured(["config.url"]);
    const method = (cfgStr(config, "method") ?? "POST").toUpperCase();
    const timeoutMs = cfgNum(config, "timeoutMs");

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-middleware-delivery": req.idempotencyKey,
      "x-middleware-correlation": req.correlationId,
    };
    const idempotencyHeader = cfgStr(config, "idempotencyHeader");
    if (idempotencyHeader) headers[idempotencyHeader] = req.idempotencyKey;

    this.applyAuth(headers, config, req.credential);

    const customHeaders = config.headers;
    if (customHeaders && typeof customHeaders === "object" && !Array.isArray(customHeaders)) {
      for (const [k, v] of Object.entries(customHeaders as Record<string, unknown>)) {
        if (typeof v === "string" && !/^content-length$/i.test(k)) headers[k] = v;
      }
    }

    const started = Date.now();
    try {
      const res = await safeFetch(url, {
        method: method as RequestInit["method"],
        headers,
        body: JSON.stringify({
          idempotencyKey: req.idempotencyKey,
          attempt: req.attempt,
          correlationId: req.correlationId,
          payload: req.mappedPayload,
        }),
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      if (res.ok) {
        const externalId =
          extractPath(res.bodyText, ["id"]) ??
          extractPath(res.bodyText, ["data", "id"]) ??
          res.headers.get("x-object-id") ??
          undefined;
        return successResult(res, { externalId, requestUrl: url });
      }
      return failureResult(res, url);
    } catch (err) {
      const e = err as { code?: string; message?: string; retryable?: boolean };
      return {
        success: false,
        errorCode: e.code as DeliveryResult["errorCode"],
        errorMessage: e.message ?? "Custom API destination failed.",
        retryable: e.retryable ?? false,
        requestUrl: url,
        durationMs: Date.now() - started,
      };
    }
  }

  async testConnection(
    dest: DestinationContext,
    credential?: CredentialContext,
  ): Promise<ConnectionTestResult> {
    const missing = this.validate(dest, credential);
    if (missing.length > 0) {
      return { ok: false, status: "NOT_CONFIGURED", error: `Missing: ${missing.join(", ")}` };
    }
    const url = cfgStr(dest.config, "url");
    if (url === undefined) {
      return { ok: false, status: "NOT_CONFIGURED", error: "Missing: config.url" };
    }
    const started = Date.now();
    try {
      const headers: Record<string, string> = {};
      this.applyAuth(headers, dest.config, credential);
      const res = await safeFetch(url, { method: "HEAD", headers, timeoutMs: 5_000 });
      return {
        ok: res.status < 500,
        status: res.status < 500 ? "CONNECTED" : "ERROR",
        latencyMs: Date.now() - started,
        detail: { httpStatus: res.status },
      };
    } catch (err) {
      return {
        ok: false,
        status: "ERROR",
        error: err instanceof Error ? err.message : "Connection failed",
        latencyMs: Date.now() - started,
      };
    }
  }

  private applyAuth(
    headers: Record<string, string>,
    config: Record<string, unknown>,
    credential?: CredentialContext,
  ): void {
    const authType = (cfgStr(config, "authType") ?? "none") as AuthType;
    if (authType === "none" || !credential) return;
    if (authType === "bearer") {
      headers["authorization"] = `Bearer ${credential.secret}`;
    } else if (authType === "basic") {
      const username = typeof credential.meta.username === "string" ? credential.meta.username : "";
      headers["authorization"] = `Basic ${Buffer.from(`${username}:${credential.secret}`).toString("base64")}`;
    } else if (authType === "apikey") {
      const headerName = cfgStr(config, "apiKeyHeader") ?? "x-api-key";
      headers[headerName] = credential.secret;
    }
  }
}
