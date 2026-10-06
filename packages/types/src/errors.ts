/**
 * Machine-readable error codes and the standard API error envelope.
 *
 * Rules:
 *  - Codes are STABLE contract values (clients may branch on them).
 *  - User-facing messages are safe; technical detail stays in server logs.
 *  - Raw backend exceptions are never exposed to clients.
 */

export const ERROR_CODES = {
  // Generic
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  TIMEOUT: 504,

  // Intake / webhooks
  WEBHOOK_SIGNATURE_INVALID: 401,
  WEBHOOK_UNKNOWN_SOURCE: 404,
  WEBHOOK_PAYLOAD_INVALID: 422,
  SOURCE_ACCOUNT_NOT_FOUND: 404,
  INVALID_JSON: 400,
  IDEMPOTENT_REPLAY: 200,

  // Lead processing
  LEAD_VALIDATION_FAILED: 422,
  LEAD_NOT_PROCESSABLE: 409,
  LEAD_DUPLICATE: 409,

  // Destinations / delivery
  DESTINATION_NOT_CONFIGURED: 422,
  DESTINATION_AUTH_FAILED: 502,
  DESTINATION_TIMEOUT: 504,
  DESTINATION_RATE_LIMITED: 429,
  DESTINATION_REJECTED: 422,
  DESTINATION_SERVER_ERROR: 502,
  DESTINATION_UNREACHABLE: 502,
  DESTINATION_SSRF_BLOCKED: 400,
  DELIVERY_DEAD: 410,
  DELIVERY_NOT_RETRYABLE: 409,

  // Storage / imports
  IMPORT_FILE_INVALID: 422,
  IMPORT_TOO_LARGE: 413,
  STORAGE_ERROR: 500,

  // Infra
  DATABASE_ERROR: 500,
  QUEUE_UNAVAILABLE: 503,
  CONFIG_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export type ApiResponse<T> = ApiSuccessBody<T> | ApiErrorBody;
