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
 * HubSpot adapter — CRM v3 objects API.
 *
 * Idempotency: PATCH upsert by unique property (default `email`) —
 * `PATCH /crm/v3/objects/{type}/{value}?idProperty={prop}` never creates a
 * second contact for the same email, even across retries.
 *
 * Config: { objectType? ('contacts'|'companies'|...), idProperty?, apiBaseUrl? }
 * Credential: BEARER = private-app access token.
 */
export class HubSpotAdapter implements DestinationAdapter {
  readonly type = "HUBSPOT" as const;

  validate(dest: DestinationContext, credential?: CredentialContext): string[] {
    return missingKeys(dest, credential, []);
  }

  async deliver(req: DeliveryRequest): Promise<DeliveryResult> {
    const missing = this.validate(req.destination, req.credential);
    if (missing.length > 0) throw notConfigured(missing);

    const cfg = req.destination.config;
    const objectType = cfgStr(cfg, "objectType") ?? "contacts";
    const idProperty = cfgStr(cfg, "idProperty") ?? "email";
    const apiBase = (cfgStr(cfg, "apiBaseUrl") ?? "https://api.hubapi.com").replace(/\/$/, "");

    const idValue = req.mappedPayload[idProperty];
    const hasIdValue = typeof idValue === "string" && idValue.trim().length > 0;

    const url = hasIdValue
      ? `${apiBase}/crm/v3/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(idValue)}?idProperty=${encodeURIComponent(idProperty)}`
      : `${apiBase}/crm/v3/objects/${encodeURIComponent(objectType)}`;

    const secret = req.credential?.secret;
    if (secret === undefined) throw notConfigured(["credential"]);
    const started = Date.now();
    try {
      const res = await safeFetch(url, {
        method: hasIdValue ? "PATCH" : "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ properties: req.mappedPayload }),
        timeoutMs: 15_000,
      });
      const externalId = parseId(res.bodyText);
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
    const objectType = cfgStr(dest.config, "objectType") ?? "contacts";
    const apiBase = (cfgStr(dest.config, "apiBaseUrl") ?? "https://api.hubapi.com").replace(/\/$/, "");
    const url = `${apiBase}/crm/v3/objects/${encodeURIComponent(objectType)}?limit=1`;
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
          error: "HubSpot rejected the access token (expired or invalid).",
        };
      }
      return {
        ok: false,
        status: "ERROR",
        latencyMs: Date.now() - started,
        error: `HubSpot responded with HTTP ${res.status}.`,
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

function parseId(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { id?: string | number };
    return parsed?.id !== undefined ? String(parsed.id) : undefined;
  } catch {
    return undefined;
  }
}
