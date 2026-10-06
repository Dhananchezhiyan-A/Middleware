import type { DestinationType } from "@middleware/types";
import type {
  ConnectionTestResult,
  CredentialContext,
  DestinationContext,
} from "../types";
import { CustomApiAdapter } from "./custom-api";
import { cfgStr } from "./helpers";

/**
 * DCT CRM adapter.
 *
 * DCT CRM exposes a REST API (see the DCT-CRMM service). Configuration:
 *   { baseUrl, createPath?, method?, authType?, apiKeyHeader?,
 *     idempotencyHeader? }   (authType defaults to "bearer")
 * Credential: the DCT CRM API token (BEARER) or API key.
 *
 * Delivery always sends the stable Idempotency-Key header so DCT CRM can
 * deduplicate retried deliveries.
 */
export class DctCrmAdapter extends CustomApiAdapter {
  override readonly type: DestinationType = "DCT_CRM";

  /** Injects DCT-specific defaults (URL composition, auth, idempotency). */
  private withDefaults(dest: DestinationContext): DestinationContext {
    if (cfgStr(dest.config, "url")) return dest;
    const baseUrl = cfgStr(dest.config, "baseUrl");
    if (!baseUrl) return dest;
    const path = cfgStr(dest.config, "createPath") ?? "/api/leads";
    const url = `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
    return {
      ...dest,
      config: {
        ...dest.config,
        url,
        method: dest.config.method ?? "POST",
        authType: dest.config.authType ?? "bearer",
        idempotencyHeader: dest.config.idempotencyHeader ?? "Idempotency-Key",
      },
    };
  }

  override validate(dest: DestinationContext, credential?: CredentialContext): string[] {
    const missing = super.validate(this.withDefaults(dest), credential);
    if (!cfgStr(dest.config, "url") && !cfgStr(dest.config, "baseUrl")) {
      missing.push("config.baseUrl");
    }
    return [...new Set(missing)];
  }

  override async testConnection(
    dest: DestinationContext,
    credential?: CredentialContext,
  ): Promise<ConnectionTestResult> {
    return super.testConnection(this.withDefaults(dest), credential);
  }
}
