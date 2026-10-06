import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { newCorrelationId, runWithContext, getContext, type RequestContext } from "@middleware/shared";

export const CORRELATION_HEADER = "x-correlation-id";
const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Runs BEFORE guards/controllers for every request:
 *  - resolves the correlation id (client-supplied if well-formed, else new)
 *  - opens the AsyncLocalStorage request context (guards enrich it with the
 *    authenticated actor)
 *  - exposes the id to logs and clients (response header)
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_HEADER];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const correlationId =
      typeof candidate === "string" && SAFE_ID.test(candidate) ? candidate : newCorrelationId();

    (req as Request & { correlationId: string }).correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);

    const ctx: RequestContext = {
      correlationId,
      actorType: "SYSTEM",
      ip: req.ip,
    };
    runWithContext(ctx, () => next());
  }
}

/** Current correlation id (for services that need it outside guards). */
export function currentCorrelationId(): string {
  return getContext()?.correlationId ?? "unknown";
}
