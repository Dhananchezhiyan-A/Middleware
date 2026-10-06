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
 * Pipedrive adapter — v1 persons/deals API.
 *
 * Idempotency: searches for an existing record by email before creating;
 * updates when found. This keeps retries from piling up duplicates.
 *
 * Config: { apiBaseUrl?, resource? ('persons'|'deals'|'organizations') }
 * Credential: API_KEY = Pipedrive API token.
 */
export class PipedriveAdapter implements DestinationAdapter {
  readonly type = "PIPEDRIVE" as const;

  validate(dest: DestinationContext, credential?: CredentialContext): string[] {
    return missingKeys(dest, credential, []);
  }

  async deliver(req: DeliveryRequest): Promise<DeliveryResult> {
    const missing = this.validate(req.destination, req.credential);
    if (missing.length > 0) throw notConfigured(missing);

    const cfg = req.destination.config;
    const resource = cfgStr(cfg, "resource") ?? "persons";
    const apiBase = (cfgStr(cfg, "apiBaseUrl") ?? "https://api.pipedrive.com").replace(/\/$/, "");
    const token = req.credential?.secret;
    if (token === undefined) throw notConfigured(["credential"]);

    const email =
      typeof req.mappedPayload.email === "string" ? req.mappedPayload.email.trim() : "";
    const started = Date.now();

    try {
      // 1) Search for an existing record by email (idempotent retries).
      if (email) {
        const searchUrl = `${apiBase}/v1/${encodeURIComponent(resource)}/search?term=${encodeURIComponent(email)}&fields=email&limit=1&api_token=${encodeURIComponent(token)}`;
        const searchRes = await safeFetch(searchUrl, {
          method: "GET",
          timeoutMs: 10_000,
        });
        const existingId = extractSearchedId(searchRes.bodyText);
        if (existingId) {
          const updateUrl = `${apiBase}/v1/${encodeURIComponent(resource)}/${existingId}?api_token=${encodeURIComponent(token)}`;
          const updateRes = await safeFetch(updateUrl, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(req.mappedPayload),
            timeoutMs: 15_000,
          });
          if (updateRes.ok) {
            return successResult(updateRes, { externalId: existingId, requestUrl: updateUrl });
          }
          return failureResult(updateRes, updateUrl);
        }
      }

      // 2) Not found (or no email) → create.
      const createUrl = `${apiBase}/v1/${encodeURIComponent(resource)}?api_token=${encodeURIComponent(token)}`;
      const createRes = await safeFetch(createUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.mappedPayload),
        timeoutMs: 15_000,
      });
      const externalId = extractCreatedId(createRes.bodyText);
      if (createRes.ok) {
        return successResult(createRes, { externalId, requestUrl: createUrl });
      }
      return failureResult(createRes, createUrl);
    } catch (err) {
      return transportError(err, apiBase, Date.now() - started);
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
    const secret = credential?.secret;
    if (secret === undefined) {
      return { ok: false, status: "NOT_CONFIGURED", error: "Missing: credential" };
    }
    const apiBase = (cfgStr(dest.config, "apiBaseUrl") ?? "https://api.pipedrive.com").replace(/\/$/, "");
    const url = `${apiBase}/v1/users/me?api_token=${encodeURIComponent(secret)}`;
    const started = Date.now();
    try {
      const res = await safeFetch(url, { method: "GET", timeoutMs: 8_000 });
      if (res.ok) return { ok: true, status: "CONNECTED", latencyMs: Date.now() - started };
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          status: "ERROR",
          latencyMs: Date.now() - started,
          error: "Pipedrive rejected the API token.",
        };
      }
      return {
        ok: false,
        status: "ERROR",
        latencyMs: Date.now() - started,
        error: `Pipedrive responded with HTTP ${res.status}.`,
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

function extractSearchedId(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as {
      data?: { items?: Array<{ item?: { id?: string | number } }> };
    };
    const id = parsed?.data?.items?.[0]?.item?.id;
    return id !== undefined ? String(id) : undefined;
  } catch {
    return undefined;
  }
}

function extractCreatedId(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { data?: { id?: string | number } };
    const id = parsed?.data?.id;
    return id !== undefined ? String(id) : undefined;
  } catch {
    return undefined;
  }
}
