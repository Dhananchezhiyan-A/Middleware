import { CallHandler, ExecutionContext, Injectable, type NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, map } from "rxjs";
import type { ApiSuccessBody } from "@middleware/types";

export const SKIP_TRANSFORM_KEY = "skipResponseTransform";

/** Marks a handler whose raw response must NOT be wrapped (file streams…). */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);

/**
 * Standard success envelope: every JSON response becomes
 *   { "success": true, "data": … }
 * so clients always get a consistent shape. Errors go through the exception
 * filter into the matching error envelope.
 */
@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const res = context.switchToHttp().getResponse<{ headersSent?: boolean }>();
    return next.handle().pipe(
      map((payload: unknown) => {
        if (res.headersSent) return payload;
        if (payload === undefined || payload === null) {
          return { success: true, data: null } satisfies ApiSuccessBody<null>;
        }
        if (Buffer.isBuffer(payload) || typeof payload === "string") return payload;
        const obj = payload as { success?: unknown };
        if (obj && typeof obj === "object" && "success" in obj) return payload;
        return { success: true, data: payload } satisfies ApiSuccessBody<unknown>;
      }),
    );
  }
}
