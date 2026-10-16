import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";
import type { ApiErrorBody, ErrorCode } from "@middleware/types";
import { AppError, errors, toErrorEnvelope, sanitizeDeep, newCorrelationId } from "@middleware/shared";
import { CORRELATION_HEADER } from "../context/request-context.middleware";
import { UnsafeDatabaseError } from "@middleware/config";

/**
 * Maps every possible error to the STANDARD public envelope:
 *
 *   { "success": false, "error": { code, message, requestId } }
 *
 * Raw backend exceptions are logged in full but NEVER returned to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ correlationId?: string; url?: string; method?: string }>();
    // Body-parser errors fire BEFORE RequestContextMiddleware runs — mint an id
    // here so the envelope stays traceable instead of the literal "unknown".
    let requestId = request.correlationId;
    if (!requestId) {
      requestId = newCorrelationId();
      if (!res.headersSent) res.setHeader(CORRELATION_HEADER, requestId);
    }

    const { appError, internal } = this.classify(exception);

    if (internal) {
      this.logger.error(
        `Unhandled exception on ${request.method ?? "?"} ${request.url ?? "?"}`,
        exception instanceof Error ? exception.stack : JSON.stringify(sanitizeDeep(exception)),
      );
    } else if (appError.httpStatus >= 500) {
      this.logger.error(`${appError.code}: ${appError.message}`, appError.stack);
    }

    const envelope: ApiErrorBody = toErrorEnvelope(appError, requestId);
    res.status(appError.httpStatus).json(envelope);
  }

  private classify(exception: unknown): { appError: AppError; internal: boolean } {
    if (exception instanceof AppError) {
      return { appError: exception, internal: false };
    }

    if (exception instanceof ZodError) {
      return {
        appError: errors.validation(
          "Request validation failed.",
          exception.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        ),
        internal: false,
      };
    }

    if (exception instanceof UnsafeDatabaseError) {
      return { appError: errors.internal("Configuration error."), internal: true };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === "string"
          ? body
          : typeof body === "object" && body !== null && "message" in body
            ? String((body as { message: unknown }).message)
            : exception.message;
      if (
        status === 400 &&
        (exception instanceof SyntaxError ||
          /(?:expected property name|unexpected token|json.*(?:position|column)|unexpected end of json)/i.test(
            message,
          ))
      ) {
        return {
          appError: new AppError("INVALID_JSON", "Malformed JSON request body."),
          internal: false,
        };
      }
      const code = this.httpStatusToCode(status);
      // nestjs-zod's ZodValidationException carries per-field issues in `errors`;
      // surface them as `details` so clients can highlight the offending fields.
      const fieldErrors =
        typeof body === "object" && body !== null && "errors" in body
          ? (body as { errors?: unknown }).errors
          : undefined;
      // Nest throttler/auth built-ins → standard codes, safe messages.
      return {
        appError:
          status < 500 && Array.isArray(fieldErrors) && fieldErrors.length > 0
            ? new AppError(code, message || "Request failed.", { details: fieldErrors })
            : new AppError(code, message || "Request failed."),
        internal: false,
      };
    }

    // Express-level http-errors from the body parser (entity.too.large,
    // entity.parse.failed, unsupported charset…) — plain objects carrying
    // { status, expose, type }, not Nest HttpExceptions. Without this branch
    // an oversized payload fell through to errors.internal() → a 500.
    const maybeHttpErr = exception as {
      status?: unknown;
      statusCode?: unknown;
      expose?: unknown;
      type?: unknown;
    };
    const expressStatus =
      typeof maybeHttpErr?.status === "number"
        ? maybeHttpErr.status
        : typeof maybeHttpErr?.statusCode === "number"
          ? maybeHttpErr.statusCode
          : undefined;
    if (
      expressStatus !== undefined &&
      expressStatus >= 400 &&
      expressStatus < 500 &&
      (maybeHttpErr.expose === true || typeof maybeHttpErr.type === "string")
    ) {
      const parseFailed = maybeHttpErr.type === "entity.parse.failed";
      const message =
        expressStatus === 413
          ? "Request payload exceeds the configured limit."
          : expressStatus === 415
            ? "Unsupported content type."
            : parseFailed
              ? "Malformed JSON request body."
              : "Malformed request body.";
      return {
        appError: new AppError(
          parseFailed ? "INVALID_JSON" : this.httpStatusToCode(expressStatus),
          message,
        ),
        internal: false,
      };
    }

    // multer upload errors (file too large, wrong field, too many files) —
    // plain Error subclasses carrying a `code`, not Nest HttpExceptions.
    // Without this branch an oversized CSV upload fell through to
    // errors.internal() → a 500 for what is an ordinary client error.
    const maybeMulter = exception as { name?: unknown; code?: unknown };
    if (maybeMulter?.name === "MulterError" && typeof maybeMulter.code === "string") {
      const tooLarge = maybeMulter.code === "LIMIT_FILE_SIZE";
      return {
        appError: new AppError(
          tooLarge ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
          tooLarge ? "Uploaded file exceeds the size limit." : "Invalid file upload.",
        ),
        internal: false,
      };
    }

    // Prisma runtime errors (unique violation, connection issues…)
    const maybePrisma = exception as { code?: string; meta?: unknown };
    if (typeof maybePrisma?.code === "string" && maybePrisma.code.startsWith("P")) {
      if (maybePrisma.code === "P2002") {
        return {
          appError: new AppError("CONFLICT", "A record with the same unique value already exists."),
          internal: false,
        };
      }
      if (maybePrisma.code === "P2025") {
        return { appError: errors.notFound(), internal: false };
      }
      return { appError: errors.database(), internal: true };
    }

    return { appError: errors.internal(), internal: true };
  }

  private httpStatusToCode(status: number): ErrorCode {
    switch (status) {
      case 400:
        return "BAD_REQUEST";
      case 401:
        return "UNAUTHENTICATED";
      case 403:
        return "FORBIDDEN";
      case 404:
        return "NOT_FOUND";
      case 409:
        return "CONFLICT";
      case 413:
        return "PAYLOAD_TOO_LARGE";
      case 415:
        return "UNSUPPORTED_MEDIA_TYPE";
      case 422:
        return "VALIDATION_FAILED";
      case 429:
        return "RATE_LIMITED";
      case 503:
        return "SERVICE_UNAVAILABLE";
      case 504:
        return "TIMEOUT";
      default:
        return status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
    }
  }
}
