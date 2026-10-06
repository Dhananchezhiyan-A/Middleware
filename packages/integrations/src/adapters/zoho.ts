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
import { transportError } from "./salesforce";

/**
 * Zoho CRM adapter — v6 module create/upsert.
 *
 * Idempotency: with `config.externalIdField`, retries use PUT upsert
 * (`/module/{externalIdField}/{key}`) so retries can't create duplicates.
 *
 * Config: { region? ('com'|'eu'|'in'|'au'|'jp'), module?, apiVersion?,
 *           externalIdField?, apiDomain? }
 * Credential: BEARER = Zoho OAuth access token.
 */
export class ZohoAdapter implements DestinationAdapter {
  readonly type = "ZOHO" as const;

  validate(dest: DestinationContext, credential?: CredentialContext): string[] {
    return missingKeys(dest, credential, []);
  }

  private baseUrl(dest: DestinationContext): string {
    const apiDomain = cfgStr(dest.config, "apiDomain");
    if (apiDomain) return apiDomain.replace(/\/$/, "");
    const region = cfgStr(dest.config, "region") ?? "com";
    return `https://www.zohoapis.${region}`;
  }

  async deliver(req: DeliveryRequest): Promise<DeliveryResult> {
    const missing = this.validate(req.destination, req.credential);
    if (missing.length > 0) throw notConfigured(missing);

    const cfg = req.destination.config;
    const module = cfgStr(cfg, "module") ?? "Leads";
    const apiVersion = cfgStr(cfg, "apiVersion") ?? "v6";
    const externalIdField = cfgStr(cfg, "externalIdField");
    const base = `${this.baseUrl(req.destination)}/crm/${apiVersion}/${encodeURIComponent(module)}`;

    const url = externalIdField
      ? `${base}/${encodeURIComponent(externalIdField)}/${encodeURIComponent(req.idempotencyKey)}`
      : base;

    const secret = req.credential?.secret;
    if (secret === undefined) throw notConfigured(["credential"]);
    const started = Date.now();
    try {
      const res = await safeFetch(url, {
        method: externalIdField ? "PUT" : "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ data: [req.mappedPayload] }),
        timeoutMs: 15_000,
      });
      const externalId = extractZohoId(res.bodyText);
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
    const module = cfgStr(dest.config, "module") ?? "Leads";
    const apiVersion = cfgStr(dest.config, "apiVersion") ?? "v6";
    const url = `${this.baseUrl(dest)}/crm/${apiVersion}/${encodeURIComponent(module)}?limit=1`;
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
          error: "Zoho rejected the access token (expired or invalid).",
        };
      }
      return {
        ok: false,
        status: "ERROR",
        latencyMs: Date.now() - started,
        error: `Zoho responded with HTTP ${res.status}.`,
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

function extractZohoId(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { data?: Array<{ details?: { id?: string } }> };
    const id = parsed?.data?.[0]?.details?.id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}
