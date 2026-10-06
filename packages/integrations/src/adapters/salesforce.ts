import type {
  ConnectionTestResult,
  CredentialContext,
  DeliveryRequest,
  DeliveryResult,
  DestinationAdapter,
  DestinationContext,
} from "../types";
import { safeFetch } from "../http";
import { cfgStr, failureResult, missingKeys, notConfigured, successResult } from "./helpers";

/**
 * Salesforce adapter — REST sObject create/upsert.
 *
 * Idempotency: when `config.externalIdField` (a custom External ID field API
 * name) is configured, retries use PATCH upsert so a timed-out-then-created
 * lead can never be duplicated on retry.
 *
 * Config: { instanceUrl, sObject?, apiVersion?, externalIdField? }
 * Credential: BEARER = OAuth access token.
 */
export class SalesforceAdapter implements DestinationAdapter {
  readonly type = "SALESFORCE" as const;

  validate(dest: DestinationContext, credential?: CredentialContext): string[] {
    return missingKeys(dest, credential, ["instanceUrl"]);
  }

  async deliver(req: DeliveryRequest): Promise<DeliveryResult> {
    const missing = this.validate(req.destination, req.credential);
    if (missing.length > 0) throw notConfigured(missing);

    const cfg = req.destination.config;
    const instanceUrlRaw = cfgStr(cfg, "instanceUrl");
    if (instanceUrlRaw === undefined) throw notConfigured(["config.instanceUrl"]);
    const instanceUrl = instanceUrlRaw.replace(/\/$/, "");
    const sObject = cfgStr(cfg, "sObject") ?? "Lead";
    const apiVersion = cfgStr(cfg, "apiVersion") ?? "v60.0";
    const externalIdField = cfgStr(cfg, "externalIdField");
    const secret = req.credential?.secret;
    if (secret === undefined) throw notConfigured(["credential"]);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    };

    const upserting = Boolean(externalIdField);
    const url = upserting
      ? `${instanceUrl}/services/data/${apiVersion}/sobjects/${sObject}/${externalIdField}/${encodeURIComponent(req.idempotencyKey)}`
      : `${instanceUrl}/services/data/${apiVersion}/sobjects/${sObject}`;

    const started = Date.now();
    try {
      const res = await safeFetch(url, {
        method: upserting ? "PATCH" : "POST",
        headers,
        body: JSON.stringify(req.mappedPayload),
        timeoutMs: 15_000,
      });
      // Upsert → 204 with a Location header; create → 201 with body id.
      const location = res.headers.get("location");
      const externalId = location
        ? location.slice(location.lastIndexOf("/") + 1)
        : (parseJsonField(res.bodyText, "id") ?? undefined);
      if (res.ok) return successResult(res, { externalId, requestUrl: url });
      return failureResult(res, url);
    } catch (err) {
      return transportError(err, url, Date.now() - started);
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
    const instanceUrlRaw = cfgStr(dest.config, "instanceUrl");
    if (instanceUrlRaw === undefined) {
      return { ok: false, status: "NOT_CONFIGURED", error: "Missing: config.instanceUrl" };
    }
    const instanceUrl = instanceUrlRaw.replace(/\/$/, "");
    const apiVersion = cfgStr(dest.config, "apiVersion") ?? "v60.0";
    const url = `${instanceUrl}/services/data/${apiVersion}/sobjects`;
    const secret = credential?.secret;
    if (secret === undefined) {
      return { ok: false, status: "NOT_CONFIGURED", error: "Missing: credential" };
    }
    const started = Date.now();
    try {
      const res = await safeFetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${secret}` },
        timeoutMs: 8_000,
      });
      if (res.ok) return { ok: true, status: "CONNECTED", latencyMs: Date.now() - started };
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          status: "ERROR",
          latencyMs: Date.now() - started,
          error: "Salesforce rejected the access token (expired or invalid).",
        };
      }
      return {
        ok: false,
        status: "ERROR",
        latencyMs: Date.now() - started,
        error: `Salesforce responded with HTTP ${res.status}.`,
      };
    } catch (err) {
      return {
        ok: false,
        status: "ERROR",
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }
}

function parseJsonField(body: string, field: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && field in (parsed as object)) {
      const v = (parsed as Record<string, unknown>)[field];
      if (typeof v === "string") return v;
    }
  } catch {
    /* not JSON — ignore */
  }
  return undefined;
}

export function transportError(err: unknown, url: string, durationMs: number): DeliveryResult {
  const e = err as { code?: string; message?: string; retryable?: boolean };
  return {
    success: false,
    errorCode: e.code as DeliveryResult["errorCode"],
    errorMessage: e.message ?? "Destination request failed.",
    retryable: e.retryable ?? false,
    requestUrl: url,
    durationMs,
  };
}
