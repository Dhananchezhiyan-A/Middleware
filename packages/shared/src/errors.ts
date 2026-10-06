import { ERROR_CODES, type ApiErrorBody, type ErrorCode } from "@middleware/types";

/**
 * Typed application errors.
 *
 * - `code` is a stable machine contract (see ERROR_CODES).
 * - `message` is SAFE to show users (generic, non-sensitive).
 * - `detail` is internal-only context for logs (never returned to clients
 *   unless `exposeDetails` is explicitly true AND sanitized).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly exposeDetails?: unknown;
  /** Whether the client may retry the same request later. */
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { cause?: unknown; details?: unknown; retryable?: boolean; httpStatus?: number },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? ERROR_CODES[code] ?? 500;
    this.exposeDetails = options?.details;
    this.retryable = options?.retryable ?? false;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

// --- Constructors -----------------------------------------------------------

export const errors = {
  badRequest: (message = "The request could not be processed.", details?: unknown) =>
    new AppError("BAD_REQUEST", message, { details }),
  validation: (message = "Request validation failed.", details?: unknown) =>
    new AppError("VALIDATION_FAILED", message, { details }),
  unauthenticated: (message = "Authentication is required.") =>
    new AppError("UNAUTHENTICATED", message),
  tokenExpired: (message = "Session expired. Please sign in again.") =>
    new AppError("TOKEN_EXPIRED", message),
  forbidden: (message = "You do not have permission to perform this action.") =>
    new AppError("FORBIDDEN", message),
  notFound: (message = "The requested resource was not found.") =>
    new AppError("NOT_FOUND", message),
  conflict: (message = "The request conflicts with the current state.", details?: unknown) =>
    new AppError("CONFLICT", message, { details }),
  rateLimited: (message = "Too many requests. Please slow down.") =>
    new AppError("RATE_LIMITED", message, { retryable: true }),
  payloadTooLarge: (message = "The payload exceeds the configured size limit.") =>
    new AppError("PAYLOAD_TOO_LARGE", message),
  internal: (message = "An unexpected error occurred.", cause?: unknown) =>
    new AppError("INTERNAL_ERROR", message, { cause }),
  database: (message = "A database error occurred.", cause?: unknown) =>
    new AppError("DATABASE_ERROR", message, { cause }),
  queueUnavailable: (message = "The job queue is unavailable.", cause?: unknown) =>
    new AppError("QUEUE_UNAVAILABLE", message, { cause, retryable: true }),
  destinationNotConfigured: (missing: string[]) =>
    new AppError(
      "DESTINATION_NOT_CONFIGURED",
      `Destination is not configured. Missing: ${missing.join(", ")}`,
      { details: { missing } },
    ),
  destinationTimeout: (timeoutMs: number) =>
    new AppError(
      "DESTINATION_TIMEOUT",
      `Destination did not respond within ${timeoutMs}ms.`,
      { retryable: true },
    ),
  webhookSignatureInvalid: () =>
    new AppError("WEBHOOK_SIGNATURE_INVALID", "Webhook signature verification failed."),
};

// --- Standard error envelope ----------------------------------------------

/**
 * Builds the public error response. Only the safe message and the code are
 * exposed; the full technical error stays in server logs.
 */
export function toErrorEnvelope(err: AppError, requestId: string): ApiErrorBody {
  return {
    success: false,
    error: {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.exposeDetails !== undefined ? { details: err.exposeDetails } : {}),
    },
  };
}
