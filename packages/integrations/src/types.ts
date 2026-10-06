import type {
  CanonicalLead,
  ConnectionStatus,
  CredentialType,
  DestinationType,
  ErrorCode,
} from "@middleware/types";

/** Non-secret destination configuration (DB `Destination.config`). */
export interface DestinationContext {
  id: string;
  type: DestinationType;
  name: string;
  config: Record<string, unknown>;
  rateLimitPerSec?: number | null;
}

/** Decrypted credential material — NEVER logged, NEVER returned by APIs. */
export interface CredentialContext {
  type: CredentialType;
  secret: string;
  meta: Record<string, unknown>;
}

export interface DeliveryRequest {
  destination: DestinationContext;
  credential?: CredentialContext;
  lead: {
    id: string;
    externalLeadId?: string | null;
    canonical: CanonicalLead;
  };
  /** Payload produced by the field-mapping engine for this destination. */
  mappedPayload: Record<string, unknown>;
  correlationId: string;
  attempt: number;
  /**
  * Stable identity for this delivery (lead|destination) — adapters
   * that support idempotent upserts use it to make retries safe.
   */
  idempotencyKey: string;
}

export interface DeliveryResult {
  success: boolean;
  /** Destination-side record id, when the destination returns one. */
  externalId?: string;
  responseStatus?: number;
  /** Sanitized, size-capped response body for the delivery timeline. */
  responseBody?: string;
  errorCode?: ErrorCode;
  /** SAFE user-facing message (no secrets, no raw exceptions). */
  errorMessage?: string;
  /** Whether a retry can plausibly succeed. */
  retryable: boolean;
  rateLimited?: boolean;
  /** Honors Retry-After when the destination provides it. */
  retryAfterMs?: number;
  durationMs: number;
  requestUrl?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: ConnectionStatus;
  latencyMs?: number;
  /** SAFE error message — never contains credentials. */
  error?: string;
  detail?: Record<string, unknown>;
}

/**
 * The contract every destination integration implements.
 *
 * The core pipeline never contains CRM-specific logic — it only calls this
 * interface. New destinations = new adapter, zero pipeline changes.
 */
export interface DestinationAdapter {
  readonly type: DestinationType;

  /**
   * Returns the list of missing/invalid configuration keys.
   * An empty array means the destination is configured.
   * Anything else surfaces as DESTINATION_NOT_CONFIGURED — never a fake
   * success.
   */
  validate(destination: DestinationContext, credential?: CredentialContext): string[];

  /** Executes one delivery attempt. NEVER throws for HTTP failures. */
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;

  /** Real connectivity/auth probe used by the Destination Health UI. */
  testConnection(
    destination: DestinationContext,
    credential?: CredentialContext,
  ): Promise<ConnectionTestResult>;
}
