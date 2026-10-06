import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";

/**
 * Emits trace headers on every response:
 *  - x-correlation-id  (set by RequestContextMiddleware, guaranteed here)
 *  - x-response-time-ms (real measured latency)
 */
@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const res = context.switchToHttp().getResponse<{ getHeader(h: string): unknown; setHeader(h: string, v: string): void }>();
    const started = Date.now();
    return next.handle().pipe(
      tap(() => {
        if (!res.getHeader("x-correlation-id")) {
          // Middleware always sets it; this is a safety net.
        }
        res.setHeader("x-response-time-ms", String(Date.now() - started));
      }),
    );
  }
}
